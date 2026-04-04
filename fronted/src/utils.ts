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
const requestCache = new Map<string, Promise<string | null>>();
const preloadCache = new Map<string, Promise<void>>();

export function buildImageQuery(activity: string, location: string): string {
  return [activity, location].filter(Boolean).join(' ').slice(0, 80);
}

export function buildImageCacheKey(activity: string, location: string, category: string): string {
  return `${buildImageQuery(activity, location)}::${category}`;
}

export async function fetchPixabayImage(query: string, category: string): Promise<string | null> {
  const cacheKey = `${query}::${category}`;
  if (imgCache.has(cacheKey)) return imgCache.get(cacheKey)!;
  if (requestCache.has(cacheKey)) return requestCache.get(cacheKey)!;

  const pending = (async () => {
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
  })();

  requestCache.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    requestCache.delete(cacheKey);
  }
}

function preloadImage(cacheKey: string, url: string): Promise<void> {
  if (loadedCache.get(cacheKey)) return Promise.resolve();
  const preloadKey = `${cacheKey}::${url}`;
  if (preloadCache.has(preloadKey)) return preloadCache.get(preloadKey)!;

  const pending = new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => {
      loadedCache.set(cacheKey, true);
      resolve();
    };
    image.onerror = () => resolve();
    image.src = url;
    if (image.complete) {
      loadedCache.set(cacheKey, true);
      resolve();
    }
  });

  preloadCache.set(preloadKey, pending);
  pending.finally(() => preloadCache.delete(preloadKey));
  return pending;
}

export async function prefetchPixabayImage(activity: string, location: string, category: string): Promise<string | null> {
  const query = buildImageQuery(activity, location);
  const cacheKey = `${query}::${category}`;
  const url = await fetchPixabayImage(query, category);
  if (!url) return null;
  await preloadImage(cacheKey, url);
  return url;
}

export function picsumFallback(seed: string) {
  return `https://picsum.photos/seed/${seed.replace(/\s+/g, '-').toLowerCase()}/400/300`;
}
