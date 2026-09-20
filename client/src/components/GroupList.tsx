import { useMemo, useState } from 'react';
import { App as AntdApp, Modal, Input } from 'antd';
import { Avatar } from './Avatar';
import { api, apiError } from '../api/client';
import { chatKey, useStore } from '../store';
import type { GroupInfo } from '../types';
import dayjs from 'dayjs';

interface Props {
  onOpen: (target: { kind: 'group'; group: GroupInfo }) => void;
}

export function GroupList({ onOpen }: Props) {
  const { message: toast } = AntdApp.useApp();
  const groups = useStore((s) => s.groups);
  const unread = useStore((s) => s.unread);
  const active = useStore((s) => s.active);
  const setGroups = useStore((s) => s.setGroups);
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!keyword.trim()) return groups;
    const kw = keyword.trim().toLowerCase();
    return groups.filter(
      (g) => g.name.toLowerCase().includes(kw) || g.groupNumber.includes(kw)
    );
  }, [groups, keyword]);

  const createGroup = async () => {
    const name = newName.trim();
    if (name.length < 1 || name.length > 20) {
      toast.error('群名需在 1-20 字符之间');
      return;
    }
    setBusy(true);
    try {
      const res = await api.createGroup(name);
      toast.success('建群成功，群号 ' + res.group.groupNumber);
      setCreateOpen(false);
      setNewName('');
      setGroups(await (await api.groups()).groups);
      onOpen({ kind: 'group', group: res.group });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="search-bar">
        <Input.Search
          placeholder="搜索群名称 / 群号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => undefined}
          allowClear
          enterButton="查找"
          size="small"
        />
        <button
          style={{ width: '100%', height: 30, marginTop: 8, fontSize: 13 }}
          onClick={() => setCreateOpen(true)}
        >
          + 创建新群
        </button>
      </div>

      <Modal
        title="创建群聊"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={createGroup}
        okText="创建"
        confirmLoading={busy}
        width="360px"
      >
        <Input
          placeholder="群名称（1-20 字符）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={20}
          autoFocus
          onPressEnter={createGroup}
        />
        <div style={{ color: '#8a8f99', fontSize: 12, marginTop: 8 }}>
          创建后将分配一个群号，可通过「按群号加群」邀请好友加入
        </div>
      </Modal>

      <div className="friend-list">
        {filtered.length === 0 && (
          <div className="empty-mini">{keyword ? '没有匹配的群' : '还没有群聊，点击上方「创建新群」'}</div>
        )}
        {filtered.map((g) => {
          const key = chatKey({ kind: 'group', group: g });
          const u = unread[key] || 0;
          const isActive = active && active.kind === 'group' && active.group.id === g.id;
          return (
            <div key={g.id} className={isActive ? 'chat-item active' : 'chat-item'} onClick={() => onOpen({ kind: 'group', group: g })}>
              <Avatar src={g.avatar} name={g.name} size={36} square />
              <div className="meta">
                <div className="title">{g.name}</div>
                <div className="sub">{g.memberCount} 人 · 群号 {g.groupNumber}</div>
              </div>
              <div className="right">
                <span className="time">{dayjs(g.createdAt).format('MM-DD')}</span>
                {u > 0 && <span className="badge">{u > 99 ? '99+' : u}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
