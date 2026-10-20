/**
 * 进程托管：把鲸鱼娘 Python 侧车拉起来 / 停下去 / 重启。
 *
 * 取代原来的 `_botctl.ps1`（以及一堆 .bat）。为什么不用 PowerShell：
 * 改 .ps1 会丢 UTF-8 BOM，Windows PowerShell 5.1 随后按 GBK 解析中文，
 * 报一堆假语法错误（知识库里踩过两次）。这里全部走 subprocess，零 BOM 风险。
 *
 * 启动序列（顺序不能换，10-19 踩过）：
 *   1. `_probe_uia.py` 热激活微信 UIA 树（微信 4.x 重启后 gate byte 会归零）
 *   2. 起 `web_main.py`，等 `/api/settings` 有响应（端口活了）
 *   3. `POST /api/bot/start`，等 `running=true` 且微信 `connected`
 *
 * 2026-10-20 加固（装进 DSH 后宿主不可用，且没留下任何崩溃记录）：
 *   - **每个 Promise 都挂 catch**：`handle.done` 失败只记日志，绝不冒泡成
 *     unhandledRejection（Node 默认会直接结束主进程）；
 *   - 所有对外方法自己 try/catch，永不抛；
 *   - start/stop/restart 串行化（内部实现不带锁，公开方法才抢锁）。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSupervisor(ctx, cfg, bot, log) {
  const state = {
    handle: null,
    attachedAt: 0,
    spawnedAt: 0,
    lastError: '',
    lastAction: '',
    opLock: null,
  };
  const offsets = { stdout: 0, stderr: 0 };
  let tail = '';
  let ticker = null;

  const subprocess = () => {
    const service = typeof ctx.get === 'function' ? ctx.get('subprocess') : undefined;
    if (!service) throw new Error('当前 DSH 配置里没有 subprocess 服务，无法托管机器人进程');
    return service;
  };

  function appendTail(text) {
    if (!text) return;
    tail = (tail + text).slice(-24000);
  }

  function readStream(reader, key) {
    if (!reader) return;
    try {
      const read = reader.readFrom(offsets[key]);
      if (read?.text) {
        appendTail(read.text);
        offsets[key] = read.nextOffset;
      }
    } catch (error) {
      log(`读取 ${key} 输出失败: ${String(error?.message ?? error)}`);
    }
  }

  function pumpLogs() {
    const handle = state.handle;
    if (!handle) return;
    readStream(handle.collected?.stdout, 'stdout');
    readStream(handle.collected?.stderr, 'stderr');
  }

  function clearTicker() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  /** 同一时刻只允许一个生命周期操作。 */
  function withLock(name, operation) {
    if (state.opLock) {
      return Promise.resolve({
        ok: false,
        busy: true,
        message: `正在执行 ${state.opLock}，稍等`,
      });
    }
    state.opLock = name;
    return Promise.resolve()
      .then(operation)
      .catch((error) => {
        const message = String(error?.message ?? error);
        state.lastError = message;
        log(`ERROR ${name}: ${message}`);
        return { ok: false, message: `${name} 失败: ${message}` };
      })
      .finally(() => {
        state.opLock = null;
      });
  }

  async function waitApi(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await bot.ping()) return true;
      } catch {
        /* 继续等 */
      }
      await sleep(700);
    }
    return false;
  }

  async function probeUia() {
    let handle;
    try {
      handle = subprocess().spawn({
        argv: [cfg.pythonExe, '_probe_uia.py'],
        cwd: cfg.botRoot,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 200_000 },
          stderr: { maxBytes: 200_000 },
        },
        graceMs: 5000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
    } catch (error) {
      const message = String(error?.message ?? error);
      log(`UIA 热激活跳过（spawn 失败）: ${message}`);
      return { ok: false, detail: message };
    }

    // done 必须挂 catch：provider 失败时它是 reject
    const done = handle.done
      .then((outcome) => ({ kind: 'done', outcome }))
      .catch((error) => ({ kind: 'error', error }));

    const timeout = sleep(25000).then(() => ({ kind: 'timeout' }));
    const result = await Promise.race([done, timeout]).catch(() => ({ kind: 'error' }));

    readStream(handle.collected?.stdout, 'stdout');
    readStream(handle.collected?.stderr, 'stderr');

    if (result.kind === 'done') return { ok: true, detail: 'ok' };
    if (result.kind === 'timeout') {
      try {
        handle.terminate();
      } catch {
        /* ignore */
      }
      return { ok: false, detail: '超时（微信可能没开）' };
    }
    return { ok: false, detail: String(result.error?.message ?? 'spawn 失败') };
  }

  function spawnWeb() {
    const handle = subprocess().spawn({
      argv: [cfg.pythonExe, 'web_main.py'],
      cwd: cfg.botRoot,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 2_000_000, spill: { maxBytes: 20_000_000 } },
        stderr: { maxBytes: 2_000_000, spill: { maxBytes: 20_000_000 } },
      },
      graceMs: 8000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    state.handle = handle;
    state.spawnedAt = Date.now();
    offsets.stdout = 0;
    offsets.stderr = 0;

    // ★ 关键：这个 then 必须带 catch，否则 done 一旦 reject 就是主进程崩溃
    handle.done
      .then((outcome) => {
        appendTail(
          `\n[supervisor] web_main 退出 exitCode=${outcome?.exitCode} signal=${outcome?.signal}\n`,
        );
      })
      .catch((error) => {
        appendTail(`\n[supervisor] web_main 异常退出: ${String(error?.message ?? error)}\n`);
      })
      .finally(() => {
        if (state.handle === handle) {
          state.handle = null;
          clearTicker();
        }
      });

    clearTicker();
    ticker = setInterval(pumpLogs, 2000);
    if (typeof ticker.unref === 'function') ticker.unref();
    return handle;
  }

  async function ensureBotChannel() {
    const status = await bot.status();
    if (status?.running) return status;
    await bot.startPlatform('');
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const next = await bot.status();
      const wechat = String(next?.wechat?.status ?? '');
      if (next?.running && wechat !== 'disconnected') return next;
      await sleep(1000);
    }
    return bot.status();
  }

  /** 已经有一个外部实例在跑时，接管它而不是再起一个。 */
  async function attach() {
    state.lastAction = 'attach';
    state.attachedAt = Date.now();
    const status = await ensureBotChannel();
    return {
      ok: true,
      mode: 'attach',
      message: '接管了已在运行的机器人实例',
      running: Boolean(status?.running),
      wechat: String(status?.wechat?.status ?? ''),
    };
  }

  // ------------------------------------------------------------ 内部实现
  async function doStart() {
    if (await bot.ping()) return await attach();

    if (!cfg.botRoot || !cfg.pythonExe) {
      return {
        ok: false,
        message:
          '还没配置 botRoot：在 profile 的 cordis.patch.yml 里把 botRoot 指向机器人目录' +
          '（pythonExe 留空则自动取 <botRoot>\\.venv\\Scripts\\python.exe）',
      };
    }

    if (cfg.mode === 'attach') {
      return {
        ok: false,
        mode: 'attach',
        message: `attach 模式下没发现已运行的实例（127.0.0.1:${cfg.port} 无响应）`,
      };
    }
    if (cfg.mode === 'manual') {
      return {
        ok: false,
        mode: 'manual',
        message: 'manual 模式下插件不自动拉起，请手动启动机器人',
      };
    }

    const probe = await probeUia();
    const handle = spawnWeb();
    const ready = await waitApi(90000);
    if (!ready) {
      state.lastError = 'web_main 90 秒内没起来';
      try {
        handle.terminate();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        mode: 'spawn',
        message: `${state.lastError}；请查看 logs\\chatbot.log 与 logs\\errors.log`,
        uia: probe,
        tail: tail.slice(-2000),
      };
    }
    await sleep(1200);
    state.lastAction = 'spawn';
    const status = await ensureBotChannel();
    return {
      ok: Boolean(status?.running),
      mode: 'spawn',
      message: status?.running ? '机器人已启动' : 'Web 已起，但机器人通道没连上',
      running: Boolean(status?.running),
      wechat: String(status?.wechat?.status ?? ''),
      uia: probe,
    };
  }

  async function doStop({ killProcess = true } = {}) {
    try {
      if (await bot.ping()) await bot.stopPlatform('');
    } catch (error) {
      log(`停止通道失败（继续杀进程）: ${String(error?.message ?? error)}`);
    }

    const handle = state.handle;
    if (handle && killProcess) {
      try {
        handle.terminate();
      } catch (error) {
        log(`terminate 失败: ${String(error?.message ?? error)}`);
      }
      let exited = false;
      try {
        exited = await Promise.race([
          handle.waitForExit(15000).then((value) => value !== false),
          sleep(16000).then(() => false),
        ]);
      } catch (error) {
        log(`waitForExit 失败: ${String(error?.message ?? error)}`);
        exited = false;
      }
      if (state.handle === handle) {
        state.handle = null;
        clearTicker();
      }
      if (!exited) {
        let stillUp = false;
        try {
          stillUp = await bot.ping();
        } catch {
          stillUp = false;
        }
        if (stillUp) {
          state.lastError = '进程没退干净，端口仍被占用';
          return {
            ok: false,
            message: '进程没退干净：端口 8080 仍被占用。请运行 deepseekgirl\\停止-鲸鱼娘.bat 清理',
          };
        }
      }
    }

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      let up = false;
      try {
        up = await bot.ping();
      } catch {
        up = false;
      }
      if (!up) break;
      await sleep(500);
    }
    state.lastAction = 'stop';
    return { ok: true, message: '机器人已停止' };
  }

  // ------------------------------------------------------------ 公开接口
  function start() {
    return withLock('start', doStart);
  }

  function stop(options) {
    return withLock('stop', () => doStop(options));
  }

  function restart({ force = false } = {}) {
    return withLock('restart', async () => {
      const busy = await bot.busyState().catch(() => ({
        online: false,
        queue: 0,
        pipelineRunning: false,
      }));
      // 只有队列里真压着消息才拦。`pipelineRunning` 是管线开关（常为 true），
      // 拿它当"正在生成"会永远拒绝重启（2026-10-20 读错过）。
      if (busy.online && busy.queue > 0 && !force) {
        return {
          ok: false,
          busy: true,
          message: `队列里还有 ${busy.queue} 条没处理完，等它发完再重启；要强来就传 force`,
          state: busy,
        };
      }
      const stopped = await doStop({ killProcess: true });
      if (!stopped.ok) return stopped;
      await sleep(1500);
      const result = await doStart();
      return { ...result, restarted: true };
    });
  }

  function snapshot() {
    return {
      attached: Boolean(state.handle),
      mode: cfg.mode,
      busy: state.opLock,
      spawnedAt: state.spawnedAt || null,
      attachedAt: state.attachedAt || null,
      lastAction: state.lastAction,
      lastError: state.lastError,
      botRoot: cfg.botRoot,
      pythonExe: cfg.pythonExe,
      port: cfg.port,
      logFile: cfg.logFile,
      tail: tail.slice(-4000),
    };
  }

  function dispose() {
    clearTicker();
    if (cfg.stopOnExit) {
      try {
        state.handle?.terminate();
      } catch {
        /* ignore */
      }
    }
    state.handle = null;
  }

  return { start, stop, restart, snapshot, dispose, pumpLogs };
}
