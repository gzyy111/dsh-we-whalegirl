/**
 * 把 plugin/ui/theme.css 内联进 plugin/client.js 的 CSS 常量。
 *
 * 为什么要这一步：浏览器侧的产物必须是**单文件自注册脚本**（相对 import 不生效），
 * 样式又不想在预览页和插件里各写一份。所以 CSS 只在 theme.css 里维护，
 * 由这个脚本写进 client.js 的标记区。
 *
 * 用法：node tools/build-theme.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cssPath = path.join(root, 'ui', 'theme.css');
const clientPath = path.join(root, 'client.js');

const START = '/*__THEME_START__*/';
const END = '/*__THEME_END__*/';

const css = fs.readFileSync(cssPath, 'utf8');
if (css.includes('`') || css.includes('${')) {
  console.error('theme.css 里不能出现反引号或 ${（会被内联进模板字符串）');
  process.exit(1);
}

const source = fs.readFileSync(clientPath, 'utf8');
const startAt = source.indexOf(START);
const endAt = source.indexOf(END);
if (startAt < 0 || endAt < 0 || endAt < startAt) {
  console.error('client.js 里找不到主题标记（/*__THEME_START__*/ … /*__THEME_END__*/）');
  process.exit(1);
}

const next =
  source.slice(0, startAt + START.length) +
  '\n' +
  css +
  '\n  ' +
  source.slice(endAt);

fs.writeFileSync(clientPath, next, 'utf8');
console.log(`theme inlined: ${css.length} chars -> ${path.relative(root, clientPath)}`);
