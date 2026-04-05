import type { ChatResponse, TaskStatus, FinalItinerary, ItinerarySummary, Conversation, ConversationMessage } from './types';

export const API_BASE = '/api';

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
    headers: { 'Content-Type': 'application/json' },
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
  const res = await fetch(`${API_BASE}/task/${taskId}/status`);
  if (!res.ok) throw new Error(`状态查询失败 (${res.status})`);
  return res.json();
}

export async function fetchResult(taskId: string): Promise<FinalItinerary> {
  const res = await fetch(`${API_BASE}/task/${taskId}/result`);
  if (!res.ok) throw new Error(`获取结果失败 (${res.status})`);
  return res.json();
}

export async function fetchTasks(): Promise<ItinerarySummary[]> {
  const res = await fetch(`${API_BASE}/tasks`);
  if (!res.ok) throw new Error(`获取历史规划失败 (${res.status})`);
  return res.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/task/${taskId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`删除行程失败 (${res.status})`);
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error(`获取对话列表失败 (${res.status})`);
  return res.json();
}

export async function createConversation(): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations`, { method: 'POST' });
  if (!res.ok) throw new Error(`创建对话失败 (${res.status})`);
  return res.json();
}

export async function fetchConversationMessages(convId: string): Promise<ConversationMessage[]> {
  const res = await fetch(`${API_BASE}/conversations/${convId}/messages`);
  if (!res.ok) throw new Error(`获取对话消息失败 (${res.status})`);
  const data = await res.json();
  return data.messages ?? [];
}

export async function updateConversationTitle(convId: string, title: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations/${convId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`更新对话标题失败 (${res.status})`);
  return res.json();
}

export async function touchConversation(convId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${convId}/touch`, { method: 'POST' });
}

export async function deleteConversation(convId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/${convId}`, { method: 'DELETE' });
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints }),
  });
  if (!res.ok) return { segments: [], ok: false };
  return res.json();
}
