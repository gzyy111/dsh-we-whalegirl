// 本地预检：在 node 里模拟 DSH 的浏览器侧 ModuleLoader，
// 执行 client.js 的 factory 与 apply，抓任何加载期/注册期异常。
// 只验证"能不能安全加载与注册"，不验证渲染结果。

const fs = require('node:fs');
const path = require('node:path');

const clientPath = process.argv[2];
const source = fs.readFileSync(clientPath, 'utf8');

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
  useMemo: (fn) => fn(),
  Component: class Component {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
  },
};

const registered = [];
let factoryResult = null;
let loadError = null;

global.window = {
  __ModuleLoader__: {
    load(spec) {
      try {
        if (!spec || typeof spec.factory !== 'function') {
          throw new Error('spec.factory 不是函数');
        }
        factoryResult = spec.factory((name) => {
          if (name === 'react') return React;
          throw new Error(`未知模块: ${name}`);
        });
        registered.push({ id: spec.id, ok: true });
      } catch (error) {
        loadError = error;
      }
    },
  },
};

// 执行整个脚本（等价于浏览器里加载 artifact）
new Function('window', source)(global.window);

if (loadError) {
  console.error('FACTORY 抛错:', loadError && loadError.stack);
  process.exit(1);
}
if (!factoryResult) {
  console.error('factory 没有返回对象');
  process.exit(1);
}
console.log('artifact id:', registered[0] && registered[0].id);
console.log('factory 返回键:', Object.keys(factoryResult));
console.log('inject:', factoryResult.inject);

if (typeof factoryResult.apply !== 'function') {
  console.error('缺少 apply');
  process.exit(1);
}

// 模拟宿主 ctx
const slots = {
  inject(owner, callback) {
    console.log('slots.inject:', owner);
    const disposer = callback();
    if (typeof disposer !== 'function') {
      console.log('  (该 inject 未返回 disposer)');
    }
    return typeof disposer === 'function' ? disposer : () => {};
  },
  register(options, component) {
    console.log('slots.register:', JSON.stringify(options), '组件类型:', typeof component);
    if (!options || !options.name) throw new Error('register 缺少 name');
    if (typeof component !== 'function') throw new Error('register 的组件不是函数');
    return () => {};
  },
};

const ctx = {
  slots,
  effect(fn, label) {
    console.log('ctx.effect:', label);
    const disposer = fn();
    return typeof disposer === 'function' ? disposer : () => {};
  },
  get(name) {
    if (name === 'slots') return slots;
    return undefined;
  },
};

try {
  factoryResult.apply(ctx);
  console.log('apply 执行成功');
} catch (error) {
  console.error('APPLY 抛错:', error && error.stack);
  process.exit(1);
}
