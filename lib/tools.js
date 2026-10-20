/**
 * 让模型能在对话里指挥鲸鱼娘：9 个 whalegirl_* 工具。
 *
 * 安全口径：
 * - `whalegirl_say` / `whalegirl_image` 会**真的往微信群里发消息**，默认只允许
 *   `wechat.target_groups` 白名单里的会话（外加「文件传输助手」用于自测）；
 *   需要放开时把插件配置 `allowAnyRoom` 打开。
 * - `whalegirl_restart` 会先看 `queue_size`，队列里还压着消息就拒绝动手
 *   （10-20 踩过：重启打断在途回复，消息永久丢失）。
 *   注意 `handler.processing` 是**管线运行开关**（常为 true），不能当"正在生成"用。
 */

import { clampNumber } from './util.js';

const TEXT_OUTPUT = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * ★ 2026-10-20 事故根因：宿主把工具的 `parameters` **原样**当作 JSON Schema
 * 发给模型（openai 兼容的 function calling 要求顶层 `type: "object"`）。
 * 我原先写的是一张「属性表」（`{ action: {...}, values: {...} }`）甚至空对象 `{}`，
 * 于是模型请求直接 `INVALID_REQUEST: schema must be a JSON Schema of 'type: "object"',
 * got 'type: null'` —— 每轮都失败，看起来就像 DSH 炸了。
 *
 * 官方 `defineTool` 会替你做这层包装；这里不引入 `@deepseek-ai/dsh-tools`
 * （本地 link 的包解析不到宿主依赖），所以自己包一层，并在预检里断言。
 */
function asJsonSchema(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { type: 'object', properties: {}, additionalProperties: false };
  }
  if (parameters.type === 'object' || parameters.type === 'array') {
    return parameters;
  }
  // 允许传 {properties, required} 这种半成品
  if (parameters.properties && typeof parameters.properties === 'object') {
    return {
      type: 'object',
      additionalProperties: parameters.additionalProperties ?? false,
      ...parameters,
    };
  }
  return {
    type: 'object',
    properties: parameters,
    additionalProperties: false,
  };
}

function renderJson(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function fail(message) {
  return { ok: false, message };
}

export function registerTools(ctx, { bot, supervisor, cfg, log }) {
  const tools = [];

  function define(definition) {
    tools.push(definition);
  }

  /** 工具超时：真唱最久（渲染 15 分钟级别），状态查询最短。 */
  const TIMEOUTS = {
    whalegirl_status: 20000,
    whalegirl_start: 180000,
    whalegirl_stop: 180000,
    whalegirl_restart: 240000,
    whalegirl_say: 120000,
    whalegirl_image: 180000,
    whalegirl_cover: 960000,
    whalegirl_divination: 180000,
    whalegirl_config: 60000,
  };

  /**
   * 执行体统一包一层 catch：失败变成工具结果，而不是可能没人接的 rejection
   * （宿主主进程对 unhandledRejection 是零容忍的）。
   */
  function wrapExecute(fn) {
    return async (args, exec) => {
      try {
        return await fn(args, exec);
      } catch (error) {
        log?.(`工具执行失败: ${String(error?.message ?? error)}`);
        return fail(String(error?.message ?? error));
      }
    };
  }

  /** 发消息前的收件人白名单校验。 */
  async function ensureRoomAllowed(room) {
    const target = String(room ?? '').trim();
    if (!target) return { ok: false, message: '必须指定 room（群名或「文件传输助手」）' };
    if (cfg.allowAnyRoom) return { ok: true, room: target };
    if (target === '文件传输助手') return { ok: true, room: target };
    try {
      const data = await bot.settings();
      const allowed = Array.isArray(data?.values?.['wechat.target_groups'])
        ? data.values['wechat.target_groups'].map(String)
        : [];
      if (allowed.includes(target)) return { ok: true, room: target };
      return {
        ok: false,
        message: `「${target}」不在监听白名单里（${allowed.join('、') || '空'}）。要放开就把插件配置 allowAnyRoom 设为 true`,
      };
    } catch (error) {
      return { ok: false, message: `读取监听列表失败: ${String(error?.message ?? error)}` };
    }
  }

  // ---------------------------------------------------------------- 状态
  define({
    name: 'whalegirl_status',
    description:
      '查看鲸鱼娘机器人的运行状态：进程是否在、微信/QQ/企微三端连接、队列与处理中、AI 可用性、今日 token 用量、当前人设与音色。只读，无副作用。',
    parameters: {},
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async () => {
      const supervisorState = supervisor.snapshot();
      let status = null;
      let capabilities = null;
      let style = null;
      try {
        status = await bot.status();
      } catch {
        status = null;
      }
      if (status) {
        try {
          capabilities = await bot.capabilities();
        } catch {
          capabilities = null;
        }
        try {
          style = await bot.style();
        } catch {
          style = null;
        }
      }
      return {
        ok: Boolean(status),
        online: Boolean(status),
        supervisor: {
          attached: supervisorState.attached,
          mode: supervisorState.mode,
          lastAction: supervisorState.lastAction,
          lastError: supervisorState.lastError,
        },
        running: Boolean(status?.running),
        platforms: {
          wechat: String(status?.wechat?.status ?? 'unknown'),
          qq: Boolean(status?.qq_running),
          wecom: Boolean(status?.wecom_running),
        },
        queue: Number(status?.handler?.queue_size ?? 0),
        // ⚠️ handler.processing 是「消息处理管线的运行开关」，不是「正在生成回复」，
        // 正常运行时它一直是 true（2026-10-20 读错过一次）。
        pipelineRunning: Boolean(status?.handler?.processing),
        ai: {
          available: Boolean(status?.ai?.available),
          model: capabilities?.ai?.model ?? '',
          tokens: status?.ai?.usage?.total_tokens ?? 0,
          requests: status?.ai?.usage?.request_count ?? 0,
        },
        persona: style
          ? { active: style.active, display: style.current?.display_name, locked: style.locked }
          : null,
        voice: capabilities?.voice ?? null,
        song: capabilities?.song ?? null,
        divination: capabilities?.divination ?? null,
      };
    },
  });

  // ---------------------------------------------------------------- 启停
  define({
    name: 'whalegirl_start',
    description:
      '启动鲸鱼娘。不传 platform 时启动整台机器人（先热激活微信 UIA，再起 web 服务，再连微信，约 25 秒）；传 wechat/qq/wecom 只启动该平台通道。',
    parameters: {
      platform: {
        type: 'string',
        enum: ['', 'wechat', 'qq', 'wecom'],
        description: '留空启动整台机器人',
      },
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async (args) => {
      const platform = String(args?.platform ?? '').trim();
      if (platform) {
        try {
          return await bot.startPlatform(platform);
        } catch (error) {
          return fail(`启动 ${platform} 失败: ${String(error?.message ?? error)}`);
        }
      }
      return supervisor.start();
    },
  });

  define({
    name: 'whalegirl_stop',
    description:
      '停止鲸鱼娘。不传 platform 时停掉机器人通道并结束 Python 进程；传 wechat/qq/wecom 只停该平台通道（进程保留）。',
    parameters: {
      platform: {
        type: 'string',
        enum: ['', 'wechat', 'qq', 'wecom'],
        description: '留空停止整台机器人',
      },
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async (args) => {
      const platform = String(args?.platform ?? '').trim();
      if (platform) {
        try {
          return await bot.stopPlatform(platform);
        } catch (error) {
          return fail(`停止 ${platform} 失败: ${String(error?.message ?? error)}`);
        }
      }
      return supervisor.stop({ killProcess: true });
    },
  });

  define({
    name: 'whalegirl_restart',
    description:
      '重启鲸鱼娘（改完设置需要它才生效）。默认会检查队列：正在生成回复时拒绝重启，避免打断在途消息；确实要强来传 force=true。',
    parameters: {
      force: { type: 'boolean', description: '生成中也强行重启（可能丢一条回复）' },
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async (args) => supervisor.restart({ force: Boolean(args?.force) }),
  });

  // ---------------------------------------------------------------- 发言
  define({
    name: 'whalegirl_say',
    description:
      '让鲸鱼娘在指定微信群/会话里发一条文本。**有外部副作用**：会真的发到群里。只允许监听白名单内的会话（或「文件传输助手」）。',
    parameters: {
      room: { type: 'string', description: '群名，或「文件传输助手」' },
      text: { type: 'string', description: '要发送的文本' },
      platform: { type: 'string', enum: ['wechat', 'qq'], description: '默认 wechat' },
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async (args) => {
      const guard = await ensureRoomAllowed(args?.room);
      if (!guard.ok) return fail(guard.message);
      const text = String(args?.text ?? '').trim();
      if (!text) return fail('text 不能为空');
      try {
        return await bot.sendText({
          room: guard.room,
          text,
          platform: String(args?.platform ?? 'wechat'),
        });
      } catch (error) {
        return fail(`发送失败: ${String(error?.message ?? error)}`);
      }
    },
  });

  define({
    name: 'whalegirl_image',
    description:
      '让鲸鱼娘在指定会话发一张图。path 留空则从本地表情包库随机挑一张；mood 可按情绪标签挑。**有外部副作用**：会真的发图。',
    parameters: {
      room: { type: 'string', description: '群名，或「文件传输助手」' },
      path: { type: 'string', description: '本地图片绝对路径，留空=从表情包库挑' },
      mood: { type: 'string', description: '情绪标签，如 sleepy/laugh，可留空' },
      platform: { type: 'string', enum: ['wechat', 'qq'], description: '默认 wechat' },
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async (args) => {
      const guard = await ensureRoomAllowed(args?.room);
      if (!guard.ok) return fail(guard.message);
      try {
        return await bot.sendImage({
          room: guard.room,
          path: String(args?.path ?? ''),
          mood: String(args?.mood ?? ''),
          platform: String(args?.platform ?? 'wechat'),
        });
      } catch (error) {
        return fail(`发图失败: ${String(error?.message ?? error)}`);
      }
    },
  });

  define({
    name: 'whalegirl_cover',
    description:
      '让鲸鱼娘真唱一首歌（SVC 翻唱，用她自己的音色）。一段约 30 秒走语音条，整首走文件。首次点某首歌要渲染 1—3 分钟，之后命中缓存秒回。**有外部副作用**：会真的发语音/文件到会话。',
    parameters: {
      song: { type: 'string', description: '点歌文本，例如「唱一段晴天」「整首 后来」' },
      mode: { type: 'string', enum: ['segment', 'full'], description: '一段/整首，留空按文本判断' },
      room: { type: 'string', description: '发到哪个会话；留空=只渲染不发送' },
      platform: { type: 'string', enum: ['wechat', 'qq'], description: '默认 wechat' },
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async (args) => {
      const room = String(args?.room ?? '').trim();
      if (room) {
        const guard = await ensureRoomAllowed(room);
        if (!guard.ok) return fail(guard.message);
      }
      const song = String(args?.song ?? '').trim();
      if (!song) return fail('song 不能为空，例如「唱一段晴天」');
      try {
        return await bot.coverPlay({
          text: song,
          room,
          mode: String(args?.mode ?? ''),
          platform: String(args?.platform ?? 'wechat'),
        });
      } catch (error) {
        return fail(`真唱失败: ${String(error?.message ?? error)}`);
      }
    },
  });

  define({
    name: 'whalegirl_divination',
    description:
      '用鲸鱼娘自己的算命链路（八字/紫微/小六壬/梅花/塔罗/六爻）算一件事，返回她组织好的口吻文本与牌面图路径。纯本地排盘 + 模型组织语言，不往群里发消息。',
    parameters: {
      text: { type: 'string', description: '例如「塔罗 问工作」「1999年7月1日 17:00 男」' },
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async (args) => {
      const text = String(args?.text ?? '').trim();
      if (!text) return fail('text 不能为空');
      try {
        return await bot.divination(text);
      } catch (error) {
        return fail(`算命失败: ${String(error?.message ?? error)}`);
      }
    },
  });

  // ---------------------------------------------------------------- 配置
  define({
    name: 'whalegirl_config',
    description:
      '读写鲸鱼娘的配置。action=get 看当前设置；action=set 按白名单批量改（values 是 {"配置路径": 值}）；action=logs 看日志尾。改完多数项需要重启（返回的 restart_keys 会说明），再调 whalegirl_restart 生效。',
    parameters: {
      action: { type: 'string', enum: ['get', 'set', 'logs'], description: '默认 get' },
      values: { type: 'object', description: 'action=set 时的配置项，例如 {"joke.enabled": false}' },
      limit: { type: 'number', description: 'action=logs 时取多少行（默认 80）' },
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => renderJson(value) },
    execute: async (args) => {
      const action = String(args?.action ?? 'get').trim();
      try {
        if (action === 'logs') {
          const limit = Math.round(clampNumber(args?.limit, 80, 1, 500));
          return await bot.logs(limit);
        }
        if (action === 'set') {
          const values = args?.values;
          if (!values || typeof values !== 'object' || Array.isArray(values)) {
            return fail('values 必须是 {"配置路径": 值} 形式的对象');
          }
          const result = await bot.patchSettings(values);
          if (result?.requires_restart && !cfg.automaticRestart) {
            result.next_step = '改完的项需要重启才生效，可调用 whalegirl_restart';
          }
          return result;
        }
        const [settings, schema] = await Promise.all([bot.settings(), bot.schema()]);
        return { ok: true, values: settings?.values ?? {}, presets: schema?.presets ?? [] };
      } catch (error) {
        return fail(`配置操作失败: ${String(error?.message ?? error)}`);
      }
    },
  });

  // ---------------------------------------------------------------- 注册
  const disposers = [];
  for (const definition of tools) {
    try {
      const parameters = asJsonSchema(definition.parameters);
      if (parameters.type !== 'object') {
        // 宁可不注册，也不要让整份工具表被模型请求判为非法
        log?.(`跳过工具 ${definition.name}：parameters 不是 object schema`);
        continue;
      }
      const dispose = ctx.tools.register({
        ...definition,
        parameters,
        output: {
          schema: definition.output?.schema ?? TEXT_OUTPUT,
          render: definition.output?.render ?? ((_args, value) => renderJson(value)),
        },
        execute: wrapExecute(definition.execute),
        timeoutMs: TIMEOUTS[definition.name] ?? 120000,
        isConcurrencySafe: (args) => {
          // 只有只读工具可以并发；发消息/启停必须排队
          const readOnly = new Set(['whalegirl_status']);
          return readOnly.has(definition.name);
        },
      });
      disposers.push(dispose);
      log?.(`已注册工具 ${definition.name}`);
    } catch (error) {
      log?.(`注册工具 ${definition.name} 失败: ${String(error?.message ?? error)}`);
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  };
}
