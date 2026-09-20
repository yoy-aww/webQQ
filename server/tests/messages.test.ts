import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, useTestDb } from '../src/db';
import { saveMessage, fetchDmHistory, fetchGroupHistory } from '../src/services/messages';

/** 用临时库跑测试, 不影响真实 data/webqq.db */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webqq-test-'));
  useTestDb(path.join(tmpDir, 'test.db'));
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // 清理失败可忽略
  }
});

/** 插入一个用户, 返回 id */
function insertUser(nickname: string): number {
  const db = getDb();
  const info = db
    .prepare(
      'INSERT INTO users (qq_number, nickname, password_hash, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(String(900000 + Math.floor(Math.random() * 99999)), nickname, 'hash', Date.now());
  return info.lastInsertRowid as number;
}

describe('saveMessage', () => {
  it('保存后能按 id 读回, 字段从 snake_case 变成 camelCase', () => {
    const db = getDb();
    const a = insertUser('甲');
    const b = insertUser('乙');
    const saved = saveMessage({ senderId: a, receiverId: b, type: 'text', content: '你好' });
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(saved.id) as Record<string, unknown>;
    expect(row.sender_id).toBe(a);
    expect(row.receiver_id).toBe(b);
    expect(row.content).toBe('你好');
  });

  it('群消息 receiver_id 为 null', () => {
    const db = getDb();
    const a = insertUser('乙');
    const g = db
      .prepare('INSERT INTO groups (group_number, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run('123456', '群', a, Date.now());
    const gid = g.lastInsertRowid as number;
    const saved = saveMessage({ senderId: a, groupId: gid, type: 'text', content: '群消息' });
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(saved.id) as Record<string, unknown>;
    expect(row.receiver_id).toBeNull();
    expect(row.group_id).toBe(gid);
  });
});

describe('fetchDmHistory', () => {
  it('返回两人之间的消息, 按时间正序', () => {
    const a = insertUser('丙');
    const b = insertUser('丁');
    const msgs = [1, 2, 3].map((n) =>
      saveMessage({ senderId: a, receiverId: b, type: 'text', content: `第${n}条` })
    );
    // 加一条不相关的对话, 验证不会被混进来
    const c = insertUser('戊');
    saveMessage({ senderId: c, receiverId: a, type: 'text', content: '别人的消息' });

    const history = fetchDmHistory(a, b);
    expect(history).toHaveLength(3);
    // 正序: 先发的在前
    expect(history.map((m) => m.content)).toEqual(['第1条', '第2条', '第3条']);
    // 不包含 c 的消息
    expect(history.every((m) => m.senderId === a || m.senderId === b)).toBe(true);
  });

  it('方向无关: fetchDmHistory(b,a) 与 fetchDmHistory(a,b) 结果相同', () => {
    const a = insertUser('己');
    const b = insertUser('庚');
    saveMessage({ senderId: a, receiverId: b, type: 'text', content: 'AB' });
    saveMessage({ senderId: b, receiverId: a, type: 'text', content: 'BA' });

    const ab = fetchDmHistory(a, b);
    const ba = fetchDmHistory(b, a);
    expect(ab.map((m) => m.content)).toEqual(ba.map((m) => m.content));
    expect(ab).toHaveLength(2);
  });

  it('before 参数只返回更早的消息', () => {
    const a = insertUser('辛');
    const b = insertUser('壬');
    const saved = [1, 2, 3, 4].map((n) =>
      saveMessage({ senderId: a, receiverId: b, type: 'text', content: `n${n}` })
    );
    // 以第 2 条为界, 只应拿到第 1 条
    const older = fetchDmHistory(a, b, saved[1].id, 10);
    expect(older).toHaveLength(1);
    expect(older[0].id).toBe(saved[0].id);
  });

  it('limit 参数生效: 取最新 limit 条, 按时间正序返回', () => {
    const a = insertUser('癸');
    const b = insertUser('子');
    [1, 2, 3, 4, 5].forEach((n) =>
      saveMessage({ senderId: a, receiverId: b, type: 'text', content: `m${n}` })
    );
    const got = fetchDmHistory(a, b, undefined, 3).map((m) => m.content);
    // SQL 是 ORDER BY id DESC LIMIT 3 后 reverse → 取最新 3 条, 正序排
    expect(got).toEqual(['m3', 'm4', 'm5']);
    expect(fetchDmHistory(a, b, undefined, 1)).toHaveLength(1);
  });
});

describe('fetchGroupHistory', () => {
  it('只返回指定群的消息, 正序', () => {
    const db = getDb();
    const a = insertUser('丑');
    const mkGroup = () => {
      const g = db
        .prepare('INSERT INTO groups (group_number, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
        .run(String(200000 + Math.floor(Math.random() * 99999)), '群', a, Date.now());
      return g.lastInsertRowid as number;
    };
    const g1 = mkGroup();
    const g2 = mkGroup();

    saveMessage({ senderId: a, groupId: g1, type: 'text', content: 'G1-1' });
    saveMessage({ senderId: a, groupId: g2, type: 'text', content: 'G2-1' });
    saveMessage({ senderId: a, groupId: g1, type: 'text', content: 'G1-2' });

    const h1 = fetchGroupHistory(g1);
    expect(h1).toHaveLength(2);
    expect(h1.map((m) => m.content)).toEqual(['G1-1', 'G1-2']);

    const h2 = fetchGroupHistory(g2);
    expect(h2).toHaveLength(1);
    expect(h2[0].content).toBe('G2-1');
  });

  it('before 分页只返回更早的消息', () => {
    const db = getDb();
    const a = insertUser('寅');
    const g = db
      .prepare('INSERT INTO groups (group_number, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run('333333', '分页群', a, Date.now());
    const gid = g.lastInsertRowid as number;

    const saved = [1, 2, 3].map((n) =>
      saveMessage({ senderId: a, groupId: gid, type: 'text', content: `p${n}` })
    );
    const older = fetchGroupHistory(gid, saved[2].id, 10);
    expect(older.map((m) => m.content)).toEqual(['p1', 'p2']);
  });
});

describe('数据库外键约束', () => {
  it('删除用户会级联删除其消息 (foreign_keys=ON)', () => {
    const db = getDb();
    const a = insertUser('卯');
    const b = insertUser('辰');
    const saved = saveMessage({ senderId: a, receiverId: b, type: 'text', content: '待删' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id = ?').get(saved.id)).toEqual({ n: 1 });

    db.prepare('DELETE FROM users WHERE id = ?').run(a);
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id = ?').get(saved.id)).toEqual({ n: 0 });
  });
});
