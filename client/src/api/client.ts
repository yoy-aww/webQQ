import axios from 'axios';
import type {
  FriendEntry,
  GroupInfo,
  GroupMember,
  Message,
  PublicUser,
} from '../types';

export const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('webqq_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('webqq_token');
      localStorage.removeItem('webqq_user');
      if (location.pathname !== '/login') location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { error?: string } | undefined)?.error || e.message;
  }
  return e instanceof Error ? e.message : '请求失败';
}

const unwrap = async <T>(p: Promise<{ data: T }>): Promise<T> => (await p).data;

export const api = {
  login: (account: string, password: string) =>
    unwrap(http.post<{ token: string; user: PublicUser }>('/auth/login', { account, password })),
  register: (nickname: string, password: string) =>
    unwrap(
      http.post<{ token: string; user: PublicUser }>('/auth/register', { nickname, password })
    ),

  me: () => unwrap(http.get<{ user: PublicUser }>('/users/me')),
  updateMe: (patch: { nickname?: string; signature?: string; avatar?: string }) =>
    unwrap(http.patch<{ user: PublicUser }>('/users/me', patch)),
  searchUser: (qq: string) =>
    unwrap(http.get<{ users: PublicUser[] }>('/users/search', { params: { qq } })),

  friends: () => unwrap(http.get<{ friends: FriendEntry[] }>('/friends')),
  friendSearch: (qq: string) =>
    unwrap(http.get<{ user: PublicUser | null; relation: string | null }>('/friends/search', { params: { qq } })),
  sendFriendRequest: (qqNumber: string) =>
    unwrap(http.post<{ status: string }>('/friends/request', { qqNumber })),
  acceptFriend: (friendId: number) =>
    unwrap(http.post<{ status: string }>('/friends/accept', { friendId })),
  rejectFriend: (friendId: number) =>
    unwrap(http.post<{ status: string }>('/friends/reject', { friendId })),
  deleteFriend: (friendId: number) =>
    unwrap(http.delete<{ ok: boolean }>('/friends/' + friendId)),
  setRemark: (friendId: number, remark: string) =>
    unwrap(http.patch<{ ok: boolean }>('/friends/remark', { friendId, remark })),

  dmHistory: (friendId: number, before?: number) =>
    unwrap(
      http.get<{ messages: Message[]; hasMore: boolean }>(`/messages/dm/${friendId}`, {
        params: { before },
      })
    ),
  groupHistory: (groupId: number, before?: number) =>
    unwrap(
      http.get<{ messages: Message[]; hasMore: boolean }>(`/messages/group/${groupId}`, {
        params: { before },
      })
    ),
  uploadImage: (base64: string) => unwrap(http.post<{ url: string }>('/messages/upload', { image: base64 })),

  groups: () => unwrap(http.get<{ groups: GroupInfo[] }>('/groups')),
  createGroup: (name: string) => unwrap(http.post<{ group: GroupInfo }>('/groups', { name })),
  joinGroup: (groupId: number) => unwrap(http.post<{ ok: boolean; group: GroupInfo }>('/groups/' + groupId + '/join')),
  groupMembers: (groupId: number) =>
    unwrap(http.get<{ members: GroupMember[] }>(`/groups/${groupId}/members`)),
};
