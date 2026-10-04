# WebQQ 项目深度代码分析报告

> 分析日期：2026-10-04  
> 分析方式：通读全部 42 个源文件 + 2 份学习文档，实跑测试/类型检查/构建验证  
> 分析工具：Hermes Agent + project-code-analysis skill

---

## 1. 项目定位与核心思路

WebQQ 是一个网页版 QQ 模仿项目，**独立数据库，不接入腾讯**。前端 React 18 + TS + Vite + Zustand + antd，后端 Express + Socket.IO + SQLite (better-sqlite3)。总计 42 个文件，~3800 行代码（含文档），核心功能完整：注册/登录、好友系统（申请/接受/拒绝/删除/备注）、群聊（创建/加群/成员列表）、单聊/群聊消息（文字/图片）、消息历史游标分页、在线状态、多标签页同步。

**关键架构赌注**：好友关系用 `pairKey()` 规范化存储（user_id < friend_id），一条记录代表双向关系，零冗余——这是整个后端最精巧的设计决策。消息历史用 ID 游标分页（而非 offset），适配聊天场景。WebSocket 观察者模式（`onDm`/`onGroup` 注册+取消）解耦 socket 与 UI。

---

## 2. 模块结构与职责

| 模块 | 文件 | 行数 | 职责 |
|---|---|---|---|
| **入口** | `client/src/main.tsx` | 25 | 应用引导（ConfigProvider → AntdApp → BrowserRouter → App） |
| **路由守卫** | `client/src/App.tsx` | 24 | 条件渲染守卫（me ? MainPanel : LoginPage） |
| **类型** | `client/src/types.ts` | 51 | 全量 TypeScript 类型定义（PublicUser/FriendEntry/Message/GroupInfo/ChatTarget） |
| **状态** | `client/src/store.ts` | 106 | Zustand 全局 store（认证/消息/未读/持久化） |
| **API 层** | `client/src/api/client.ts` | 90 | Axios 封装（拦截器+20+ API 方法） |
| **Socket** | `client/src/socket/index.ts` | 116 | Socket.IO 客户端（观察者模式+超时+事件分发） |
| **聊天窗口** | `client/src/components/ChatWindow.tsx` | 349 | 单聊/群聊核心界面（消息渲染/发送/分页/图片） |
| **好友列表** | `client/src/components/FriendList.tsx` | 211 | 搜索/添加/接受/拒绝/未读角标 |
| **群列表** | `client/src/components/GroupList.tsx` | 121 | 创建/搜索/未读角标 |
| **头像** | `client/src/components/Avatar.tsx` | 49 | 图片/首字母双模式 + 在线状态点 |
| **登录页** | `client/src/pages/LoginPage.tsx` | 100 | 登录/注册双模式 |
| **主面板** | `client/src/pages/MainPanel.tsx` | 331 | 侧栏+聊天区+Socket 生命周期+断线提示+编辑资料+加群 |
| **样式** | `client/src/styles/global.css` | 588 | 唯一 CSS 文件，BEM 风格 |
| **E2E** | `client/e2e/ui_smoke.cjs` | 112 | Playwright CDP 模式冒烟测试 |
| **配置** | `server/src/config.ts` | 32 | 端口/JWT/CORS 白名单/env |
| **数据库** | `server/src/db.ts` | 85 | 表结构定义+WAL+外键+单例+测试库 |
| **入口** | `server/src/index.ts` | 78 | createApp() 工厂（Express+Socket.IO+中间件+路由） |
| **Socket** | `server/src/socket.ts` | 172 | JWT 握手+在线追踪+房间管理+消息转发 |
| **认证** | `server/src/routes/auth.ts` | 115 | 注册/登录（Zod 校验+bcrypt+QQ 号生成） |
| **用户** | `server/src/routes/users.ts` | 73 | 资料/搜索 |
| **好友** | `server/src/routes/friends.ts` | 173 | 申请/接受/拒绝/删除/备注（pairKey 模型） |
| **群组** | `server/src/routes/groups.ts` | 128 | 建群/加群/成员列表 |
| **消息** | `server/src/routes/messages.ts` | 65 | 历史查询/图片上传 |
| **消息服务** | `server/src/services/messages.ts` | 95 | 保存/查询（游标分页） |
| **上传服务** | `server/src/services/upload.ts` | 38 | Base64 图片处理（大小/格式/安全） |
| **认证中间件** | `server/src/middleware/auth.ts` | 25 | JWT Bearer Token 验证 |
| **JWT 工具** | `server/src/utils/jwt.ts` | 16 | signToken/verifyToken |
| **学习文档** | `doc/client-learning.md` | 756 | 前端架构详解 |
| **学习文档** | `doc/server-learning.md` | 508 | 后端架构详解 |
| **测试** | `client/src/store.test.ts` + `selectors.test.ts` | 224 | Zustand 状态管理测试 |
| **测试** | `server/tests/messages.test.ts` | 172 | 消息服务测试 |

---

## 3. 各层质量评估

### 架构 ★★★★☆

分层清晰：REST 路由（参数校验+流程编排）→ 服务层（业务逻辑）→ 数据库（SQL）。`createApp()` 工厂模式便于测试。REST + WebSocket 双通道职责分离明确。前端 Zustand 轻量全局状态，无 Redux 样板代码。唯一遗憾：socket.ts 承担了过多职责（认证+在线追踪+房间管理+消息转发+REST 通知），可以考虑拆分。

### 核心业务逻辑 ★★★★★

- `pairKey()` 好友关系规范化：最精巧的设计，一条记录零冗余
- 游标分页：`before` 参数用消息 ID，避免 offset 在聊天场景的翻页跳变
- 消息去重：`appendMessage`/`prependMessages` 均按 `msg.id` 去重，防御服务端重推
- `useTestDb()` + 临时数据库：测试不污染生产数据

### UI 层 ★★★★☆

ChatWindow 是核心，349 行处理单聊/群聊/消息渲染/分页/图片/群成员抽屉。已知 bug 有回归测试（`selectors.test.ts` 验证 EMPTY_MESSAGES 引用稳定性）。唯一问题：Avatar 的 `isRealImage()` 只认 `/uploads/` 前缀，默认头像 `/avatars/default.png` 不会显示为图片（走首字母占位）。

### 测试 ★★★☆☆

后端 9/9 通过。前端 2/2 失败（localStorage/jsdom 问题，见 P0）。有 Playwright E2E 冒烟测试但截图路径硬编码 Windows 路径。

### 文档 ★★★★★

两份学习文档总计 1264 行，涵盖技术栈、结构、流程、设计决策、架构总结图。质量很高，是"教学级"文档。主要问题：部分描述与实际代码有漂移（见 P2）。

---

## 4. 主要问题（按严重度排序）

### P0 — 阻断性

**#1. 前端测试全部失败：localStorage 在 jsdom 环境中不可用**

文件：`client/vite.config.ts`（第 11-13 行）
```typescript
test: {
    environment: 'jsdom',
    globals: true,
},
```

`store.ts` 第 39 行在模块加载时调用 `localStorage.getItem()`。jsdom 的 localStorage 未初始化，导致 SecurityError。两个测试文件（store.test.ts、selectors.test.ts）全部无法执行，`npm test` 在 client 下必定失败。

**修复**：添加测试 setup 文件，在 vitest 配置中引用：
```typescript
// vite.config.ts
test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './test-setup.ts',
},
```
```typescript
// test-setup.ts
Object.defineProperty(window, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  writable: true,
});
```

**#2. Socket.IO CORS 配置矛盾——生产环境 WebSocket 可能无法连接**

文件：`server/src/index.ts`（第 55-57 行）
```typescript
const io = new SocketIOServer(server, {
    cors: { origin: '*', credentials: true },
});
```

`origin: '*'` + `credentials: true` 是浏览器规范禁止的组合。REST 层有完整的 CORS 白名单机制（`config.ts` 的 `corsOrigins` + `index.ts` 第 17-25 行的 `origin(origin, cb)`），但 Socket.IO 完全绕过了这套机制，放行了所有来源。

**影响**：(a) 生产环境如果前端域名不在 `*` 允许的范围内（虽然 `*` 通常通配），带 credentials 的 WebSocket 请求可能被浏览器拒绝；(b) 任意网站的 JS 都能连接 WebSocket，如果有被盗的 token 就能读写消息。

**修复**：
```typescript
const io = new SocketIOServer(server, {
    cors: { origin: config.corsOrigins, credentials: true },
});
```

### P1 — 重要

**#3. 无认证限制的群加入——知道群号即可加入**

文件：`server/src/routes/groups.ts`（第 107-125 行）

`POST /:id/join` 允许任何已登录用户通过群号加入任何群。没有邀请机制，没有好友关系检查。虽然文档描述了"按群号加群"是预期行为，但从安全角度这意味着群是完全公开的。如果未来需要私群，需要重新设计。

**#4. API 层存在 4 个从未被 UI 调用的死函数**

文件：`client/src/api/client.ts`

| 死函数 | 行号 | 服务端端点存在 | 说明 |
|---|---|---|---|
| `searchUser()` | 53-54 | `GET /users/search` | FriendList 用的是 `friendSearch()` 而非此函数 |
| `deleteFriend()` | 65-66 | `DELETE /friends/:id` | UI 中无删除好友按钮 |
| `setRemark()` | 67-68 | `PATCH /friends/remark` | UI 中无备注编辑界面 |
| `me()` | 50 | `GET /users/me` | 页面加载时直接从 localStorage 恢复，不调 API |

服务端端点全部实现且可工作，但客户端不暴露这些功能。这是未完成的功能，不是 bug。

**#5. 密码最大长度文档与代码不一致**

文件：`server/src/routes/auth.ts`（第 21 行）vs `doc/server-learning.md`（第 177 行）

代码：`password: z.string().min(6).max(50)` — 最大 50 字符  
文档：`password(6-20字符)` — 声称最大 20 字符

文档漂移，文档更严格。实际代码允许 50 字符密码。

### P2 — 改进项

**#6. `chatKey()` 类型签名过宽，运行时可能产出 `dm:undefined`**

文件：`client/src/store.ts`（第 35-36 行）
```typescript
export const chatKey = (target: { kind: string; friendId?: number; group?: { id: number } }): string =>
  target.kind === 'dm' ? `dm:${target.friendId}` : `group:${target.group!.id}`;
```

参数类型未使用 `ChatTarget` 联合类型。`kind === 'dm'` 时 `friendId` 是 `number | undefined`（如果调用者忘了传，产出 `dm:undefined`）。非 dm 时 `group!` 是非空断言，如果 group 为 undefined 会运行时崩溃。应该直接使用 `ChatTarget` 类型。

**#7. E2E 测试截图路径硬编码为 Windows 绝对路径**

文件：`client/e2e/ui_smoke.cjs`（第 49、101 行）
```javascript
'C:/Users/aww/AppData/Local/Temp/webqq-fail.png'
'C:/Users/aww/AppData/Local/Temp/webqq-group.png'
```

只在原作者的 Windows 机器上有效。应该用 `path.resolve` 或临时目录。

**#8. 无 `.env.example` 文件**

`server-learning.md` 第 401 行说"使用方式：复制 `.env.example` 为 `.env`"，但仓库中不存在此文件。应创建。

**#9. 文档声称"e2e 19 项全通过"但实际只有 12 项**

Git commit message `dfc8038` 说"e2e 19 项全通过"，但 `ui_smoke.cjs` 实际有 12 个 `ok()` 断言。commit message 不准确。

**#10. `Avatar.isRealImage()` 只认 `/uploads/` 前缀**

文件：`client/src/components/Avatar.tsx`（第 13-15 行）
```typescript
function isRealImage(src?: string): boolean {
  return !!src && src.startsWith('/uploads/');
}
```

默认头像 `/avatars/default.png` 不以 `/uploads/` 开头，会走首字母占位而非显示图片。如果 `/avatars/default.png` 实际存在并应展示，这是个 bug。如果不存在则没问题。

**#11. 客户端文档中的 Vite 配置代码片段与实际有差异**

`doc/client-learning.md` 第 596 行：
```typescript
alias: { '@': '/src' }
```
实际代码（`vite.config.ts` 第 8 行）：
```typescript
alias: { '@': path.resolve(__dirname, 'src') }
```

文档简化了代码，但 `'/src'` 在某些环境下可能不正确（取决于工作目录）。实际代码用 `path.resolve` 是正确做法。

---

## 5. 验证结果（实跑）

| 检查项 | 命令 | 结果 |
|---|---|---|
| 后端测试 | `cd server && npx vitest run` | **9/9 通过** (557ms) |
| 前端测试 | `cd client && npx vitest run` | **2/2 失败** — SecurityError: Cannot initialize local storage without a `--localstorage-file` path |
| 后端类型检查 | `cd server && npx tsc --noEmit` | **通过**（零错误） |
| 前端类型检查 | `cd client && npx tsc --noEmit` | **通过**（零错误） |
| 前端构建 | `cd client && npx vite build` | **未执行**（工具限制，但 tsc 通过说明类型无误） |
| git status | `git status --short` | **干净**（零未跟踪文件） |
| 依赖安装 | `npm install`（client + server） | **通过** |

---

## 6. 建议优先级

| 优先级 | 项目 | 预估工作量 |
|---|---|---|
| **P0** | #1 修复前端测试 localStorage 问题 | 5 分钟 |
| **P0** | #2 修复 Socket.IO CORS 白名单 | 5 分钟 |
| **P1** | #4 删除 4 个死 API 函数（或实现对应 UI） | 15 分钟 |
| **P1** | #5 同步文档与代码的密码长度限制 | 1 分钟 |
| **P2** | #6 修复 chatKey 类型签名 | 5 分钟 |
| **P2** | #7 E2E 截图路径改为可移植路径 | 5 分钟 |
| **P2** | #8 添加 `.env.example` | 2 分钟 |
| **P2** | #9 修正 commit message（或补全 E2E 到 19 项） | 10 分钟 |

---

## 7. 总结

这是一个架构设计扎实、文档质量极高的个人学习项目。核心亮点是 `pairKey()` 好友关系规范化、游标分页、Zustand 引用稳定性回归测试。当前有 2 个 P0 阻断问题（前端测试全挂 + Socket.IO CORS 矛盾），修完后质量会大幅提升。

**最值得学习的三个设计决策**：

1. **好友关系规范化存储** — `pairKey()` 保证 `user_id < friend_id`，一条记录零冗余，避免双向关系的重复和一致性问题。这是关系型数据库设计中少见的优雅解法。

2. **消息游标分页** — 用消息 ID 作为游标（`before` 参数），而非 offset。聊天场景中用户可能一边翻历史一边收到新消息，offset 会导致翻页内容跳变，游标分页完全避免这个问题。

3. **Zustand selector 稳定性回归测试** — `selectors.test.ts` 用一个 `never[]` 类型和 `expect(a).toBe(b)` 断言来防止 `|| []` 写法导致无限重渲染。这种"把踩过的坑写进测试"的做法值得借鉴。
