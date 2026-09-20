import type { Server, Socket } from 'socket.io';
import { verifyToken } from './utils/jwt.js';
import { getDb } from './db.js';
import { saveMessage } from './services/messages.js';

export interface OnlineSocket extends Socket {
  userId?: number;
}

/** userId -> 该用户所有在线 socket id 集合 */
export const onlineSockets = new Map<number, Set<string>>();

export function isOnline(userId: number): boolean {
  return onlineSockets.has(userId);
}

function trackSocket(userId: number, socketId: string): void {
  let set = onlineSockets.get(userId);
  if (!set) {
    set = new Set();
    onlineSockets.set(userId, set);
  }
  set.add(socketId);
}

function untrackSocket(userId: number, socketId: string): void {
  const set = onlineSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) onlineSockets.delete(userId);
}

export function getFriendIds(userId: number): number[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS other
         FROM friendships
        WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'`
    )
    .all(userId, userId, userId) as { other: number }[];
  return rows.map((r) => r.other);
}

export function getGroupIds(userId: number): number[] {
  const db = getDb();
  const rows = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(
    userId
  ) as { group_id: number }[];
  return rows.map((r) => r.group_id);
}

export function setupSocket(io: Server): void {
  io.use((socket: OnlineSocket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.query?.token as string | undefined);
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const payload = verifyToken(token);
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: OnlineSocket) => {
    const userId = socket.userId!;
    trackSocket(userId, socket.id);

    // 加入用户自己的 room
    socket.join(`user:${userId}`);
    // 加入所在群的 room
    for (const gid of getGroupIds(userId)) socket.join(`group:${gid}`);

    // 通知好友：上线
    for (const fid of getFriendIds(userId)) {
      io.to(`user:${fid}`).emit('friend:status', { friendId: userId, online: true });
    }

    socket.on('dm:send', (payload: { to: number; type: 'text' | 'image'; content: string }, ack?: (r: { ok: boolean; message?: unknown; error?: string }) => void) => {
      try {
        if (typeof payload?.to !== 'number' || !payload?.content) {
          ack?.({ ok: false, error: '参数错误' });
          return;
        }
        const msg = saveMessage({
          senderId: userId,
          receiverId: payload.to,
          type: payload.type === 'image' ? 'image' : 'text',
          content: payload.content,
        });
        const out = { id: msg.id, senderId: msg.sender_id, receiverId: msg.receiver_id, type: msg.type, content: msg.content, createdAt: msg.created_at };
        // 回显给发送方（多标签页同步）
        io.to(`user:${userId}`).emit('dm:new', out);
        // 推送给接收方
        io.to(`user:${payload.to}`).emit('dm:new', out);
        ack?.({ ok: true, message: out });
      } catch (e) {
        ack?.({ ok: false, error: (e as Error).message || '发送失败' });
      }
    });

    socket.on('group:send', (payload: { groupId: number; type: 'text' | 'image'; content: string }, ack?: (r: { ok: boolean; message?: unknown; error?: string }) => void) => {
      try {
        if (typeof payload?.groupId !== 'number' || !payload?.content) {
          ack?.({ ok: false, error: '参数错误' });
          return;
        }
        const db = getDb();
        const isMember = db
          .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
          .get(payload.groupId, userId);
        if (!isMember) {
          ack?.({ ok: false, error: '不是该群成员' });
          return;
        }
        const msg = saveMessage({
          senderId: userId,
          groupId: payload.groupId,
          type: payload.type === 'image' ? 'image' : 'text',
          content: payload.content,
        });
        const out = { id: msg.id, senderId: msg.sender_id, groupId: msg.group_id, type: msg.type, content: msg.content, createdAt: msg.created_at };
        io.to(`group:${payload.groupId}`).emit('group:new', out);
        ack?.({ ok: true, message: out });
      } catch (e) {
        ack?.({ ok: false, error: (e as Error).message || '发送失败' });
      }
    });

    socket.on('group:join', (groupId: number) => {
      socket.join(`group:${groupId}`);
    });

    socket.on('group:leave', (groupId: number) => {
      socket.leave(`group:${groupId}`);
    });

    socket.on('disconnect', () => {
      untrackSocket(userId, socket.id);
      for (const fid of getFriendIds(userId)) {
        io.to(`user:${fid}`).emit('friend:status', { friendId: userId, online: false });
      }
    });
  });
}
