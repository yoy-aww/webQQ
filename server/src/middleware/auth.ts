import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';

export interface AuthedRequest extends Request {
  userId?: number;
  qqNumber?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    req.qqNumber = payload.qqNumber;
    next();
  } catch {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}
