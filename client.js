/**
 * 鲸鱼娘 · DSH 客户端半边
 *
 * 两处入口，一个数据源（Host 插件的同源代理 /whalegirl/*）：
 *   1. 设置 → 鲸鱼娘        —— 功能开关 / 人设 / 回复频率 / 平台 / 语音点歌 / 模型与高级
 *   2. 侧栏「鲸鱼娘」面板   —— 总览仪表盘（默认不注册，Host 配置 enablePanel 才开）
 *
 * 这份文件是**单文件自注册脚本**：浏览器侧的 ModuleLoader 只喂 react，
 * 相对 import 不生效，所以基础件、页面、注册全部写在一起。
 * 样式集中在 plugin/ui/theme.css，由 tools/build-theme.mjs 内联进下面的 CSS 常量。
 */
window.__ModuleLoader__.load({
  id: 'dsh-we-whalegirl',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo } = React;

    const API = '/dsh-we-whalegirl';
    const PANEL_ID = 'dsh-we-whalegirl';

    const CSS = String.raw`
/*__THEME_START__*/
/*
 * 鲸鱼娘 · 插件界面主题（唯一 CSS 源）
 *
 * 供两处使用：
 *   1. plugin/client.js —— 由 build-theme.mjs 内联进 CSS 常量（浏览器产物是单文件）；
 *   2. preview/preview.html —— 直接 <link> 引入，用来在真浏览器里目检。
 *
 * 约定：颜色只用宿主主题 token（--dsw-alias-*），并带浅色回退值，
 * 这样明暗主题自动跟随，预览页在没有 token 时也看得清。
 */

:root {
  --wg-font: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --wg-mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  --wg-bg-base: var(--dsw-alias-bg-base, #ffffff);
  --wg-bg-1: var(--dsw-alias-bg-layer-1, #ffffff);
  --wg-bg-2: var(--dsw-alias-bg-layer-2, #f6f7f9);
  --wg-border: var(--dsw-alias-border-l1, #e6e8ec);
  --wg-border-2: var(--dsw-alias-border-l2, #d3d7de);
  --wg-brand: var(--dsw-alias-brand-primary, #2f6fed);
  --wg-text: var(--dsw-alias-label-primary, #171a1f);
  --wg-dim: var(--dsw-alias-label-secondary, #6b7280);
  --wg-error: var(--dsw-alias-state-error-primary, #d93b3b);
  --wg-warn: var(--dsw-alias-state-warn-primary, #b9700a);
  --wg-ok: var(--dsw-alias-state-success-primary, #1f8a4c);
  --wg-idle: var(--dsw-alias-state-idle-primary, #9aa1ac);
  --wg-shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 10px 30px -18px rgba(16, 24, 40, 0.25);
  --wg-radius: 14px;
}

/* ------------------------------------------------------------------ 页面 */
.wg-page {
  height: 100%;
  overflow: auto;
  background: var(--wg-bg-base);
  color: var(--wg-text);
  font-family: var(--wg-font);
  font-size: 13px;
  line-height: 1.6;
  padding: 24px 28px 96px;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}
.wg-shell {
  max-width: 1000px;
  margin: 0 auto;
}
.wg-page ::selection {
  background: color-mix(in srgb, var(--wg-brand) 22%, transparent);
}

/* ------------------------------------------------------------------ 顶部 */
.wg-hero {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--wg-border);
  border-radius: 18px;
  background: var(--wg-bg-1);
  padding: 18px 20px 16px;
  box-shadow: var(--wg-shadow);
}
.wg-hero::before {
  content: "";
  position: absolute;
  inset: -40% 40% 40% -10%;
  background: radial-gradient(closest-side, var(--wg-brand), transparent);
  opacity: 0.12;
  pointer-events: none;
}
.wg-hero-top {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.wg-hero-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.2px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wg-hero-sub {
  color: var(--wg-dim);
  font-size: 12.5px;
  margin-top: 2px;
}
.wg-mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: var(--wg-brand);
  background: color-mix(in srgb, var(--wg-brand) 12%, var(--wg-bg-1));
  border: 1px solid color-mix(in srgb, var(--wg-brand) 26%, var(--wg-border));
}
.wg-mark svg {
  width: 24px;
  height: 24px;
  display: block;
}
.wg-input.short {
  max-width: 260px;
}
.wg-hero-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.wg-chips {
  position: relative;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.wg-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--wg-border);
  background: var(--wg-bg-2);
  color: var(--wg-dim);
  font-size: 11.5px;
  white-space: nowrap;
}
.wg-chip .wg-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.wg-chip.ok {
  color: var(--wg-ok);
  border-color: color-mix(in srgb, var(--wg-ok) 40%, var(--wg-border));
  background: color-mix(in srgb, var(--wg-ok) 8%, var(--wg-bg-1));
}
.wg-chip.warn {
  color: var(--wg-warn);
  border-color: color-mix(in srgb, var(--wg-warn) 40%, var(--wg-border));
  background: color-mix(in srgb, var(--wg-warn) 8%, var(--wg-bg-1));
}
.wg-chip.error {
  color: var(--wg-error);
  border-color: color-mix(in srgb, var(--wg-error) 40%, var(--wg-border));
  background: color-mix(in srgb, var(--wg-error) 8%, var(--wg-bg-1));
}
.wg-chip.brand {
  color: var(--wg-brand);
  border-color: color-mix(in srgb, var(--wg-brand) 40%, var(--wg-border));
  background: color-mix(in srgb, var(--wg-brand) 8%, var(--wg-bg-1));
}

/* ------------------------------------------------------------------ 分段标签 */
.wg-tabs {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  gap: 4px;
  margin: 16px 0 18px;
  padding: 5px;
  border: 1px solid var(--wg-border);
  border-radius: 13px;
  background: var(--wg-bg-1);
  box-shadow: 0 6px 16px -14px rgba(16, 24, 40, 0.5);
  overflow-x: auto;
  scrollbar-width: none;
}
.wg-tabs::-webkit-scrollbar {
  display: none;
}
.wg-tab {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--wg-dim);
  font-family: inherit;
  font-size: 12.5px;
  height: 30px;
  padding: 0 14px;
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.wg-tab:hover {
  color: var(--wg-text);
  background: var(--wg-bg-2);
}
.wg-tab.active {
  color: var(--wg-text);
  font-weight: 600;
  background: var(--wg-bg-base);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08), inset 0 0 0 1px var(--wg-border);
}

/* ------------------------------------------------------------------ 卡片 */
.wg-card {
  border: 1px solid var(--wg-border);
  border-radius: var(--wg-radius);
  background: var(--wg-bg-1);
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  overflow: hidden;
}
.wg-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--wg-border);
  background: linear-gradient(180deg, var(--wg-bg-2), transparent);
}
.wg-card-title {
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.2px;
}
.wg-card-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--wg-dim);
  font-size: 11.5px;
}
.wg-card-body {
  padding: 4px 16px 12px;
}
.wg-card-body.flush {
  padding: 0;
}

/* ------------------------------------------------------------------ 字段行 */
.wg-field {
  display: grid;
  grid-template-columns: minmax(180px, 232px) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
  padding: 11px 0;
  border-bottom: 1px dashed var(--wg-border);
}
.wg-field:last-child {
  border-bottom: 0;
}
.wg-field.wide {
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}
.wg-field-label {
  font-weight: 500;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.wg-field-hint {
  color: var(--wg-dim);
  font-size: 11.5px;
  margin-top: 3px;
  word-break: break-word;
}
.wg-path {
  font-family: var(--wg-mono);
  font-size: 10.5px;
  color: var(--wg-dim);
  opacity: 0.9;
  display: block;
  margin-top: 4px;
}
.wg-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--wg-warn);
  flex: 0 0 auto;
}

/* ------------------------------------------------------------------ 开关 */
.wg-switch {
  position: relative;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--wg-border-2);
  background: var(--wg-bg-2);
  cursor: pointer;
  padding: 0;
  transition: background 0.18s, border-color 0.18s;
  flex: 0 0 auto;
}
.wg-switch > i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--wg-idle);
  transition: left 0.18s, background 0.18s;
}
.wg-switch[aria-checked="true"] {
  background: var(--wg-brand);
  border-color: var(--wg-brand);
}
.wg-switch[aria-checked="true"] > i {
  left: 20px;
  background: #fff;
}
.wg-switch:focus-visible {
  outline: 2px solid var(--wg-brand);
  outline-offset: 2px;
}
.wg-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wg-switch-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* ------------------------------------------------------------------ 按钮 */
.wg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 13px;
  border-radius: 9px;
  border: 1px solid var(--wg-border-2);
  background: var(--wg-bg-base);
  color: var(--wg-text);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, filter 0.15s;
  white-space: nowrap;
}
.wg-btn:hover {
  background: var(--wg-bg-2);
}
.wg-btn.primary {
  background: var(--wg-brand);
  border-color: var(--wg-brand);
  color: #fff;
}
.wg-btn.primary:hover {
  filter: brightness(1.06);
}
.wg-btn.ghost {
  background: transparent;
  border-color: var(--wg-border);
  color: var(--wg-dim);
}
.wg-btn.ghost:hover {
  color: var(--wg-text);
  background: var(--wg-bg-2);
}
.wg-btn.danger {
  background: transparent;
  border-color: color-mix(in srgb, var(--wg-error) 45%, var(--wg-border));
  color: var(--wg-error);
}
.wg-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wg-btn.sm {
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
  border-radius: 8px;
}

/* ------------------------------------------------------------------ 输入 */
.wg-input,
.wg-select,
.wg-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--wg-border-2);
  border-radius: 9px;
  background: var(--wg-bg-base);
  color: var(--wg-text);
  font-family: inherit;
  font-size: 12.5px;
  padding: 0 10px;
  height: 32px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.wg-textarea {
  height: auto;
  padding: 8px 10px;
  line-height: 1.55;
  resize: vertical;
  font-family: var(--wg-font);
}
.wg-textarea.mono {
  font-family: var(--wg-mono);
  font-size: 12px;
}
.wg-input.mono {
  font-family: var(--wg-mono);
}
.wg-input:focus,
.wg-select:focus,
.wg-textarea:focus {
  outline: 0;
  border-color: var(--wg-brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wg-brand) 18%, transparent);
}
.wg-input::placeholder,
.wg-textarea::placeholder {
  color: var(--wg-idle);
}
.wg-number {
  max-width: 168px;
}
.wg-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wg-range {
  font-family: var(--wg-mono);
  font-size: 11px;
  color: var(--wg-dim);
}

/* ------------------------------------------------------------------ 标签编辑器 */
.wg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.wg-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 4px 0 9px;
  border-radius: 7px;
  border: 1px solid var(--wg-border);
  background: var(--wg-bg-2);
  font-size: 11.5px;
}
.wg-tag button {
  border: 0;
  background: transparent;
  color: var(--wg-dim);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 4px;
}
.wg-tag button:hover {
  color: var(--wg-error);
  background: color-mix(in srgb, var(--wg-error) 10%, transparent);
}

/* ------------------------------------------------------------------ 提示条 */
.wg-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 10px 14px;
  border: 1px solid var(--wg-border);
  border-left: 3px solid var(--wg-idle);
  border-radius: 10px;
  background: var(--wg-bg-2);
  font-size: 12.5px;
  margin-bottom: 14px;
}
.wg-banner.ok {
  border-left-color: var(--wg-ok);
  background: color-mix(in srgb, var(--wg-ok) 7%, var(--wg-bg-1));
}
.wg-banner.warn {
  border-left-color: var(--wg-warn);
  background: color-mix(in srgb, var(--wg-warn) 8%, var(--wg-bg-1));
}
.wg-banner.error {
  border-left-color: var(--wg-error);
  background: color-mix(in srgb, var(--wg-error) 8%, var(--wg-bg-1));
}
.wg-banner.brand {
  border-left-color: var(--wg-brand);
  background: color-mix(in srgb, var(--wg-brand) 7%, var(--wg-bg-1));
}
.wg-banner-text {
  flex: 1;
  min-width: 0;
}
.wg-banner-detail {
  color: var(--wg-dim);
  font-size: 11.5px;
  margin-top: 2px;
}

/* ------------------------------------------------------------------ 统计 */
.wg-stats {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin-bottom: 16px;
}
.wg-stat {
  border: 1px solid var(--wg-border);
  border-radius: 13px;
  background: var(--wg-bg-1);
  padding: 12px 14px;
}
.wg-stat-label {
  color: var(--wg-dim);
  font-size: 11px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.wg-stat-value {
  font-size: 21px;
  font-weight: 650;
  margin-top: 3px;
  letter-spacing: 0.2px;
}
.wg-stat-sub {
  color: var(--wg-dim);
  font-size: 11px;
  margin-top: 2px;
}

/* ------------------------------------------------------------------ 预设卡 */
.wg-presets {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}
.wg-preset {
  border: 1px solid var(--wg-border);
  border-radius: 12px;
  background: var(--wg-bg-2);
  padding: 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wg-preset-name {
  font-weight: 600;
  font-size: 12.5px;
}
.wg-preset-desc {
  color: var(--wg-dim);
  font-size: 11.5px;
  flex: 1;
}
.wg-preset .wg-btn {
  align-self: flex-start;
  margin-top: 6px;
}

/* ------------------------------------------------------------------ 消息与日志 */
.wg-list {
  display: flex;
  flex-direction: column;
}
.wg-msg {
  display: grid;
  grid-template-columns: 52px 128px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 7px 0;
  border-bottom: 1px dashed var(--wg-border);
  font-size: 12.5px;
}
.wg-msg:last-child {
  border-bottom: 0;
}
.wg-msg-time {
  font-family: var(--wg-mono);
  font-size: 10.5px;
  color: var(--wg-dim);
}
.wg-msg-who {
  color: var(--wg-brand);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wg-msg-text {
  word-break: break-word;
}
.wg-code {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--wg-border);
  border-radius: 10px;
  background: var(--wg-bg-base);
  color: var(--wg-dim);
  font-family: var(--wg-mono);
  font-size: 11.5px;
  line-height: 1.55;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ------------------------------------------------------------------ 空态 / 加载 */
.wg-empty {
  padding: 22px 0;
  text-align: center;
  color: var(--wg-dim);
  font-size: 12.5px;
}
.wg-skeleton {
  height: 96px;
  border-radius: var(--wg-radius);
  border: 1px solid var(--wg-border);
  background: linear-gradient(90deg, var(--wg-bg-2) 25%, var(--wg-bg-1) 37%, var(--wg-bg-2) 63%);
  background-size: 400% 100%;
  animation: wg-shimmer 1.4s ease infinite;
  margin-bottom: 14px;
}
@keyframes wg-shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
.wg-spin {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: wg-spin 0.9s linear infinite;
  display: inline-block;
  opacity: 0.8;
}
@keyframes wg-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------------------------------------------ 保存条 */
.wg-savebar {
  position: sticky;
  bottom: 12px;
  z-index: 7;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  padding: 10px 14px;
  border: 1px solid var(--wg-border);
  border-radius: 12px;
  background: var(--wg-bg-1);
  box-shadow: var(--wg-shadow);
}
.wg-savebar-text {
  flex: 1;
  font-size: 12.5px;
  color: var(--wg-dim);
}
.wg-savebar-text strong {
  color: var(--wg-text);
}

/* ------------------------------------------------------------------ 小工具 */
.wg-divider {
  height: 1px;
  background: var(--wg-border);
  margin: 12px 0;
}
.wg-mono {
  font-family: var(--wg-mono);
  font-size: 11.5px;
}
.wg-muted {
  color: var(--wg-dim);
}
.wg-hstack {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wg-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: start;
  margin-top: 8px;
}
.wg-scroll {
  scrollbar-width: thin;
}
.wg-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.wg-scroll::-webkit-scrollbar-thumb {
  background: var(--wg-border-2);
  border-radius: 99px;
}

  /*__THEME_END__*/
`;

    // ------------------------------------------------------------ API
    async function apiFetch(path, init) {
      const res = await fetch(`${API}${path}`, init);
      const text = await res.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { ok: false, raw: text.slice(0, 400) };
      }
      if (!res.ok && !body?.offline) {
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      return body;
    }
    const getJson = (path) => apiFetch(path);
    const postJson = (path, body) =>
      apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });

    // ------------------------------------------------------------ 基础件
    function Styles() {
      return h('style', { 'data-whalegirl-css': '' }, CSS);
    }

    function Page({ children }) {
      return h(
        'div',
        { className: 'wg-page wg-scroll' },
        h(Styles),
        h('div', { className: 'wg-shell' }, children),
      );
    }

    function Card({ title, right, children }) {
      return h(
        'section',
        { className: 'wg-card' },
        title
          ? h(
              'div',
              { className: 'wg-card-head' },
              h('div', { className: 'wg-card-title' }, title),
              right ? h('div', { className: 'wg-card-right' }, right) : null,
            )
          : null,
        h('div', { className: 'wg-card-body' }, children),
      );
    }

    function Field({ label, hint, path, wide, dirty, children }) {
      return h(
        'div',
        { className: wide ? 'wg-field wide' : 'wg-field' },
        h(
          'div',
          { style: { minWidth: 0 } },
          h(
            'div',
            { className: 'wg-field-label' },
            label,
            dirty ? h('span', { className: 'wg-dirty', title: '有未保存改动' }) : null,
          ),
          hint ? h('div', { className: 'wg-field-hint' }, hint) : null,
          path ? h('span', { className: 'wg-path' }, path) : null,
        ),
        h('div', { style: { minWidth: 0 } }, children),
      );
    }

    function Switch({ checked, onChange, disabled }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          disabled,
          className: 'wg-switch',
          onClick: () => onChange(!checked),
        },
        h('i'),
      );
    }

    function Button({ children, onClick, kind = '', size = '', disabled, busy, title }) {
      return h(
        'button',
        {
          type: 'button',
          title,
          className: ['wg-btn', kind, size].filter(Boolean).join(' '),
          disabled: disabled || busy,
          onClick,
        },
        busy ? h('span', { className: 'wg-spin' }) : null,
        children,
      );
    }

    function Chip({ tone = '', children, dot = true }) {
      return h(
        'span',
        { className: `wg-chip ${tone}`.trim() },
        dot ? h('i', { className: 'wg-dot' }) : null,
        children,
      );
    }

    function TextInput({ value, onChange, placeholder, mono, short, disabled }) {
      return h('input', {
        type: 'text',
        className: ['wg-input', mono ? 'mono' : '', short ? 'short' : ''].filter(Boolean).join(' '),
        value: value ?? '',
        placeholder,
        disabled,
        onChange: (e) => onChange(e.target.value),
      });
    }

    function NumberInput({ value, onChange, min, max, step }) {
      return h('input', {
        type: 'number',
        className: 'wg-input wg-number',
        value: value ?? '',
        min,
        max,
        step: step ?? 1,
        onChange: (e) => {
          const raw = e.target.value;
          onChange(raw === '' ? '' : Number(raw));
        },
      });
    }

    function TextArea({ value, onChange, rows = 6, mono }) {
      return h('textarea', {
        className: mono ? 'wg-textarea mono' : 'wg-textarea',
        value: value ?? '',
        rows,
        onChange: (e) => onChange(e.target.value),
      });
    }

    function Select({ value, onChange, options, width }) {
      return h(
        'select',
        {
          className: 'wg-select',
          style: { maxWidth: width ?? 240 },
          value: value ?? '',
          onChange: (e) => onChange(e.target.value),
        },
        options.map((option) => h('option', { key: option, value: option }, option)),
      );
    }

    function TagEditor({ value, onChange, placeholder }) {
      const items = Array.isArray(value) ? value : [];
      const [text, setText] = useState('');
      const add = () => {
        const next = text.trim();
        if (!next) return;
        if (!items.includes(next)) onChange([...items, next]);
        setText('');
      };
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'wg-tags' },
          items.length === 0
            ? h('span', { className: 'wg-muted', style: { fontSize: 12 } }, '（空）')
            : items.map((item) =>
                h(
                  'span',
                  { key: item, className: 'wg-tag' },
                  item,
                  h(
                    'button',
                    {
                      type: 'button',
                      title: '移除',
                      onClick: () => onChange(items.filter((x) => x !== item)),
                    },
                    '×',
                  ),
                ),
              ),
        ),
        h(
          'div',
          { className: 'wg-inline', style: { flexWrap: 'nowrap' } },
          h(
            'div',
            { style: { flex: 1, maxWidth: 320 } },
            h(TextInput, {
              value: text,
              onChange: setText,
              placeholder: placeholder ?? '输入后点添加',
            }),
          ),
          h(Button, { size: 'sm', kind: 'ghost', onClick: add }, '添加'),
        ),
      );
    }

    function Tabs({ items, active, onChange }) {
      return h(
        'div',
        { className: 'wg-tabs' },
        items.map((item) =>
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              className: active === item.id ? 'wg-tab active' : 'wg-tab',
              onClick: () => onChange(item.id),
            },
            item.label,
          ),
        ),
      );
    }

    function Banner({ tone = '', children, detail, action }) {
      return h(
        'div',
        { className: `wg-banner ${tone}`.trim() },
        h(
          'div',
          { className: 'wg-banner-text' },
          children,
          detail ? h('div', { className: 'wg-banner-detail' }, detail) : null,
        ),
        action,
      );
    }

    function Stat({ label, value, sub, tone }) {
      return h(
        'div',
        { className: 'wg-stat' },
        h('div', { className: 'wg-stat-label' }, label),
        h('div', { className: 'wg-stat-value', style: tone ? { color: tone } : undefined }, value),
        sub ? h('div', { className: 'wg-stat-sub' }, sub) : null,
      );
    }

    function Empty({ children }) {
      return h('div', { className: 'wg-empty' }, children);
    }

    function Skeleton({ count = 2 }) {
      return h(
        'div',
        null,
        Array.from({ length: count }).map((_, i) =>
          h('div', { key: i, className: 'wg-skeleton' }),
        ),
      );
    }

    function Code({ children }) {
      return h('pre', { className: 'wg-code' }, children);
    }

    function HintBlock({ children }) {
      return h('div', { className: 'wg-field-hint', style: { padding: '8px 0' } }, children);
    }

    function WhaleMark() {
      return h(
        'div',
        { className: 'wg-mark', 'aria-hidden': true },
        h(
          'svg',
          { viewBox: '0 0 24 24', width: 24, height: 24 },
          h('path', {
            d: 'M3.2 14.4c0-3.1 2.6-5.6 5.9-5.6 1.5 0 2.9.5 3.9 1.4 1.4-.6 2.4-2 2.4-3.6 0-.5-.1-1-.3-1.4l1.7-.9c.3.7.4 1.5.4 2.3 0 2-1 3.7-2.5 4.7.5 2.5-.4 5.4-2.7 6.8-1.1.6-2.4.9-3.6.6l-.9 2.3-1.6-.6.8-2.2c-2.3-1-3.5-2.9-3.5-4.8z',
            fill: 'currentColor',
          }),
          h('circle', { cx: 7.6, cy: 13.2, r: 0.95, fill: 'var(--wg-bg-1)' }),
        ),
      );
    }

    // ------------------------------------------------------------ 错误边界
    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: '' };
      }
      static getDerivedStateFromError(error) {
        return { error: String(error?.message ?? error) };
      }
      componentDidCatch(error, info) {
        try {
          console.error('[whalegirl] 页面渲染失败', error, info);
        } catch {
          /* ignore */
        }
      }
      render() {
        if (this.state.error) {
          return h(
            'div',
            { className: 'wg-page' },
            h(Styles),
            h(
              'div',
              { className: 'wg-shell' },
              h(
                Banner,
                { tone: 'error' },
                '鲸鱼娘面板渲染出错（不影响 DSH 其它功能）：',
                h('div', { className: 'wg-mono', style: { marginTop: 6 } }, this.state.error),
              ),
              h(Empty, null, '细节看 ~/.dsh/whalegirl/plugin.log 与浏览器控制台。'),
            ),
          );
        }
        return this.props.children ?? null;
      }
    }

    function guarded(Component) {
      return function Guarded() {
        return h(Boundary, null, h(Component));
      };
    }

    // ------------------------------------------------------------ 字段控件
    function FieldControl({ field, value, onChange }) {
      if (field.type === 'bool') {
        return h(
          'div',
          { className: 'wg-switch-row' },
          h(Switch, { checked: Boolean(value), onChange }),
          h('span', { className: 'wg-muted', style: { fontSize: 11.5 } }, value ? '开' : '关'),
        );
      }
      if (field.type === 'enum') {
        return h(Select, { value, onChange, options: field.options ?? [] });
      }
      if (field.type === 'int' || field.type === 'float') {
        return h(
          'div',
          { className: 'wg-inline' },
          h(NumberInput, {
            value,
            onChange,
            min: field.min,
            max: field.max,
            step: field.step ?? (field.type === 'float' ? 0.05 : 1),
          }),
          field.min !== undefined
            ? h('span', { className: 'wg-range' }, `${field.min} ~ ${field.max}`)
            : null,
        );
      }
      if (field.type === 'list') {
        return h(TagEditor, { value, onChange });
      }
      return h(TextInput, { value, onChange, short: true, mono: field.path.length > 22 });
    }

    // ------------------------------------------------------------ 设置页
    const TABS = [
      { id: 'features', label: '功能开关' },
      { id: 'persona', label: '人设' },
      { id: 'frequency', label: '回复频率' },
      { id: 'platform', label: '平台' },
      { id: 'voice', label: '语音与点歌' },
      { id: 'advanced', label: '模型与高级' },
    ];

    function SettingsPage() {
      const [tab, setTab] = useState('features');
      const [schema, setSchema] = useState(null);
      const [values, setValues] = useState({});
      const [draft, setDraft] = useState({});
      const [status, setStatus] = useState(null);
      const [supervisor, setSupervisor] = useState(null);
      const [busy, setBusy] = useState('');
      const [notice, setNotice] = useState(null);
      const [styleDoc, setStyleDoc] = useState(null);
      const [persona, setPersona] = useState(null);
      const [qqCfg, setQqCfg] = useState(null);
      const [qqDraft, setQqDraft] = useState({ app_id: '', client_secret: '', sandbox: false });
      const [logs, setLogs] = useState([]);

      const reloadSettings = useCallback(async () => {
        try {
          const [schemaData, valueData] = await Promise.all([
            getJson('/api/settings/schema'),
            getJson('/api/settings'),
          ]);
          setSchema(schemaData);
          setValues(valueData?.values ?? {});
        } catch (e) {
          setNotice({ tone: 'error', text: `读取设置失败：${String(e?.message ?? e)}` });
        }
      }, []);

      const reloadPersona = useCallback(async () => {
        try {
          const doc = await getJson('/api/style');
          setStyleDoc(doc);
          if (doc?.current) {
            setPersona({
              display_name: doc.current.display_name ?? '',
              description: doc.current.description ?? '',
              system_prompt: doc.current.system_prompt ?? '',
              temperature: doc.current.temperature ?? 0.9,
              max_tokens: doc.current.max_tokens ?? 100,
              examples: Array.isArray(doc.current.examples) ? doc.current.examples.slice() : [],
            });
          }
        } catch {
          setStyleDoc({ offline: true });
        }
      }, []);

      const reloadQQ = useCallback(async () => {
        try {
          const data = await getJson('/api/qq/config');
          setQqCfg(data);
          setQqDraft({
            app_id: data?.app_id ?? '',
            client_secret: '',
            sandbox: Boolean(data?.sandbox),
          });
        } catch {
          setQqCfg(null);
        }
      }, []);

      const reloadRuntime = useCallback(async () => {
        try {
          const sup = await getJson('/local/supervisor');
          setSupervisor(sup);
          try {
            setStatus(await getJson('/api/status'));
          } catch {
            setStatus(null);
          }
        } catch (e) {
          setSupervisor({ online: false, error: String(e?.message ?? e) });
          setStatus(null);
        }
      }, []);

      useEffect(() => {
        reloadSettings();
        reloadPersona();
        reloadQQ();
        reloadRuntime();
      }, [reloadSettings, reloadPersona, reloadQQ, reloadRuntime]);

      useEffect(() => {
        const timer = setInterval(reloadRuntime, 5000);
        return () => clearInterval(timer);
      }, [reloadRuntime]);

      const online = Boolean(status) || Boolean(supervisor?.online);
      const running = Boolean(status?.running);
      const wechat = String(status?.wechat?.status ?? (online ? 'unknown' : '未连接'));
      const pipeline = Boolean(status?.handler?.processing);
      const queue = status?.handler?.queue_size ?? 0;
      const dirtyCount = Object.keys(draft).length;

      // ---------------------------------------------------------- 动作
      async function saveSettings() {
        if (dirtyCount === 0) return;
        setBusy('save');
        try {
          const result = await postJson('/api/settings', { values: draft });
          if (result?.success) {
            setDraft({});
            setNotice({
              tone: result.requires_restart ? 'warn' : 'ok',
              text: result.message,
              restart: Boolean(result.requires_restart),
              detail: (result.restart_keys ?? []).join('、'),
            });
            await reloadSettings();
          } else {
            setNotice({
              tone: 'error',
              text: result?.message || '保存失败',
              detail: result?.errors ? Object.values(result.errors).join('；') : '',
            });
          }
        } catch (e) {
          setNotice({ tone: 'error', text: `保存失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      async function applyPreset(preset) {
        setBusy(`preset-${preset}`);
        try {
          const result = await postJson('/api/settings/preset', { preset });
          setNotice({
            tone: result?.requires_restart ? 'warn' : 'ok',
            text: `已套用「${preset}」：${result?.message ?? ''}`,
            restart: Boolean(result?.requires_restart),
            detail: (result?.restart_keys ?? []).join('、'),
          });
          await reloadSettings();
        } catch (e) {
          setNotice({ tone: 'error', text: `套用失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      async function control(action) {
        setBusy(action);
        try {
          const result = await postJson(`/local/${action}`, action === 'restart' ? { force: false } : {});
          setNotice({ tone: result?.ok ? 'ok' : 'warn', text: result?.message ?? `${action} 完成` });
          await reloadRuntime();
          await reloadSettings();
        } catch (e) {
          setNotice({ tone: 'error', text: `${action} 失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      async function savePersona() {
        if (!persona) return;
        setBusy('persona');
        try {
          const result = await postJson('/api/style', persona);
          setNotice({ tone: result?.success ? 'ok' : 'error', text: result?.message ?? '已保存' });
          if (result?.success) await reloadPersona();
        } catch (e) {
          setNotice({ tone: 'error', text: `保存人设失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      async function resetPersona() {
        setBusy('persona-reset');
        try {
          const result = await postJson('/api/style/reset', {});
          setNotice({ tone: result?.success ? 'ok' : 'error', text: result?.message ?? '' });
          await reloadPersona();
        } catch (e) {
          setNotice({ tone: 'error', text: `恢复失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      async function toggleLock() {
        setBusy('lock');
        try {
          const next = !styleDoc?.locked;
          const result = await postJson('/api/style/lock', { locked: next });
          setNotice({ tone: result?.success ? 'ok' : 'error', text: result?.message ?? '' });
          await reloadPersona();
        } catch (e) {
          setNotice({ tone: 'error', text: `切换锁失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      async function saveQQ() {
        setBusy('qq');
        try {
          const result = await postJson('/api/qq/config', {
            app_id: qqDraft.app_id.trim(),
            client_secret: qqDraft.client_secret.trim(),
            sandbox: Boolean(qqDraft.sandbox),
            backend: 'official',
            enabled: true,
          });
          setNotice({ tone: result?.success ? 'ok' : 'error', text: result?.message ?? '已保存' });
          await reloadQQ();
        } catch (e) {
          setNotice({ tone: 'error', text: `保存 QQ 配置失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      async function loadLogs() {
        try {
          const data = await getJson('/api/logs?limit=120');
          setLogs(Array.isArray(data?.logs) ? data.logs : []);
        } catch (e) {
          setLogs([`读取日志失败：${String(e?.message ?? e)}`]);
        }
      }

      async function clearContext() {
        setBusy('clear');
        try {
          const result = await postJson('/api/context/clear', {});
          setNotice({ tone: 'ok', text: `已清空上下文：${(result?.cleared ?? []).join('、')}` });
        } catch (e) {
          setNotice({ tone: 'error', text: `清空失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      // ---------------------------------------------------------- 分组
      const fieldsByGroup = useMemo(() => {
        const map = {};
        for (const field of schema?.fields ?? []) {
          (map[field.group] ??= []).push(field);
        }
        return map;
      }, [schema]);

      const groupTitle = (id) => (schema?.groups ?? []).find((g) => g.id === id)?.label ?? id;
      const valueOf = (field) => (field.path in draft ? draft[field.path] : values[field.path]);

      function fieldRow(field) {
        return h(
          Field,
          {
            key: field.path,
            label: field.label,
            hint: field.help,
            path: field.path,
            dirty: field.path in draft,
          },
          h(FieldControl, {
            field,
            value: valueOf(field),
            onChange: (next) => setDraft((prev) => ({ ...prev, [field.path]: next })),
          }),
        );
      }

      function groupCard(groupId) {
        const fields = fieldsByGroup[groupId] ?? [];
        if (fields.length === 0) return null;
        const on = fields.filter((f) => Boolean(valueOf(f))).length;
        return h(
          Card,
          { key: groupId, title: groupTitle(groupId), right: `${on}/${fields.length} 开` },
          fields.map(fieldRow),
        );
      }

      function fieldsCard(title, groupId) {
        const fields = fieldsByGroup[groupId] ?? [];
        if (fields.length === 0) return null;
        return h(Card, { title }, fields.map(fieldRow));
      }

      // ---------------------------------------------------------- 各分区
      function featuresTab() {
        return h(
          'div',
          null,
          h(
            Banner,
            { tone: 'brand' },
            '这里的开关写入 deepseekgirl\\config.yaml。除监听列表外，改完需要重启机器人（约 25 秒）才生效。',
          ),
          ['chat', 'media', 'song', 'divination', 'joke', 'proactive'].map(groupCard),
        );
      }

      function personaTab() {
        if (!styleDoc) return h(Skeleton, { count: 2 });
        if (styleDoc.offline) {
          return h(Banner, { tone: 'warn' }, '机器人本体没响应，人设暂时读不到。');
        }
        const locked = Boolean(styleDoc.locked);
        return h(
          'div',
          null,
          h(
            Banner,
            {
              tone: locked ? 'warn' : 'ok',
              action: h(
                Button,
                { onClick: toggleLock, busy: busy === 'lock', size: 'sm', kind: 'ghost' },
                locked ? '解锁编辑' : '锁定出厂人设',
              ),
            },
            locked
              ? '人设已锁定：等于改造前的永久锁，只能读不能改。'
              : `当前人设：${styleDoc.active} · 保存后立即生效（不重启、不重连微信）`,
          ),
          locked || !persona
            ? null
            : h(
                Card,
                {
                  title: '人设编辑',
                  right: [
                    h(
                      Button,
                      {
                        key: 'reset',
                        onClick: resetPersona,
                        busy: busy === 'persona-reset',
                        size: 'sm',
                        kind: 'ghost',
                      },
                      '恢复默认',
                    ),
                    h(
                      Button,
                      {
                        key: 'save',
                        onClick: savePersona,
                        busy: busy === 'persona',
                        size: 'sm',
                        kind: 'primary',
                      },
                      '保存并生效',
                    ),
                  ],
                },
                h(
                  Field,
                  { label: '显示名', hint: '仪表盘/日志里显示的名字' },
                  h(TextInput, {
                    value: persona.display_name,
                    onChange: (v) => setPersona((p) => ({ ...p, display_name: v })),
                    short: true,
                  }),
                ),
                h(
                  Field,
                  { label: '一句话描述', hint: '给自己看的备注，不影响提示词' },
                  h(TextInput, {
                    value: persona.description,
                    onChange: (v) => setPersona((p) => ({ ...p, description: v })),
                    short: true,
                  }),
                ),
                h(
                  Field,
                  {
                    label: '人设提示词',
                    wide: true,
                    hint: '开头 [PERSONA_LOAD] … [PERSONA_END] 那段是身份防护标记，非必要别删',
                  },
                  h(TextArea, {
                    value: persona.system_prompt,
                    rows: 14,
                    mono: true,
                    onChange: (v) => setPersona((p) => ({ ...p, system_prompt: v })),
                  }),
                ),
                h(
                  Field,
                  { label: '温度', hint: '越高越放飞；0.9 是她现在的设定' },
                  h(NumberInput, {
                    value: persona.temperature,
                    min: 0,
                    max: 2,
                    step: 0.05,
                    onChange: (v) => setPersona((p) => ({ ...p, temperature: v })),
                  }),
                ),
                h(
                  Field,
                  { label: '回复 token 上限', hint: '群聊场景别调太高' },
                  h(NumberInput, {
                    value: persona.max_tokens,
                    min: 16,
                    max: 4096,
                    step: 16,
                    onChange: (v) => setPersona((p) => ({ ...p, max_tokens: v })),
                  }),
                ),
                h(
                  'div',
                  { style: { paddingTop: 12 } },
                  h(
                    'div',
                    { className: 'wg-hstack', style: { justifyContent: 'space-between' } },
                    h('div', { style: { fontWeight: 600 } }, `示例对话（${persona.examples.length}）`),
                    h(
                      Button,
                      {
                        size: 'sm',
                        kind: 'ghost',
                        onClick: () =>
                          setPersona((p) => ({
                            ...p,
                            examples: [...p.examples, { user: '', assistant: '' }],
                          })),
                      },
                      '加一条',
                    ),
                  ),
                  h(
                    'div',
                    { className: 'wg-field-hint', style: { marginTop: 2 } },
                    '左边是群友说的，右边是她该回的腔调；会一起进提示词。',
                  ),
                  persona.examples.length === 0
                    ? h(Empty, null, '没有示例对话')
                    : persona.examples.map((example, index) =>
                        h(
                          'div',
                          { key: index, className: 'wg-grid-2' },
                          h(TextArea, {
                            value: example.user ?? '',
                            rows: 2,
                            onChange: (v) =>
                              setPersona((p) => {
                                const next = p.examples.slice();
                                next[index] = { ...next[index], user: v };
                                return { ...p, examples: next };
                              }),
                          }),
                          h(TextArea, {
                            value: example.assistant ?? '',
                            rows: 2,
                            onChange: (v) =>
                              setPersona((p) => {
                                const next = p.examples.slice();
                                next[index] = { ...next[index], assistant: v };
                                return { ...p, examples: next };
                              }),
                          }),
                          h(
                            Button,
                            {
                              size: 'sm',
                              kind: 'danger',
                              onClick: () =>
                                setPersona((p) => ({
                                  ...p,
                                  examples: p.examples.filter((_, i) => i !== index),
                                })),
                            },
                            '删',
                          ),
                        ),
                      ),
                ),
              ),
        );
      }

      function frequencyTab() {
        return h(
          'div',
          null,
          h(
            Card,
            { title: '频率预设', right: '点一下套用，再往下微调' },
            h(
              'div',
              { className: 'wg-presets', style: { paddingTop: 10 } },
              (schema?.presets ?? []).map((preset) =>
                h(
                  'div',
                  { key: preset.id, className: 'wg-preset' },
                  h('div', { className: 'wg-preset-name' }, preset.label),
                  h('div', { className: 'wg-preset-desc' }, preset.desc),
                  h(
                    Button,
                    {
                      size: 'sm',
                      kind: preset.id === 'normal' ? 'primary' : '',
                      onClick: () => applyPreset(preset.id),
                      busy: busy === `preset-${preset.id}`,
                    },
                    '套用',
                  ),
                ),
              ),
            ),
          ),
          h(
            Banner,
            { tone: 'brand' },
            '「@ 她」永远必回，不受参与概率影响 —— 概率只作用于没人叫她的闲聊。',
          ),
          groupCard('frequency'),
        );
      }

      function platformTab() {
        return h(
          'div',
          null,
          h(
            Card,
            {
              title: '微信',
              right: h(Chip, { tone: wechat === 'connected' ? 'ok' : 'warn' }, wechat),
            },
            h(
              Field,
              { label: '通道控制', hint: '微信桌面版 UI 自动化；启动约 25 秒' },
              h(
                'div',
                { className: 'wg-hstack' },
                h(Button, { onClick: () => control('start'), busy: busy === 'start', kind: 'primary' }, '启动'),
                h(Button, { onClick: () => control('stop'), busy: busy === 'stop' }, '停止'),
                h(Button, { onClick: () => control('restart'), busy: busy === 'restart' }, '重启'),
              ),
            ),
          ),
          groupCard('platform'),
          h(
            Card,
            { title: 'QQ 开放平台凭证' },
            qqCfg
              ? h(
                  'div',
                  null,
                  h(
                    Field,
                    { label: 'AppID' },
                    h(TextInput, {
                      value: qqDraft.app_id,
                      short: true,
                      onChange: (v) => setQqDraft((p) => ({ ...p, app_id: v })),
                    }),
                  ),
                  h(
                    Field,
                    {
                      label: 'AppSecret',
                      hint: qqCfg.secret_set ? '已设置（留空表示不修改）' : '还没设置',
                    },
                    h(TextInput, {
                      value: qqDraft.client_secret,
                      short: true,
                      placeholder: qqCfg.secret_set ? '••••••（留空不改）' : 'Client Secret',
                      onChange: (v) => setQqDraft((p) => ({ ...p, client_secret: v })),
                    }),
                  ),
                  h(
                    Field,
                    { label: '沙箱环境' },
                    h(Switch, {
                      checked: Boolean(qqDraft.sandbox),
                      onChange: (v) => setQqDraft((p) => ({ ...p, sandbox: v })),
                    }),
                  ),
                  h(
                    'div',
                    { className: 'wg-hstack', style: { paddingTop: 10 } },
                    h(Button, { onClick: saveQQ, busy: busy === 'qq', kind: 'primary' }, '保存 QQ 配置'),
                    h(
                      'span',
                      { className: 'wg-muted', style: { fontSize: 11.5 } },
                      'Secret 走机器人本体的 Fernet 加密落盘',
                    ),
                  ),
                )
              : h(Empty, null, '读不到 QQ 配置（机器人可能没起）'),
          ),
          h(
            Card,
            { title: '企业微信' },
            h(
              HintBlock,
              null,
              '当前 config.yaml 里没有 wecom 段，等于未启用。要用手先在「功能开关」打开，再补 corpid / agentid / secret。',
            ),
          ),
        );
      }

      function voiceTab() {
        return h(
          'div',
          null,
          groupCard('voice'),
          groupCard('song'),
          h(
            Card,
            { title: '音色口径' },
            h(
              HintBlock,
              null,
              '说话：zh-CN-XiaoyiNeural + pitch +40Hz（「更儿童」）；真唱音色由 voice.songs.cover.prompt 决定。改音色或混音配比必须同时改 voice_version，否则旧缓存会直接命中。',
            ),
          ),
        );
      }

      function advancedTab() {
        return h(
          'div',
          null,
          h(
            Card,
            {
              title: '机器人进程',
              right: [
                h(Button, { key: 's', size: 'sm', onClick: () => control('start'), busy: busy === 'start', kind: 'primary' }, '启动'),
                h(Button, { key: 'o', size: 'sm', onClick: () => control('stop'), busy: busy === 'stop' }, '停止'),
                h(Button, { key: 'r', size: 'sm', onClick: () => control('restart'), busy: busy === 'restart' }, '重启'),
              ],
            },
            h(
              'div',
              { className: 'wg-stats', style: { marginTop: 10 } },
              h(Stat, {
                label: '进程',
                value: supervisor?.supervisor?.attached ? '托管中' : '未托管',
                tone: supervisor?.supervisor?.attached ? 'var(--wg-ok)' : 'var(--wg-dim)',
              }),
              h(Stat, {
                label: '本体',
                value: online ? '在线' : '离线',
                tone: online ? 'var(--wg-ok)' : 'var(--wg-error)',
              }),
              h(Stat, {
                label: '微信',
                value: wechat,
                tone: wechat === 'connected' ? 'var(--wg-ok)' : 'var(--wg-warn)',
              }),
              h(Stat, { label: '队列', value: queue, sub: pipeline ? '管线在跑' : '管线已停' }),
            ),
            supervisor?.supervisor?.lastError
              ? h(Banner, { tone: 'warn' }, supervisor.supervisor.lastError)
              : null,
            h(Code, null, JSON.stringify(supervisor?.supervisor ?? {}, null, 2)),
          ),
          fieldsCard('模型接口', 'ai'),
          fieldsCard('高级', 'advanced'),
          h(
            Card,
            {
              title: '上下文与日志',
              right: [
                h(Button, { key: 'l', size: 'sm', kind: 'ghost', onClick: loadLogs }, '读日志'),
                h(
                  Button,
                  { key: 'c', size: 'sm', kind: 'danger', onClick: clearContext, busy: busy === 'clear' },
                  '清空上下文',
                ),
              ],
            },
            logs.length === 0
              ? h(Empty, null, '点「读日志」看最近 120 行')
              : h(
                  Code,
                  null,
                  logs.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n'),
                ),
          ),
          h(
            Card,
            { title: '插件自身配置（只读）' },
            h(Code, null, JSON.stringify(supervisor?.config ?? {}, null, 2)),
            h(
              'div',
              { className: 'wg-field-hint', style: { paddingTop: 6 } },
              '路径/端口/模式这类基础设施配置，要改请编辑 profile 的 cordis.patch.yml。',
            ),
          ),
        );
      }

      const body = {
        features: featuresTab,
        persona: personaTab,
        frequency: frequencyTab,
        platform: platformTab,
        voice: voiceTab,
        advanced: advancedTab,
      }[tab]();

      return h(
        Page,
        null,
        h(
          'div',
          { className: 'wg-hero' },
          h(
            'div',
            { className: 'wg-hero-top' },
            h(WhaleMark),
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { className: 'wg-hero-title' }, '鲸鱼娘'),
              h(
                'div',
                { className: 'wg-hero-sub' },
                `自建微信 / QQ 机器人的控制面 · 端口 ${supervisor?.config?.port ?? 8080}`,
              ),
            ),
            h(
              'div',
              { className: 'wg-hero-actions' },
              h(Button, { onClick: () => control('start'), busy: busy === 'start', kind: 'primary' }, '启动'),
              h(Button, { onClick: () => control('stop'), busy: busy === 'stop' }, '停止'),
              h(Button, { onClick: () => control('restart'), busy: busy === 'restart', kind: 'ghost' }, '重启'),
            ),
          ),
          h(
            'div',
            { className: 'wg-chips' },
            h(Chip, { tone: online ? 'ok' : 'error' }, online ? '本体在线' : '本体离线'),
            h(Chip, { tone: running ? 'ok' : '' }, running ? '运行中' : '已停止'),
            h(Chip, { tone: wechat === 'connected' ? 'ok' : 'warn' }, `微信：${wechat}`),
            h(Chip, null, `队列 ${queue}`),
            styleDoc?.active ? h(Chip, { tone: 'brand' }, `人设 ${styleDoc.active}`) : null,
          ),
        ),
        h(Tabs, { items: TABS, active: tab, onChange: setTab }),
        notice
          ? h(
              Banner,
              {
                tone: notice.tone,
                detail: notice.detail || '',
                action: notice.restart
                  ? h(
                      Button,
                      { onClick: () => control('restart'), busy: busy === 'restart', kind: 'primary', size: 'sm' },
                      '保存并重启',
                    )
                  : h(Button, { size: 'sm', kind: 'ghost', onClick: () => setNotice(null) }, '知道了'),
              },
              notice.text,
            )
          : null,
        schema ? body : h(Skeleton, { count: 3 }),
        dirtyCount > 0
          ? h(
              'div',
              { className: 'wg-savebar' },
              h('div', { className: 'wg-savebar-text' }, '有 ', h('strong', null, dirtyCount), ' 项改动未保存'),
              h(Button, { kind: 'ghost', onClick: () => setDraft({}) }, '放弃'),
              h(
                Button,
                { kind: 'primary', onClick: saveSettings, busy: busy === 'save' },
                `保存 ${dirtyCount} 项`,
              ),
            )
          : null,
      );
    }

    // ------------------------------------------------------------ 仪表盘
    function msgOf(item) {
      if (!item || typeof item !== 'object') return null;
      return {
        time: String(item.time ?? item.timestamp ?? item.created_at ?? ''),
        who: String(item.sender ?? item.from ?? item.who ?? item.nickname ?? ''),
        text: String(item.content ?? item.text ?? ''),
        room: String(item.room ?? item.group ?? item.chat ?? ''),
        platform: String(item.platform ?? 'wechat'),
      };
    }

    function logLine(item) {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return String(item);
      const time = item.time ?? item.timestamp ?? '';
      const level = item.level ?? '';
      const message = item.message ?? item.msg ?? JSON.stringify(item);
      return [time, level, message].filter(Boolean).join(' | ');
    }

    function DashboardPage() {
      const [status, setStatus] = useState(null);
      const [sup, setSup] = useState(null);
      const [caps, setCaps] = useState(null);
      const [messages, setMessages] = useState([]);
      const [logs, setLogs] = useState([]);
      const [busy, setBusy] = useState('');
      const [notice, setNotice] = useState(null);

      const loadCore = useCallback(async () => {
        try {
          const supervisor = await getJson('/local/supervisor');
          setSup(supervisor);
          try {
            setStatus(await getJson('/api/status'));
            try {
              setCaps(await getJson('/api/capabilities'));
            } catch {
              setCaps(null);
            }
          } catch {
            setStatus(null);
          }
        } catch {
          setSup(null);
        }
      }, []);

      const loadStreams = useCallback(async () => {
        try {
          const [msgData, logData] = await Promise.all([
            getJson('/api/messages?limit=25').catch(() => ({ messages: [] })),
            getJson('/api/logs?limit=60').catch(() => ({ logs: [] })),
          ]);
          setMessages(Array.isArray(msgData?.messages) ? msgData.messages : []);
          setLogs(Array.isArray(logData?.logs) ? logData.logs : []);
        } catch {
          /* 离线时保持上一帧 */
        }
      }, []);

      useEffect(() => {
        loadCore();
        loadStreams();
        const a = setInterval(loadCore, 4000);
        const b = setInterval(loadStreams, 7000);
        return () => {
          clearInterval(a);
          clearInterval(b);
        };
      }, [loadCore, loadStreams]);

      async function control(action) {
        setBusy(action);
        try {
          const result = await postJson(`/local/${action}`, action === 'restart' ? { force: false } : {});
          setNotice({ tone: result?.ok ? 'ok' : 'warn', text: result?.message ?? '' });
          await loadCore();
        } catch (e) {
          setNotice({ tone: 'error', text: `${action} 失败：${String(e?.message ?? e)}` });
        } finally {
          setBusy('');
        }
      }

      const online = Boolean(status);
      const running = Boolean(status?.running);
      const wechat = String(status?.wechat?.status ?? 'unknown');
      const tokens = status?.ai?.usage?.total_tokens ?? 0;
      const requests = status?.ai?.usage?.request_count ?? 0;
      const queue = status?.handler?.queue_size ?? 0;
      const pipeline = Boolean(status?.handler?.processing);
      const chips = [];
      if (caps) {
        chips.push(['语音', Boolean(caps.voice?.enabled && caps.voice?.available)]);
        chips.push(['真唱', Boolean(caps.song?.cover_available)]);
        chips.push(['ACE-Step', Boolean(caps.song?.acestep)]);
        chips.push(['算命', Boolean(caps.divination?.enabled)]);
        chips.push(['笑话', Boolean(caps.joke?.enabled)]);
        chips.push(['ASR', Boolean(caps.asr?.enabled)]);
      }

      return h(
        Page,
        null,
        h(
          'div',
          { className: 'wg-hero' },
          h(
            'div',
            { className: 'wg-hero-top' },
            h(WhaleMark),
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { className: 'wg-hero-title' }, '鲸鱼娘'),
              h('div', { className: 'wg-hero-sub' }, '总览 · 运行状态、消息流与日志'),
            ),
            h(
              'div',
              { className: 'wg-hero-actions' },
              h(Button, { onClick: () => control('start'), busy: busy === 'start', kind: 'primary' }, '启动'),
              h(Button, { onClick: () => control('stop'), busy: busy === 'stop' }, '停止'),
              h(Button, { onClick: () => control('restart'), busy: busy === 'restart', kind: 'ghost' }, '重启'),
            ),
          ),
          h(
            'div',
            { className: 'wg-chips' },
            h(Chip, { tone: online ? 'ok' : 'error' }, online ? '在线' : '离线'),
            h(Chip, { tone: running ? 'ok' : '' }, running ? '运行中' : '已停止'),
            h(Chip, { tone: wechat === 'connected' ? 'ok' : 'warn' }, `微信：${wechat}`),
            h(Chip, { tone: pipeline ? 'brand' : '' }, pipeline ? '管线在跑' : '管线已停'),
          ),
        ),
        notice
          ? h(
              Banner,
              {
                tone: notice.tone,
                action: h(
                  Button,
                  { size: 'sm', kind: 'ghost', onClick: () => setNotice(null) },
                  '知道了',
                ),
              },
              notice.text,
            )
          : null,
        h(
          'div',
          { className: 'wg-stats' },
          h(Stat, {
            label: '今日 token',
            value: Number(tokens).toLocaleString(),
            sub: `${requests} 次请求`,
          }),
          h(Stat, { label: '队列', value: queue, sub: pipeline ? '管线在跑' : '管线已停' }),
          h(Stat, {
            label: 'QQ',
            value: status?.qq_running ? '在线' : '停',
            tone: status?.qq_running ? 'var(--wg-ok)' : 'var(--wg-dim)',
          }),
          h(Stat, {
            label: '企微',
            value: status?.wecom_running ? '在线' : '未启用',
            tone: status?.wecom_running ? 'var(--wg-ok)' : 'var(--wg-dim)',
          }),
        ),
        chips.length
          ? h(
              Card,
              { title: '能力自检' },
              h(
                'div',
                { className: 'wg-chips', style: { marginTop: 10 } },
                chips.map(([label, on]) =>
                  h(Chip, { key: label, tone: on ? 'ok' : '' }, `${label}${on ? ' 可用' : ' 关'}`),
                ),
              ),
            )
          : null,
        h(
          Card,
          { title: '最近消息', right: `${messages.length} 条` },
          messages.length === 0
            ? h(Empty, null, online ? '最近没有消息' : '本体离线')
            : h(
                'div',
                { className: 'wg-list' },
                messages
                  .map(msgOf)
                  .filter(Boolean)
                  .slice()
                  .reverse()
                  .map((m, i) =>
                    h(
                      'div',
                      { key: i, className: 'wg-msg' },
                      h('span', { className: 'wg-msg-time' }, m.time),
                      h(
                        'span',
                        { className: 'wg-msg-who' },
                        `${m.room ? m.room + ' · ' : ''}${m.who || m.platform}`,
                      ),
                      h('span', { className: 'wg-msg-text' }, m.text),
                    ),
                  ),
              ),
        ),
        h(
          Card,
          {
            title: '日志尾',
            right: h(Button, { size: 'sm', kind: 'ghost', onClick: loadStreams }, '刷新'),
          },
          logs.length === 0
            ? h(Empty, null, '没有日志')
            : h(Code, null, logs.map(logLine).join('\n')),
        ),
        h(
          Card,
          { title: '进程托管' },
          h(
            Code,
            null,
            JSON.stringify(
              {
                attached: sup?.supervisor?.attached,
                mode: sup?.supervisor?.mode,
                lastAction: sup?.supervisor?.lastAction,
                lastError: sup?.supervisor?.lastError,
                port: sup?.supervisor?.port,
                botRoot: sup?.supervisor?.botRoot,
              },
              null,
              2,
            ),
          ),
          sup?.supervisor?.tail
            ? h('div', { style: { marginTop: 8 } }, h(Code, null, sup.supervisor.tail))
            : null,
        ),
      );
    }

    // ------------------------------------------------------------ 侧栏图标
    function WhaleIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 20;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M3.2 14.4c0-3.1 2.6-5.6 5.9-5.6 1.5 0 2.9.5 3.9 1.4 1.4-.6 2.4-2 2.4-3.6 0-.5-.1-1-.3-1.4l1.7-.9c.3.7.4 1.5.4 2.3 0 2-1 3.7-2.5 4.7.5 2.5-.4 5.4-2.7 6.8-1.1.6-2.4.9-3.6.6l-.9 2.3-1.6-.6.8-2.2c-2.3-1-3.5-2.9-3.5-4.8z',
          fill: 'currentColor',
        }),
        h('circle', { cx: 7.6, cy: 13.2, r: 0.9, fill: 'var(--dsw-alias-bg-base)' }),
      );
    }

    // ------------------------------------------------------------ 注册
    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = (() => {
          try {
            if (typeof ctx.get === 'function') {
              const fromGet = ctx.get('slots');
              if (fromGet) return fromGet;
            }
          } catch {
            /* ignore */
          }
          return ctx.slots;
        })();

        if (!slots) {
          try {
            console.warn('[whalegirl] 拿不到 slots 服务，界面不注册');
          } catch {
            /* ignore */
          }
          return;
        }

        try {
          slots.inject('settings.section', () =>
            slots.register(
              { name: 'settings.section', id: PANEL_ID, order: 60, label: '鲸鱼娘' },
              guarded(SettingsPage),
            ),
          );
        } catch (error) {
          try {
            console.error('[whalegirl] 注册设置页失败', error);
          } catch {
            /* ignore */
          }
        }

        const enablePanel = () =>
          fetch(`${API}/local/health`, { credentials: 'same-origin' })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
              if (!data?.config?.enablePanel) return;
              try {
                slots.inject('main', () =>
                  slots.register({ name: 'main', key: PANEL_ID }, guarded(DashboardPage)),
                );
                slots.inject('sidebar.panellist', () =>
                  slots.register(
                    { name: 'sidebar.panellist', id: PANEL_ID, order: 16, label: '鲸鱼娘' },
                    WhaleIcon,
                  ),
                );
              } catch (error) {
                try {
                  console.error('[whalegirl] 注册侧栏面板失败', error);
                } catch {
                  /* ignore */
                }
              }
            })
            .catch(() => {
              /* 宿主没起来就只保留设置页 */
            });

        try {
          const timer = setTimeout(enablePanel, 1500);
          if (typeof timer?.unref === 'function') timer.unref();
        } catch {
          /* ignore */
        }
      },
    };
  },
});
