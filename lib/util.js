/**
 * 插件内部的小工具：HTTP 响应、请求体解析、回环地址判断。
 *
 * 与 dsh-free-search 的 bridge 保持同一套写法（同源路由 + 只认本机请求），
 * 这样行为与本机其它插件一致，也避免把 8080 暴露给浏览器。
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? '';
  return LOOPBACK.has(address);
}

export function writeJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value ?? null), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function writeText(res, status, text, type = 'text/plain; charset=utf-8') {
  const body = Buffer.from(String(text ?? ''), 'utf8');
  res.writeHead(status, {
    'content-type': type,
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** 读 JSON 请求体；格式错误返回 undefined（调用方回 400）。 */
export function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish(undefined);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return finish({});
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        finish(undefined);
      }
    });
    req.on('error', () => finish(undefined));
  });
}

/** 只取对象上的已知键，避免把客户端塞的任意字段带进内部。 */
export function pick(source, keys) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

export function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function tailLines(text, count) {
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}
