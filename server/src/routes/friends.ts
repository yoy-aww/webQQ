import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isOnline } from '../socket.js';

const router = Router();
router.use(requireAuth);

const friendSchema = z.object({ qqNumber: z.string().min(1) });

/** 规范化关系行：user_id 恒小于 friend_id，保证一对好友只存一行 */
function pairKey(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

/** 返回行中的"对方" id（相对 me 而言） */
function otherId(me: number, row: { user_id: number; friend_id: number }): number {
  return row.user_id === me ? row.friend_id : row.user_id;
}

// 好友列表：我参与的所有关系（含我发出的 pending 与发我的 pending）
router.get('/', (req: AuthedRequest, res) => {
  const db = getDb();
  const me = req.userId!;
  const rows = db
    .prepare(
      `SELECT f.id, f.user_id, f.friend_id, f.status, f.remark, f.created_at AS request_at,
              u.qq_number, u.nickname, u.avatar, u.signature
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
        WHERE f.user_id = ? OR f.friend_id = ?
        ORDER BY (f.status = 'accepted') DESC, f.created_at DESC`
    )
    .all(me, me, me) as Record<string, unknown>[];

  const items = rows.map((r) => {
    const uid = otherId(me, r as { user_id: number; friend_id: number });
    return {
      id: r.id,
      status: r.status,
      remark: r.remark,
      requestAt: r.request_at,
      friendId: uid,
      friend: {
        id: uid,
        qqNumber: r.qq_number,
        nickname: r.nickname,
        avatar: r.avatar,
        signature: r.signature,
        online: isOnline(uid),
      },
    };
  });
  res.json({ friends: items });
});

// 用户搜索 + 当前关系状态
router.get('/search', (req: AuthedRequest, res) => {
  const q = String(req.query.qq || '').trim();
  if (!q) return res.json({ user: null, relation: null });
  const db = getDb();
  const like = q.length >= 6 && /^\d+$/.test(q) ? `${q}%` : `%${q}%`;
  const u = db
    .prepare(
      `SELECT * FROM users WHERE (qq_number LIKE ? OR nickname LIKE ?) AND id != ? LIMIT 1`
    )
    .get(like, like, req.userId!) as Record<string, unknown> | undefined;
  if (!u) return res.json({ user: null, relation: null });

  const row = db
    .prepare('SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?')
    .get(...pairKey(req.userId!, u.id as number)) as { status: string } | undefined;
  res.json({
    user: {
      id: u.id,
      qqNumber: u.qq_number,
      nickname: u.nickname,
      avatar: u.avatar,
      signature: u.signature,
      online: isOnline(u.id as number),
    },
    relation: row?.status || null,
  });
});

// 发送好友申请
router.post('/request', (req: AuthedRequest, res) => {
  const parsed = friendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '参数错误' });
  const db = getDb();

  const target = db
    .prepare('SELECT id FROM users WHERE qq_number = ?')
    .get(parsed.data.qqNumber) as { id: number } | undefined;
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.id === req.userId) return res.status(400).json({ error: '不能添加自己' });

  const [lo, hi] = pairKey(req.userId!, target.id);
  const existing = db
    .prepare('SELECT * FROM friendships WHERE user_id = ? AND friend_id = ?')
    .get(lo, hi) as { status: string } | undefined;

  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: '已经是好友了' });
    return res.json({ status: 'pending' }); // 已存在申请（无论谁发起）
  }

  db.prepare(
    'INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, ?, ?)'
  ).run(lo, hi, 'pending', Date.now());
  res.status(201).json({ status: 'sent' });
});

// 接受好友申请
router.post('/accept', (req: AuthedRequest, res) => {
  const body = z.object({ friendId: z.number().int() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: '参数错误' });
  const db = getDb();

  const row = db
    .prepare('SELECT * FROM friendships WHERE user_id = ? AND friend_id = ?')
    .get(...pairKey(req.userId!, body.data.friendId)) as { id: number; status: string } | undefined;
  if (!row || row.status !== 'pending') return res.status(404).json({ error: '申请不存在' });

  db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(row.id);
  res.json({ status: 'accepted' });
});

// 拒绝好友申请
router.post('/reject', (req: AuthedRequest, res) => {
  const body = z.object({ friendId: z.number().int() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: '参数错误' });
  const db = getDb();
  const info = db
    .prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'pending'")
    .run(...pairKey(req.userId!, body.data.friendId));
  if (info.changes === 0) return res.status(404).json({ error: '申请不存在' });
  res.json({ status: 'rejected' });
});

// 删除好友
router.delete('/:friendId', (req: AuthedRequest, res) => {
  const friendId = parseInt(req.params.friendId, 10);
  if (!Number.isFinite(friendId)) return res.status(400).json({ error: '参数错误' });
  const db = getDb();
  db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').run(
    ...pairKey(req.userId!, friendId)
  );
  res.json({ ok: true });
});

// 设置备注
router.patch('/remark', (req: AuthedRequest, res) => {
  const body = z.object({ friendId: z.number().int(), remark: z.string().max(20) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: '参数错误' });
  const db = getDb();
  db.prepare('UPDATE friendships SET remark = ? WHERE user_id = ? AND friend_id = ?').run(
    body.data.remark,
    ...pairKey(req.userId!, body.data.friendId)
  );
  res.json({ ok: true });
});

export default router;
