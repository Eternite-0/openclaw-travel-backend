import type { AgentStatus, FinalItinerary } from './types';
import { AGENT_PLACEHOLDERS, PIXABAY_CAT } from './constants';

// ── Agent normalizer ───────────────────────────────────────────────────────

export function normalizeAgents(incoming: AgentStatus[] | undefined, fallback: AgentStatus[]): AgentStatus[] {
  const source = incoming && incoming.length > 0 ? incoming : fallback;
  const byName = new Map(source.map(a => [a.agent_name, a]));
  return AGENT_PLACEHOLDERS.map((placeholder) => byName.get(placeholder.agent_name) ?? placeholder);
}

// ── Date formatting ────────────────────────────────────────────────────────

export function formatDT(dt: string): string {
  try {
    const d = new Date(dt);
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dt; }
}

// ── Itinerary context builder ──────────────────────────────────────────────

export function buildItineraryContext(it: FinalItinerary): string {
  const lines: string[] = [
    `目的地: ${it.intent.dest_city}(${it.intent.dest_country})`,
    `出发地: ${it.intent.origin_city}`,
    `日期: ${it.intent.departure_date} ~ ${it.intent.return_date}，共${it.intent.duration_days}天`,
    `预算: ¥${it.intent.budget_cny}`,
    `航班: ${it.recommended_flight?.airline || ''} ${it.recommended_flight?.flight_number || ''}, ¥${it.recommended_flight?.price_cny || '?'}`,
    `酒店: ${it.recommended_hotel?.name || ''}, ¥${it.recommended_hotel?.price_per_night_cny || '?'}/晚`,
  ];
  if (it.weather?.overall_summary) lines.push(`天气: ${it.weather.overall_summary}`);
  for (const day of it.days) {
    const acts = day.activities.map(a => a.activity).slice(0, 5).join(', ');
    lines.push(`第${day.day_number}天 [${day.theme}]: ${acts}`);
  }
  if (it.highlights?.length) lines.push(`亮点: ${it.highlights.slice(0, 5).join('、')}`);
  return lines.join('\n');
}

// ── Image helpers ──────────────────────────────────────────────────────────

const PIXABAY_KEY = import.meta.env.VITE_PIXABAY_KEY ?? '55288051-01a1c9c852b808f3a1100bfa5';
export const imgCache = new Map<string, string>();
export const loadedCache = new Map<string, boolean>();

export async function fetchPixabayImage(query: string, category: string): Promise<string | null> {
  const cacheKey = `${query}::${category}`;
  if (imgCache.has(cacheKey)) return imgCache.get(cacheKey)!;
  try {
    const cat = PIXABAY_CAT[category] ?? 'travel';
    const url = `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&image_type=photo&category=${cat}&per_page=5&safesearch=true&order=popular`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.hits?.length > 0) {
      const imgUrl: string = data.hits[Math.floor(Math.random() * Math.min(data.hits.length, 3))].webformatURL;
      imgCache.set(cacheKey, imgUrl);
      return imgUrl;
    }
  } catch {}
  return null;
}

export function picsumFallback(seed: string) {
  return `https://picsum.photos/seed/${seed.replace(/\s+/g, '-').toLowerCase()}/400/300`;
}
