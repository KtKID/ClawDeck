/**
 * Storage 模块测试
 *
 * 6 个场景：get/set/remove 基本读写、字符串/对象序列化、
 * migrate 旧键迁移、不覆盖已存在新键、Node.js 无 localStorage fallback。
 *
 * 运行: node --test test/storage.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// Mock localStorage
// ============================================================

const mockStore = new Map();
const mockLocalStorage = {
  getItem: (k) => mockStore.get(k) ?? null,
  setItem: (k, v) => mockStore.set(k, String(v)),
  removeItem: (k) => mockStore.delete(k),
  clear: () => mockStore.clear(),
  get length() { return mockStore.size; },
  key: () => null,
};

// ============================================================
// Tests
// ============================================================

describe('Storage 模块', () => {
  let Storage;

  beforeEach(async () => {
    mockStore.clear();
    // 注入 mock localStorage
    globalThis.localStorage = mockLocalStorage;
    // 动态导入以确保使用 mock 环境
    const mod = await import(`../bridge/storage.js?t=${Date.now()}`);
    Storage = mod.Storage;
  });

  // --- #1 get/set/remove 基本读写 ---
  it('get/set/remove 基本读写', () => {
    Storage.set('url', 'ws://localhost:18789');
    assert.equal(Storage.get('url'), 'ws://localhost:18789');

    Storage.remove('url');
    assert.equal(Storage.get('url'), null);
  });

  // --- #2 set string → get 返回 string ---
  it('set string → get 返回 string（不 JSON.parse）', () => {
    Storage.set('token', 'my-secret-token');
    assert.equal(Storage.get('token'), 'my-secret-token');
    assert.equal(typeof Storage.get('token'), 'string');
  });

  // --- #3 set object → get 返回 parsed object ---
  it('set object → get 返回 parsed object', () => {
    const obj = { host: 'localhost', port: 18789 };
    Storage.set('url', JSON.stringify(obj));
    const result = Storage.get('url');
    assert.deepStrictEqual(result, obj);
  });

  // --- #4 migrate() 旧键迁移到新前缀 ---
  it('migrate() 旧键迁移到新前缀', async () => {
    // 设置旧键（无 clawdeck. 前缀的旧格式）
    mockStore.set('clawdeck.gateway.url', 'ws://old-host:9999');
    mockStore.set('clawdeck.gateway.token', 'old-token');

    // 重新导入触发 constructor → migrate()
    const mod = await import(`../bridge/storage.js?t=${Date.now()}-migrate`);
    const S = mod.Storage;

    // 新键应该有值
    assert.equal(S.get('url'), 'ws://old-host:9999');
    assert.equal(S.get('token'), 'old-token');

    // 旧键应该被删除
    assert.equal(mockStore.has('clawdeck.gateway.url'), false);
    assert.equal(mockStore.has('clawdeck.gateway.token'), false);
  });

  // --- #5 migrate() 不覆盖已存在的新键 ---
  it('migrate() 不覆盖已存在的新键', async () => {
    // 新键已有值
    mockStore.set('clawdeck.url', 'ws://new-host:8888');
    // 旧键也有值
    mockStore.set('clawdeck.gateway.url', 'ws://old-host:9999');

    const mod = await import(`../bridge/storage.js?t=${Date.now()}-no-overwrite`);
    const S = mod.Storage;

    // 新键保持不变
    assert.equal(S.get('url'), 'ws://new-host:8888');
    // 旧键因为新键已存在而不迁移，保留原值
    assert.equal(mockStore.get('clawdeck.gateway.url'), 'ws://old-host:9999');
  });

  // --- #6 Node.js 环境无 localStorage → no-op fallback ---
  it('无 localStorage 时 fallback 不报错', async () => {
    // 保存原始 localStorage 并删除
    const orig = globalThis.localStorage;
    delete globalThis.localStorage;

    const mod = await import(`../bridge/storage.js?t=${Date.now()}-nols`);
    const S = mod.Storage;

    // 操作不报错
    assert.equal(S.get('url'), null);
    S.set('url', 'test');
    assert.equal(S.get('url'), null); // no-op fallback
    S.remove('url'); // no-op

    // 恢复
    globalThis.localStorage = orig;
  });
});
