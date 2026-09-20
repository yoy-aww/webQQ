import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { App as AntdApp, Modal } from 'antd';
import { Avatar } from './Avatar';
import { api, apiError } from '../api/client';
import { chatKey, useStore } from '../store';
import type { ChatTarget, GroupMember, Message } from '../types';
import dayjs from 'dayjs';

interface Props {
  target: ChatTarget;
  onClose: () => void;
}

// 模块级常量：selector 在没有该 key 的会话时返回同一个空数组引用，
// 避免 Zustand 误判"引用变化"而触发无限重渲染。
const EMPTY_MESSAGES: Message[] = [];

// 群成员角色的配色
const roleStyle: Record<GroupMember['role'], CSSProperties> = {
  owner: { color: '#d48806', fontSize: 11, fontWeight: 600 },
  admin: { color: '#1d6fc4', fontSize: 11, fontWeight: 600 },
  member: { color: '#8a8f99', fontSize: 11 },
};

export function ChatWindow({ target, onClose }: Props) {
  const { message: toast } = AntdApp.useApp();
  const me = useStore((s) => s.me)!;
  const key = chatKey(target);
  // ⚠️ 不要写成 `s.messages[key] || []` —— 每次渲染都返回新数组引用，
  // Zustand 按引用比较会导致无限重渲染 (Maximum update depth exceeded)。
  // 用模块级常量保持引用稳定。
  const messages = useStore((s) => s.messages[key] ?? EMPTY_MESSAGES);
  const hasMore = useStore((s) => s.hasMore[key]);
  const setMessages = useStore((s) => s.setMessages);
  const prependMessages = useStore((s) => s.prependMessages);
  const clearUnread = useStore((s) => s.clearUnread);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [memberCount] = useState(target.kind === 'group' ? target.group.memberCount : 0);
  const [nicknameMap, setNicknameMap] = useState<Record<number, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 加载历史（打开会话时）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res =
          target.kind === 'dm'
            ? await api.dmHistory(target.friendId)
            : await api.groupHistory(target.group.id);
        if (cancelled) return;
        setMessages(key, res.messages, res.hasMore);
        clearUnread(key);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 群聊：拉取成员昵称映射，用于消息里显示昵称而非"用户 {id}"
  const groupId = target.kind === 'group' ? target.group.id : 0;
  useEffect(() => {
    if (groupId === 0) return;
    let cancelled = false;
    api
      .groupMembers(groupId)
      .then((r) => {
        if (cancelled) return;
        const map: Record<number, string> = {};
        r.members.forEach((m) => {
          map[m.id] = m.nickname;
        });
        setNicknameMap(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // 新消息滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.length]);

  const title = target.kind === 'dm' ? target.friend.nickname : target.group.name;
  const signature = target.kind === 'dm' ? target.friend.signature : `${memberCount} 人 · 群号 ${target.group.groupNumber}`;

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const res =
        target.kind === 'dm'
          ? await sendViaSocket(target.friendId, content)
          : await sendGroupViaSocket(target.group.id, content);
      if (!res.ok) toast.error(res.error || '发送失败');
    } finally {
      setText('');
      setSending(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const oldest = messages[0];
    setLoadingMore(true);
    try {
      const res =
        target.kind === 'dm'
          ? await api.dmHistory(target.friendId, oldest.id)
          : await api.groupHistory(target.group.id, oldest.id);
      prependMessages(key, res.messages, res.hasMore);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoadingMore(false);
    }
  };

  // 图片上传并作为消息发送
  const handleImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('只能发送图片');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('图片不能超过 2MB');
      return;
    }
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const up = await api.uploadImage(String(reader.result));
          const res =
            target.kind === 'dm'
              ? await sendViaSocket(target.friendId, up.url, 'image')
              : await sendGroupViaSocket(target.group.id, up.url, 'image');
          if (!res.ok) toast.error(res.error || '图片发送失败');
        } catch (e) {
          toast.error(apiError(e));
        }
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error('图片读取失败');
    }
  };

  return (
    <div className="chat-window">
      <div className="chat-titlebar">
        <div className="left">
          <Avatar
            src={target.kind === 'dm' ? target.friend.avatar : target.group.avatar}
            name={title}
            size={36}
            online={target.kind === 'dm' ? target.friend.online : undefined}
            square={target.kind === 'group'}
          />
          <div>
            <div className="name">{title}</div>
            <div className="sig">{signature}</div>
          </div>
        </div>
        <div className="actions">
          {target.kind === 'group' && <GroupMembersDrawer groupId={target.group.id} />}
          <button onClick={onClose} title="关闭会话">✕</button>
        </div>
      </div>

      <div className="msg-scroll" ref={scrollRef}>
        {hasMore && messages.length > 0 && (
          <div className="load-more">
            <button onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '加载中…' : '↑ 加载更多历史消息'}
            </button>
          </div>
        )}
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            msg={m}
            meId={me.id}
            nickname={nicknameMap[m.senderId]}
            selfNickname={me.nickname}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImage(f);
            e.target.value = '';
          }}
        />
        <button
          style={{ height: 44, padding: '0 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#8a8f99' }}
          onClick={() => fileRef.current?.click()}
          title="发送图片"
        >
          🖼
        </button>
        <textarea
          value={text}
          placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
        />
        <button className="send-btn" onClick={send} disabled={sending || !text.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}

// 群成员列表
export function GroupMembersDrawer({ groupId }: { groupId: number }) {
  const { message: toast } = AntdApp.useApp();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const me = useStore((s) => s.me)!;

  useEffect(() => {
    if (!open) return;
    api.groupMembers(groupId)
      .then((r) => setMembers(r.members))
      .catch((e) => toast.error(apiError(e)));
  }, [open, groupId]);

  const roleBadge = (role: GroupMember['role']): string =>
    role === 'owner' ? '👑 群主' : role === 'admin' ? '✋ 管理员' : '成员';

  return (
    <>
      <button
        style={{ height: 30, padding: '0 12px', fontSize: 13 }}
        onClick={() => setOpen(true)}
      >
        👥 群成员
      </button>
      <Modal
        title={`群成员（${members.length} 人）`}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="380px"
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '8px 0' }}>
          {members.map((m) => (
            <div key={m.id} style={{ width: 88, textAlign: 'center' }}>
              <Avatar src={m.avatar} name={m.nickname} size={48} online={m.online} />
              <div
                style={{
                  fontSize: 12,
                  marginTop: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.id === me.id ? m.nickname + '（我）' : m.nickname}
              </div>
              <div style={roleStyle[m.role]}>{roleBadge(m.role)}</div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

function MessageRow({
  msg,
  meId,
  nickname,
  selfNickname,
}: {
  msg: Message;
  meId: number;
  nickname?: string;
  selfNickname?: string;
}) {
  if (msg.type === 'system') {
    return (
      <div className="msg system">
        <span className="sys">{msg.content}</span>
      </div>
    );
  }
  const self = msg.senderId === meId;
  // 对方昵称：群聊从 nicknameMap 取；单聊/未知回退到"用户 {id}"
  const peerName = self ? selfNickname : (nickname || `用户 ${msg.senderId}`);
  return (
    <div className={self ? 'msg self' : 'msg'}>
      <Avatar name={peerName || '?'} size={34} />
      <div className="body">
        {!self && <div className="who">{peerName}</div>}
        <div className="bubble">
          {msg.type === 'image' ? (
            <img src={msg.content} alt="图片" />
          ) : (
            msg.content
          )}
        </div>
        <div className="who" style={self ? { textAlign: 'right' } : undefined}>
          {dayjs(msg.createdAt).format('HH:mm')}
        </div>
      </div>
    </div>
  );
}

// ---- socket 发送封装（放在此文件避免循环引用） ----
import { sendDm, sendGroup } from '../socket';

async function sendViaSocket(to: number, content: string, type: 'text' | 'image' = 'text') {
  return sendDm(to, content, type);
}

async function sendGroupViaSocket(groupId: number, content: string, type: 'text' | 'image' = 'text') {
  return sendGroup(groupId, content, type);
}
