// bridge/mock-logger.js — Mock 模式日志模块
// 用于本地开发时写入日志文件，与真实插件日志系统保持接口兼容

import * as fs from 'fs';
import * as path from 'path';

let _logDir = null;
let _logFile = null;
let _logId = 0;
let _maxSize = 5 * 1024 * 1024; // 默认 5MB

/**
 * 初始化 Mock 日志模块
 * @param {string} [logDir='logs/mock'] - 日志目录
 * @param {object} [options={}] - 配置选项
 * @param {number} [options.maxSize=5*1024*1024] - 单文件最大字节数
 */
export function initMockLog(logDir = 'logs/mock', options = {}) {
  _logDir = path.resolve(process.cwd(), logDir);
  _maxSize = options.maxSize || _maxSize;

  // 确保目录存在
  if (!fs.existsSync(_logDir)) {
    fs.mkdirSync(_logDir, { recursive: true });
  }

  // 生成日志文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _logFile = path.join(_logDir, `clawdeck-${timestamp}.log`);

  // 如果文件不存在，写入 BOM + 空对象
  if (!fs.existsSync(_logFile)) {
    fs.writeFileSync(_logFile, JSON.stringify({ entries: [], nextId: 1 }), 'utf-8');
  } else {
    // 读取现有文件获取最新的 ID
    try {
      const content = fs.readFileSync(_logFile, 'utf-8');
      const data = JSON.parse(content);
      _logId = data.nextId || 0;
    } catch {
      _logId = 0;
    }
  }

  console.log(`[MockLog] Initialized: ${_logFile}`);
}

/**
 * 写入日志
 * @param {string} cat - 分类: init, hook, rpc, error
 * @param {string} msg - 日志消息
 * @returns {LogEntry} 创建的日志条目
 */
export function mockLog(cat, msg) {
  if (!_logFile) {
    initMockLog();
  }

  const entry = {
    id: ++_logId,
    ts: new Date().toISOString(),
    cat,
    msg,
  };

  // 读取现有数据
  let data = { entries: [], nextId: _logId };
  try {
    const content = fs.readFileSync(_logFile, 'utf-8');
    data = JSON.parse(content);
  } catch {
    // 文件损坏，重新初始化
    data = { entries: [], nextId: _logId };
  }

  // 追加新条目
  data.entries.push(entry);
  data.nextId = _logId;

  // 检查文件大小，必要时轮转
  const content = JSON.stringify(data);
  if (content.length > _maxSize) {
    _rotateLog();
  }

  // 写入文件
  fs.writeFileSync(_logFile, JSON.stringify(data), 'utf-8');

  return entry;
}

/**
 * 轮转日志文件
 */
function _rotateLog() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const newFile = path.join(_logDir, `clawdeck-${timestamp}.log`);
  _logFile = newFile;
  _logId = 0;
  console.log(`[MockLog] Rotated to: ${_logFile}`);
}

/**
 * 获取增量日志
 * @param {number} [sinceId=0] - 从指定 ID 之后获取
 * @returns {{entries: LogEntry[], latestId: number, count: number}}
 */
export function getMockLogs(sinceId = 0) {
  if (!_logFile || !fs.existsSync(_logFile)) {
    return { entries: [], latestId: _logId, count: 0 };
  }

  try {
    const content = fs.readFileSync(_logFile, 'utf-8');
    const data = JSON.parse(content);

    // 过滤出增量日志
    const entries = data.entries.filter(e => e.id > sinceId);
    const latestId = data.nextId || 0;

    return {
      entries,
      latestId,
      count: entries.length,
    };
  } catch {
    return { entries: [], latestId: _logId, count: 0 };
  }
}

/**
 * 获取最新日志 ID
 * @returns {number}
 */
export function getLatestMockLogId() {
  return _logId;
}

/**
 * 获取日志文件路径（调试用）
 * @returns {string|null}
 */
export function getMockLogPath() {
  return _logFile;
}
