import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';

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

/**
 * 回归测试: ChatWindow 曾因 `useStore((s) => s.messages[key] || [])`
 * 在 selector 里返回新数组引用, 导致 Zustand 判定"状态变了"而无限重渲染
 * (Maximum update depth exceeded)。
 * 修复方案是用模块级 EMPTY_MESSAGES 常量保持引用稳定。
 * 本测试验证: 空会话的 selector 必须返回同一个引用。
 */
describe('空会话消息 selector 的引用稳定性', () => {
  it('未设置消息的 key, 两次读取得到同一个数组引用', () => {
    // 模拟组件里的写法: messages[key] ?? EMPTY_MESSAGES
    const EMPTY: never[] = [];
    const selector = (s: ReturnType<typeof useStore.getState>) => s.messages['dm:999'] ?? EMPTY;

    const a = selector(useStore.getState());
    const b = selector(useStore.getState());
    expect(a).toBe(b);
    expect(a).toBe(EMPTY);
  });

  it('对比: `|| []` 写法每次返回新引用 (证明这就是 bug 根源)', () => {
    const badSelector = (s: ReturnType<typeof useStore.getState>) => s.messages['dm:999'] || [];
    const a = badSelector(useStore.getState());
    const b = badSelector(useStore.getState());
    // 两个都是空数组但引用不同 → Zustand 会认为状态变了 → 触发重渲染
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('setMessages 后 selector 返回新数组, 且不再与 EMPTY 相同', () => {
    const EMPTY: never[] = [];
    const selector = (s: ReturnType<typeof useStore.getState>) => s.messages['dm:1'] ?? EMPTY;

    const before = selector(useStore.getState());
    expect(before).toBe(EMPTY);

    useStore.getState().setMessages('dm:1', [{ id: 1, senderId: 1, receiverId: 2, groupId: null, type: 'text', content: 'hi', createdAt: 1 }], false);
    const after = selector(useStore.getState());
    expect(after).not.toBe(EMPTY);
    expect(after).toHaveLength(1);
  });
});
