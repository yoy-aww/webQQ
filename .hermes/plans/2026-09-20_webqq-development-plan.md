# WebQQ 网页版 QQ 开发计划

> **For Hermes:** 使用 subagent-driven-development 按任务逐个执行；每个任务完成后做 spec 合规 + 代码质量双评审。

**目标：** 从零构建一个模仿腾讯 QQ 的网页版即时通讯应用（独立数据库，不接入腾讯），支持注册登录、好友、单聊、群聊、消息记录。

**架构：** 前后端分离。React SPA 前端 + Node.js Express 后端，WebSocket（Socket.IO）承载实时消息，REST API 承载账号/好友/历史消息，SQLite（better-sqlite3）本地存储起步，架构上保留将来迁移 PostgreSQL 的可能。

**技术栈：**
- 前端：React 18 + TypeScript + Vite + Zustand（状态）+ antd（组件）+ dayjs
- 后端：Node.js 24 + Express + TypeScript + Socket.IO + JWT + bcryptjs
- 数据库：SQLite（better-sqlite3，同步 API 简单可靠）
- 工程：ESLint + Prettier，Vitest（后端单测），dotenv 配置

**项目根目录：** `C:\yoyac-work\WebQQ`（当前为空目录）

```
WebQQ/
├── client/          # React 前端（Vite）
├── server/          # Express + Socket.IO 后端
│   ├── src/
│   └── tests/
└── README.md
```

---

## 设计决策（Trade-off 说明）

| 决策点 | 选择 | 理由 / 放弃项 |
|---|---|---|
| 实时协议 | Socket.IO | 自带断线重连、房间（群聊天然映射 room）、降级轮询；放弃裸 WebSocket（要手写重连/心跳） |
| 账号体系 | 自增 QQ 号（6 位起）+ 昵称 + 密码 | 模仿 QQ 的"号码"体验；放弃邮箱注册（不像 QQ） |
| 在线状态 | Socket.IO 连接即在线，内存 Map 维护 | 简单；多实例部署时才需要 Redis，YAGNI |
| 消息存储 | 全部落库，客户端拉历史 + 离线消息 | 放弃纯内存转发（刷新就没记录） |
| 文件/图片 | 一期只做**图片**（base64 ≤2MB 直传，存 server/uploads） | 不做大文件分片，YAGNI |
| UI 风格 | 模仿经典 QQ 2008-2013 面板风：左侧窄面板（头像+好友列表），右侧独立聊天窗口 | 可后期加皮肤 |

---

## 数据模型（SQLite）

```sql
-- 用户
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qq_number TEXT UNIQUE NOT NULL,        -- 6位数字号，从 100000 起自增分配
  nickname TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT DEFAULT '/avatars/default.png',
  signature TEXT DEFAULT '',             -- 个性签名
  created_at INTEGER NOT NULL
);

-- 好友关系（双向各存一行，status: pending/accepted）
CREATE TABLE friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  friend_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  remark TEXT DEFAULT '',                -- 备注名
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, friend_id)
);

-- 群
CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_number TEXT UNIQUE NOT NULL,     -- 群号
  name TEXT NOT NULL,
  avatar TEXT DEFAULT '/avatars/group.png',
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',   -- owner/admin/member
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

-- 消息（单聊 receiver_id 为对方用户；群聊 group_id 非空）
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  group_id INTEGER REFERENCES groups(id),
  type TEXT NOT NULL DEFAULT 'text',     -- text/image
  content TEXT NOT NULL,                 -- text 内容或图片 URL
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_msg_dm ON messages(sender_id, receiver_id, created_at);
CREATE INDEX idx_msg_group ON messages(group_id, created_at);
```

---

## API 设计（REST）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register | 注册（昵称+密码）→ 返回分配的 QQ 号 |
| POST | /api/auth/login | QQ号+密码 → JWT |
| GET | /api/users/me | 当前用户信息 |
| PATCH | /api/users/me | 改昵称/签名/头像 |
| GET | /api/users/search?qq= | 按 QQ 号搜索用户 |
| GET | /api/friends | 好友列表（含在线状态） |
| POST | /api/friends/request | 发送好友申请 |
| POST | /api/friends/accept | 同意申请 |
| DELETE | /api/friends/:id | 删除好友 |
| GET | /api/messages/dm/:friendId?before=&limit=50 | 单聊历史（分页） |
| POST | /api/groups | 创建群 |
| GET | /api/groups | 我的群列表 |
| POST | /api/groups/:id/join | 加群 |
| GET | /api/messages/group/:groupId?before=&limit=50 | 群聊历史 |

**Socket.IO 事件：**
- 客户端发：`dm:send` {to, type, content}、`group:send` {groupId, type, content}
- 服务端推：`dm:new`（新单聊消息）、`group:new`、`friend:status`（好友上/下线）、`friend:request`（收到申请）
- 认证：握手时 `auth: { token }` 传 JWT，服务端校验后把 socket 加入 `user:{id}` room

---

## 任务分解

### Phase 0 — 工程脚手架

**Task 0.1 初始化 monorepo 与 git**
- Files: `C:/yoyac-work/WebQQ/`（根 README.md、.gitignore）
- 步骤：`git init`；创建 .gitignore（node_modules、dist、*.db、uploads/）；`git commit -m "chore: init"`

**Task 0.2 后端脚手架**
- Create: `server/package.json`、`server/tsconfig.json`、`server/src/index.ts`、`server/.env.example`
- 依赖：express cors dotenv better-sqlite3 bcryptjs jsonwebtoken socket.io zod；dev: typescript tsx vitest supertest @types/*
- 验证：`cd server && npx tsx src/index.ts`，GET /api/health 返回 `{"ok":true}`

**Task 0.3 前端脚手架**
- `npm create vite@latest client -- --template react-ts`
- 依赖：antd zustand socket.io-client axios dayjs；react-router-dom
- 验证：`npm run dev` 能打开默认页

### Phase 1 — 账号体系

**Task 1.1 数据库初始化模块**
- Create: `server/src/db.ts`（better-sqlite3 连接 + 执行上面的建表 SQL）
- Test: `server/tests/db.test.ts` — 表存在性
- 命令：`npx vitest run`

**Task 1.2 注册接口（TDD）**
- Test: `tests/auth.test.ts` — POST /api/auth/register 成功返回 6 位 qq_number；重复密码 hash 不存明文
- Create: `server/src/routes/auth.ts`、`server/src/utils/qqNumber.ts`（事务内查最大号+1，从 100000 起）
- 验证：`npx vitest run tests/auth.test.ts` PASS + curl 实测

**Task 1.3 登录 + JWT 中间件**
- Test: 正确密码返回 token，错误返回 401；受保护路由无 token 返回 401
- Create: `server/src/middleware/auth.ts`
- 验证：vitest + curl 带 Authorization 头访问 /api/users/me

**Task 1.4 前端登录/注册页**
- Create: `client/src/pages/Login.tsx`、`client/src/pages/Register.tsx`、`client/src/api/client.ts`（axios 实例 + token 拦截器）
- 样式：仿 QQ 登录框（居中卡片、蓝色渐变标题栏、QQ 企鹅占位 logo）
- 验证：手动注册→登录→跳转主面板

### Phase 2 — 好友系统

**Task 2.1 搜索用户 + 好友申请/接受（TDD）**
- Test: `tests/friends.test.ts` — 申请→对方 accept→双向各一行 accepted
- Create: `server/src/routes/friends.ts`
- 验证：vitest

**Task 2.2 好友列表 API（含在线状态）**
- 在线状态从 Socket.IO 内存 Map 查
- 验证：vitest（先 mock 在线表）

**Task 2.3 前端主面板（好友列表）**
- Create: `client/src/pages/Main.tsx`、`client/src/components/FriendList.tsx`、`AddFriend.tsx`（搜索弹窗）
- 布局：左栏 250px，头像圆形、昵称+签名两行、在线亮色/离线灰显
- 验证：开两个浏览器用户 A 加 B 为好友

### Phase 3 — 单聊（核心）

**Task 3.1 Socket.IO 服务端 + JWT 握手认证**
- Create: `server/src/socket.ts`（连接管理、user→sockets Map）
- Test: `tests/socket.test.ts` — 无 token 连接被拒
- 验证：vitest + 客户端手测连接

**Task 3.2 dm:send → 落库 → 推送（TDD）**
- 服务端收到 dm:send：写 messages 表 → 发 `dm:new` 给发送方（回显确认）和接收方所有在线 socket
- Test: 两个 socket.io-client 模拟 A→B 发消息
- 验证：vitest PASS

**Task 3.3 单聊历史分页 API**
- `before` 游标（message id）倒序取 50 条
- Test: 分页边界
- 验证：vitest

**Task 3.4 前端聊天窗口**
- Create: `client/src/components/ChatWindow.tsx`、`MessageBubble.tsx`、`ChatInput.tsx`
- Create: `client/src/stores/chatStore.ts`（Zustand：会话列表、消息按会话缓存、未读计数）
- 行为：双击好友打开独立窗口（一期可用右侧分栏代替独立弹窗，二期再做拖拽窗口）；收到消息未读红点；滚动加载历史
- 验证：两浏览器互发消息实时到达、刷新后历史仍在

### Phase 4 — 群聊

**Task 4.1 建群/加群/群列表 API（TDD）**
- Create: `server/src/routes/groups.ts`

**Task 4.2 group:send → Socket.IO room 广播**
- 连接时把 socket join 到所有所在群的 `group:{id}` room
- Test: 群成员收到、非成员收不到

**Task 4.3 前端群聊**
- 群 tab（好友/群两个 tab 切换，仿 QQ 面板）、创建群弹窗、群聊天窗口复用 ChatWindow
- 验证：三人进群互聊

### Phase 5 — 体验增强

**Task 5.1 在线状态实时推送**（friend:status 广播给好友，前端实时亮/灰）
**Task 5.2 个性签名 + 资料编辑**
**Task 5.3 图片消息**（粘贴/选择图片 → base64 上传 → 消息里渲染缩略图）
**Task 5.4 未读消息角标 + 提示音**（可选，用简单 Audio）
**Task 5.5 界面打磨**：QQ 经典蓝色皮肤、窗口最小化/关闭按钮样式、登录页动画

### Phase 6 — 收尾

**Task 6.1** README（启动步骤、截图、架构图 ASCII）
**Task 6.2** 全量测试 `npx vitest run` + 前端 `npm run build` 通过
**Task 6.3** 一键启动脚本 `start.bat`（同时起 server 5173→proxy、client）

---

## 关键风险与开放问题

1. **独立聊天窗口 vs 单页布局**：真正 QQ 是每个好友一个可拖拽独立窗口。网页实现成本高（窗口管理器）。**建议一期用"左列表右聊天"分栏（像微信网页版），二期再加弹窗模式**。—— 需你确认。
2. **Socket.IO 与 Vite 代理**：开发环境 client(5173) → server(3001) 需配 vite proxy + websocket proxy，计划中已在 Task 0.3 包含。
3. **better-sqlite3 原生编译**：Windows 上需要预编译二进制，Node 24 一般自带 prebuilt；若失败备选 sql.js（纯 JS）。
4. **多标签页**：同一账号开两个标签页消息同步 —— Socket.IO 的 `user:{id}` room 天然支持，不额外处理。

## 验证总标准（Definition of Done）

- 后端 `npx vitest run` 全绿
- 前端 `npm run build` 无 TS 错误
- 手动冒烟：注册两个号 → 加好友 → 单聊 → 建群 → 群聊 → 刷新历史不丢 → 图片消息
