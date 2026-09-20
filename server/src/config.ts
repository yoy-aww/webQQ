import 'dotenv/config';

/**
 * 允许的跨域来源白名单。
 * - 本地开发：Vite(5173) 经 proxy 访问后端时是同源、无 Origin 头，直接放行；
 *   但也显式列出 localhost 以便前后端分端口直连调试。
 * - 生产部署时在 .env 里覆盖 CORS_ORIGINS，逗号分隔，如 https://webqq.example.com
 */
const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];
const corsEnv = process.env.CORS_ORIGINS?.trim();
const corsOrigins = corsEnv
  ? corsEnv.split(',').map((s) => s.trim()).filter(Boolean)
  : defaultOrigins;

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'webqq-dev-secret-change-me',
  dbPath: process.env.DB_PATH || './data/webqq.db',
  jwtExpiresIn: '7d',
  corsOrigins,
};

/** 判断某个 Origin 是否在白名单内 */
export function isAllowedOrigin(origin: string): boolean {
  return corsOrigins.includes(origin);
}
