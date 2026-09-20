import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isOnline } from '../socket.js';

const router = Router();
router.use(requireAuth);

// 生成 QQ 风格 6 位群号（100000-999999），避开已存在的
function genGroupNumber(db: ReturnType<typeof getDb>): string {
  const existing = new Set(
    (db.prepare('SELECT group_number FROM groups').all() as { group_number: string }[]).map(
      (r) => r.group_number
    )
  );
  for (let i = 0; i < 5000; i++) {
    const no = String(Math.floor(Math.random() * 900000) + 100000);
    if (!existing.has(no)) return no;
  }
  // 极端情况：随机 5000 次都撞车，从最小未用号往后找
  for (let no = 100000; no < 1000000; no++) {
    if (!existing.has(String(no))) return String(no);
  }
  // 理论上不会到这里（900000 个候选）
  throw new Error('无法生成群号');
}

function groupOut(g: Record<string, unknown>, memberCount: number): Record<string, unknown> {
  return {
    id: g.id,
    groupNumber: g.group_number,
    name: g.name,
    avatar: g.avatar,
    ownerId: g.owner_id,
    memberCount,
    createdAt: g.created_at,
  };
}

// 我的群列表
router.get('/', (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS cnt
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = ?
        ORDER BY g.created_at DESC`
    )
    .all(req.userId!) as Record<string, unknown>[];
  res.json({ groups: rows.map((g) => groupOut(g, g.cnt as number)) });
});

// 建群
router.post('/', (req: AuthedRequest, res) => {
  const body = z.object({ name: z.string().min(1).max(20) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: '群名不合法' });
  const db = getDb();
  const info = db.transaction(() => {
    const gno = genGroupNumber(db);
    const ins = db
      .prepare(
        'INSERT INTO groups (group_number, name, owner_id, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(gno, body.data.name, req.userId!, Date.now());
    const gid = ins.lastInsertRowid as number;
    db.prepare(
      'INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    ).run(gid, req.userId!, 'owner', Date.now());
    db.prepare(
      "INSERT INTO messages (sender_id, group_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(req.userId!, gid, 'system', `${req.userId!} 创建了群聊`, Date.now());
    return gid;
  })();
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(info) as Record<string, unknown>;
  res.status(201).json({ group: groupOut(g, 1) });
});

// 群成员列表
router.get('/:id/members', (req: AuthedRequest, res) => {
  const gid = parseInt(req.params.id, 10);
  const db = getDb();
  const members = db
    .prepare(
      `SELECT u.id, u.qq_number, u.nickname, u.avatar, u.signature, m.role
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = ?
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.id`
    )
    .all(gid) as Record<string, unknown>[];
  res.json({
    members: members.map((m) => ({
      id: m.id,
      qqNumber: m.qq_number,
      nickname: m.nickname,
      avatar: m.avatar,
      signature: m.signature,
      role: m.role,
      online: isOnline(m.id as number),
    })),
  });
});

// 按群号加群（前端「按群号加群」传的是群号而非 id，所以优先按 group_number 查）
router.post('/:id/join', (req: AuthedRequest, res) => {
  const raw = req.params.id.trim();
  const db = getDb();

  const g = db
    .prepare('SELECT * FROM groups WHERE group_number = ? OR id = ?')
    .get(raw, parseInt(raw, 10)) as Record<string, unknown> | undefined;
  if (!g) return res.status(404).json({ error: '群不存在' });

  const gid = g.id as number;
  const isOwner = g.owner_id === req.userId;
  db.prepare(
    'INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  ).run(gid, req.userId!, isOwner ? 'owner' : 'member', Date.now());
  const cnt = db
    .prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?')
    .get(gid) as { n: number };
  res.json({ ok: true, group: groupOut(g, cnt.n) });
});

export default router;
