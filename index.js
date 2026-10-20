/**
 * 鲸鱼娘 Bot · DSH 插件（Host 半边）
 *
 * 职责（对照《方案-鲸鱼娘DSH插件化-20261020.md》）：
 *   1. 进程托管：拉起 / 停掉 Python 侧车（取代 `_botctl.ps1` 与一堆 .bat）
 *   2. 同源代理：`/whalegirl/api/*` → `http://127.0.0.1:8080/api/*`，
 *      浏览器不直连 8080，也就不需要 CORS、不暴露端口
 *   3. 9 个 `whalegirl_*` 工具，让模型能在对话里指挥机器人
 *
 * 侧车本身（deepseekgirl）不改结构：微信 UIA、faster-whisper、SoulX-Singer /
 * ACE-Step（conda + GPU）这些都留在 Python 侧，插件只做控制面。
 *
 * ⚠️ 2026-10-20 装了第一版之后 DSH 直接不可用，且系统事件日志里没有任何崩溃
 * 记录 ⇒ 判定为主进程里的 uncaughtException / unhandledRejection。
 * 所以这一版的原则是：**插件任何一处失败，都不许把宿主带走**。
 *   - apply 整体 try/catch，注册失败只降级 + 写日志；
 *   - 所有 Promise 都有 catch；
 *   - 代理对 req / res / upstream 全部挂 error 处理，绝不留下未处理的 'error' 事件；
 *   - 自动启动默认关闭（改成用户点一下），首次安装不再在 HMR 期间拉进程；
 *   - 自己的日志落 `~/.dsh/whalegirl/plugin.log`，下次出问题有据可查。
 */

import http from 'node:http';
import path from 'node:path';

import { createBotClient } from './lib/bot.js';
import { createLog, logError, logPath } from './lib/log.js';
import { createSupervisor } from './lib/supervisor.js';
import { registerTools } from './lib/tools.js';
import {
  clampNumber,
  isLoopbackRequest,
  readJsonBody,
  writeJson,
} from './lib/util.js';

export const name = 'dsh-we-whalegirl';

const PREFIX = '/dsh-we-whalegirl';
// 默认留空：发布到公共仓库不能把你本机的路径写死。
// 安装后在 cordis.patch.yml 的 botRoot 里填，或把机器人放在任意目录后配置。
const DEFAULT_BOT_ROOT = '';

function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const botRoot = String(input.botRoot || DEFAULT_BOT_ROOT).trim();
  const pythonExe = String(
    input.pythonExe ||
      (botRoot ? path.join(botRoot, '.venv', 'Scripts', 'python.exe') : ''),
  ).trim();
  const mode = ['auto', 'attach', 'manual'].includes(String(input.mode))
    ? String(input.mode)
    : 'auto';
  return {
    botRoot,
    pythonExe,
    port: Math.round(clampNumber(input.port, 8080, 1, 65535)),
    mode,
    // 默认关：首次安装 / HMR 期间不自动拉进程，让用户手动点「启动」
    autoStart: input.autoStart === true,
    stopOnExit: Boolean(input.stopOnExit),
    allowAnyRoom: Boolean(input.allowAnyRoom),
    automaticRestart: Boolean(input.automaticRestart),
    enablePanel: input.enablePanel === true,
    logFile: logPath(),
  };
}

export function apply(ctx, rawConfig) {
  const log = createLog('host');

  try {
    const cfg = normalizeConfig(rawConfig);
    log(
      `激活：botRoot=${cfg.botRoot} port=${cfg.port} mode=${cfg.mode} ` +
        `autoStart=${cfg.autoStart} panel=${cfg.enablePanel}`,
    );

    const bot = createBotClient(cfg);
    const supervisor = createSupervisor(ctx, cfg, bot, log);

    // ------------------------------------------------------------ 清理
    try {
      ctx.effect(
        () => () => {
          try {
            supervisor.dispose();
          } catch (error) {
            logError(log, 'dispose supervisor', error);
          }
          try {
            bot.dispose();
          } catch (error) {
            logError(log, 'dispose bot client', error);
          }
          log('已卸载');
        },
        'whalegirl: clients',
      );
    } catch (error) {
      logError(log, '注册清理钩子', error);
    }

    // ------------------------------------------------------------ 代理
    function safeEnd(res) {
      try {
        if (!res.writableEnded) res.end();
      } catch {
        /* ignore */
      }
    }

    function proxy(req, res) {
      let settled = false;
      let upstream;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        const message = String(error?.message ?? error);
        log(`代理失败 ${req.method} ${req.url}: ${message}`);
        try {
          if (!res.headersSent) {
            writeJson(res, 503, {
              ok: false,
              offline: true,
              message: `鲸鱼娘本体没响应（127.0.0.1:${cfg.port}）：${message}`,
              hint: '点「启动」或检查 deepseekgirl 目录 / .venv 是否正常',
            });
          } else {
            safeEnd(res);
          }
        } catch {
          safeEnd(res);
        }
        try {
          upstream?.destroy();
        } catch {
          /* ignore */
        }
      };

      // 客户端提前断开时 req/res 会发 error，必须有人接，否则主进程崩
      req.on('error', fail);
      res.on('error', fail);
      res.on('close', () => {
        if (!res.writableEnded) {
          try {
            upstream?.destroy();
          } catch {
            /* ignore */
          }
        }
      });

      try {
        const original = new URL(req.url, 'http://127.0.0.1');
        const rest = original.pathname.slice(PREFIX.length) || '/';
        const targetPath = `${rest}${original.search}`;

        const headers = { ...req.headers, host: `127.0.0.1:${cfg.port}` };
        delete headers.connection;

        upstream = http.request(
          {
            host: '127.0.0.1',
            port: cfg.port,
            method: req.method,
            path: targetPath,
            headers,
            timeout: 900000,
          },
          (upRes) => {
            if (settled) {
              safeEnd(upRes);
              return;
            }
            settled = true;
            try {
              res.writeHead(upRes.statusCode ?? 502, upRes.headers);
            } catch (error) {
              fail(error);
              return;
            }
            upRes.on('error', fail);
            upRes.on('aborted', () => safeEnd(res));
            // 手动搬运而不是 pipe：pipe 要求 res 是完整的 Writable，
            // 一旦客户端已断开/被替换，pipe 会在回调里抛，可能直接带走进程。
            upRes.on('data', (chunk) => {
              try {
                if (!res.writableEnded) res.write(chunk);
              } catch (error) {
                fail(error);
              }
            });
            upRes.on('end', () => safeEnd(res));
          },
        );

        upstream.on('timeout', () => {
          upstream.destroy(new Error('上游超时'));
        });
        upstream.on('error', fail);

        if (req.method === 'GET' || req.method === 'HEAD') {
          upstream.end();
        } else {
          req.pipe(upstream);
        }
      } catch (error) {
        fail(error);
      }
    }

    // ------------------------------------------------------------ 本机接口
    async function handleLocal(req, res, pathname) {
      if (pathname === '/local/health') {
        writeJson(res, 200, {
          ok: true,
          name,
          logFile: logPath(),
          config: cfg,
          supervisor: supervisor.snapshot(),
        });
        return true;
      }

      if (pathname === '/local/supervisor' && req.method === 'GET') {
        const snapshot = supervisor.snapshot();
        const busy = await bot.busyState().catch(() => ({
          online: false,
          running: false,
          queue: 0,
          pipelineRunning: false,
          wechat: 'unknown',
        }));
        writeJson(res, 200, {
          ok: true,
          supervisor: snapshot,
          online: busy.online,
          running: busy.running,
          queue: busy.queue,
          pipelineRunning: busy.pipelineRunning,
          wechat: busy.wechat,
          config: cfg,
        });
        return true;
      }

      if (pathname === '/local/config' && req.method === 'GET') {
        writeJson(res, 200, {
          ok: true,
          config: cfg,
          note: '这些是插件自身的基础设施配置，改它要编辑 profile 的 cordis.patch.yml',
        });
        return true;
      }

      if (pathname === '/local/start' && req.method === 'POST') {
        await readJsonBody(req);
        writeJson(res, 200, await supervisor.start());
        return true;
      }

      if (pathname === '/local/stop' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body && body.platform) {
          try {
            writeJson(res, 200, await bot.stopPlatform(String(body.platform)));
          } catch (error) {
            writeJson(res, 200, { ok: false, message: String(error?.message ?? error) });
          }
          return true;
        }
        writeJson(res, 200, await supervisor.stop({ killProcess: true }));
        return true;
      }

      if (pathname === '/local/restart' && req.method === 'POST') {
        const body = (await readJsonBody(req)) ?? {};
        writeJson(res, 200, await supervisor.restart({ force: Boolean(body.force) }));
        return true;
      }

      return false;
    }

    function makeHandler() {
      return async (req, res) => {
        try {
          if (!isLoopbackRequest(req)) {
            writeJson(res, 403, { ok: false, message: '只接受本机请求' });
            return;
          }
          let pathname = '/';
          try {
            pathname = new URL(req.url, 'http://127.0.0.1').pathname;
          } catch {
            writeJson(res, 400, { ok: false, message: '无效请求路径' });
            return;
          }
          if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) {
            writeJson(res, 404, { ok: false, message: 'not found' });
            return;
          }
          const inner = pathname.slice(PREFIX.length) || '/';
          if (inner.startsWith('/local/')) {
            const handled = await handleLocal(req, res, inner);
            if (handled) return;
            writeJson(res, 404, { ok: false, message: `未知的本地接口 ${inner}` });
            return;
          }
          proxy(req, res);
        } catch (error) {
          logError(log, `请求处理 ${req.url}`, error);
          try {
            if (!res.headersSent) {
              writeJson(res, 500, { ok: false, message: String(error?.message ?? error) });
            } else {
              safeEnd(res);
            }
          } catch {
            safeEnd(res);
          }
        }
      };
    }

    // ------------------------------------------------------------ 路由注册
    try {
      ctx.inject(['webServer'], (sctx) => {
        try {
          sctx.effect(() => {
            // 与 dsh-bili-scroll 同款取法：inject 之后既可能是属性，也可能只能 get
            const server =
              (typeof sctx.get === 'function' ? sctx.get('webServer') : undefined) ??
              sctx.webServer;
            if (!server || typeof server.register !== 'function') {
              log('webServer 不可用，跳过代理路由（设置页会显示离线）');
              return () => {};
            }
            const dispose = server.register({
              kind: 'prefix',
              path: PREFIX,
              handler: makeHandler(),
            });
            log(`已挂载 ${PREFIX}/* → 127.0.0.1:${cfg.port}`);
            return () => {
              try {
                dispose();
              } catch (error) {
                logError(log, '注销路由', error);
              }
            };
          }, 'whalegirl: bridge routes');
        } catch (error) {
          logError(log, '注册路由', error);
        }
      });
    } catch (error) {
      logError(log, '注入 webServer', error);
    }

    // ------------------------------------------------------------ 工具注册
    try {
      ctx.inject(['tools'], (sctx) => {
        try {
          sctx.effect(() => {
            const registry =
              (typeof sctx.get === 'function' ? sctx.get('tools') : undefined) ?? sctx.tools;
            if (!registry || typeof registry.register !== 'function') {
              log('tools 不可用，跳过工具注册');
              return () => {};
            }
            return registerTools(
              { tools: registry },
              { bot, supervisor, cfg, log },
            );
          }, 'whalegirl: agent tools');
        } catch (error) {
          logError(log, '注册工具', error);
        }
      });
    } catch (error) {
      logError(log, '注入 tools', error);
    }

    // ------------------------------------------------------------ 自动启动
    if (cfg.autoStart) {
      try {
        ctx.effect(() => {
          const timer = setTimeout(() => {
            supervisor
              .start()
              .then((result) => {
                log(`自动启动：${result.ok ? result.message : `未完成（${result.message}）`}`);
              })
              .catch((error) => logError(log, '自动启动', error));
          }, 10000);
          if (typeof timer.unref === 'function') timer.unref();
          return () => clearTimeout(timer);
        }, 'whalegirl: autostart');
      } catch (error) {
        logError(log, '注册自动启动', error);
      }
    }
  } catch (error) {
    // 最后一道网：apply 自己炸了也只降级，绝不把异常抛回宿主
    logError(log, 'apply', error);
  }
}
