import { getDb } from '../db.js';

export type MessageType = 'text' | 'image' | 'system';

export interface MessageRecord {
  id: number;
  sender_id: number;
  receiver_id: number | null;
  group_id: number | null;
  type: MessageType;
  content: string;
  created_at: number;
}

export interface MessageOut {
  id: number;
  senderId: number;
  receiverId: number | null;
  groupId: number | null;
  type: MessageType;
  content: string;
  createdAt: number;
}

export function saveMessage(input: {
  senderId: number;
  receiverId?: number;
  groupId?: number;
  type: MessageType;
  content: string;
}): MessageRecord {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO messages (sender_id, receiver_id, group_id, type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.senderId,
      input.receiverId ?? null,
      input.groupId ?? null,
      input.type,
      input.content,
      Date.now()
    );
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(info.lastInsertRowid) as MessageRecord;
  return row;
}

export function toMessageOut(m: MessageRecord): MessageOut {
  return {
    id: m.id,
    senderId: m.sender_id,
    receiverId: m.receiver_id,
    groupId: m.group_id,
    type: m.type,
    content: m.content,
    createdAt: m.created_at,
  };
}

/** 单聊历史：两人之间、before 之前的 limit 条，倒序 */
export function fetchDmHistory(a: number, b: number, before?: number, limit = 50): MessageOut[] {
  const db = getDb();
  const sql = before
    ? `SELECT * FROM messages
        WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
          AND id < ?
        ORDER BY id DESC LIMIT ?`
    : `SELECT * FROM messages
        WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        ORDER BY id DESC LIMIT ?`;
  const rows = (
    before
      ? db.prepare(sql).all(a, b, b, a, before, limit)
      : db.prepare(sql).all(a, b, b, a, limit)
  ) as MessageRecord[];
  return rows.map(toMessageOut).reverse();
}

export function fetchGroupHistory(groupId: number, before?: number, limit = 50): MessageOut[] {
  const db = getDb();
  const sql = before
    ? 'SELECT * FROM messages WHERE group_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
    : 'SELECT * FROM messages WHERE group_id = ? ORDER BY id DESC LIMIT ?';
  const rows = (
    before
      ? db.prepare(sql).all(groupId, before, limit)
      : db.prepare(sql).all(groupId, limit)
  ) as MessageRecord[];
  return rows.map(toMessageOut).reverse();
}
