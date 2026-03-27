import type { StorageSchema } from './types.js';

const PREFIX = 'clawdeck.';

/** 旧键 → 新键 迁移映射 */
const MIGRATIONS: [string, keyof StorageSchema][] = [
  ['clawdeck.gateway.url', 'url'],
  ['clawdeck.gateway.token', 'token'],
];

/** Node.js 环境下 localStorage 不可用，提供 no-op fallback */
const store: Storage = typeof localStorage !== 'undefined' && typeof localStorage?.getItem === 'function'
  ? localStorage
  : { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, clear: () => {}, key: () => null } as any;

class ClawDeckStorage {
  constructor() {
    this.migrate();
  }

  get<K extends keyof StorageSchema>(key: K): StorageSchema[K] | null {
    const raw = store.getItem(PREFIX + key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return raw as any; }
  }

  set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): void {
    store.setItem(PREFIX + key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  remove(key: keyof StorageSchema): void {
    store.removeItem(PREFIX + key);
  }

  /** 迁移旧键到新前缀，迁移后删除旧键 */
  migrate(): void {
    for (const [oldKey, newKey] of MIGRATIONS) {
      const value = store.getItem(oldKey);
      if (value !== null && store.getItem(PREFIX + newKey) === null) {
        store.setItem(PREFIX + newKey, value);
        store.removeItem(oldKey);
      }
    }
  }
}

export const Storage = new ClawDeckStorage();
