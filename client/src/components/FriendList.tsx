import { useMemo, useState } from 'react';
import { App as AntdApp, Modal, Input } from 'antd';
import { Avatar } from './Avatar';
import { api, apiError } from '../api/client';
import { chatKey, useStore } from '../store';
import type { FriendEntry, PublicUser } from '../types';
import dayjs from 'dayjs';

interface Props {
  onOpen: (target: { kind: 'dm'; friendId: number; friend: PublicUser }) => void;
}

/** 会话列表项：展示头像、昵称、最后一条消息、时间、未读数 */
function SessionItem({ item, unread, active, onClick }: {
  item: FriendEntry;
  unread: number;
  active: boolean;
  onClick: () => void;
}) {
  const { friend } = item;
  const isPending = item.status !== 'accepted';
  return (
    <div className={active ? 'chat-item active' : 'chat-item'} onClick={onClick}>
      <Avatar src={friend.avatar} name={friend.nickname} online={friend.online} />
      <div className="meta">
        <div className="title">{friend.nickname}</div>
        <div className="sub">{isPending ? '待确认的好友申请' : friend.signature || friend.qqNumber}</div>
      </div>
      <div className="right">
        <span className="time">{dayjs(item.requestAt).format('MM-DD')}</span>
        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      </div>
    </div>
  );
}

export function FriendList({ onOpen }: Props) {
  const { message: toast } = AntdApp.useApp();
  const friends = useStore((s) => s.friends);
  const unread = useStore((s) => s.unread);
  const active = useStore((s) => s.active);
  const setFriends = useStore((s) => s.setFriends);
  const [keyword, setKeyword] = useState('');
  const [searchResult, setSearchResult] = useState<{ user: PublicUser | null; relation: string | null } | null>(null);

  const pending = friends.filter((f) => f.status !== 'accepted');
  const accepted = friends.filter((f) => f.status === 'accepted');

  const filtered = useMemo(() => {
    if (!keyword.trim()) return accepted;
    const kw = keyword.trim().toLowerCase();
    return accepted.filter(
      (f) =>
        f.friend.nickname.toLowerCase().includes(kw) ||
        f.friend.qqNumber.includes(kw) ||
        (f.remark && f.remark.toLowerCase().includes(kw))
    );
  }, [accepted, keyword]);

  const doSearch = async () => {
    if (!keyword.trim()) {
      setSearchResult(null);
      return;
    }
    try {
      setSearchResult(await api.friendSearch(keyword.trim()));
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const open = (f: FriendEntry) => {
    setSearchResult(null);
    setKeyword('');
    onOpen({ kind: 'dm', friendId: f.friend.id, friend: f.friend });
  };

  const accept = async (f: FriendEntry) => {
    try {
      await api.acceptFriend(f.friend.id);
      toast.success('已添加好友');
      setFriends(await (await api.friends()).friends);
      onOpen({ kind: 'dm', friendId: f.friend.id, friend: f.friend });
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const reject = async (f: FriendEntry) => {
    try {
      await api.rejectFriend(f.friend.id);
      toast.success('已拒绝');
      setFriends((await api.friends()).friends);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const addStranger = async () => {
    const u = searchResult?.user;
    if (!u) return;
    try {
      await api.sendFriendRequest(u.qqNumber);
      toast.success('好友申请已发送');
      setFriends((await api.friends()).friends);
      setKeyword('');
      setSearchResult(null);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <>
      <div className="search-bar">
        <Input.Search
          placeholder="搜索好友 / QQ 号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={doSearch}
          allowClear
          enterButton="查找"
          size="small"
        />
      </div>

      {searchResult && (
        <Modal
          title="查找用户"
          open
          onCancel={() => setSearchResult(null)}
          footer={null}
          width="380px"
        >
          {searchResult.user ? (
            <div style={searchStyle}>
              <Avatar src={searchResult.user.avatar} name={searchResult.user.nickname} online={searchResult.user.online} size={56} />
              <div style={{ marginLeft: 14, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {searchResult.user.nickname}
                  {searchResult.relation === 'accepted' && (
                    <span style={{ color: '#8a8f99', fontSize: 12, marginLeft: 6 }}>已为好友</span>
                  )}
                </div>
                <div style={{ color: '#8a8f99', fontSize: 13 }}>QQ 号：{searchResult.user.qqNumber}</div>
                {searchResult.user.signature && (
                  <div style={{ color: '#8a8f99', fontSize: 12 }}>签名：{searchResult.user.signature}</div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: '#8a8f99', padding: '20px 0', textAlign: 'center' }}>未找到相关用户</div>
          )}
          {searchResult.user && searchResult.relation !== 'accepted' && (
            <button style={{ marginTop: 18, width: '100%' }} onClick={addStranger}>
              添加为好友
            </button>
          )}
        </Modal>
      )}

      <div className="friend-list">
        {pending.length > 0 && (
          <>
            <div className="section-title">好友请求（{pending.length}）</div>
            {pending.map((f) => (
              <div key={f.id} className="chat-item">
                <Avatar src={f.friend.avatar} name={f.friend.nickname} size={34} />
                <div className="meta">
                  <div className="title">{f.friend.nickname}</div>
                  <div className="sub">申请加你为好友</div>
                </div>
                <button style={tinyBtn} onClick={() => accept(f)}>接受</button>
                <button style={{ ...tinyBtn, color: '#8a8f99' }} onClick={() => reject(f)}>拒绝</button>
              </div>
            ))}
          </>
        )}

        <div className="section-title">我的好友（{accepted.length}）</div>
        {filtered.length === 0 && (
          <div className="empty-mini">
            {keyword ? '没有匹配的好友' : '还没有好友，在搜索框输入 QQ 号查找并添加'}
          </div>
        )}
        {filtered.map((f) => (
          <SessionItem
            key={f.id}
            item={f}
            unread={unread[chatKey({ kind: 'dm', friendId: f.friend.id })] || 0}
            active={!!(active && active.kind === 'dm' && active.friendId === f.friend.id)}
            onClick={() => open(f)}
          />
        ))}
      </div>
    </>
  );
}

const searchStyle: React.CSSProperties = { display: 'flex', alignItems: 'center' };
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
