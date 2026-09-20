import { io, type Socket } from 'socket.io-client';
import type { Message } from '../types';

let socket: Socket | null = null;

/** 服务端推送的统一消息形状（senderId/receiverId/groupId 可能为 null） */
export type ServerMessage = Message;

export type SocketEventHandler = (msg: ServerMessage) => void;
const dmListeners = new Set<SocketEventHandler>();
const groupListeners = new Set<SocketEventHandler>();

export function onDm(handler: SocketEventHandler): () => void {
  dmListeners.add(handler);
  return () => dmListeners.delete(handler);
}

export function onGroup(handler: SocketEventHandler): () => void {
  groupListeners.add(handler);
  return () => groupListeners.delete(handler);
}

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(token: string): Socket {
  socket?.disconnect();
  const s = io('/', { auth: { token }, transports: ['websocket'] });
  socket = s;

  s.on('connect_error', (e) => {
    console.error('[socket] connect_error', e.message);
    if (e.message === 'unauthorized') {
      localStorage.removeItem('webqq_token');
      localStorage.removeItem('webqq_user');
      if (location.pathname !== '/login') location.href = '/login';
    }
  });

  // 连接状态变化 → 通知 UI 显示断线/重连提示
  const wasConnected = { v: false };
  s.on('connect', () => {
    wasConnected.v = true;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('webqq:socket-status', { detail: { connected: true } }));
    }
  });
  s.on('disconnect', () => {
    if (wasConnected.v) {
      wasConnected.v = false;
      window.dispatchEvent(new CustomEvent('webqq:socket-status', { detail: { connected: false } }));
    }
  });

  s.on('dm:new', (msg: ServerMessage) => {
    dmListeners.forEach((h) => h(msg));
  });
  s.on('group:new', (msg: ServerMessage) => {
    groupListeners.forEach((h) => h(msg));
  });
  s.on('friend:status', (p: { friendId: number; online: boolean }) => {
    window.dispatchEvent(new CustomEvent('webqq:friend-status', { detail: p }));
  });
  s.on('friend:request', (p: unknown) => {
    window.dispatchEvent(new CustomEvent('webqq:friend-request', { detail: p }));
  });

  return s;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** 发送单聊消息，返回 ack 结果 */
export function sendDm(
  to: number,
  content: string,
  type: 'text' | 'image' = 'text'
): Promise<{ ok: boolean; message?: ServerMessage; error?: string }> {
  return new Promise((resolve) => {
    if (!socket) return resolve({ ok: false, error: '未连接服务器' });
    const timer = setTimeout(() => resolve({ ok: false, error: '发送超时，请重试' }), 5000);
    socket.emit('dm:send', { to, content, type }, (r: { ok: boolean; message?: ServerMessage; error?: string }) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

export function sendGroup(
  groupId: number,
  content: string,
  type: 'text' | 'image' = 'text'
): Promise<{ ok: boolean; message?: ServerMessage; error?: string }> {
  return new Promise((resolve) => {
    if (!socket) return resolve({ ok: false, error: '未连接服务器' });
    const timer = setTimeout(() => resolve({ ok: false, error: '发送超时，请重试' }), 5000);
    socket.emit('group:send', { groupId, content, type }, (r: { ok: boolean; message?: ServerMessage; error?: string }) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/** 加入/离开群 room（切会话时调用） */
export function joinGroupRoom(groupId: number): void {
  socket?.emit('group:join', groupId);
}

export function leaveGroupRoom(groupId: number): void {
  socket?.emit('group:leave', groupId);
}
