import { useEffect, useRef, useState } from 'react';
import { Modal, Input, message } from 'antd';
import { Avatar } from '../components/Avatar';
import { FriendList } from '../components/FriendList';
import { GroupList } from '../components/GroupList';
import { ChatWindow } from '../components/ChatWindow';
import { api, apiError } from '../api/client';
import { useStore } from '../store';
import { disconnectSocket, onDm, onGroup, connectSocket, joinGroupRoom } from '../socket';
import type { ChatTarget } from '../types';

type Tab = 'friends' | 'groups';

export function MainPanel() {
  const me = useStore((s) => s.me)!;
  const token = useStore((s) => s.token)!;
  const friends = useStore((s) => s.friends);
  const groups = useStore((s) => s.groups);
  const active = useStore((s) => s.active);
  const setFriends = useStore((s) => s.setFriends);
  const setGroups = useStore((s) => s.setGroups);
  const openChat = useStore((s) => s.openChat);
  const closeChat = useStore((s) => s.closeChat);
  const appendMessage = useStore((s) => s.appendMessage);
  const [tab, setTab] = useState<Tab>('friends');
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinNumber, setJoinNumber] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [connected, setConnected] = useState(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const meRef = useRef(me);
  meRef.current = me;

  // 初始化：连 socket + 拉数据
  useEffect(() => {
    connectSocket(token);
    let cancelled = false;
    (async () => {
      try {
        const [f, g] = await Promise.all([api.friends(), api.groups()]);
        if (cancelled) return;
        setFriends(f.friends);
        setGroups(g.groups);
      } catch (e) {
        if (!cancelled) message.error(apiError(e));
      }
    })();

    const offDm = onDm((msg) => {
      const mine = msg.senderId === meRef.current.id;
      const peer = mine ? msg.receiverId : msg.senderId;
      if (peer == null) return;
      const key = `dm:${peer}`;
      const st = useStore.getState();
      appendMessage(key, msg);
      if (st.active && st.active.kind === 'dm' && st.active.friendId === peer) {
        st.clearUnread(key);
      } else if (!st.messages[key]) {
        // 对方发了新消息但还没打开过会话 → 记未读
        st.markUnread(key);
      }
    });

    const offGroup = onGroup((msg) => {
      if (!msg.groupId) return;
      const key = `group:${msg.groupId}`;
      appendMessage(key, msg);
      const st = useStore.getState();
      if (st.active && st.active.kind === 'group' && st.active.group.id === msg.groupId) {
        st.clearUnread(key);
      } else {
        st.markUnread(key);
      }
    });

    // 好友上下线 → 刷新列表快照
    const onStatus = () => {
      api.friends().then((r) => setFriends(r.friends)).catch(() => undefined);
    };
    window.addEventListener('webqq:friend-status', onStatus);

    // 收到好友申请 → toast 提示 + 刷新好友列表
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent).detail as { nickname: string } | undefined;
      message.info(`${detail?.nickname || '有人'} 申请加你为好友`);
      api.friends().then((r) => setFriends(r.friends)).catch(() => undefined);
    };
    window.addEventListener('webqq:friend-request', onRequest);

    // 连接状态变化 → 顶部 banner 提示
    const onSocketStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail as { connected: boolean };
      setConnected(detail.connected);
    };
    window.addEventListener('webqq:socket-status', onSocketStatus);

    return () => {
      cancelled = true;
      offDm();
      offGroup();
      window.removeEventListener('webqq:friend-status', onStatus);
      window.removeEventListener('webqq:friend-request', onRequest);
      window.removeEventListener('webqq:socket-status', onSocketStatus);
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 浏览器标签页显示未读总数
  const unreadTotal = useStore(
    (s) => Object.values(s.unread).reduce((a, b) => a + b, 0)
  );
  useEffect(() => {
    document.title = unreadTotal > 0 ? `（${unreadTotal}）WebQQ` : 'WebQQ';
  }, [unreadTotal]);

  const open = (t: ChatTarget) => {
    if (t.kind === 'group') joinGroupRoom(t.group.id);
    openChat(t);
    setTab(t.kind === 'group' ? 'groups' : 'friends');
  };

  const doJoin = async () => {
    const num = joinNumber.trim();
    if (!num) return;
    try {
      const res = await api.joinGroup(Number(num));
      if (!res.group) {
        message.error('未找到该群号');
        return;
      }
      message.success('已加入群聊');
      setJoinOpen(false);
      setJoinNumber('');
      setGroups(await (await api.groups()).groups);
      open({ kind: 'group', group: res.group });
    } catch (e) {
      message.error(apiError(e));
    }
  };

  return (
    <div className="main-shell">
      {!connected && (
        <div className="offline-banner">
          ⚠ 网络连接已断开，正在重新连接…
        </div>
      )}
      <aside className="side-panel">
        <div className="side-header">
          <Avatar src={me.avatar} name={me.nickname} size={40} />
          <div className="me-info">
            <div className="me-title">{me.nickname}</div>
            <div className="me-sub">QQ {me.qqNumber}</div>
          </div>
          <button style={iconBtn} title="编辑资料" onClick={() => setEditOpen(true)}>
            ⚙
          </button>
          <button style={iconBtn} title="退出登录" onClick={() => { disconnectSocket(); useStore.getState().logout(); }}>
            ⎋
          </button>
        </div>

        <div className="side-tabs">
          <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>
            好友
          </button>
          <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
            群聊
          </button>
        </div>

        {tab === 'friends' ? <FriendList onOpen={open} /> : <GroupList onOpen={open} />}

        <div className="side-footer">
          <span>{friends.filter((f) => f.status === 'accepted').length} 好友 · {groups.length} 群</span>
          <button style={tinyBtn} onClick={() => setJoinOpen(true)}>按群号加群</button>
        </div>
      </aside>

      <main className="chat-shell">
        {active ? (
          <ChatWindow
            target={active}
            onClose={closeChat}
          />
        ) : (
          <div className="empty-state">
            <div className="big">💬</div>
            <div className="txt">选择左侧好友或群聊开始聊天</div>
            <div style={{ fontSize: 12, color: '#c2c6cc' }}>
              支持文字 / 图片消息 · 消息记录云端保存 · 多标签页同步
            </div>
          </div>
        )}
      </main>

      <Modal
        title="按群号加群"
        open={joinOpen}
        onCancel={() => setJoinOpen(false)}
        onOk={doJoin}
        okText="加入"
        width="340px"
      >
        <Input
          placeholder="输入群号，如 1"
          value={joinNumber}
          onChange={(e) => setJoinNumber(e.target.value)}
          onPressEnter={doJoin}
          autoFocus
        />
      </Modal>

      <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}

// 编辑资料弹窗
function EditProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const updateMe = useStore((s) => s.updateMe);
  const [nickname, setNickname] = useState(me.nickname);
  const [signature, setSignature] = useState(me.signature);
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState('');

  useEffect(() => {
    if (open) {
      setNickname(me.nickname);
      setSignature(me.signature);
      setImg('');
    }
  }, [open, me]);

  const submit = async () => {
    if (nickname.trim().length < 2) return message.error('昵称至少 2 个字符');
    setBusy(true);
    try {
      let avatar = me.avatar;
      if (img) {
        const up = await api.uploadImage(img);
        avatar = up.url;
      }
      const res = await api.updateMe({ nickname: nickname.trim(), signature: signature.trim(), avatar });
      updateMe(res.user);
      message.success('已更新');
      onClose();
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="编辑资料"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="保存"
      confirmLoading={busy}
      width="380px"
    >
      <div style={profileStyle.row}>
        <Avatar src={img || me.avatar} name={nickname || me.nickname} size={56} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: '#8a8f99' }}>QQ 号：{me.qqNumber}（不可修改）</div>
          <input
            style={{ marginTop: 8, width: '100%', height: 30, border: '1px solid #e2e5e9', borderRadius: 4, padding: '0 8px', fontSize: 13 }}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            placeholder="昵称"
          />
          <input
            style={{ marginTop: 8, width: '100%', height: 30, border: '1px solid #e2e5e9', borderRadius: 4, padding: '0 8px', fontSize: 13 }}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            maxLength={60}
            placeholder="个性签名"
          />
          <input
            type="file"
            accept="image/*"
            style={{ marginTop: 8, fontSize: 12 }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (!f.type.startsWith('image/')) return message.error('只能选择图片');
              if (f.size > 2 * 1024 * 1024) return message.error('图片不能超过 2MB');
              const r = new FileReader();
              r.onload = () => setImg(String(r.result));
              r.readAsDataURL(f);
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

const iconBtn: React.CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: '#8a8f99',
  fontSize: 16,
  padding: 4,
};

const tinyBtn: React.CSSProperties = {
  height: 24,
  padding: '0 10px',
  fontSize: 12,
  border: '1px solid #4aa8f0',
  borderRadius: 12,
  background: '#fff',
  color: '#1d6fc4',
  cursor: 'pointer',
};

const profileStyle = {
  row: { display: 'flex', gap: 14, alignItems: 'center' } satisfies React.CSSProperties,
};
