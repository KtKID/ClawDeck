// plugin/src/debug-log.ts — 调试日志（内存环形缓冲 + 文件持久化）
// 支持配置：文件大小限制、自动清理、环境变量

import fs from "node:fs";
import path from "node:path";

// ============================================================
// 类型定义
// ============================================================

export interface LogEntry {
  id: number;
  ts: string; // ISO 时间戳
  cat: string; // 分类: init, hook, rpc, error
  msg: string;
}

export interface DebugLogOptions {
  maxFileSize?: number; // 最大文件大小（字节），默认 5MB
  autoCleanupDays?: number; // 自动清理天数，0=不清理
}

// ============================================================
// 常量
// ============================================================

const MAX_ENTRIES = 200;
const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_CLEANUP_DAYS = 0;

// ============================================================
// 模块状态
// ============================================================

const buffer: LogEntry[] = [];
let nextId = 1;
let logFilePath: string | null = null;
let logDirPath: string | null = null;
let fileIndex = 0;
let options: Required<DebugLogOptions> = {
  maxFileSize: DEFAULT_MAX_FILE_SIZE,
  autoCleanupDays: DEFAULT_CLEANUP_DAYS,
};

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化日志模块（插件启动时调用）
 * @param logDir - 日志目录路径
 * @param opts - 配置选项
 */
export function initDebugLog(logDir: string, opts: DebugLogOptions = {}): void {
  // 合并配置（环境变量优先）
  // 使用 !== undefined 检查以兼容旧版 Node.js（不支持 ?? 操作符）
  const envMaxSize = parseInt(process.env.CLAWDECK_LOG_MAX_SIZE || "");
  const envCleanupDays = parseInt(process.env.CLAWDECK_LOG_CLEANUP_DAYS || "");

  options = {
    maxFileSize:
      opts.maxFileSize !== undefined
        ? opts.maxFileSize
        : envMaxSize || DEFAULT_MAX_FILE_SIZE,
    autoCleanupDays:
      opts.autoCleanupDays !== undefined
        ? opts.autoCleanupDays
        : envCleanupDays || DEFAULT_CLEANUP_DAYS,
  };

  // 创建日志目录
  fs.mkdirSync(logDir, { recursive: true });
  logDirPath = logDir;

  // 生成带时间戳的文件名
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  logFilePath = path.join(logDir, `clawdeck-${ts}.log`);
  fileIndex = 0;

  // 写入文件头
  const header = `# ClawDeck Log Started at ${new Date().toISOString()}\n# Options: maxFileSize=${options.maxFileSize}, autoCleanupDays=${options.autoCleanupDays}\n\n`;
  fs.writeFileSync(logFilePath, header, "utf-8");

  // 清理旧日志（如果配置了）
  if (options.autoCleanupDays > 0) {
    cleanupOldLogs(logDir, options.autoCleanupDays);
  }
}

// ============================================================
// 日志记录
// ============================================================

/**
 * 记录日志（内存 + 文件）
 * @param category - 分类: init, hook, rpc, error
 * @param message - 日志消息
 * @param data - 可选的附加数据
 */
export function debugLog(
  category: string,
  message: string,
  data?: unknown,
): void {
  const ts = new Date().toISOString();
  let msg = message;

  if (data !== undefined) {
    try {
      const s = JSON.stringify(data);
      // 截断过长的 data
      msg += " " + (s.length > 300 ? s.slice(0, 300) + "..." : s);
    } catch {
      msg += " [unserializable]";
    }
  }

  const entry: LogEntry = { id: nextId++, ts, cat: category, msg };
  buffer.push(entry);

  // FIFO 淘汰
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }

  // 实时写入文件
  writeToFile(ts, category, msg);
}

/**
 * 写入日志到文件（带大小检查）
 */
function writeToFile(ts: string, category: string, msg: string): void {
  if (!logFilePath || !logDirPath) return;

  try {
    // 检查文件大小
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      if (stats.size >= options.maxFileSize) {
        // 超过大小限制，新建文件
        fileIndex++;
        const baseName = path.basename(logFilePath, ".log");
        logFilePath = path.join(logDirPath, `${baseName}.${fileIndex}.log`);
      }
    }

    const line = `[${ts}] [${category}] ${msg}\n`;
    fs.appendFileSync(logFilePath, line, "utf-8");
  } catch (err) {
    // 文件写入失败不应影响主流程
    console.error("[debug-log] File write error:", err);
  }
}

/**
 * 清理旧日志文件
 */
function cleanupOldLogs(logDir: string, days: number): void {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const files = fs.readdirSync(logDir);
    for (const file of files) {
      if (!file.startsWith("clawdeck-") || !file.endsWith(".log")) continue;

      const filePath = path.join(logDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          console.log(`[debug-log] Cleaned up old log: ${file}`);
        }
      } catch {
        // 忽略单个文件错误
      }
    }
  } catch {
    // 忽略目录读取错误
  }
}

// ============================================================
// 查询接口
// ============================================================

/**
 * 获取增量日志（供 Gateway Method 调用）
 * @param sinceId - 获取此 ID 之后的日志
 */
export function getServerLogs(sinceId = 0): LogEntry[] {
  if (sinceId <= 0) return buffer.slice();
  return buffer.filter((e) => e.id > sinceId);
}

/** 获取当前最大 id */
export function getLatestLogId(): number {
  return buffer.length > 0 ? buffer[buffer.length - 1].id : 0;
}

/** 获取日志文件路径 */
export function getLogFilePath(): string | null {
  return logFilePath;
}

/** 获取当前配置 */
export function getOptions(): Required<DebugLogOptions> {
  return { ...options };
}
