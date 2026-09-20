# WebQQ

网页版 QQ 模仿项目（独立数据库，不接入腾讯）。

## 结构

- `client/` — React 18 + TS + Vite 前端
- `server/` — Express + Socket.IO + SQLite 后端

## 启动

```bash
# 后端
cd server && npm install && npx tsx src/index.ts

# 前端（新终端）
cd client && npm install && npm run dev
```
