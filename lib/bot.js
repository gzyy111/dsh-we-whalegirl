/**
 * 机器人本体的 HTTP 客户端（127.0.0.1:8080/api/*）。
 *
 * 为什么不让浏览器直连 8080：DSH 页面在 50761，跨域要 CORS；而且把机器人的
 * 内部 API 直接暴露给页面不如走同源代理。所以：客户端只认 `/whalegirl/*`，
 * Host 插件在 Node 里转发到本机 8080。
 */

import http from 'node:http';

const DEFAULT_TIMEOUT = 15000;

export function createBotClient(cfg) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });

  function request(path, options = {}) {
    const { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = options;
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
      const headers = payload
        ? {
            'content-type': 'application/json; charset=utf-8',
            'content-length': String(payload.length),
          }
        : {};
      const req = http.request(
        { host: '127.0.0.1', port: cfg.port, path, method, agent, headers },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed;
            let isJson = false;
            try {
              parsed = text ? JSON.parse(text) : undefined;
              isJson = true;
            } catch {
              parsed = undefined;
            }
            if (res.statusCode >= 400) {
              const error = new Error(
                `机器人接口 ${path} 返回 HTTP ${res.statusCode}: ${text.slice(0, 200)}`,
              );
              error.status = res.statusCode;
              error.body = parsed;
              reject(error);
              return;
            }
            resolve(isJson ? parsed : text);
          });
        },
      );
      req.setTimeout(timeout, () => {
        req.destroy(new Error(`机器人接口 ${path} 超时（${timeout}ms）`));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  return {
    request,
    dispose() {
      agent.destroy();
    },

    /** 端口上到底有没有在跑（不管机器人是否已连接微信）。 */
    async ping(timeout = 2500) {
      try {
        await request('/api/settings', { timeout });
        return true;
      } catch {
        return false;
      }
    },

    status() {
      return request('/api/status', { timeout: 8000 });
    },

    schema() {
      return request('/api/settings/schema');
    },

    settings() {
      return request('/api/settings');
    },

    patchSettings(values) {
      return request('/api/settings', { method: 'POST', body: { values }, timeout: 30000 });
    },

    applyPreset(preset) {
      return request('/api/settings/preset', { method: 'POST', body: { preset } });
    },

    style() {
      return request('/api/style');
    },

    saveStyle(payload) {
      return request('/api/style', { method: 'POST', body: payload, timeout: 30000 });
    },

    setStyleActive(name) {
      return request('/api/style/active', { method: 'POST', body: { name } });
    },

    resetStyle() {
      return request('/api/style/reset', { method: 'POST', body: {} });
    },

    setStyleLock(locked) {
      return request('/api/style/lock', { method: 'POST', body: { locked } });
    },

    capabilities() {
      return request('/api/capabilities');
    },

    startPlatform(platform = '') {
      return request('/api/bot/start', {
        method: 'POST',
        body: platform ? { platform } : {},
        timeout: 60000,
      });
    },

    stopPlatform(platform = '') {
      return request('/api/bot/stop', {
        method: 'POST',
        body: platform ? { platform } : {},
        timeout: 60000,
      });
    },

    sendText({ room, text, platform = 'wechat' }) {
      return request('/api/text/send', {
        method: 'POST',
        body: { room, text, platform },
        timeout: 90000,
      });
    },

    sendImage({ room, path = '', mood = '', platform = 'wechat' }) {
      return request('/api/image/send', {
        method: 'POST',
        body: { room, path, mood, platform },
        timeout: 120000,
      });
    },

    coverPlay({ text, room = '', mode = '', platform = 'wechat' }) {
      return request('/api/cover/play', {
        method: 'POST',
        body: { text, room, mode, platform },
        timeout: 900000,
      });
    },

    songs() {
      return request('/api/songs');
    },

    divination(text) {
      return request('/api/divination', { method: 'POST', body: { text }, timeout: 120000 });
    },

    logs(limit = 120) {
      return request(`/api/logs?limit=${limit}`);
    },

    messages(limit = 30, platform = '') {
      return request(`/api/messages?limit=${limit}&platform=${encodeURIComponent(platform)}`);
    },

    clearContext(platform = '') {
      return request('/api/context/clear', {
        method: 'POST',
        body: platform ? { platform } : {},
      });
    },

    /**
     * 重启前要看的"忙不忙"。
     *
     * ⚠️ 2026-10-20 读错过一次：`handler.processing` **不是**"正在生成回复"，
     * 它是 `MessageHandler._processing`，即**消息处理管线的运行开关**
     * （`start()` 置真、`stop()` 置假），所以正常运行时它永远是 true。
     * 真正的"待办"只有 `queue_size`。所以这里给它换个名字，别再用错。
     */
    async busyState() {
      try {
        const status = await this.status();
        const handler = status?.handler ?? {};
        return {
          online: true,
          running: Boolean(status?.running),
          queue: Number(handler.queue_size ?? 0),
          // 管线在跑（几乎总是 true，只作展示）
          pipelineRunning: Boolean(handler.processing),
          wechat: String(status?.wechat?.status ?? ''),
        };
      } catch {
        return {
          online: false,
          running: false,
          queue: 0,
          pipelineRunning: false,
          wechat: 'unknown',
        };
      }
    },
  };
}
