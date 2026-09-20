import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, chatKey } from './store';
import type { PublicUser } from './types';

const me: PublicUser = {
  id: 1,
  qqNumber: '100001',
  nickname: '测试用户',
  avatar: '',
  signature: '',
  online: false,
};

/** 每个用例前重置 store 到初始态, 避免用例之间互相污染 */
function resetStore() {
  useStore.setState({
    me: null,
    token: null,
    friends: [],
    groups: [],
    active: null,
    messages: {},
    hasMore: {},
    unread: {},
    loading: false,
  });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('chatKey', () => {
  it('dm 会话返回 dm:{friendId}', () => {
    expect(chatKey({ kind: 'dm', friendId: 7 })).toBe('dm:7');
  });

  it('group 会话返回 group:{groupId}', () => {
    expect(chatKey({ kind: 'group', group: { id: 3 } })).toBe('group:3');
  });

  it('不同会话的 key 互不相同', () => {
    const a = chatKey({ kind: 'dm', friendId: 1 });
    const b = chatKey({ kind: 'group', group: { id: 1 } });
    expect(a).not.toBe(b);
  });
});

describe('auth 相关', () => {
  it('setAuth 同时写入 store 和 localStorage', () => {
    useStore.getState().setAuth(me, 'tok-1');
    expect(useStore.getState().me).toEqual(me);
    expect(useStore.getState().token).toBe('tok-1');
    expect(localStorage.getItem('webqq_token')).toBe('tok-1');
    expect(JSON.parse(localStorage.getItem('webqq_user')!)).toEqual(me);
  });

  it('logout 清空 store 与 localStorage', () => {
    useStore.getState().setAuth(me, 'tok-1');
    useStore.getState().setFriends([]);
    useStore.getState().markUnread('dm:2');
    useStore.getState().logout();

    const s = useStore.getState();
    expect(s.me).toBeNull();
    expect(s.token).toBeNull();
    expect(s.friends).toEqual([]);
    expect(s.active).toBeNull();
    expect(s.messages).toEqual({});
    expect(s.unread).toEqual({});
    expect(localStorage.getItem('webqq_token')).toBeNull();
    expect(localStorage.getItem('webqq_user')).toBeNull();
  });

  it('updateMe 更新用户信息并同步 localStorage', () => {
    useStore.getState().setAuth(me, 'tok-1');
    const updated = { ...me, nickname: '新昵称', signature: '新签名' };
    useStore.getState().updateMe(updated);
    expect(useStore.getState().me!.nickname).toBe('新昵称');
    expect(JSON.parse(localStorage.getItem('webqq_user')!).nickname).toBe('新昵称');
    // token 不受影响
    expect(useStore.getState().token).toBe('tok-1');
  });
});

describe('消息读写', () => {
  it('setMessages 写入指定 key, 不影响其他 key', () => {
    const m1 = { id: 1, senderId: 1, receiverId: 2, groupId: null, type: 'text' as const, content: 'a', createdAt: 1 };
    const m2 = { id: 2, senderId: 2, receiverId: 1, groupId: null, type: 'text' as const, content: 'b', createdAt: 2 };
    useStore.getState().setMessages('dm:1', [m1], false);
    useStore.getState().setMessages('dm:2', [m2], true);

    const s = useStore.getState();
    expect(s.messages['dm:1']).toEqual([m1]);
    expect(s.messages['dm:2']).toEqual([m2]);
    expect(s.hasMore['dm:1']).toBe(false);
    expect(s.hasMore['dm:2']).toBe(true);
    // 未设置的 key 不存在
    expect(s.messages['dm:3']).toBeUndefined();
  });

  it('prependMessages 新消息排在前面', () => {
    const older = { id: 1, senderId: 1, receiverId: 2, groupId: null, type: 'text' as const, content: '旧', createdAt: 1 };
    const newer = { id: 2, senderId: 1, receiverId: 2, groupId: null, type: 'text' as const, content: '新', createdAt: 2 };
    useStore.getState().setMessages('dm:1', [older], true);
    useStore.getState().prependMessages('dm:1', [newer], false);

    const msgs = useStore.getState().messages['dm:1']!;
    expect(msgs.map((m) => m.id)).toEqual([2, 1]);
    expect(useStore.getState().hasMore['dm:1']).toBe(false);
  });

  it('prependMessages 去重, 重复 id 只保留一条', () => {
    const dup = { id: 1, senderId: 1, receiverId: 2, groupId: null, type: 'text' as const, content: '重复', createdAt: 1 };
    const other = { id: 2, senderId: 1, receiverId: 2, groupId: null, type: 'text' as const, content: '另一条', createdAt: 2 };
    useStore.getState().setMessages('dm:1', [dup], true);
    useStore.getState().prependMessages('dm:1', [dup, other], false);

    const msgs = useStore.getState().messages['dm:1']!;
    expect(msgs.length).toBe(2);
    expect(msgs.filter((m) => m.id === 1).length).toBe(1);
  });

  it('appendMessage 追加到末尾, 且重复 id 不重复追加', () => {
    const m1 = { id: 1, senderId: 1, receiverId: 2, groupId: null, type: 'text' as const, content: 'a', createdAt: 1 };
    const m2 = { id: 2, senderId: 1, receiverId: 2, groupId: null, type: 'text' as const, content: 'b', createdAt: 2 };
    useStore.getState().appendMessage('dm:1', m1);
    useStore.getState().appendMessage('dm:1', m2);
    useStore.getState().appendMessage('dm:1', m2); // 重复

    const msgs = useStore.getState().messages['dm:1']!;
    expect(msgs.map((m) => m.id)).toEqual([1, 2]);
  });
});

describe('未读计数', () => {
  it('markUnread 累加, clearUnread 归零', () => {
    useStore.getState().markUnread('dm:1');
    useStore.getState().markUnread('dm:1');
    useStore.getState().markUnread('dm:1');
    expect(useStore.getState().unread['dm:1']).toBe(3);

    // 其他 key 不受影响
    useStore.getState().markUnread('dm:2');
    expect(useStore.getState().unread['dm:2']).toBe(1);

    useStore.getState().clearUnread('dm:1');
    expect(useStore.getState().unread['dm:1']).toBe(0);
    expect(useStore.getState().unread['dm:2']).toBe(1);
  });

  it('openChat 会把对应会话的未读清零', () => {
    useStore.getState().markUnread('dm:1');
    useStore.getState().markUnread('dm:1');
    useStore.getState().openChat({ kind: 'dm', friendId: 1, friend: me });
    expect(useStore.getState().active).not.toBeNull();
    expect(useStore.getState().unread['dm:1']).toBe(0);
  });
});
