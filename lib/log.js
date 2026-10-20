/**
 * 插件自己的日志。
 *
 * 为什么必须有：2026-10-20 第一次装进 DSH 时，宿主直接不可用、系统事件日志里
 * 一条记录都没有（Firefox 的 crashhelper 是噪音）。没有日志就只剩猜。
 *
 * 位置：`%USERPROFILE%\.dsh\whalegirl\plugin.log`（超过 2 MB 自动轮转一次）。
 * 铁律：**写日志本身永远不能抛**——它跑在主进程里，抛一次就可能带走整个 DSH。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.dsh', 'dsh-we-whalegirl');
const FILE = path.join(DIR, 'plugin.log');
const MAX_BYTES = 2 * 1024 * 1024;

let dirReady = false;

function ensureDir() {
  if (dirReady) return true;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    dirReady = true;
    return true;
  } catch {
    return false;
  }
}

function rotateIfNeeded() {
  try {
    const stat = fs.statSync(FILE);
    if (stat.size > MAX_BYTES) fs.renameSync(FILE, `${FILE}.1`);
  } catch {
    /* 文件不存在或没权限：忽略 */
  }
}

export function logPath() {
  return FILE;
}

export function createLog(scope = 'plugin') {
  return (message) => {
    const text = String(message ?? '');
    try {
      console.log(`[dsh-we-whalegirl:${scope}] ${text}`);
    } catch {
      /* ignore */
    }
    try {
      if (!ensureDir()) return;
      rotateIfNeeded();
      fs.appendFileSync(
        FILE,
        `${new Date().toISOString()} [${scope}] ${text}\n`,
        'utf8',
      );
    } catch {
      /* 日志失败也绝不能影响宿主 */
    }
  };
}

/** 记录一个异常对象（含栈）。 */
export function logError(log, where, error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  log(`ERROR ${where}: ${message}`);
}
