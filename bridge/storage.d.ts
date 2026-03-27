import type { StorageSchema } from './types.js';
declare class ClawDeckStorage {
    constructor();
    get<K extends keyof StorageSchema>(key: K): StorageSchema[K] | null;
    set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): void;
    remove(key: keyof StorageSchema): void;
    /** 迁移旧键到新前缀，迁移后删除旧键 */
    migrate(): void;
}
export declare const Storage: ClawDeckStorage;
export {};
