import type { ChatResponse, TaskStatus, FinalItinerary, ItinerarySummary } from './types';

export const API_BASE = '/api';

export async function postChat(message: string, sessionId: string, taskId?: string, itineraryContext?: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      ...(taskId && { task_id: taskId }),
      ...(itineraryContext && { itinerary_context: itineraryContext }),
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
