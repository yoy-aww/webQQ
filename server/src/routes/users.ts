import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isOnline } from '../socket.js';

const router = Router();
router.use(requireAuth);

function publicUser(u: Record<string, unknown>): Record<string, unknown> {
  return {
    id: u.id,
    qqNumber: u.qq_number,
    nickname: u.nickname,
    avatar: u.avatar,
    signature: u.signature,
    createdAt: u.created_at,
    online: isOnline(u.id as number),
  };
}

// 个人资料
router.get('/me', (req: AuthedRequest, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId!) as Record<string, unknown> | undefined;
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json({ user: publicUser(u) });
});

const patchSchema = z.object({
  nickname: z.string().min(2).max(20).optional(),
  signature: z.string().max(60).optional(),
  avatar: z.string().max(500).optional(),
});

router.patch('/me', (req: AuthedRequest, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const db = getDb();
  const { nickname, signature, avatar } = parsed.data;
  if (nickname) {
    const dup = db
      .prepare('SELECT id FROM users WHERE nickname = ? AND id != ?')
      .get(nickname, req.userId!);
    if (dup) return res.status(409).json({ error: '昵称已被占用' });
  }
  db.prepare(
    `UPDATE users SET
       nickname = COALESCE(?, nickname),
       signature = COALESCE(?, signature),
       avatar = COALESCE(?, avatar)
     WHERE id = ?`
  ).run(nickname ?? null, signature ?? null, avatar ?? null, req.userId!);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId!) as Record<string, unknown>;
  res.json({ user: publicUser(u) });
});

// 搜索用户
router.get('/search', (req: AuthedRequest, res) => {
  const q = String(req.query.qq || '').trim();
  if (!q) return res.json({ users: [] });
  const db = getDb();
  const like = q.length >= 6 && /^\d+$/.test(q) ? `${q}%` : `%${q}%`;
  const rows = db
    .prepare(
      `SELECT * FROM users WHERE (qq_number LIKE ? OR nickname LIKE ?) AND id != ? LIMIT 20`
    )
    .all(like, like, req.userId!) as Record<string, unknown>[];
  res.json({ users: rows.map(publicUser) });
});

export default router;
