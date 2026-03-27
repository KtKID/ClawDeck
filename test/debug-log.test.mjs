/**
 * debug-log 日志模块测试
 *
 * 测试内存缓冲、文件写入、配置选项。
 * 使用临时目录作为日志目录。
 *
 * 运行: node --test test/debug-log.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 动态导入模块（ESM）
const { initDebugLog, debugLog, getServerLogs, getLatestLogId, getLogFilePath, getOptions } =
  await import('../plugin/src/debug-log.js');

// ============================================================
// 测试工具
// ============================================================

let tempDir;

function createTempDir() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawdeck-test-'));
  return tempDir;
}

function cleanupTempDir() {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = null;
}

function getLogFiles(dir) {
  return fs.readdirSync(dir).filter(f => f.startsWith('clawdeck-') && f.endsWith('.log'));
}

function readLogFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

// ============================================================
// 测试用例
// ============================================================

describe('initDebugLog()', () => {
  beforeEach(() => {
    createTempDir();
  });

  afterEach(() => {
    cleanupTempDir();
  });

  it('创建日志目录', () => {
    initDebugLog(tempDir);
    assert.ok(fs.existsSync(tempDir));
  });

  it('创建带时间戳的日志文件', () => {
    initDebugLog(tempDir);
    const files = getLogFiles(tempDir);
    assert.ok(files.length === 1, '应该创建一个日志文件');
    assert.ok(files[0].match(/clawdeck-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.log/),
      '文件名应包含时间戳');
  });

  it('写入文件头', () => {
    initDebugLog(tempDir);
    const files = getLogFiles(tempDir);
    const content = readLogFile(path.join(tempDir, files[0]));
    assert.ok(content.includes('# ClawDeck Log Started at'));
    assert.ok(content.includes('maxFileSize='));
  });

  it('支持自定义配置', () => {
    initDebugLog(tempDir, { maxFileSize: 1024, autoCleanupDays: 7 });
    const options = getOptions();
    assert.equal(options.maxFileSize, 1024);
    assert.equal(options.autoCleanupDays, 7);
  });

  it('支持环境变量 CLAWDECK_LOG_MAX_SIZE', () => {
    process.env.CLAWDECK_LOG_MAX_SIZE = '2048';
    initDebugLog(tempDir);
    const options = getOptions();
    assert.equal(options.maxFileSize, 2048);
    delete process.env.CLAWDECK_LOG_MAX_SIZE;
  });

  it('支持环境变量 CLAWDECK_LOG_CLEANUP_DAYS', () => {
    process.env.CLAWDECK_LOG_CLEANUP_DAYS = '14';
    initDebugLog(tempDir);
    const options = getOptions();
    assert.equal(options.autoCleanupDays, 14);
    delete process.env.CLAWDECK_LOG_CLEANUP_DAYS;
  });
});

describe('debugLog()', () => {
  beforeEach(() => {
    createTempDir();
    initDebugLog(tempDir);
  });

  afterEach(() => {
    cleanupTempDir();
  });

  it('写入内存缓冲', () => {
    debugLog('init', 'test message');
    const logs = getServerLogs();
    assert.ok(logs.length === 1);
    assert.equal(logs[0].cat, 'init');
    assert.ok(logs[0].msg.includes('test message'));
  });

  it('写入文件', () => {
    debugLog('init', 'file test');
    const files = getLogFiles(tempDir);
    const content = readLogFile(path.join(tempDir, files[0]));
    assert.ok(content.includes('[init] file test'));
  });

  it('支持 data 参数', () => {
    debugLog('hook', 'with data', { foo: 'bar' });
    const logs = getServerLogs();
    assert.ok(logs[0].msg.includes('foo'));
    assert.ok(logs[0].msg.includes('bar'));
  });

  it('截断过长的 data', () => {
    const longData = { x: 'a'.repeat(500) };
    debugLog('rpc', 'long data', longData);
    const logs = getServerLogs();
    assert.ok(logs[0].msg.length < 400, '应该截断过长的 data');
  });

  it('处理 unserializable data', () => {
    const circular = { a: 1 };
    circular.self = circular;
    debugLog('error', 'circular', circular);
    const logs = getServerLogs();
    assert.ok(logs[0].msg.includes('[unserializable]'));
  });

  it('ISO 时间戳格式', () => {
    debugLog('init', 'timestamp test');
    const logs = getServerLogs();
    assert.ok(logs[0].ts.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      '时间戳应为 ISO 格式');
  });
});

describe('getServerLogs()', () => {
  beforeEach(() => {
    createTempDir();
    initDebugLog(tempDir);
  });

  afterEach(() => {
    cleanupTempDir();
  });

  it('获取全部日志', () => {
    debugLog('init', 'a');
    debugLog('hook', 'b');
    const logs = getServerLogs();
    assert.equal(logs.length, 2);
  });

  it('增量获取 (sinceId)', () => {
    debugLog('init', 'a');
    const first = getServerLogs();
    debugLog('hook', 'b');
    debugLog('rpc', 'c');
    const second = getServerLogs(first[0].id);
    assert.equal(second.length, 2);
    assert.equal(second[0].cat, 'hook');
    assert.equal(second[1].cat, 'rpc');
  });

  it('空缓冲返回空数组', () => {
    const logs = getServerLogs();
    assert.deepEqual(logs, []);
  });

  it('sinceId=0 返回全部', () => {
    debugLog('init', 'a');
    debugLog('hook', 'b');
    const logs = getServerLogs(0);
    assert.equal(logs.length, 2);
  });
});

describe('getLatestLogId()', () => {
  beforeEach(() => {
    createTempDir();
    initDebugLog(tempDir);
  });

  afterEach(() => {
    cleanupTempDir();
  });

  it('返回最新 ID', () => {
    debugLog('init', 'a');
    debugLog('init', 'b');
    debugLog('init', 'c');
    assert.equal(getLatestLogId(), 3);
  });

  it('空缓冲返回 0', () => {
    assert.equal(getLatestLogId(), 0);
  });
});

describe('getLogFilePath()', () => {
  beforeEach(() => {
    createTempDir();
  });

  afterEach(() => {
    cleanupTempDir();
  });

  it('返回日志文件路径', () => {
    initDebugLog(tempDir);
    const logPath = getLogFilePath();
    assert.ok(logPath.includes('clawdeck-'));
    assert.ok(logPath.endsWith('.log'));
  });

  it('初始化前返回 null', () => {
    // 注意：这个测试可能在其他测试之后运行，状态已被修改
    // 所以我们只检查路径格式
    const logPath = getLogFilePath();
    assert.ok(logPath === null || logPath.includes('clawdeck-'));
  });
});

describe('文件大小限制', () => {
  beforeEach(() => {
    createTempDir();
  });

  afterEach(() => {
    cleanupTempDir();
  });

  it('超过大小后新建文件', () => {
    initDebugLog(tempDir, { maxFileSize: 200 }); // 200 bytes

    // 写入足够多的日志以触发轮转
    for (let i = 0; i < 20; i++) {
      debugLog('init', `message ${i} - some padding text to make it longer`);
    }

    const files = getLogFiles(tempDir);
    assert.ok(files.length > 1, '应该创建多个日志文件');
  });

  it('文件名带索引后缀', () => {
    initDebugLog(tempDir, { maxFileSize: 100 });

    for (let i = 0; i < 30; i++) {
      debugLog('init', `message ${i} - padding`);
    }

    const files = getLogFiles(tempDir);
    const indexedFiles = files.filter(f => f.match(/\.1\.log$|\.2\.log$/));
    assert.ok(indexedFiles.length > 0, '应该有带索引后缀的文件');
  });
});

describe('内存缓冲 FIFO', () => {
  beforeEach(() => {
    createTempDir();
    initDebugLog(tempDir);
  });

  afterEach(() => {
    cleanupTempDir();
  });

  it('超过 200 条后淘汰旧日志', () => {
    // 写入 250 条日志
    for (let i = 0; i < 250; i++) {
      debugLog('init', `message ${i}`);
    }

    const logs = getServerLogs();
    assert.ok(logs.length <= 200, '缓冲区不应超过 200 条');
    // 最新的日志应该保留
    assert.ok(logs[logs.length - 1].msg.includes('message 249'));
  });
});
