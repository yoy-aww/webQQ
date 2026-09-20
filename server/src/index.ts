import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import friendRoutes from './routes/friends.js';
import groupRoutes from './routes/groups.js';
import messageRoutes from './routes/messages.js';
import { setupSocket } from './socket.js';
import { ensureUploadDir } from './services/upload.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 上传文件的静态访问
  const uploadDir = ensureUploadDir();
  app.use('/uploads', express.static(uploadDir));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'webqq-server', time: Date.now() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/friends', friendRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/messages', messageRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[unhandled]', err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: { origin: '*', credentials: true },
  });
  setupSocket(io);

  return { app, server, io };
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err);
    // 不让一个错误炸掉整个服务；记录后继续运行
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection:', reason);
  });
  const { server } = createApp();
  server.listen(config.port, () => {
    console.log(`[WebQQ] server listening on http://localhost:${config.port}`);
  });
}

export default createApp;
