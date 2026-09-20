import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db: Database.Database;

function initDb(pathOverride?: string): Database.Database {
  const dbPath = pathOverride || config.dbPath;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');

  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      qq_number TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '/avatars/default.png',
      signature TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
      remark TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_number TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '/avatars/group.png',
      owner_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','system')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_msg_dm ON messages(sender_id, receiver_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_msg_group ON messages(group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_friends_user ON friendships(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);
    CREATE INDEX IF NOT EXISTS idx_gm_user ON group_members(user_id);
  `);

  return conn;
}

export function getDb(): Database.Database {
  if (!db) db = initDb();
  return db;
}

/** 仅供测试：用临时库替换全局连接 */
export function useTestDb(testDbPath: string): Database.Database {
  db = initDb(testDbPath);
  return db;
}
