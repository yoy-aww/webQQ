# WebQQ Client 学习文档

> 本文档面向想了解 WebQQ 前端架构与实现细节的开发者，涵盖技术栈、项目结构、状态管理、组件体系、API 层、WebSocket 通信、认证流程等核心内容。

---

## 1. 技术栈概览

| 类别 | 技术 | 版本 | 说明 |
|---|---|---|---|
| UI 框架 | React | 18.3 | 函数组件 + Hooks |
| 构建工具 | Vite | 6.x | 开发服务器 + 构建打包 |
| 语言 | TypeScript | 5.6 | 严格模式，ES2022 目标 |
| 路由 | react-router-dom | 6.28 | BrowserRouter，条件渲染守卫 |
| 状态管理 | Zustand | 5.0 | 轻量全局 store，无中间件 |
| UI 组件库 | Ant Design (antd) | 5.22 | Modal、Input、ConfigProvider 等 |
| HTTP 客户端 | Axios | 1.7 | 拦截器 + 统一错误处理 |
| WebSocket | socket.io-client | 4.8 | 与服务端 Socket.IO 对接 |
| 日期处理 | dayjs | 1.11 | 中文 locale |
| 单元测试 | Vitest + jsdom | 2.1 | store 与 selector 测试 |
| E2E 测试 | playwright-core | 1.63 | CDP 连接模式冒烟测试 |
| 样式 | 手写全局 CSS | — | BEM 风格，~588 行 |

---

## 2. 项目结构

```
client/
├── index.html                # SPA 入口 HTML
├── package.json              # 依赖与脚本
├── tsconfig.json             # TS 编译配置（strict + @ 路径别名）
├── vite.config.ts            # Vite 配置（代理 + 分包 + Vitest）
├── e2e/
│   └── ui_smoke.cjs          # Playwright E2E 冒烟测试
└── src/
    ├── main.tsx              # 🚀 应用引导入口
    ├── App.tsx               # 🛡️ 路由守卫（登录态判断）
    ├── types.ts              # 📋 全局 TypeScript 类型定义
    ├── store.ts              # 🏪 Zustand 全局状态管理
    ├── store.test.ts         # 单元测试：store actions
    ├── selectors.test.ts     # 回归测试：selector 引用稳定性
    ├── api/
    │   └── client.ts         # 🌐 Axios HTTP API 封装
    ├── socket/
    │   └── index.ts          # 🔌 Socket.IO 客户端封装
    ├── components/
    │   ├── Avatar.tsx         # 头像组件（图片/首字母 + 在线状态）
    │   ├── ChatWindow.tsx     # 💬 聊天窗口（单聊/群聊核心界面）
    │   ├── FriendList.tsx     # 👥 好友列表（搜索/添加/接受/拒绝）
    │   └── GroupList.tsx      # 🏠 群列表（创建/搜索/加群）
    ├── pages/
    │   ├── LoginPage.tsx      # 🔐 登录/注册页
    │   └── MainPanel.tsx      # 📱 主面板（侧栏 + 聊天区 + 全局 Modal）
    └── styles/
        └── global.css         # 🎨 全局样式（唯一 CSS 文件）
```

---

## 3. 应用启动与路由

### 3.1 启动链路

```
index.html (#root)
  → main.tsx
    → dayjs 中文 locale
    → <ConfigProvider locale={zhCN}>    // antd 中文化
      → <AntdApp>                       // 提供 message.useMessage 上下文
        → <BrowserRouter>
          → <App />
```

### 3.2 路由守卫（App.tsx）

没有使用声明式嵌套路由，采用**条件渲染守卫**：

```typescript
// 伪代码
if (store.me === null) {
  return <LoginPage />;       // 所有路径都显示登录页
} else {
  return <MainPanel />;       // 所有路径都显示主面板
}
```

- 登录成功后 `navigate('/', { replace: true })` 跳转
- 401 响应时 `location.href = '/login'` 强制跳转（硬刷新，清空所有状态）

---

## 4. 状态管理（Zustand）

### 4.1 Store 结构

```typescript
interface AppState {
  // ── 认证 ──
  me: PublicUser | null;          // 当前登录用户
  token: string | null;           // JWT Token

  // ── 数据 ──
  friends: FriendEntry[];         // 好友列表（含 pending + accepted）
  groups: GroupInfo[];            // 群列表
  active: ChatTarget | null;      // 当前打开的会话

  // ── 消息 ──
  messages: Record<string, Message[]>;   // chatKey → 消息数组
  hasMore: Record<string, boolean>;      // chatKey → 是否有更多历史
  unread: Record<string, number>;        // chatKey → 未读数

  loading: boolean;
}
```

### 4.2 chatKey 约定

消息、未读等以 `chatKey` 为 key 存储：

| 会话类型 | chatKey 格式 | 示例 |
|---|---|---|
| 单聊 | `dm:{friendId}` | `dm:42` |
| 群聊 | `group:{groupId}` | `group:7` |

### 4.3 核心 Actions

| Action | 说明 |
|---|---|
| `setAuth(user, token)` | 登录成功：写 store + localStorage |
| `logout()` | 登出：清空全部状态 + localStorage |
| `updateMe(user)` | 更新个人信息：同步 store + localStorage |
| `openChat(target)` | 打开会话，同时清除该会话未读 |
| `closeChat()` | 关闭当前会话 |
| `setMessages(key, msgs, hasMore)` | 首次加载会话消息 |
| `prependMessages(key, msgs, hasMore)` | 加载更多历史（顶部追加，含去重） |
| `appendMessage(key, msg)` | 收到新消息（底部追加，含去重防重推） |
| `markUnread(key)` | 标记未读（非当前会话收到消息时） |
| `clearUnread(key)` | 清除未读（打开会话时） |

### 4.4 持久化策略

| 持久化 | 不持久化 |
|---|---|
| `token` → `localStorage['webqq_token']` | `friends`、`groups` |
| `user` → `localStorage['webqq_user']` | `messages`、`unread`、`active` |

- 消息和列表数据每次登录后从服务端拉取，保证一致性
- 页面刷新后自动从 localStorage 恢复登录态

### 4.5 消息去重

`appendMessage` 和 `prependMessages` 都通过 `msg.id` 去重，防止 WebSocket 重推或网络延迟导致重复显示。

---

## 5. 组件体系

### 5.1 组件层级关系

```
main.tsx
  └─ ConfigProvider (antd 中文)
       └─ AntdApp
            └─ BrowserRouter
                 └─ App
                      ├─ [未登录] LoginPage
                      └─ [已登录] MainPanel
                           ├─ aside.side-panel
                           │    ├─ Avatar (当前用户头像)
                           │    ├─ side-tabs (好友 / 群聊切换)
                           │    ├─ FriendList (好友 tab)
                           │    │    ├─ SessionItem (每个好友会话项)
                           │    │    └─ Modal (搜索用户 / 添加好友)
                           │    ├─ GroupList (群聊 tab)
                           │    │    └─ Modal (创建群聊)
                           │    ├─ side-footer (统计 + 加群按钮)
                           │    └─ Modal (按群号加群)
                           ├─ main.chat-shell
                           │    ├─ ChatWindow (有活跃会话时)
                           │    │    ├─ Avatar (对方头像)
                           │    │    ├─ MessageRow × N
                           │    │    │    └─ Avatar (发送者头像)
                           │    │    ├─ GroupMembersDrawer (群成员列表)
                           │    │    └─ 输入区 (textarea + 图片按钮)
                           │    └─ .empty-state (无会话时)
                           └─ EditProfileModal (编辑个人资料)
```

### 5.2 核心组件说明

#### `Avatar` — 通用头像

- 支持**真实图片**和**首字母占位**两种模式
- 右下角显示**在线状态点**（绿色在线 / 灰色离线）
- 支持**方形**（群头像）和**圆形**（用户头像）
- Props: `src`, `name`, `online`, `shape`

#### `ChatWindow` — 聊天窗口

- 核心聊天界面，同时支持单聊和群聊
- 功能：历史消息渲染、文字发送、图片发送、群成员抽屉
- 打开时自动加载消息历史
- 滚动到顶部可"加载更多"（游标分页）
- 图片消息点击放大预览
- 自动滚动到底部（新消息 / 历史加载后）

#### `FriendList` — 好友列表

- 双区展示：**待处理申请**（pending）+ **已添加好友**（accepted）
- 搜索用户：按 QQ 号搜索
- 好友操作：发送申请、接受/拒绝申请、删除好友、设置备注
- 未读角标：好友会话有未读消息时显示红色数字

#### `GroupList` — 群列表

- 展示用户已加入的所有群
- 创建新群（1-20 字符群名）
- 每个群显示：群名、群号、成员数
- 未读角标

#### `LoginPage` — 登录/注册页

- 单页面切换**登录**和**注册**两种模式
- 登录：输入 QQ号/昵称 + 密码
- 注册：输入昵称 + 密码 + 确认密码
- 使用 antd Form 组件，内置校验规则

#### `MainPanel` — 主面板

- 整体布局：左侧边栏 + 右聊天区
- **Socket 生命周期管理**：挂载时 `connectSocket()`，卸载时 `disconnectSocket()`
- 监听 WebSocket 事件：DM 消息、群消息、好友状态变更、好友申请
- 断线提示 banner
- 编辑资料 Modal、加群 Modal

---

## 6. API 服务层

### 6.1 Axios 实例配置

```typescript
// src/api/client.ts
const api = axios.create({
  baseURL: '/api',    // 通过 Vite 代理到后端
  timeout: 15000,
});
```

### 6.2 拦截器

**请求拦截器**：从 localStorage 取 Token，自动添加 `Authorization: Bearer` 头

**响应拦截器**：401 时自动清空 localStorage + 重定向 `/login`

### 6.3 工具函数

```typescript
apiError(e: unknown): string   // 统一提取错误消息
unwrap<T>(res): T              // 解包 { data: T } 为 T
```

### 6.4 API 方法清单

| 模块 | 方法 | HTTP | 路径 |
|---|---|---|---|
| **认证** | `login(account, password)` | POST | `/auth/login` |
| | `register(nickname, password)` | POST | `/auth/register` |
| **用户** | `me()` | GET | `/users/me` |
| | `updateMe(patch)` | PATCH | `/users/me` |
| | `searchUser(qq)` | GET | `/users/search?qq=` |
| **好友** | `friends()` | GET | `/friends` |
| | `friendSearch(qq)` | GET | `/friends/search?qq=` |
| | `sendFriendRequest(qqNumber)` | POST | `/friends/request` |
| | `acceptFriend(friendId)` | POST | `/friends/accept` |
| | `rejectFriend(friendId)` | POST | `/friends/reject` |
| | `deleteFriend(friendId)` | DELETE | `/friends/:id` |
| | `setRemark(friendId, remark)` | PATCH | `/friends/remark` |
| **消息** | `dmHistory(friendId, before?)` | GET | `/messages/dm/:id` |
| | `groupHistory(groupId, before?)` | GET | `/messages/group/:id` |
| | `uploadImage(base64)` | POST | `/messages/upload` |
| **群** | `groups()` | GET | `/groups` |
| | `createGroup(name)` | POST | `/groups` |
| | `joinGroup(groupId)` | POST | `/groups/:id/join` |
| | `groupMembers(groupId)` | GET | `/groups/:id/members` |

### 6.5 Vite 代理配置

开发模式下，以下路径代理到后端 `http://localhost:3001`：

| 代理路径 | 用途 |
|---|---|
| `/api` | REST API |
| `/uploads` | 上传的图片文件 |
| `/socket.io` | WebSocket 握手与轮询 |

---

## 7. WebSocket 通信

### 7.1 连接管理

```typescript
connectSocket(token: string)   // 断开旧连接，创建新连接
disconnectSocket()              // 断开连接并置空引用
```

连接参数：
```typescript
io('/', {
  auth: { token },              // JWT 认证
  transports: ['websocket'],    // 仅 WebSocket，不降级到轮询
});
```

### 7.2 Socket 事件

#### 发送（客户端 → 服务端）

| 事件 | 数据 | 说明 |
|---|---|---|
| `dm:send` | `{ to, type, content }` | 发送私聊消息 |
| `group:send` | `{ groupId, type, content }` | 发送群聊消息 |
| `group:join` | `groupId` | 加入群 Room |
| `group:leave` | `groupId` | 离开群 Room |

#### 接收（服务端 → 客户端）

| 事件 | 数据 | 说明 |
|---|---|---|
| `dm:new` | `ServerMessage` | 收到私聊消息 |
| `group:new` | `ServerMessage` | 收到群聊消息 |
| `friend:request` | `{ fromId, nickname }` | 好友申请通知 |
| `friend:status` | `{ friendId, online }` | 好友上下线通知 |
| `connect_error` | — | 连接失败（含 `unauthorized` 认证失败） |

### 7.3 事件分发机制

socket 模块使用**观察者模式**分发消息：

```typescript
// 注册处理器（返回取消函数）
const off = onDm((msg) => { /* 处理私聊消息 */ });
const off2 = onGroup((msg) => { /* 处理群聊消息 */ });

// 取消注册
off();
```

其他事件通过 `window.dispatchEvent` 广播：

| 自定义事件 | 触发时机 | 监听方 |
|---|---|---|
| `webqq:socket-status` | 连接/断开 | MainPanel 显示离线 banner |
| `webqq:friend-status` | 好友上下线 | MainPanel 刷新好友列表 |
| `webqq:friend-request` | 收到好友申请 | MainPanel toast 提示 + 刷新列表 |

### 7.4 发送消息超时

`sendDm` 和 `sendGroup` 都设置了 **5 秒超时**，超时后 Promise reject，上层 toast 提示"发送失败"。

---

## 8. 认证流程

### 8.1 注册

```
用户输入 昵称 + 密码
  → api.register(nickname, password)
  → 服务端返回 { token, user }
  → store.setAuth(user, token)    // 写 store + localStorage
  → connectSocket(token)          // 建立 WebSocket 连接
  → navigate('/')                 // 跳转主面板
```

### 8.2 登录

```
用户输入 QQ号/昵称 + 密码
  → api.login(account, password)
  → 同注册流程
```

### 8.3 自动恢复

```
页面加载
  → localStorage.getItem('webqq_token')
  → localStorage.getItem('webqq_user')
  → 若都存在 → store.setAuth(user, token) → 显示 MainPanel
  → 若不存在 → 显示 LoginPage
```

### 8.4 401 处理

| 触发点 | 行为 |
|---|---|
| Axios 响应拦截器 | 清空 localStorage + `location.href = '/login'`（硬刷新） |
| Socket `connect_error` (unauthorized) | 同上 |

### 8.5 登出

```
disconnectSocket()          // 断开 WebSocket
store.logout()              // 清空全部状态 + localStorage
→ App 检测 store.me === null → 显示 LoginPage
```

---

## 9. 核心功能实现

### 9.1 单聊

```
点击好友 → store.openChat({ kind: 'dm', friendId, friend })
  → ChatWindow 加载历史: api.dmHistory(friendId)
  → store.setMessages(chatKey, msgs, hasMore)
  → 用户输入文字 → sendDm(friendId, content, 'text')
  → 服务端 ack → 回调返回保存结果
  → 收到 dm:new → store.appendMessage(chatKey, msg)
  → 非当前会话 → store.markUnread(chatKey)
```

### 9.2 群聊

```
点击群 → store.openChat({ kind: 'group', group })
  → joinGroupRoom(groupId)           // 加入 Socket Room
  → api.groupHistory(groupId)        // 加载历史
  → sendGroup(groupId, content, 'text')
  → 收到 group:new → store.appendMessage(chatKey, msg)
```

### 9.3 图片消息

```
用户点击图片按钮 → <input type="file"> 选择图片
  → FileReader.readAsDataURL() → 得到 Base64 Data URL
  → api.uploadImage(base64)           → 服务端返回 { url }
  → sendDm/sendGroup(id, url, 'image') → 发送图片消息
  → ChatWindow 渲染时判断 type === 'image' → <img> 标签展示
```

### 9.4 消息历史分页

```
首次打开会话 → 加载最近 50 条消息
滚动到顶部 → 显示"加载更多"按钮
  → api.dmHistory(friendId, { before: oldestMsgId })
  → store.prependMessages(chatKey, olderMsgs, hasMore)
  → 消息去重（按 msg.id）
```

游标分页（`before` 参数）而非 offset 分页，避免新消息导致翻页内容跳变。

### 9.5 未读消息

```
收到非当前会话的消息 → store.markUnread(chatKey)
  → 好友/群列表对应项显示红色角标
  → document.title 显示总未读数："(3) WebQQ"
打开会话 → store.clearUnread(chatKey)
  → 角标消失
```

### 9.6 在线状态

```
Socket 收到 friend:status 事件
  → window.dispatchEvent('webqq:friend-status')
  → MainPanel 监听 → api.friends() 刷新好友列表
  → Avatar 组件根据 friend.online 显示绿/灰圆点
```

### 9.7 断线重连

```
Socket 断开
  → window.dispatchEvent('webqq:socket-status', { connected: false })
  → MainPanel 顶部显示红色 banner："网络连接已断开，正在重新连接…"
Socket 重连成功
  → window.dispatchEvent('webqq:socket-status', { connected: true })
  → banner 消失
```

---

## 10. 类型定义

`src/types.ts` 定义了全部核心领域类型：

```typescript
// 公开用户信息
interface PublicUser {
  id: number;
  qqNumber: string;
  nickname: string;
  avatar: string;
  signature: string;
  online?: boolean;
  createdAt: number;
}

// 好友条目（含 pending 和 accepted）
interface FriendEntry {
  id: number;
  status: 'pending' | 'accepted';
  remark: string;
  requestAt: number;
  friendId: number;
  friend: PublicUser;
}

// 消息
interface Message {
  id: number;
  senderId: number;
  receiverId: number | null;
  groupId: number | null;
  type: 'text' | 'image' | 'system';
  content: string;
  createdAt: number;
}

// 群信息
interface GroupInfo {
  id: number;
  groupNumber: string;
  name: string;
  avatar: string;
  ownerId: number;
  memberCount: number;
  createdAt: number;
}

// 群成员（继承 PublicUser + 角色）
interface GroupMember extends PublicUser {
  role: 'owner' | 'admin' | 'member';
}

// 聊天目标（联合类型）
type ChatTarget =
  | { kind: 'dm'; friendId: number; friend: PublicUser }
  | { kind: 'group'; group: GroupInfo };
```

---

## 11. 样式方案

### 11.1 整体策略

- **纯手写全局 CSS**，唯一文件 `src/styles/global.css`（~588 行）
- 无 CSS Modules、无 Tailwind、无 styled-components
- BEM 风格类名：`.chat-window`、`.chat-titlebar`、`.msg.self`
- 部分组件用 `style` prop 做小型内联样式

### 11.2 配色体系

| 用途 | 颜色 |
|---|---|
| 主色 | `#1d6fc4` / `#4aa8f0`（蓝色系） |
| 背景 | `#f7f8fa` |
| 文字 | `#1f2329` |
| 次要文字 | `#8a8f99` |
| 在线状态 | `#52c41a`（绿色） |
| 离线状态 | `#bfbfbf`（灰色） |
| 未读角标 | `#ff4d4f`（红色） |
| 自己的消息气泡 | `#4aa8f0`（蓝色） |
| 对方的消息气泡 | `#ffffff`（白色） |

### 11.3 字体

```css
font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
```

### 11.4 特色样式

- 自定义 WebKit 滚动条（细窄风格）
- 消息气泡三角箭头（CSS border 实现）
- 头像在线状态圆点（绝对定位 + box-shadow）
- 平滑过渡动画（`transition: all 0.2s`）

---

## 12. 构建配置

### 12.1 Vite 配置要点 (`vite.config.ts`)

```typescript
export default defineConfig({
  resolve: { alias: { '@': '/src' } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/socket.io': 'http://localhost:3001',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          socket: ['socket.io-client'],
        },
      },
    },
  },
  test: { environment: 'jsdom', globals: true },
});
```

### 12.2 分包策略

| Chunk | 包含模块 | 说明 |
|---|---|---|
| `react` | react + react-dom + react-router-dom | React 核心不变，长期缓存 |
| `antd` | antd + @ant-design/icons | UI 库独立缓存 |
| `socket` | socket.io-client | WebSocket 库独立缓存 |
| `index` | 业务代码 | 频繁变更 |

### 12.3 TypeScript 配置

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```

---

## 13. 测试

### 13.1 单元测试（Vitest）

#### `store.test.ts` — Store Actions 测试

覆盖范围：
- **chatKey 生成**：验证 `dm:` / `group:` 前缀
- **认证流程**：`setAuth` / `logout` / `updateMe`
- **消息 CRUD**：`setMessages` / `prependMessages` / `appendMessage` / 去重
- **未读计数**：`markUnread` / `clearUnread`

#### `selectors.test.ts` — Selector 稳定性回归测试

目的：防止 selector 返回新引用（如 `messages[key] || []`）导致 Zustand 订阅组件无限重渲染。

运行命令：
```bash
npx vitest           # watch 模式
npx vitest run       # 单次运行（CI）
```

### 13.2 E2E 测试（Playwright）

文件：`e2e/ui_smoke.cjs`

**技术方案**：通过 CDP 连接已有 Chrome 实例（`chromium.connectOverCDP('http://127.0.0.1:9333')`），需要预先启动带 CDP 的 Chrome。

**测试流程**：
1. 清空 localStorage
2. 断言登录页渲染
3. 注册新用户 → 断言跳转主面板
4. 断言分配了 QQ 号
5. 创建新群 → 断言群列表显示
6. 进入群聊 → 发送消息 → 断言消息发送成功
7. 断言无前端错误（console error / page error / request failure）
8. 截图保存

---

## 14. 启动与开发

```bash
# 安装依赖
cd client && npm install

# 启动开发服务器（端口 5173，代理到后端 3001）
npm run dev

# 类型检查
npx tsc --noEmit

# 运行单元测试
npx vitest

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

---

## 15. 架构总结图

```
┌─────────────────────────────────────────────────────────┐
│                     main.tsx                            │
│  ConfigProvider → AntdApp → BrowserRouter → App         │
│                                                         │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │     LoginPage       │  │      MainPanel           │  │
│  │  (未登录时渲染)      │  │  ┌────────┬───────────┐ │  │
│  │                     │  │  │ 侧栏   │  聊天区    │ │  │
│  │  - 登录表单         │  │  │FriendL │ChatWindow │ │  │
│  │  - 注册表单         │  │  │GroupL  │           │ │  │
│  │  - api.login()      │  │  │Avatar  │Messages   │ │  │
│  │  - api.register()   │  │  │EditPrf │Input      │ │  │
│  └─────────────────────┘  │  └────────┴───────────┘ │  │
│                            └──────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │               Zustand Store                     │    │
│  │  me / token / friends / groups / active         │    │
│  │  messages / unread / hasMore / loading          │    │
│  └────────────────────┬────────────────────────────┘    │
│                       │                                 │
│  ┌────────────────────▼────────────────────────────┐    │
│  │              Data Layer                         │    │
│  │  api/client.ts (Axios + REST)                  │    │
│  │  socket/index.ts (Socket.IO + 实时事件)          │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 16. 关键设计决策与最佳实践

1. **Zustand 轻量状态管理**：无 Redux 样板代码，一个 `create()` 搞定全局状态；selector 稳定性测试防止无限渲染
2. **条件渲染路由守卫**：比嵌套路由更简单直观，适合单页应用只有两个"页面"的场景
3. **REST + WebSocket 双通道**：CRUD 走 Axios，实时消息走 Socket.IO，职责清晰
4. **消息去重**：`appendMessage` / `prependMessages` 均按 `msg.id` 去重，防御服务端重推
5. **游标分页**：消息历史用消息 ID 游标（`before`），避免 offset 分页在聊天场景下的问题
6. **自动 401 处理**：Axios 拦截器 + Socket 认证失败双通道自动跳转登录页
7. **localStorage 最小持久化**：只存 token 和 user，其余数据服务端拉取，保证一致性
8. **Socket 观察者模式**：`onDm` / `onGroup` 注册处理器，组件卸载时取消，避免内存泄漏
9. **Vite 分包**：react / antd / socket 独立 chunk，业务代码变更不影响长效缓存
10. **E2E CDP 模式**：连接已有浏览器而非启动新实例，适合 CI 或本地调试
