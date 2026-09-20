import { create } from 'zustand';
import type { ChatTarget, FriendEntry, GroupInfo, Message, PublicUser } from './types';

interface AppState {
  me: PublicUser | null;
  token: string | null;
  friends: FriendEntry[];
  groups: GroupInfo[];
  /** 当前打开的会话，null 表示未打开任何会话 */
  active: ChatTarget | null;
  /** key: dm:{friendId} / group:{groupId} */
  messages: Record<string, Message[]>;
  /** key 同上，是否还有更多历史 */
  hasMore: Record<string, boolean>;
  /** 未读消息计数，key: dm:{friendId} / group:{groupId} */
  unread: Record<string, number>;
  loading: boolean;

  setAuth: (user: PublicUser, token: string) => void;
  logout: () => void;
  updateMe: (user: PublicUser) => void;
  setFriends: (friends: FriendEntry[]) => void;
  setGroups: (groups: GroupInfo[]) => void;
  openChat: (target: ChatTarget) => void;
  closeChat: () => void;
  setMessages: (key: string, messages: Message[], hasMore: boolean) => void;
  prependMessages: (key: string, messages: Message[], hasMore: boolean) => void;
  appendMessage: (key: string, msg: Message) => void;
  clearUnread: (key: string) => void;
  markUnread: (key: string) => void;
  setLoading: (v: boolean) => void;
}

/** key: dm:{friendId} / group:{groupId} — 只需要 id 就能构造 */
export const chatKey = (target: { kind: string; friendId?: number; group?: { id: number } }): string =>
  target.kind === 'dm' ? `dm:${target.friendId}` : `group:${target.group!.id}`;

const storedUser = (): PublicUser | null => {
  const raw = localStorage.getItem('webqq_user');
  return raw ? (JSON.parse(raw) as PublicUser) : null;
};

export const useStore = create<AppState>((set, get) => ({
  me: storedUser(),
  token: localStorage.getItem('webqq_token'),
  friends: [],
  groups: [],
  active: null,
  messages: {},
  hasMore: {},
  unread: {},
  loading: false,

  setAuth: (user, token) => {
    localStorage.setItem('webqq_token', token);
    localStorage.setItem('webqq_user', JSON.stringify(user));
    set({ me: user, token });
  },

  logout: () => {
    localStorage.removeItem('webqq_token');
    localStorage.removeItem('webqq_user');
    set({ me: null, token: null, friends: [], groups: [], active: null, messages: {}, hasMore: {}, unread: {} });
  },

  updateMe: (user) => {
    localStorage.setItem('webqq_user', JSON.stringify(user));
    set({ me: user });
  },

  setFriends: (friends) => set({ friends }),
  setGroups: (groups) => set({ groups }),

  openChat: (target) => {
    const key = chatKey(target);
    set({ active: target, unread: { ...get().unread, [key]: 0 } });
  },

  closeChat: () => set({ active: null }),

  setMessages: (key, messages, hasMore) =>
    set({ messages: { ...get().messages, [key]: messages }, hasMore: { ...get().hasMore, [key]: hasMore } }),

  prependMessages: (key, messages, hasMore) => {
    const cur = get().messages[key] || [];
    const merged = [...messages, ...cur];
    // 去重（服务端可能重发）
    const seen = new Set<number>();
    const dedup = merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    set({ messages: { ...get().messages, [key]: dedup }, hasMore: { ...get().hasMore, [key]: hasMore } });
  },

  appendMessage: (key, msg) => {
    const cur = get().messages[key] || [];
    if (cur.some((m) => m.id === msg.id)) return;
    set({ messages: { ...get().messages, [key]: [...cur, msg] } });
  },

  clearUnread: (key) => set({ unread: { ...get().unread, [key]: 0 } }),

  markUnread: (key) =>
    set({ unread: { ...get().unread, [key]: (get().unread[key] || 0) + 1 } }),

  setLoading: (v) => set({ loading: v }),
}));
