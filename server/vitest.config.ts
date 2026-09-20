import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * server 源码统一用 `.js` 扩展名导入 TS 文件 (ESM 风格, 与 tsx 运行一致),
 * vitest 需要这个 resolve 才能把 `./config.js` 解析到 `./config.ts`。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
