import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db.js';
import { signToken } from '../utils/jwt.js';

export interface UserRow {
  id: number;
  qq_number: string;
  nickname: string;
  password_hash: string;
  avatar: string;
  signature: string;
  created_at: number;
}

const router = Router();

const registerSchema = z.object({
  nickname: z.string().min(2, '昵称至少 2 个字符').max(20, '昵称不能超过 20 个字符'),
  password: z.string().min(6, '密码至少 6 位').max(50, '密码不能超过 50 位'),
});

const loginSchema = z.object({
  account: z.string().min(1, '账号不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

function genQQNumber(db: ReturnType<typeof getDb>): string {
  const row = db.prepare('SELECT MAX(CAST(qq_number AS INTEGER)) AS max_no FROM users').get() as { max_no: number | null };
  const next = (row.max_no || 0) + 1;
  if (next < 100000) return '100000';
  return String(next);
}

export function toPublicUser(u: {
  id: number;
  qq_number: string;
  nickname: string;
  avatar: string;
  signature: string;
  created_at: number;
}): Record<string, unknown> {
  return {
    id: u.id,
    qqNumber: u.qq_number,
    nickname: u.nickname,
    avatar: u.avatar,
    signature: u.signature,
    createdAt: u.created_at,
  };
}

router.post('/register', (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { nickname, password } = parsed.data;
  const db = getDb();

  const exists = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
  if (exists) {
    res.status(409).json({ error: '昵称已被占用' });
    return;
  }

  const tx = db.transaction(() => {
    const qqNumber = genQQNumber(db);
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare(
        'INSERT INTO users (qq_number, nickname, password_hash, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(qqNumber, nickname, hash, Date.now());
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as
      | unknown
      | null;
    return row;
  });

  const user = tx() as UserRow;
  if (!user) {
    res.status(500).json({ error: '注册失败' });
    return;
  }
  const token = signToken({ userId: user.id, qqNumber: user.qq_number });
  res.status(201).json({ token, user: toPublicUser(user) });
});

router.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { account, password } = parsed.data;
  const db = getDb();

  const user = db
    .prepare('SELECT * FROM users WHERE qq_number = ? OR nickname = ?')
    .get(account, account) as UserRow | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: '账号或密码错误' });
    return;
  }
  const token = signToken({ userId: user.id, qqNumber: user.qq_number });
  res.json({ token, user: toPublicUser(user) });
});

export default router;

