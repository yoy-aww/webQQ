export interface PublicUser {
  id: number;
  qqNumber: string;
  nickname: string;
  avatar: string;
  signature: string;
  online: boolean;
  createdAt?: number;
}

export interface FriendEntry {
  id: number;
  status: 'pending' | 'accepted';
  remark: string;
  requestAt: number;
  friendId: number;
  friend: PublicUser;
}

export interface Message {
  id: number;
  senderId: number;
  receiverId: number | null;
  groupId: number | null;
  type: 'text' | 'image' | 'system';
  content: string;
  createdAt: number;
}

export interface GroupInfo {
  id: number;
  groupNumber: string;
  name: string;
  avatar: string;
  ownerId: number;
  memberCount: number;
  createdAt: number;
}

export interface GroupMember extends PublicUser {
  role: 'owner' | 'admin' | 'member';
}

export interface ApiError {
  error: string;
}

export type ChatTarget =
  | { kind: 'dm'; friendId: number; friend: PublicUser }
  | { kind: 'group'; group: GroupInfo };
