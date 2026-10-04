/**
 * Vitest 测试环境 setup：
 * jsdom 的 localStorage 是不可配置属性，Object.defineProperty 无法覆盖。
 * 使用 vi.stubGlobal 注入基于内存的 localStorage mock。
 * 同时满足 store.ts 在模块加载时读取、以及 setAuth/updateMe 写入后的断言需求。
 */
import { vi } from 'vitest';

const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string): string | null => storage.get(key) ?? null,
  setItem: (key: string, value: string): void => { storage.set(key, value); },
  removeItem: (key: string): void => { storage.delete(key); },
  clear: (): void => { storage.clear(); },
  key: (index: number): string | null => Array.from(storage.keys())[index] ?? null,
  get length(): number { return storage.size; },
});
