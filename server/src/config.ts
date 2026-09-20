import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'webqq-dev-secret-change-me',
  dbPath: process.env.DB_PATH || './data/webqq.db',
  jwtExpiresIn: '7d',
};
