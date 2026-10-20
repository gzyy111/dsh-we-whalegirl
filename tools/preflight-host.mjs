// 本地预检：在 node 里模拟 DSH 的 Host 侧 Cordis ctx，执行 apply，
// 再走一遍路由 handler（本地接口 + 代理），确认不会抛、不会挂。
// 不连接真实宿主，因此**不会影响 DSH 自身**。

import { EventEmitter } from 'node:events';

const { apply } = await import('../index.js');

const captured = { routes: [], tools: [], effects: [] };

const webServer = {
  register(route) {
    captured.routes.push(route);
    console.log('webServer.register:', route.kind, route.path);
    return () => console.log('  (route disposed)');
  },
};

const tools = {
  register(definition) {
    captured.tools.push(definition);
    console.log('tools.register:', definition.name, 'timeout=', definition.timeoutMs);
    return () => {};
  },
};

// 机器人此刻可能没在跑；spawn 只在用户点启动时才会用到
const subprocess = {
  spawn(spec) {
    console.log('subprocess.spawn:', spec.argv.join(' '));
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate() {},
      waitForExit: async () => true,
    };
  },
};

const services = { webServer, tools, subprocess };

function makeCtx(scoped) {
  const ctx = {
    get(name) {
      return scoped.has(name) ? services[name] : undefined;
    },
    inject(names, callback) {
      const set = new Set(names);
      callback(makeCtx(set));
    },
    effect(fn, label) {
      captured.effects.push(label);
      const disposer = fn();
      return typeof disposer === 'function' ? disposer : () => {};
    },
  };
  // 真实 Cordis：inject 之后服务也以属性形式出现（sctx.webServer）
  for (const name of scoped) {
    if (services[name]) ctx[name] = services[name];
  }
  return ctx;
}

apply(makeCtx(new Set(Object.keys(services))), {
  botRoot: 'D:\\BaiduNetdiskDownload\\harness\\deepseekgirl',
  port: 8080,
  mode: 'manual',
  autoStart: false,
  enablePanel: false,
});

console.log('\n--- 挂载结果 ---');
console.log('routes:', captured.routes.length, 'tools:', captured.tools.length);
console.log('effects:', captured.effects.join(' | '));

// ------------------------------------------------------------ schema 断言
// 2026-10-20 事故：工具 parameters 不是 {type:"object"}，宿主把它原样发给模型，
// 整个工具表被判非法 ⇒ 每轮请求 INVALID_REQUEST。这里必须拦住。
let schemaBad = 0;
for (const tool of captured.tools) {
  const params = tool.parameters;
  if (!params || params.type !== 'object') {
    console.error(`✗ ${tool.name}: parameters.type = ${params && params.type}`);
    schemaBad += 1;
    continue;
  }
  if (!params.properties || typeof params.properties !== 'object') {
    console.error(`✗ ${tool.name}: parameters.properties 缺失`);
    schemaBad += 1;
    continue;
  }
  for (const [key, prop] of Object.entries(params.properties)) {
    if (!prop || typeof prop !== 'object' || (!prop.type && !prop.enum && !prop.oneOf && !prop.anyOf)) {
      console.error(`✗ ${tool.name}.${key}: 属性缺少 type/enum/oneOf`);
      schemaBad += 1;
    }
  }
  const out = tool.output?.schema;
  if (!out || out.type !== 'object') {
    console.error(`✗ ${tool.name}: output.schema.type = ${out && out.type}`);
    schemaBad += 1;
  }
}
if (schemaBad > 0) {
  console.error(`\nTool schema 断言失败：${schemaBad} 处`);
  process.exit(1);
}
console.log('Tool schema 断言：全部通过（parameters 均为 type:"object"）');

// ------------------------------------------------------------ 模拟请求
function fakeRes() {
  const res = {
    headersSent: false,
    writableEnded: false,
    status: 0,
    body: '',
    writeHead(status) {
      this.headersSent = true;
      this.status = status;
    },
    end(chunk) {
      this.writableEnded = true;
      if (chunk) this.body += chunk.toString();
    },
    on() {},
    write(chunk) {
      if (chunk) this.body += chunk.toString();
      return true;
    },
  };
  return res;
}

function fakeReq(url, method = 'GET') {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  req.pipe = () => req;
  return req;
}

const route = captured.routes[0];
if (!route) {
  console.error('没有注册任何路由');
  process.exit(1);
}

async function call(url, method) {
  const req = fakeReq(url, method);
  const res = fakeRes();
  await route.handler(req, res);
  // 代理是异步的，等一轮事件循环
  await new Promise((resolve) => setTimeout(resolve, 400));
  return res;
}

const health = await call('/dsh-we-whalegirl/local/health');
console.log('\n[GET /local/health]', health.status, (health.body || '').slice(0, 160));

const cfg = await call('/dsh-we-whalegirl/local/config');
console.log('[GET /local/config]', cfg.status, (cfg.body || '').slice(0, 120));

const proxyOffline = await call('/dsh-we-whalegirl/api/status');
console.log('[GET /api/status（经代理取真值）]', proxyOffline.status, (proxyOffline.body || '').slice(0, 120));

const denied = await call('/dsh-we-whalegirl/api/status');
console.log('[重复请求仍稳定]', denied.status);

console.log('\n预检结束：没有抛错');
process.exit(0);
