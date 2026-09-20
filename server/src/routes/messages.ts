import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { fetchDmHistory, fetchGroupHistory } from '../services/messages.js';
import { saveBase64Image } from '../services/upload.js';

const router = Router();
router.use(requireAuth);

const LIMIT = 50;

// 图片上传 POST /api/messages/upload  { image: base64 }
router.post('/upload', (req: AuthedRequest, res) => {
  const image = String(req.body?.image || '');
  if (!image) return res.status(400).json({ error: '图片数据为空' });
  try {
    const url = saveBase64Image(image);
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message || '图片上传失败' });
  }
});

function parseBefore(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseInt(v, 10) : (v as number | undefined);
  return Number.isFinite(n) && n! > 0 ? n : undefined;
}

// 单聊历史 GET /api/messages/dm/:friendId
router.get('/dm/:friendId', (req: AuthedRequest, res) => {
  const friendId = parseInt(req.params.friendId, 10);
  if (!Number.isFinite(friendId)) return res.status(400).json({ error: '参数错误' });
  const list = fetchDmHistory(req.userId!, friendId, parseBefore(req.query.before), LIMIT);
  res.json({ messages: list, hasMore: list.length === LIMIT });
});

// 群聊历史 GET /api/messages/group/:groupId
router.get('/group/:groupId', (req: AuthedRequest, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: '参数错误' });
  const db = getDb();
  const isMember = db
    .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, req.userId!);
  if (!isMember) return res.status(403).json({ error: '不是该群成员' });
  const list = fetchGroupHistory(groupId, parseBefore(req.query.before), LIMIT);
  res.json({ messages: list, hasMore: list.length === LIMIT });
});

export default router;
