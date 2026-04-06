import type { ChatResponse, TaskStatus, FinalItinerary, ItinerarySummary, Conversation, ConversationMessage } from './types';

export const API_BASE = '/api';

// ── Backend Config ───────────────────────────────────────────────────────────
export interface BackendConfig {
  auth_enabled: boolean;
}

export async function fetchBackendConfig(): Promise<BackendConfig> {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error(`获取配置失败 (${res.status})`);
  return res.json();
}

// ── Token Management ────────────────────────────────────────────────────────
const TOKEN_KEY = 'openclaw_tokens';

export interface TokenData {
  access_token: string;
  refresh_token: string;
  user_id: string;
  username: string;
}

export function saveTokens(data: TokenData) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
}

export function getTokens(): TokenData | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const tokens = getTokens();
  return tokens ? { 'Authorization': `Bearer ${tokens.access_token}` } : {};
}

export interface ChatAttachmentPayload {
  name: string;
  mime_type: string;
  data_base64: string;
  size_bytes?: number;
}

export async function postChat(
  message: string,
  sessionId: string,
  taskId?: string,
  itineraryContext?: string,
  attachments?: ChatAttachmentPayload[],
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      ...(taskId && { task_id: taskId }),
      ...(itineraryContext && { itinerary_context: itineraryContext }),
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`请求失败 (${res.status}): ${txt}`);
  }
  return res.json();
}

export async function pollStatus(taskId: string): Promise<TaskStatus> {
  const res = await fetch(`${API_BASE}/task/${taskId}/status`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`状态查询失败 (${res.status})`);
  return res.json();
}

export async function fetchResult(taskId: string): Promise<FinalItinerary> {
  const res = await fetch(`${API_BASE}/task/${taskId}/result`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`获取结果失败 (${res.status})`);
  return res.json();
}

export async function fetchTasks(): Promise<ItinerarySummary[]> {
  const res = await fetch(`${API_BASE}/tasks`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`获取历史规划失败 (${res.status})`);
  return res.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/task/${taskId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`删除行程失败 (${res.status})`);
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`获取对话列表失败 (${res.status})`);
  return res.json();
}

export async function createConversation(): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`创建对话失败 (${res.status})`);
  return res.json();
}

export async function fetchConversationMessages(convId: string): Promise<ConversationMessage[]> {
  const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`获取对话消息失败 (${res.status})`);
  const data = await res.json();
  return data.messages ?? [];
}

export async function updateConversationTitle(convId: string, title: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations/${convId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`更新对话标题失败 (${res.status})`);
  return res.json();
}

export async function touchConversation(convId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${convId}/touch`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
}

export async function deleteConversation(convId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/${convId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`删除对话失败 (${res.status})`);
}

export interface WalkingRouteResponse {
  segments: [number, number][][];
  ok: boolean;
}

export async function fetchWalkingRoute(
  waypoints: { lat: number; lng: number; name?: string; location?: string; city?: string }[],
): Promise<WalkingRouteResponse> {
  const res = await fetch(`${API_BASE}/route/walking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ waypoints }),
  });
  if (!res.ok) return { segments: [], ok: false };
  return res.json();
}

// ── Auth API ─────────────────────────────────────────────────────────────────

export interface LoginRequest {
  username: string;  // username or email
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user_id: string;
  username: string;
}

export async function login(body: LoginRequest): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`登录失败 (${res.status}): ${txt}`);
  }
  const data: TokenResponse = await res.json();
  saveTokens(data);
  return data;
}

export async function register(body: RegisterRequest): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`注册失败 (${res.status}): ${txt}`);
  }
  const data: TokenResponse = await res.json();
  saveTokens(data);
  return data;
}

export async function refreshToken(): Promise<TokenResponse> {
  const tokens = getTokens();
  if (!tokens) throw new Error('未登录');
  
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) {
    clearTokens();
    throw new Error(`Token 刷新失败 (${res.status})`);
  }
  const data: TokenResponse = await res.json();
  saveTokens(data);
  return data;
}

export async function fetchUserProfile() {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`获取用户信息失败 (${res.status})`);
  return res.json();
}

export function logout() {
  clearTokens();
}
