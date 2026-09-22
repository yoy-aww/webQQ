# WebQQ Server 学习文档

> 本文档面向想了解 WebQQ 后端架构与实现细节的开发者，涵盖技术栈、项目结构、数据库设计、API、WebSocket 实时通信、认证机制等核心内容。

---

## 1. 技术栈概览

| 类别 | 技术 | 说明 |
|---|---|---|
| 运行时 | Node.js (ESM) | `"type": "module"`，使用 ES Module 导入 |
| 语言 | TypeScript 5.x | 全量 TS，编译配置见 `tsconfig.json` |
| 开发运行 | tsx | 支持热重载，无需预编译即可运行 TS |
| Web 框架 | Express 4 | REST API 路由与中间件 |
| 实时通信 | Socket.IO 4 | WebSocket 双向通信（私聊/群聊/好友通知） |
| 数据库 | SQLite (better-sqlite3) | 嵌入式数据库，WAL 模式，零配置 |
| 认证 | JWT (jsonwebtoken) | Bearer Token，7 天有效期 |
| 密码安全 | bcryptjs | 盐值哈希，防彩虹表 |
| 输入校验 | Zod | 运行时类型校验，替代手动 if-else |
| 跨域 | cors | 白名单 + credentials 支持 |
| 环境变量 | dotenv | `.env` 文件管理敏感配置 |
| 测试 | Vitest + supertest | 单元测试 + HTTP 集成测试 |

---

## 2. 项目结构

```
server/
├── .env.example          # 环境变量模板
├── package.json          # 依赖与脚本
├── tsconfig.json         # TypeScript 配置
├── vitest.config.ts      # 测试配置
├── data/                 # SQLite 数据库文件目录
├── uploads/              # 用户上传的图片文件
└── src/
    ├── index.ts          # 🚀 入口：创建 Express + Socket.IO 服务器
    ├── config.ts         # ⚙️ 配置管理（端口、JWT 密钥、CORS）
    ├── db.ts             # 🗄️ 数据库初始化、表结构、单例访问
    ├── socket.ts         # 🔌 WebSocket 核心逻辑
    ├── middleware/
    │   └── auth.ts       # 🔒 JWT 认证中间件
    ├── routes/
    │   ├── auth.ts       # 注册 / 登录
    │   ├── users.ts      # 个人资料 / 搜索用户
    │   ├── friends.ts    # 好友系统（申请/接受/拒绝/删除/备注）
    │   ├── groups.ts     # 群组系统（创建/成员/加群）
    │   └── messages.ts   # 消息历史 / 图片上传
    ├── services/
    │   ├── messages.ts   # 消息保存与查询业务逻辑
    │   └── upload.ts     # Base64 图片上传处理
    ├── utils/
    │   └── jwt.ts        # JWT 签发与验证工具函数
    └── tests/
        └── messages.test.ts  # 消息服务单元测试
```

### 分层设计

```
请求 → 中间件(认证/解析) → 路由(参数校验+流程编排) → 服务(业务逻辑) → 数据库(SQL)
                                                                         ↑
WebSocket 事件 → socket.ts(认证+转发) ──────────────────────────────────────┘
```

- **Routes**：只负责接收请求、Zod 校验、调用服务、返回响应，不直接写 SQL
- **Services**：封装可复用的业务逻辑（如消息保存、历史查询），被路由和 socket 共同调用
- **DB**：表结构定义 + `getDb()` 单例，所有 SQL 集中在此

---

## 3. 应用启动流程

`src/index.ts` 中的 `createApp()` 函数：

```
1. 读取配置 (config.ts)
2. 创建 Express 应用
3. 挂载全局中间件：cors → json → urlencoded → 静态文件
4. 挂载路由：/api/auth, /api/users, /api/friends, /api/groups, /api/messages, /api/health
5. 挂载错误处理：404 → 500
6. 创建 HTTP Server
7. 创建 Socket.IO 实例（绑定到 HTTP Server）
8. 调用 setupSocket(io) 初始化 WebSocket 逻辑
9. 返回 { app, server, io } 供外部使用（如测试）
```

> **设计亮点**：`createApp()` 不直接 `app.listen()`，而是返回 app/server/io，方便测试时用 supertest 注入。

---

## 4. 数据库设计

### 4.1 表结构

#### `users` — 用户表

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTO | 主键 |
| `qq_number` | TEXT | UNIQUE, NOT NULL | 自动生成的 QQ 号（6位数字起，递增） |
| `nickname` | TEXT | UNIQUE, NOT NULL | 昵称（2-20字符） |
| `password_hash` | TEXT | NOT NULL | bcrypt 哈希密码 |
| `avatar` | TEXT | NOT NULL, DEFAULT `/avatars/default.png` | 头像 |
| `signature` | TEXT | NOT NULL, DEFAULT `''` | 个性签名 |
| `created_at` | INTEGER | NOT NULL | 注册时间戳(ms) |

#### `friendships` — 好友关系表

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTO | 主键 |
| `user_id` | INTEGER | FK→users, CASCADE | **较小的** 用户 ID |
| `friend_id` | INTEGER | FK→users, CASCADE | **较大的** 用户 ID |
| `status` | TEXT | CHECK(pending/accepted), DEFAULT pending | 关系状态 |
| `remark` | TEXT | DEFAULT `''` | 好友备注 |
| `created_at` | INTEGER | NOT NULL | 申请时间戳 |
| UNIQUE | (user_id, friend_id) | | 一对好友仅一条记录 |

#### `groups` — 群组表

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTO | 主键 |
| `group_number` | TEXT | UNIQUE, NOT NULL | 6 位群号（100000-999999） |
| `name` | TEXT | NOT NULL | 群名（1-20字符） |
| `avatar` | TEXT | NOT NULL, DEFAULT `/avatars/group.png` | 群头像 |
| `owner_id` | INTEGER | FK→users | 群主 |
| `created_at` | INTEGER | NOT NULL | 创建时间戳 |

#### `group_members` — 群成员表

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `group_id` | INTEGER | FK→groups, CASCADE | 群 ID |
| `user_id` | INTEGER | FK→users, CASCADE | 用户 ID |
| `role` | TEXT | CHECK(owner/admin/member), DEFAULT member | 角色 |
| `joined_at` | INTEGER | NOT NULL | 入群时间戳 |
| **PK** | (group_id, user_id) | | 复合主键 |

#### `messages` — 消息表

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTO | 主键（也用于分页游标） |
| `sender_id` | INTEGER | FK→users, CASCADE | 发送者 |
| `receiver_id` | INTEGER | FK→users, CASCADE | 接收者（私聊非空，群聊为 null） |
| `group_id` | INTEGER | FK→groups, CASCADE | 群 ID（群聊非空，私聊为 null） |
| `type` | TEXT | CHECK(text/image/system), DEFAULT text | 消息类型 |
| `content` | TEXT | NOT NULL | 内容（文字 / 图片URL / 系统消息） |
| `created_at` | INTEGER | NOT NULL | 发送时间戳 |

### 4.2 索引

| 索引名 | 字段 | 用途 |
|---|---|---|
| `idx_msg_dm` | (sender_id, receiver_id, created_at) | 私聊历史查询加速 |
| `idx_msg_group` | (group_id, created_at) | 群聊历史查询加速 |
| `idx_friends_user` | (user_id, status) | 好友列表查询加速 |
| `idx_groups_owner` | (owner_id) | 按群主查询加速 |
| `idx_gm_user` | (user_id) | 用户所在群查询加速 |

### 4.3 设计要点

- **好友关系规范化存储**：通过 `pairKey(a, b)` 函数保证 `user_id < friend_id`，一条记录代表双向关系，避免冗余和一致性问题
- **WAL 模式**：SQLite 启用 Write-Ahead Logging，支持读写并发
- **外键级联删除**：删除用户时自动清理好友、群成员、消息等关联数据

---

## 5. 认证机制

### 5.1 注册流程

```
POST /api/auth/register { nickname, password }
  1. Zod 校验：nickname(2-20字符)、password(6-20字符)
  2. 检查昵称唯一性
  3. 生成 QQ 号（找到当前最大 QQ 号 +1）
  4. bcrypt 哈希密码（10轮盐值）
  5. 写入 users 表
  6. 签发 JWT → 返回 { token, user }
```

### 5.2 登录流程

```
POST /api/auth/login { account, password }
  1. account 支持QQ号或昵称登录
  2. 查询用户，bcrypt 比对密码
  3. 签发 JWT → 返回 { token, user }
```

### 5.3 JWT 工具函数 (`src/utils/jwt.ts`)

```typescript
// 签发：payload = { userId, qqNumber }，有效期 7 天
signToken(payload: { userId: number; qqNumber: string }): string

// 验证：返回解码后的 payload 或 null
verifyToken(token: string): { userId: number; qqNumber: string } | null
```

### 5.4 认证中间件 (`src/middleware/auth.ts`)

- 从 `Authorization: Bearer <token>` 提取 Token
- 调用 `verifyToken` 验证
- 成功 → 将 `userId`、`qqNumber` 挂载到 `req` 对象
- 失败 → 返回 401（"未登录" 或 "登录已过期"）
- 所有受保护路由通过 `router.use(requireAuth)` 统一挂载

---

## 6. REST API 详解

### 6.1 公开端点

| 方法 | 路径 | 功能 | 请求体 |
|---|---|---|---|
| GET | `/api/health` | 健康检查 | — |
| POST | `/api/auth/register` | 注册 | `{ nickname, password }` |
| POST | `/api/auth/login` | 登录 | `{ account, password }` |

### 6.2 用户端点

| 方法 | 路径 | 功能 | 请求体 |
|---|---|---|---|
| GET | `/api/users/me` | 获取当前用户资料 | — |
| PATCH | `/api/users/me` | 修改资料 | `{ nickname?, signature?, avatar? }` |
| GET | `/api/users/search?qq=xxx` | 搜索用户（QQ号前缀/昵称模糊匹配，限20条） | — |

### 6.3 好友端点

| 方法 | 路径 | 功能 | 请求体 |
|---|---|---|---|
| GET | `/api/friends` | 好友列表（含待处理申请，附带在线状态） | — |
| GET | `/api/friends/search?qq=xxx` | 搜索用户并返回关系状态 | — |
| POST | `/api/friends/request` | 发送好友申请 | `{ qqNumber }` |
| POST | `/api/friends/accept` | 接受申请 | `{ friendId }` |
| POST | `/api/friends/reject` | 拒绝申请 | `{ friendId }` |
| DELETE | `/api/friends/:friendId` | 删除好友 | — |
| PATCH | `/api/friends/remark` | 设置备注 | `{ friendId, remark }` |

> **好友申请会通过 WebSocket 实时通知对方**：路由调用 `notifyFriendRequest()` 向对方的 `user:{userId}` room 推送 `friend:request` 事件。

### 6.4 群组端点

| 方法 | 路径 | 功能 | 请求体 |
|---|---|---|---|
| GET | `/api/groups` | 我的群列表 | — |
| POST | `/api/groups` | 创建群 | `{ name }` |
| GET | `/api/groups/:id/members` | 群成员列表（按角色排序） | — |
| POST | `/api/groups/:id/join` | 加入群 | `{ groupNumber? }`（支持按群号加入） |

### 6.5 消息端点

| 方法 | 路径 | 功能 | 参数 |
|---|---|---|---|
| POST | `/api/messages/upload` | 上传图片 | Body: `{ image: base64/dataURL }` |
| GET | `/api/messages/dm/:friendId` | 私聊历史 | Query: `?before=msgId`（游标分页） |
| GET | `/api/messages/group/:groupId` | 群聊历史 | Query: `?before=msgId`（游标分页） |

> 分页说明：使用消息 ID 作为游标（`before` 参数），每页 50 条，返回 `{ messages, hasMore }`。比 offset 分页更适合聊天场景，不会因新消息导致翻页重复。

---

## 7. WebSocket 实时通信

### 7.1 连接认证

```javascript
// 客户端连接时携带 Token
const socket = io("http://localhost:3001", {
  auth: { token: "Bearer xxx" }
  // 或 query: { token: "Bearer xxx" }
});
```

服务端在 `socket.ts` 中通过 Socket.IO 中间件验证 JWT，失败则拒绝连接。

### 7.2 在线状态管理

```
onlineSockets: Map<userId, Set<socketId>>
```

- 一个用户可多个标签页同时在线，用 Set 追踪所有 socket
- `isOnline(userId)` 判断是否在线
- **上线**：加入 `user:{userId}` room + 所有群 `group:{groupId}` room，通知好友上线
- **断开**：移除 socket 追踪，无剩余 socket 时通知好友下线

### 7.3 Room 机制

| Room | 用途 |
|---|---|
| `user:{userId}` | 每个用户一个，用于私聊消息推送 + 好友申请通知 |
| `group:{groupId}` | 每个群一个，用于群聊消息广播 |

### 7.4 事件列表

| 事件 | 方向 | 数据 | 说明 |
|---|---|---|---|
| `dm:send` | 客户端→服务端 | `{ to, type, content }` | 发送私聊消息 |
| `dm:new` | 服务端→客户端 | `{ id, senderId, receiverId, type, content, createdAt }` | 私聊消息通知（发方多端同步+收方接收） |
| `group:send` | 客户端→服务端 | `{ groupId, type, content }` | 发送群聊消息 |
| `group:new` | 服务端→客户端 | `{ id, senderId, groupId, type, content, createdAt }` | 群聊消息通知 |
| `group:join` | 客户端→服务端 | `groupId` | 动态加入新群 Room |
| `group:leave` | 客户端→服务端 | `groupId` | 离开群 Room |
| `friend:request` | 服务端→客户端 | `{ fromId, nickname }` | 好友申请实时通知 |
| `friend:status` | 服务端→客户端 | `{ friendId, online }` | 好友上/下线通知 |

### 7.5 私聊消息流转

```
客户端A 发送 dm:send { to: userIdB, type, content }
  ↓
服务端 socket.ts:
  1. 保存消息到 DB (saveMessage)
  2. 广播到 user:A 的 room → A 的其他标签页也收到 dm:new
  3. 广播到 user:B 的 room → B 收到 dm:new
  4. 回调(cbm)返回保存结果给发送方
```

### 7.6 群聊消息流转

```
客户端 发送 group:send { groupId, type, content }
  ↓
服务端 socket.ts:
  1. 验证发送者是否为群成员
  2. 保存消息到 DB (saveMessage)
  3. 广播到 group:{groupId} 的 room → 所有群成员收到 group:new
  4. 回调返回保存结果
```

---

## 8. 好友关系规范化存储

这是本项目的一个核心设计决策：

### 问题

好友关系是双向的——A 是 B 的好友，B 也是 A 的好友。如果存储两条记录，存在冗余和一致性问题。

### 解决方案

```typescript
function pairKey(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];  // 保证 user_id < friend_id
}
```

- 存储时：始终将较小的 ID 存为 `user_id`，较大的存为 `friend_id`
- 查询时：无论查 A 的好友还是 B 的好友，都通过 `WHERE user_id = min(A,B) AND friend_id = max(A,B)` 找到同一条记录
- 一条记录表示双向关系，零冗余

### 好友列表查询

查某用户的所有好友，需要两个方向 OR：

```sql
SELECT * FROM friendships
WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
```

然后用 `CASE` 或应用层逻辑确定"对方"是谁。

---

## 9. 图片上传

### 流程

```
客户端: 将图片转为 Base64 / Data URL
  ↓
POST /api/messages/upload { image: "data:image/png;base64,..." }
  ↓
服务端 upload.ts:
  1. 解析 Data URL 或纯 Base64
  2. 校验：≤2MB，格式为 png/jpg/jpeg/gif/webp
  3. 生成文件名：{时间戳}-{随机6位哈希}.{扩展名}
  4. 写入 uploads/ 目录
  5. 返回 { url: "/uploads/filename.png" }
```

上传后客户端拿到 URL，作为 `type: "image"` 消息的 `content` 发送。

---

## 10. 配置管理

| 配置项 | 默认值 | 环境变量 |
|---|---|---|
| 端口 | `3001` | `PORT` |
| JWT 密钥 | `webqq-dev-secret-change-me` | `JWT_SECRET` |
| 数据库路径 | `./data/webqq.db` | `DB_PATH` |
| CORS 来源 | `localhost:5173,localhost:3001` | `CORS_ORIGINS`（逗号分隔） |

使用方式：复制 `.env.example` 为 `.env`，修改对应值。

> **重要**：生产环境必须修改 `JWT_SECRET`，否则 Token 可被伪造。

---

## 11. 测试

项目使用 Vitest 框架，配置了临时数据库支持：

```typescript
// db.ts 提供测试专用方法
useTestDb(): void  // 切换到内存中的临时 SQLite 数据库
```

### 示例：消息服务测试 (`tests/messages.test.ts`)

```typescript
describe('messages service', () => {
  beforeEach(() => useTestDb());

  it('should save and fetch DM messages', () => {
    // 使用临时数据库测试保存和查询
  });

  it('should support cursor-based pagination', () => {
    // 测试 before 游标分页
  });
});
```

运行测试：

```bash
npx vitest
```

---

## 12. 启动与开发

```bash
# 安装依赖
cd server && npm install

# 启动开发服务器（tsx 热重载）
npx tsx watch src/index.ts

# 运行测试
npx vitest
```

服务启动后：
- REST API: `http://localhost:3001/api/*`
- WebSocket: `http://localhost:3001`（Socket.IO 自动处理升级）
- 上传文件: `http://localhost:3001/uploads/*`

---

## 13. 架构总结图

```
┌───────────────────────────────────────────────────────┐
│                     index.ts                          │
│  createApp() → { app, server, io }                   │
│                                                       │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │   Express    │    │  Socket.IO   │                 │
│  │  (REST API)  │    │  (实时通信)   │                 │
│  └──────┬───────┘    └──────┬───────┘                 │
│         │                   │                         │
│  ┌──────▼───────────────────▼──────┐                  │
│  │         Middleware              │                  │
│  │  cors / json / auth(JWT)       │                  │
│  └──────────────┬─────────────────┘                  │
│                 │                                     │
│  ┌──────────────▼─────────────────┐                  │
│  │       Routes / Socket事件       │                  │
│  │  auth | users | friends |      │                  │
│  │  groups | messages | dm/group  │                  │
│  └──────────────┬─────────────────┘                  │
│                 │                                     │
│  ┌──────────────▼─────────────────┐                  │
│  │         Services               │                  │
│  │  messages.ts | upload.ts       │                  │
│  └──────────────┬─────────────────┘                  │
│                 │                                     │
│  ┌──────────────▼─────────────────┐                  │
│  │      Data Layer                │                  │
│  │  db.ts (SQLite) | jwt.ts       │                  │
│  │  config.ts                     │                  │
│  └────────────────────────────────┘                  │
└───────────────────────────────────────────────────────┘
```

---

## 14. 关键设计决策与最佳实践

1. **REST + WebSocket 双通道**：CRUD 操作走 REST，实时推送走 WebSocket，各司其职
2. **好友关系规范化**：`pairKey` 确保单向存储，避免数据冗余
3. **游标分页**：消息历史用消息 ID 游标（而非 offset），避免新消息导致翻页跳变
4. **JWT 双通道认证**：REST 用 Authorization 头，WebSocket 用 handshake.auth/query
5. **多端在线支持**：`Map<userId, Set<socketId>>` 追踪多标签页，私聊发方也收到 `dm:new` 实现多端同步
6. **Zod 运行时校验**：替代手动 if-else，类型安全 + 自动错误响应
7. **可测试性**：`createApp()` 不直接 listen，`useTestDb()` 支持临时内存库
8. **上传安全**：大小限制 2MB + 格式白名单 + 随机文件名防路径遍历
