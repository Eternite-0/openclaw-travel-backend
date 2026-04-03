import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import avatarImg from '../images/avatar.jpg';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, Settings, Map as MapIcon, History, PlusCircle, UserCog,
  Share, MapPin, Sun, ThumbsUp, Train, Hotel, Clock, Wallet,
  Mountain, Network, Plus, Send, User, Bot, Umbrella, Users, ArrowUp,
  Loader2, CheckCircle2, CircleDashed, XCircle, CalendarDays, Plane, ChevronRight,
  Sparkles, Banknote, Calculator, Compass, CloudSun, Route, X, MessageSquare,
  Mic, SlidersHorizontal, Search, FileText, type LucideIcon,
} from 'lucide-react';

// ── API Types ──────────────────────────────────────────────────────────────

interface AgentStatus {
  agent_name: string;
  display_name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  started_at: string | null;
  finished_at: string | null;
  message: string;
  result_summary: string;
}

interface TaskStatus {
  task_id: string;
  session_id: string;
  overall_status: 'pending' | 'running' | 'done' | 'error';
  progress_pct: number;
  agents: AgentStatus[];
  created_at: string;
  updated_at: string;
}

interface ChatResponse {
  task_id: string | null;
  session_id: string;
  message: string;
  status_poll_url: string | null;
  result_url: string | null;
  response_type: 'quick' | 'pipeline';
  quick_reply: string | null;
}

interface FlightOption {
  airline: string;
  flight_number: string;
  departure_time: string;
  arrival_time: string;
  duration_hours: number;
  price_cny: number;
  stops: number;
  booking_tip: string;
}

interface HotelOption {
  name: string;
  stars: number;
  area: string;
  price_per_night_cny: number;
  total_price_cny: number;
  highlights: string[];
  booking_tip: string;
}

interface ItineraryActivity {
  time: string;
  duration_minutes: number;
  activity: string;
  location: string;
  category: string;
  estimated_cost_cny: number;
  tips: string;
}

interface ItineraryDay {
  day_number: number;
  date: string;
  theme: string;
  weather_summary: string;
  activities: ItineraryActivity[];
  meals: Record<string, string>;
  transport_notes: string;
  daily_budget_cny: number;
}

interface DayWeather {
  date: string;
  condition: string;
  temp_high_c: number;
  temp_low_c: number;
  precipitation_mm: number;
  clothing_advice: string;
}

interface TravelIntent {
  origin_city: string;
  dest_city: string;
  dest_country: string;
  departure_date: string;
  return_date: string;
  duration_days: number;
  budget_cny: number;
  travelers: number;
  travel_style: string;
}

interface ItinerarySummary {
  task_id: string;
  session_id: string;
  created_at: string;
  origin_city: string;
  dest_city: string;
  duration_days: number;
  budget_cny: number;
  status: string;
}

interface FinalItinerary {
  task_id: string;
  session_id: string;
  intent: TravelIntent;
  budget: { total_cny: number; flight_cny: number; accommodation_cny: number; food_cny: number };
  recommended_flight: FlightOption;
  recommended_hotel: HotelOption;
  weather: { daily: DayWeather[]; overall_summary: string; packing_suggestions: string[] };
  highlights: string[];
  days: ItineraryDay[];
  total_estimated_cost_cny: number;
  travel_tips: string[];
}

// Placeholder agent names shown while waiting for first poll
const AGENT_PLACEHOLDERS: AgentStatus[] = [
  { agent_name: 'intent_parser', display_name: '意图解析', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'currency_agent', display_name: '汇率分析', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'budget_agent', display_name: '预算规划', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'flight_agent', display_name: '航班查询', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'hotel_agent', display_name: '酒店推荐', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'attraction_agent', display_name: '景点规划', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'weather_agent', display_name: '天气预报', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'itinerary_agent', display_name: '行程生成', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
];

function normalizeAgents(incoming: AgentStatus[] | undefined, fallback: AgentStatus[]): AgentStatus[] {
  const source = incoming && incoming.length > 0 ? incoming : fallback;
  const byName = new Map(source.map(a => [a.agent_name, a]));
  return AGENT_PLACEHOLDERS.map((placeholder) => byName.get(placeholder.agent_name) ?? placeholder);
}

const AGENT_STYLE: Record<string, { icon: LucideIcon; color: string; bg: string; activeBg: string }> = {
  intent_parser:    { icon: Sparkles,   color: 'text-indigo-500', bg: 'bg-indigo-50',  activeBg: 'bg-indigo-100' },
  currency_agent:   { icon: Banknote,   color: 'text-amber-500',  bg: 'bg-amber-50',   activeBg: 'bg-amber-100' },
  budget_agent:     { icon: Calculator,  color: 'text-emerald-500', bg: 'bg-emerald-50', activeBg: 'bg-emerald-100' },
  flight_agent:     { icon: Plane,      color: 'text-sky-500',    bg: 'bg-sky-50',     activeBg: 'bg-sky-100' },
  hotel_agent:      { icon: Hotel,      color: 'text-rose-500',   bg: 'bg-rose-50',    activeBg: 'bg-rose-100' },
  attraction_agent: { icon: Compass,    color: 'text-violet-500', bg: 'bg-violet-50',  activeBg: 'bg-violet-100' },
  weather_agent:    { icon: CloudSun,   color: 'text-orange-500', bg: 'bg-orange-50',  activeBg: 'bg-orange-100' },
  itinerary_agent:  { icon: Route,      color: 'text-teal-500',   bg: 'bg-teal-50',    activeBg: 'bg-teal-100' },
};

// ── API Functions ──────────────────────────────────────────────────────────

const API_BASE = '/api';

async function postChat(message: string, sessionId: string, taskId?: string, itineraryContext?: string): Promise<ChatResponse> {
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

function buildItineraryContext(it: FinalItinerary): string {
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

async function pollStatus(taskId: string): Promise<TaskStatus> {
  const res = await fetch(`${API_BASE}/task/${taskId}/status`);
  if (!res.ok) throw new Error(`状态查询失败 (${res.status})`);
  return res.json();
}

async function fetchResult(taskId: string): Promise<FinalItinerary> {
  const res = await fetch(`${API_BASE}/task/${taskId}/result`);
  if (!res.ok) throw new Error(`获取结果失败 (${res.status})`);
  return res.json();
}

async function fetchTasks(): Promise<ItinerarySummary[]> {
  const res = await fetch(`${API_BASE}/tasks`);
  if (!res.ok) throw new Error(`获取历史规划失败 (${res.status})`);
  return res.json();
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PIXABAY_KEY = import.meta.env.VITE_PIXABAY_KEY ?? '55288051-01a1c9c852b808f3a1100bfa5';
const _imgCache = new Map<string, string>();
const _loadedCache = new Map<string, boolean>();

const PIXABAY_CAT: Record<string, string> = {
  landmark: 'travel',
  museum: 'buildings',
  nature: 'nature',
  entertainment: 'travel',
  food: 'food',
  transport: 'transportation',
};

async function fetchPixabayImage(query: string, category: string): Promise<string | null> {
  const cacheKey = `${query}::${category}`;
  if (_imgCache.has(cacheKey)) return _imgCache.get(cacheKey)!;
  try {
    const cat = PIXABAY_CAT[category] ?? 'travel';
    const url = `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&image_type=photo&category=${cat}&per_page=5&safesearch=true&order=popular`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.hits?.length > 0) {
      const imgUrl: string = data.hits[Math.floor(Math.random() * Math.min(data.hits.length, 3))].webformatURL;
      _imgCache.set(cacheKey, imgUrl);
      return imgUrl;
    }
  } catch {}
  return null;
}

function picsumFallback(seed: string) {
  return `https://picsum.photos/seed/${seed.replace(/\s+/g, '-').toLowerCase()}/400/300`;
}

function ActivityImage({
  activity, location, category, destCountry, sig,
}: { activity: string; location: string; category: string; destCountry: string; sig: number }) {
  const cacheKey = `${[activity, location].filter(Boolean).join(' ').slice(0, 80)}::${category}`;
  const fallback = picsumFallback(`${destCountry}-${category}-${sig}`);
  const [src, setSrc] = useState<string>(() => _imgCache.get(cacheKey) ?? fallback);
  const [loaded, setLoaded] = useState<boolean>(() => _loadedCache.get(cacheKey) ?? false);

  useEffect(() => {
    if (_imgCache.has(cacheKey)) { setSrc(_imgCache.get(cacheKey)!); return; }
    const query = [activity, location].filter(Boolean).join(' ').slice(0, 80);
    fetchPixabayImage(query, category).then(url => { if (url) setSrc(url); });
  }, [activity, location, category, cacheKey]);

  return (
    <div className="w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 shadow-sm bg-surface-container-low relative">
      {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-container-high" />}
      <img
        src={src}
        alt={activity}
        loading="lazy"
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => { setLoaded(true); _loadedCache.set(cacheKey, true); }}
        onError={() => { if (src !== fallback) { setSrc(fallback); setLoaded(false); _loadedCache.delete(cacheKey); } }}
      />
    </div>
  );
}

function formatDT(dt: string): string {
  try {
    const d = new Date(dt);
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dt; }
}

// ── Per-agent cycling status messages ────────────────────────────────────────

const AGENT_MESSAGES: Record<string, string[]> = {
  intent_parser: [
    '正在理解您的旅行需求...',
    '解析出发地与目的地...',
    '提取预算与出行偏好...',
    '识别特殊行程要求...',
    '整理旅行意图数据...',
  ],
  currency_agent: [
    '获取实时汇率数据...',
    '查询人民币兑换比率...',
    '计算目的地消费水平...',
    '分析近期汇率走势...',
    '生成换汇建议...',
  ],
  budget_agent: [
    '根据预算规划费用分配...',
    '计算交通与住宿占比...',
    '估算餐饮与景点花费...',
    '优化各项支出结构...',
    '生成预算明细报告...',
  ],
  flight_agent: [
    '搜索最优出发航班...',
    '比对多家航空公司票价...',
    '分析中转与直飞方案...',
    '筛选性价比最高航班...',
    '核查余票与座位信息...',
  ],
  hotel_agent: [
    '搜索目的地附近酒店...',
    '比对房型价格与设施...',
    '查阅用户真实评分...',
    '筛选高性价比住宿...',
    '确认入住与退房政策...',
  ],
  attraction_agent: [
    '查询目的地热门景点...',
    '分析景点开放时间与票价...',
    '规划最优游览路线...',
    '匹配您的兴趣偏好...',
    '整合景点交通衔接...',
  ],
  weather_agent: [
    '获取目的地天气预报...',
    '分析出行日期气候特征...',
    '生成逐日穿衣建议...',
    '评估天气对行程的影响...',
    '整合气象数据报告...',
  ],
  itinerary_agent: [
    '综合所有数据编排行程...',
    '优化景点与交通衔接...',
    '平衡每日游览节奏...',
    '填充餐饮与休闲安排...',
    '生成最终完整行程方案...',
  ],
};

function AnimatedAgentMessage({ agentName }: { agentName: string }) {
  const msgs = AGENT_MESSAGES[agentName] ?? ['正在处理中...', '稍等片刻...'];
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const iv = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % msgs.length);
        setShow(true);
      }, 250);
    }, 2200);
    return () => clearInterval(iv);
  }, [msgs.length]);

  return (
    <span
      className="text-[11px] text-primary/70 font-normal transition-opacity duration-250 block mt-0.5"
      style={{ opacity: show ? 1 : 0 }}
    >
      {msgs[idx]}
    </span>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

interface RunningTask {
  taskId: string;
  query: string;
  startedAt: string;
}

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'processing' | 'itinerary' | 'history'>('home');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [itinerary, setItinerary] = useState<FinalItinerary | null>(null);
  const [runningTask, setRunningTask] = useState<RunningTask | null>(null);

  const handleNavigateToProcessing = useCallback((newTaskId: string, query?: string) => {
    setTaskId(newTaskId);
    setRunningTask({ taskId: newTaskId, query: query ?? '旅行规划中...', startedAt: new Date().toISOString() });
    setCurrentView('processing');
  }, []);

  const handleProcessingComplete = useCallback((result: FinalItinerary) => {
    setItinerary(result);
    setRunningTask(null);
    setCurrentView('itinerary');
  }, []);

  const handleViewHistoryItem = useCallback((result: FinalItinerary) => {
    setItinerary(result);
    setCurrentView('itinerary');
  }, []);

  const handleResumeTask = useCallback((tid: string) => {
    setTaskId(tid);
    setCurrentView('processing');
  }, []);

  const handleCancelTask = useCallback(() => {
    setTaskId(null);
    setRunningTask(null);
    setCurrentView('home');
  }, []);

  const handleUpdateItinerary = useCallback((updated: FinalItinerary) => {
    setItinerary(updated);
  }, []);

  return (
    <div className="min-h-screen bg-surface text-on-surface font-sans selection:bg-primary-container selection:text-on-primary-container">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-surface-container-lowest/80 backdrop-blur-md flex justify-between items-center px-6 h-16 border-b border-outline-variant/20">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-on-surface tracking-tight">OpenTrip</span>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-surface-container-high text-on-surface-variant rounded-full tracking-widest">TRAVEL PLANNER</span>
          </div>
          <div className="hidden md:flex items-center bg-surface-container-low px-4 py-1.5 rounded-full">
            <span className="text-sm font-medium text-primary">OpenClaw Travel Planner</span>
            <span className="ml-2 text-[9px] font-bold bg-primary text-on-primary px-1.5 py-0.5 rounded uppercase tracking-wider">Alpha</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-on-surface-variant">
            <Bell className="w-5 h-5 cursor-pointer hover:text-on-surface transition-colors" />
            <Settings className="w-5 h-5 cursor-pointer hover:text-on-surface transition-colors" />
          </div>
          <div className="h-8 w-8 rounded-full bg-surface-container-highest flex items-center justify-center overflow-hidden">
            <img src={avatarImg} alt="User" className="h-full w-full object-cover" />
          </div>
        </div>
      </header>

      {/* Left Sidebar */}
      <aside className="fixed left-0 top-16 h-[calc(100vh-64px)] w-[220px] bg-surface-container-low flex flex-col p-4 space-y-2 z-40 border-r border-outline-variant/20">
        <div className="mb-6 px-2 mt-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">AI Workbench</h2>
          <p className="text-[9px] text-outline tracking-wider mt-1 uppercase">Professional Orchestration</p>
        </div>
        <nav className="flex-grow space-y-1">
          <button 
            onClick={() => setCurrentView('itinerary')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'itinerary' ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            <MapIcon className="w-4 h-4" />
            <span className="text-sm font-medium">当前任务</span>
          </button>
          <button
            onClick={() => setCurrentView('history')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'history' ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            <History className="w-4 h-4" />
            <span className="text-sm">历史规划</span>
          </button>
          <button 
            onClick={() => setCurrentView('home')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'home' ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            <PlusCircle className="w-4 h-4" />
            <span className="text-sm">新建任务</span>
          </button>
        </nav>
        <div className="pt-4 mt-auto space-y-1 border-t border-outline-variant/10">
          <button className="w-full flex items-center gap-3 px-3 py-2 text-on-surface-variant text-sm hover:bg-surface-container-high rounded-lg">
            <UserCog className="w-4 h-4" />
            <span>个人设置</span>
          </button>
        </div>
      </aside>

      <AnimatePresence mode="wait">
        {currentView === 'home' && (
          <HomeView key="home" sessionId={sessionId} onNavigate={handleNavigateToProcessing} />
        )}
        {currentView === 'processing' && taskId && (
          <ProcessingView key="processing" taskId={taskId} onComplete={handleProcessingComplete} onCancel={handleCancelTask} />
        )}
        {currentView === 'itinerary' && (
          <ItineraryView key="itinerary" itinerary={itinerary} sessionId={sessionId} onUpdateItinerary={handleUpdateItinerary} />
        )}
        {currentView === 'history' && (
          <HistoryView key="history" onViewItem={handleViewHistoryItem} runningTask={runningTask} onResumeTask={handleResumeTask} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ProcessingView({ taskId, onComplete, onCancel }: { taskId: string; onComplete: (r: FinalItinerary) => void; onCancel: () => void }) {
  const [agents, setAgents] = useState<AgentStatus[]>(AGENT_PLACEHOLDERS);
  const [overallStatus, setOverallStatus] = useState<string>('pending');
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const status = await pollStatus(taskId);
        if (cancelled) return;

        setAgents(prev => normalizeAgents(status.agents, prev));
        setOverallStatus(status.overall_status);
        setProgressPct(status.progress_pct);

        if (status.overall_status === 'done') {
          const result = await fetchResult(taskId);
          if (!cancelled) onComplete(result);
          return;
        }

        if (status.overall_status === 'error') {
          const errAgent = status.agents.find(a => a.status === 'error');
          setErrorMsg(errAgent?.message || '任务处理时发生错误，请重试');
          return;
        }

        timerId = setTimeout(poll, 1000);
      } catch (err: unknown) {
        if (!cancelled) setErrorMsg(`网络错误：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [taskId, onComplete]);

  const doneCount = agents.filter(a => a.status === 'done').length;
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <motion.main
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      className="ml-[220px] pt-16 min-h-screen bg-surface-container-lowest flex flex-col items-center justify-center relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:40px_40px] opacity-40 pointer-events-none" />

      <div className="max-w-lg w-full p-10 bg-white/80 backdrop-blur-xl rounded-[2rem] border border-outline-variant/20 shadow-[0_8px_32px_rgba(87,94,112,0.08)] relative z-10">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/15 rounded-full blur-xl animate-pulse" />
            <div className="w-14 h-14 bg-surface-container-low rounded-2xl flex items-center justify-center relative z-10 border border-outline-variant/15 shadow-sm">
              {errorMsg ? (
                <XCircle className="w-7 h-7 text-red-500" />
              ) : overallStatus === 'done' ? (
                <CheckCircle2 className="w-7 h-7 text-emerald-500" />
              ) : (
                <Network className="w-7 h-7 text-primary" />
              )}
            </div>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-on-surface tracking-tight">
              {errorMsg ? '规划失败' : overallStatus === 'done' ? '规划完成！' : '多智能体协同规划中'}
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {errorMsg || (overallStatus === 'done' ? '正在跳转至行程详情...' : 'OpenClaw 正在为您生成专属行程')}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 mb-6">
            {errorMsg}
          </div>
        )}

        {/* Agent Timeline */}
        <div className="space-y-1">
          {agents.map((agent, index) => {
            const style = AGENT_STYLE[agent.agent_name];
            const Icon = style?.icon ?? CircleDashed;
            const isPending = agent.status === 'pending';
            const isActive = agent.status === 'running';
            const isDone = agent.status === 'done';
            const isError = agent.status === 'error';
            const isLast = index === agents.length - 1;

            return (
              <div key={agent.agent_name} className="relative">
                {/* Connecting line */}
                {!isLast && (
                  <div className={`absolute left-8 top-[40px] w-px h-[calc(100%-16px)] z-[1] transition-colors duration-500 ${
                    isDone ? 'bg-emerald-200' : 'bg-surface-container-high'
                  }`} />
                )}

                <div className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-500 ${
                  isActive ? 'bg-primary/[0.04] ring-1 ring-primary/15' : ''
                } ${isPending ? 'opacity-35' : 'opacity-100'}`}>
                  {/* Agent icon */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 relative z-[2] transition-all duration-500 ${
                    isDone ? 'bg-emerald-50' :
                    isActive ? (style?.activeBg ?? 'bg-surface-container-low') :
                    isError ? 'bg-red-50' :
                    'bg-surface-container-low'
                  }`}>
                    {isDone ? (
                      <CheckCircle2 className="w-[18px] h-[18px] text-emerald-500" />
                    ) : isError ? (
                      <XCircle className="w-[18px] h-[18px] text-red-500" />
                    ) : isActive ? (
                      <Icon className={`w-[18px] h-[18px] ${style?.color ?? 'text-primary'}`} />
                    ) : (
                      <Icon className="w-[18px] h-[18px] text-on-surface-variant/30" />
                    )}
                  </div>

                  {/* Name & message */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] leading-tight ${
                        isActive ? 'text-on-surface font-semibold' :
                        isDone ? 'text-on-surface font-medium' :
                        isError ? 'text-red-600 font-medium' :
                        'text-on-surface-variant font-medium'
                      }`}>
                        {agent.display_name}
                      </span>
                      {isActive && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                        </span>
                      )}
                    </div>

                    {isActive && <AnimatedAgentMessage agentName={agent.agent_name} />}

                    {isDone && agent.result_summary && (
                      <span className="text-[11px] text-emerald-600/70 font-normal block mt-0.5 truncate">
                        {agent.result_summary}
                      </span>
                    )}

                    {isError && agent.message && (
                      <span className="text-[11px] text-red-500/80 block mt-0.5 truncate">
                        {agent.message}
                      </span>
                    )}
                  </div>

                  {/* Right status indicator */}
                  <div className="flex-shrink-0 w-5 flex justify-center">
                    {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    {isActive && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Cancel / terminate button */}
        {!errorMsg && overallStatus !== 'done' && (
          <div className="mt-5 flex justify-center">
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium text-on-surface-variant border border-outline-variant/40 hover:bg-surface-container-high hover:text-red-500 hover:border-red-300 transition-all duration-200"
            >
              <X className="w-3.5 h-3.5" />
              终止任务
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="mt-5 flex justify-center">
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium text-on-surface-variant border border-outline-variant/40 hover:bg-surface-container-high transition-all duration-200"
            >
              <X className="w-3.5 h-3.5" />
              返回首页
            </button>
          </div>
        )}

        {/* Progress footer */}
        {!errorMsg && (
          <div className="mt-6 space-y-2.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-on-surface-variant flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                已用时 {fmtTime(elapsedSec)}
              </span>
              <span className="text-on-surface font-bold tabular-nums">{progressPct}%</span>
            </div>
            <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary via-primary/80 to-primary/60 relative"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              >
                <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.25)_50%,transparent_100%)] animate-[shimmer_2s_infinite]" />
              </motion.div>
            </div>
            <p className="text-[11px] text-on-surface-variant">
              {doneCount} / {agents.length} 个智能体已完成
            </p>
          </div>
        )}
      </div>
    </motion.main>
  );
}

function HomeView({ sessionId, onNavigate }: { sessionId: string; onNavigate: (taskId: string, query: string) => void }) {
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detectedCity, setDetectedCity] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'detecting' | 'detected' | 'denied'>('idle');

  useEffect(() => {
    if (!navigator.geolocation) return;
    setLocationStatus('detecting');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
            { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } },
          );
          const data = await res.json();
          const city =
            data.address?.city ||
            data.address?.town ||
            data.address?.county ||
            data.address?.state_district ||
            data.address?.state;
          if (city) {
            setDetectedCity(city);
            setLocationStatus('detected');
          } else {
            setLocationStatus('denied');
          }
        } catch {
          setLocationStatus('denied');
        }
      },
      () => setLocationStatus('denied'),
      { timeout: 8000 },
    );
  }, []);

  const _buildMessage = (text: string): string => {
    if (!detectedCity) return text;
    if (/从|出发地|出发城市|我在|我住|我现在/.test(text)) return text;
    return `${text}（我当前位于${detectedCity}，请以此作为出发地）`;
  };

  const handleAction = async (preset?: string) => {
    const text = preset ?? inputValue.trim();
    if (!text || loading) return;
    setLoading(true);
    setErrorMsg(null);
    const finalText = _buildMessage(text);
    try {
      const res = await postChat(finalText, sessionId);
      if (res.task_id) {
        onNavigate(res.task_id, text);
      } else {
        setLoading(false);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <motion.main
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="ml-[220px] pt-16 min-h-screen bg-surface-container-lowest relative overflow-hidden flex flex-col"
    >
      {/* Background Decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:40px_40px] opacity-40 pointer-events-none"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#ffffff_100%)] pointer-events-none"></div>

      <div className="flex-1 overflow-y-auto px-6 flex flex-col items-center justify-center relative z-10">
        <div className="max-w-3xl w-full text-center space-y-3 -mt-20 px-8 py-12">
          <div className="flex items-center justify-center gap-4 mb-1">
            <Sun className="w-10 h-10 text-orange-400 opacity-80 fill-orange-400" />
            <h2 className="text-5xl font-serif text-slate-800 tracking-tight leading-tight italic">
              Good Afternoon, Tracy
            </h2>
          </div>
          <p className="text-slate-400 font-sans text-xl font-light tracking-wide">
            Where shall we plan our journey today?
          </p>
        </div>
      </div>

      <div className="w-full max-w-5xl mx-auto px-6 pb-12 space-y-8 relative z-10">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-on-surface-variant/60 text-[10px] font-bold uppercase tracking-[0.2em] mb-1">
            <span className="w-8 h-px bg-current opacity-20"></span>
            <span>快速开始</span>
            <span className="w-8 h-px bg-current opacity-20"></span>
          </div>
          <div className="grid grid-cols-4 gap-3 w-full max-w-4xl">
            <QuickStartCard icon={<Umbrella className="w-6 h-6" />} title="三亚五日游" desc="阳光,大海,与放松行程" onClick={() => handleAction('帮我规划三亚五日游，预算8000元')} />
            <QuickStartCard icon={<Mountain className="w-6 h-6" />} title="云南深度游" desc="古镇与高原文化" onClick={() => handleAction('帮我规划云南深度游5天，预算10000元')} />
            <QuickStartCard icon={<Wallet className="w-6 h-6" />} title="穷游旅游计划" desc="最大化体验,最小成本" onClick={() => handleAction('帮我规划一个5天穷游计划，预算3000元')} />
            <QuickStartCard icon={<Users className="w-6 h-6" />} title="家庭旅游" desc="亲子友好与便捷交通" onClick={() => handleAction('帮我规划一次家庭亲子游5天，2大1小，预算15000元')} />
          </div>
        </div>

        {errorMsg && (
          <div className="w-full max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 text-center">
            {errorMsg}
          </div>
        )}

        <div className="relative bg-white/80 backdrop-blur-xl rounded-[2rem] border border-outline-variant/20 shadow-[0_8px_32px_rgba(87,94,112,0.08)] overflow-hidden flex items-center p-2 ring-1 ring-white w-full max-w-2xl mx-auto">
          <button className="w-12 h-12 flex items-center justify-center text-outline hover:text-primary transition-colors">
            <Plus className="w-6 h-6" />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && handleAction()}
            placeholder="输入你的旅游需求或目的地..."
            className="flex-1 bg-transparent border-none focus:ring-0 text-on-surface text-[15px] placeholder-outline px-2 h-12 outline-none"
            disabled={loading}
          />
          <div className="flex items-center gap-2 pr-1">
            <button className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:text-primary hover:bg-surface-container-low rounded-full transition-all">智能体设置</button>
            <button
              className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center hover:opacity-90 transition-all shadow-md active:scale-95 disabled:opacity-50"
              onClick={() => handleAction()}
              disabled={loading || !inputValue.trim()}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUp className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Location pill */}
        <div className="flex justify-center">
          {locationStatus === 'detecting' && (
            <span className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/60 px-3 py-1 rounded-full bg-surface-container-low border border-outline-variant/20">
              <Loader2 className="w-3 h-3 animate-spin" />
              正在获取出发地...
            </span>
          )}
          {locationStatus === 'detected' && detectedCity && (
            <span className="flex items-center gap-1.5 text-[11px] text-primary/80 px-3 py-1 rounded-full bg-primary/8 border border-primary/20">
              <MapPin className="w-3 h-3" />
              出发地已定位：{detectedCity}
            </span>
          )}
          {locationStatus === 'denied' && (
            <span className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/50 px-3 py-1 rounded-full bg-surface-container-low border border-outline-variant/20">
              <MapPin className="w-3 h-3" />
              未获取到位置，请在消息中说明出发城市
            </span>
          )}
        </div>
      </div>
    </motion.main>
  );
}

function QuickStartCard({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group p-4 text-left bg-white/60 hover:bg-white border border-outline-variant/20 rounded-2xl transition-all duration-300 flex flex-col items-center text-center shadow-sm hover:shadow-md hover:-translate-y-0.5">
      <div className="mb-3 w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-primary-dim group-hover:bg-primary group-hover:text-white transition-all">
        {icon}
      </div>
      <h3 className="text-on-surface font-semibold text-sm mb-1">{title}</h3>
      <p className="text-on-surface-variant text-[11px] opacity-70">{desc}</p>
    </button>
  );
}

function HistoryView({ onViewItem, runningTask, onResumeTask }: { onViewItem: (r: FinalItinerary) => void; runningTask: RunningTask | null; onResumeTask: (taskId: string) => void }) {
  const [tasks, setTasks] = useState<ItinerarySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks()
      .then(setTasks)
      .catch(err => setErrorMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleOpen = async (taskId: string) => {
    setLoadingTaskId(taskId);
    try {
      const result = await fetchResult(taskId);
      onViewItem(result);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTaskId(null);
    }
  };

  const formatDate = (dt: string) => {
    try {
      return new Date(dt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return dt; }
  };

  return (
    <motion.main
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="ml-[220px] pt-16 min-h-screen bg-surface-container-lowest relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:40px_40px] opacity-40 pointer-events-none" />

      <div className="max-w-5xl mx-auto px-8 py-10 relative z-10">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <History className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">历史规划</h1>
          </div>
          <p className="text-on-surface-variant text-sm">所有 AI 行程规划记录</p>
        </div>

        {errorMsg && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* Running task card */}
        {runningTask && (
          <div className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-3">进行中</p>
            <button
              onClick={() => onResumeTask(runningTask.taskId)}
              className="group w-full text-left bg-white/80 hover:bg-white border border-primary/20 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5"
            >
              <div className="h-24 bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(var(--color-primary)/0.2),transparent_60%)]" />
                <div className="flex flex-col items-center gap-2 relative z-10">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                    </span>
                    <span className="text-primary font-bold text-sm">规划进行中...</span>
                  </div>
                  <span className="text-[11px] text-primary/60 max-w-[240px] truncate px-2 text-center">{runningTask.query}</span>
                </div>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-xs">{new Date(runningTask.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-outline-variant/10">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    规划中
                  </span>
                  <div className="flex items-center gap-1 text-primary text-xs font-semibold group-hover:gap-2 transition-all">
                    <span>查看进度</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-on-surface-variant text-sm">加载历史记录中...</p>
          </div>
        ) : tasks.length === 0 && !runningTask ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-surface-container-low flex items-center justify-center">
              <History className="w-8 h-8 text-outline" />
            </div>
            <p className="text-on-surface-variant text-sm font-medium">暂无历史规划记录</p>
            <p className="text-outline text-xs">新建一个旅行任务后将在此显示</p>
          </div>
        ) : tasks.length > 0 ? (
          <>
            {runningTask && <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-3">已完成</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {tasks.map((task) => (
              <button
                key={task.task_id}
                onClick={() => handleOpen(task.task_id)}
                disabled={loadingTaskId === task.task_id}
                className="group text-left bg-white/70 hover:bg-white border border-outline-variant/20 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {/* Card Header */}
                <div className="h-24 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(var(--color-primary)/0.15),transparent_60%)]" />
                  <div className="flex flex-col items-center gap-1 relative z-10">
                    <div className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight">
                      <span>{task.origin_city}</span>
                      <Plane className="w-4 h-4 opacity-60" />
                      <span>{task.dest_city}</span>
                    </div>
                    <span className="text-[10px] text-primary/60 font-medium uppercase tracking-widest">{task.duration_days} Days Journey</span>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-on-surface-variant">
                    <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs">{formatDate(task.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-on-surface-variant">
                    <Wallet className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs">预算 ¥{Math.round(task.budget_cny).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-on-surface-variant">
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs">{task.duration_days} 天行程</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-outline-variant/10">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${task.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-container-high text-outline'}`}>
                      {task.status === 'done' ? '已完成' : task.status}
                    </span>
                    <div className="flex items-center gap-1 text-primary text-xs font-semibold group-hover:gap-2 transition-all">
                      {loadingTaskId === task.task_id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>查看行程</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          </>
        ) : null}
      </div>
    </motion.main>
  );
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  type?: 'replanning' | 'confirm';
  pendingResult?: FinalItinerary;
  confirmed?: 'accepted' | 'dismissed';
}

function ItineraryView({
  itinerary, sessionId, onUpdateItinerary,
}: {
  itinerary: FinalItinerary | null;
  sessionId: string;
  onUpdateItinerary: (updated: FinalItinerary) => void;
}) {
  const [activeDay, setActiveDay] = useState(1);
  const [paymentState, setPaymentState] = useState<'idle' | 'processing' | 'success'>('idle');
  const [inputValue, setInputValue] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [replanTaskId, setReplanTaskId] = useState<string | null>(null);
  const [scheduleKey, setScheduleKey] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActiveDay(1); }, [itinerary]);

  useEffect(() => {
    if (chatEndRef.current && chatHistory.length > 0) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory]);

  useEffect(() => {
    if (!itinerary) return;
    itinerary.days.forEach(day => {
      day.activities.forEach(act => {
        const query = [act.activity, act.location].filter(Boolean).join(' ').slice(0, 80);
        fetchPixabayImage(query, act.category);
      });
    });
  }, [itinerary]);

  const handleRefine = async () => {
    const text = inputValue.trim();
    if (!text || chatLoading) return;
    setChatLoading(true);
    setChatError(null);
    setChatHistory(h => [...h, { role: 'user', text }]);
    setInputValue('');
    try {
      const ctx = itinerary ? buildItineraryContext(itinerary) : undefined;
      const res = await postChat(text, sessionId, itinerary?.task_id, ctx);
      if (res.response_type === 'quick' && res.quick_reply) {
        setChatHistory(h => [...h, { role: 'assistant', text: res.quick_reply! }]);
        setChatLoading(false);
      } else if (res.task_id) {
        setChatHistory(h => [...h, { role: 'assistant', text: '正在为您重新规划方案，请稍候...', type: 'replanning' }]);
        setReplanTaskId(res.task_id);
      } else {
        setChatLoading(false);
      }
    } catch (err: unknown) {
      setChatHistory(h => h.slice(0, -1));
      setChatError(err instanceof Error ? err.message : String(err));
      setChatLoading(false);
    }
  };

  // Inline polling for replan task
  useEffect(() => {
    if (!replanTaskId) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise(r => setTimeout(r, 2000));
        if (cancelled) break;
        try {
          const status = await pollStatus(replanTaskId);
          if (status.overall_status === 'done') {
            const result = await fetchResult(replanTaskId);
            setChatHistory(h => h.map(m =>
              m.type === 'replanning'
                ? { role: 'assistant' as const, text: '已为您优化了行程方案，是否更新？', type: 'confirm' as const, pendingResult: result }
                : m
            ));
            setReplanTaskId(null);
            setChatLoading(false);
            break;
          }
          if (status.overall_status === 'error') {
            setChatHistory(h => h.filter(m => m.type !== 'replanning'));
            setChatError('规划失败，请重试');
            setReplanTaskId(null);
            setChatLoading(false);
            break;
          }
        } catch {
          // continue polling on transient errors
        }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [replanTaskId]);

  const handleConfirmReplan = useCallback((msgIndex: number, action: 'accepted' | 'dismissed') => {
    setChatHistory(h => h.map((m, i) =>
      i === msgIndex ? { ...m, confirmed: action, text: action === 'accepted' ? '已更新行程方案 ✓' : '已忽略本次优化建议' } : m
    ));
    if (action === 'accepted') {
      const msg = chatHistory[msgIndex];
      if (msg?.pendingResult) {
        onUpdateItinerary(msg.pendingResult);
        setScheduleKey(k => k + 1);
      }
    }
  }, [chatHistory, onUpdateItinerary]);

  const totalDays = itinerary?.days.length ?? 5;
  const destCity = itinerary?.intent.dest_city ?? '大理';
  const destCountry = itinerary?.intent.dest_country ?? 'China';
  const activeIndex = activeDay - 1;
  const currentDay = itinerary?.days[activeIndex];
  const currentWeather = itinerary?.weather.daily[activeIndex];
  const title = itinerary
    ? `${destCity} ${totalDays} 天智慧旅行方案`
    : '云南 5 天智慧旅行方案';

  const handlePayment = () => {
    setPaymentState('processing');
    setTimeout(() => setPaymentState('success'), 1500);
  };

  const handleNewChat = async () => {
    try {
      await fetch(`${API_BASE}/sessions/${sessionId}/clear`, { method: 'POST' });
    } catch {
      // best-effort; clear frontend regardless
    }
    setChatHistory([]);
    setInputValue('');
    setChatError(null);
    setReplanTaskId(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Right Sidebar */}
      <aside className="fixed right-0 top-16 h-[calc(100vh-64px)] w-[300px] bg-surface-container-low flex flex-col p-6 space-y-6 z-40 border-l border-outline-variant/20">
        <header>
          <h2 className="text-lg font-bold text-on-surface">确认预订</h2>
          <p className="text-[10px] uppercase tracking-widest text-on-surface-variant mt-1">{title}</p>
        </header>
        <div className="flex text-[10px] font-bold uppercase tracking-widest border-b border-surface-container-high">
          <button className="flex-1 pb-3 text-primary border-b-2 border-primary">交通</button>
          <button className="flex-1 pb-3 text-on-surface-variant hover:text-primary">酒店</button>
          <button className="flex-1 pb-3 text-on-surface-variant hover:text-primary">门票</button>
        </div>
        <div className="space-y-6 flex-grow overflow-y-auto">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider">产品信息</label>
            <div className="mt-2 p-3 bg-surface-container-lowest rounded-lg shadow-sm border border-outline-variant/10">
              {itinerary?.recommended_flight ? (
                <>
                  <p className="text-sm font-bold text-on-surface">
                    {itinerary.intent.origin_city} → {itinerary.intent.dest_city}
                  </p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {itinerary.recommended_flight.airline} {itinerary.recommended_flight.flight_number}
                  </p>
                  <div className="flex justify-between mt-3 text-[10px] font-medium text-outline">
                    <span>{formatDT(itinerary.recommended_flight.departure_time)} 出发</span>
                    <span>约 {itinerary.recommended_flight.duration_hours.toFixed(1)}h</span>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-on-surface">昆明南 - 大理</p>
                  <p className="text-xs text-on-surface-variant mt-1">G2842 | 高铁二等座</p>
                  <div className="flex justify-between mt-3 text-[10px] font-medium text-outline">
                    <span>10月12日 09:30出发</span>
                    <span>耗时 2h 05m</span>
                  </div>
                </>
              )}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider">乘车人</label>
            <div className="mt-2 flex items-center gap-3 p-3 bg-surface-container-lowest rounded-lg shadow-sm border border-outline-variant/10">
              <User className="w-4 h-4 text-outline" />
              <span className="text-sm font-medium text-on-surface">张某某 (4201**********)</span>
            </div>
          </div>
          <div className="bg-secondary-container/50 p-4 rounded-xl border border-secondary-container/30">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-on-secondary-container" />
              <span className="text-[10px] font-bold text-on-secondary-container uppercase tracking-wider">AI 助手建议</span>
            </div>
            <p className="text-xs text-on-secondary-container leading-relaxed">
              {itinerary?.travel_tips?.[0] ?? '当前列车余票充足，建议提前 24 小时预订以锁定最佳座位。由于大理天气转晴，系统已为您自动勾选"靠窗席位"。'}
            </p>
          </div>
        </div>
        <div className="space-y-4 pt-4 border-t border-outline-variant/10">
          <div className="flex justify-between items-end">
            <span className="text-xs font-medium text-on-surface-variant">总计费用</span>
            <span className="text-2xl font-black text-primary">
              ¥ {itinerary ? Math.round(itinerary.total_estimated_cost_cny).toLocaleString() : '1200'}
            </span>
          </div>
          <div className="flex gap-3">
            <button className="flex-1 py-3 text-sm font-bold text-primary bg-surface-container-high rounded-xl hover:bg-surface-container-highest transition-colors">取消</button>
            <button 
              onClick={handlePayment}
              disabled={paymentState !== 'idle'}
              className={`flex-[2] py-3 text-sm font-bold text-on-primary rounded-xl shadow-lg transition-all ${
                paymentState === 'success' ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-primary shadow-primary/20 hover:opacity-90'
              }`}
            >
              {paymentState === 'idle' ? '确认支付' : paymentState === 'processing' ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : '支付成功'}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-[220px] mr-[300px] pt-16 min-h-screen bg-surface-container-lowest p-8 pb-24">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">{title}</h1>
            <span className="text-[9px] font-bold bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded tracking-wider">MULTI-AGENT SYSTEM</span>
          </div>
          <p className="text-on-surface-variant text-sm">由多智能体协同生成的个性化行程，已为您优化交通与住宿链路。</p>
        </header>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 p-1 bg-surface-container-low w-fit rounded-xl">
          {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => (
            <button
              key={day}
              onClick={() => setActiveDay(day)}
              className={`px-6 py-2 rounded-lg text-sm transition-colors ${
                activeDay === day
                  ? 'font-semibold bg-surface-container-lowest text-primary shadow-sm'
                  : 'font-medium text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              第{day}天
            </button>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Schedule Card */}
          <motion.section
            key={scheduleKey}
            initial={{ opacity: 0.6, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="col-span-8 bg-surface-container-lowest rounded-xl p-6 shadow-[0_8px_32px_rgba(87,94,112,0.04)] ring-1 ring-outline-variant/10"
          >
            <div className="flex justify-between items-center mb-8">
              <div>
                <h3 className="text-xl font-bold text-on-surface">
                  {currentDay?.theme ?? `${destCity}：精彩一日游`}
                </h3>
                <p className="text-[10px] text-outline uppercase tracking-widest mt-1">Day {activeDay} Schedule</p>
              </div>
              <Share className="w-5 h-5 text-primary cursor-pointer hover:opacity-70" />
            </div>

            <div className="space-y-10 relative">
              {/* Timeline Line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-surface-container-high"></div>

              {currentDay?.activities ? currentDay.activities.map((act, idx) => (
                <div key={idx} className="relative flex gap-6 pl-8">
                  <div className={`absolute left-0 top-1.5 w-4 h-4 rounded-full ${idx === 0 ? 'bg-primary' : 'bg-surface-container-highest'} border-4 border-surface-container-lowest z-10`}></div>
                  <div className="flex-grow">
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold text-on-surface text-base">{act.activity}</h4>
                      <span className="text-xs font-bold text-primary bg-primary-container/50 px-2 py-1 rounded flex-shrink-0 ml-2">{act.time}</span>
                    </div>
                    <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
                      {act.location} · {act.tips}
                    </p>
                    {act.estimated_cost_cny > 0 && (
                      <p className="text-xs text-primary font-semibold mt-1">预计费用：¥{act.estimated_cost_cny}</p>
                    )}
                  </div>
                  <ActivityImage
                    activity={act.activity}
                    location={act.location}
                    category={act.category}
                    destCountry={destCountry}
                    sig={activeIndex * 10 + idx + 1}
                  />
                </div>
              )) : (
                <>
                  <div className="relative flex gap-6 pl-8">
                    <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full bg-primary border-4 border-surface-container-lowest z-10"></div>
                    <div className="flex-grow">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-on-surface text-base">上午：苍山洗马潭索道</h4>
                        <span className="text-xs font-bold text-primary bg-primary-container/50 px-2 py-1 rounded">09:00 - 12:00</span>
                      </div>
                      <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">乘坐索道直达苍山之巅，俯瞰洱海全景。建议携带薄外套，山顶气温较低。</p>
                    </div>
                    <div className="w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 shadow-sm">
                      <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBkF7t9C5YGUtqNZ2QnTfwXW2DBanHSpQd-JNJuCaGLGUFFdN17Ptq3G-u4aGV95d9EhLN8wWa06IUs-uoj5FdGoxV4_F4VR5-CyF803XnfUcyyP7Bx8pNErw92RwRSl516-jMjaMdArvyOd2c9uL4ej5nmsfchxamlGKnK7WfkrVU_7ztpUEIJ_3TbwGFAgr_JNmJZjtE0XdFdFIzO_6oKHu6NhpXYeTzBloDbEOeiId9k7g8mICEChVyOYM4gNHg4ixug4M-Zw2RG" alt="Cangshan" className="w-full h-full object-cover" />
                    </div>
                  </div>
                  <div className="relative flex gap-6 pl-8">
                    <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full bg-surface-container-highest border-4 border-surface-container-lowest z-10"></div>
                    <div className="flex-grow">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-on-surface text-base">下午：洱海生态廊道骑行</h4>
                        <span className="text-xs font-bold text-primary bg-primary-container/50 px-2 py-1 rounded">14:00 - 17:30</span>
                      </div>
                      <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">租用共享单车在才村至磻溪村路段骑行，享受洱海微风与s型海滨路的美景。</p>
                    </div>
                    <div className="w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 shadow-sm">
                      <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBydsEaWSo0VynoD9rLWjUvytVDi0kzGfFyLUBWxDtNesyEy5M5weErfrxRCmXJ1XBzCh91YwYv6IWyLCtA0gwF3UJklj3-47LgoVi9aSwio01fsIldASvhzfvdkwNoZkXhcjVR7cSx_1G1tVHz64GKrTkz5h7R5dgxS8JRPaZV3E05JfQyYfT-lJIyoSf65Jfl2bHUGFQIufpRTC8J9cgmPY2OPCqkoIUi8c2rGvLEuN7yW9JakMApfjpNVP1Ft5lBxgqAanCRtBkR" alt="Erhai" className="w-full h-full object-cover" />
                    </div>
                  </div>
                  <div className="relative flex gap-6 pl-8">
                    <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full bg-surface-container-highest border-4 border-surface-container-lowest z-10"></div>
                    <div className="flex-grow">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-on-surface text-base">晚上：大理古城漫步</h4>
                        <span className="text-xs font-bold text-primary bg-primary-container/50 px-2 py-1 rounded">19:00 - 21:30</span>
                      </div>
                      <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">探索人民路与洋人街，体验独特的民谣氛围，品尝当地乳扇烤饵块。</p>
                    </div>
                    <div className="w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 shadow-sm">
                      <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBYzpWVbB1Y7G8NTctkIaz4e7It2iw1aemS-JtDPmfdANNuCZJsveBP5evP4fdgXoBTi4s5-oyfBppY9knHNLS0Q3SCPL8z7JXmernW3ln_hteCdGEQtRLdim2cc5_3Au4XmUdKAvRimh3WSkCVUHAz8hb-RHlTDM8-J8icD4blSGRw9sN9YBKos142JekbsOWbU4StDkpPdHPYzHXwNea1a6YtPlBaoC2F7uZxiO9sUqGQvNVGE2uO5QeWMJMhG0jbb3GLBfP1opLI" alt="Dali Old Town" className="w-full h-full object-cover" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.section>

          {/* Right Widgets */}
          <div className="col-span-4 space-y-6">
            {/* Map Widget */}
            <div className="bg-gradient-to-br from-teal-50 to-emerald-100 rounded-xl overflow-hidden aspect-[16/10] relative shadow-[0_8px_32px_rgba(87,94,112,0.04)] ring-1 ring-outline-variant/10">
              <div className="absolute inset-0 opacity-20 pointer-events-none">
                <svg fill="none" height="100%" viewBox="0 0 400 250" width="100%" xmlns="http://www.w3.org/2000/svg">
                  <path d="M-20 80 Q 80 60 180 100 T 380 70" stroke="#059669" strokeWidth="1"></path>
                  <path d="M-20 140 Q 100 120 220 160 T 420 130" stroke="#059669" strokeWidth="1"></path>
                  <path d="M120 -20 Q 100 80 140 180 T 110 380" stroke="#059669" strokeWidth="1"></path>
                  <path d="M280 -20 Q 260 100 300 200 T 270 400" stroke="#059669" strokeWidth="1"></path>
                </svg>
              </div>
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 250">
                <path d="M80 220 C 120 180, 160 150, 200 125" fill="none" opacity="0.4" stroke="#0f766e" strokeDasharray="6,4" strokeWidth="2"></path>
              </svg>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                <MapPin className="w-8 h-8 text-red-500 drop-shadow-md fill-red-500" />
                <span className="bg-white/95 backdrop-blur px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm mt-1 text-slate-800">{destCity}</span>
              </div>
              <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-2">
                <div className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </div>
                <span className="text-[11px] font-bold text-slate-700 tracking-tight">目的地：{destCity}</span>
              </div>
            </div>

            {/* Weather Widget */}
            <div className="bg-primary p-6 rounded-xl text-on-primary flex justify-between items-center shadow-[0_8px_32px_rgba(87,94,112,0.1)]">
              <div>
                <p className="text-xs font-medium opacity-80">{destCity} · 第{activeDay}天天气</p>
                <h3 className="text-3xl font-bold mt-1">
                  {currentWeather ? `${Math.round(currentWeather.temp_high_c)}°C` : '22°C'}
                </h3>
                <p className="text-sm mt-1">
                  {currentWeather ? `${currentWeather.condition} · 低温${Math.round(currentWeather.temp_low_c)}°C` : '晴朗 · 适宜户外活动'}
                </p>
              </div>
              <Sun className="w-12 h-12 text-yellow-300 fill-yellow-300" />
            </div>

            {/* Recommendations */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-on-surface-variant flex items-center gap-2 uppercase tracking-wider">
                <ThumbsUp className="w-4 h-4" />
                系统推荐
              </h4>
              <div className="bg-surface-container-low p-4 rounded-xl hover:bg-surface-container-high transition-colors cursor-pointer border border-outline-variant/10">
                <div className="flex items-center gap-2 mb-2">
                  <Train className="w-4 h-4 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">交通推荐</span>
                </div>
                <p className="text-sm font-semibold text-on-surface">
                  {itinerary?.recommended_flight
                    ? `${itinerary.intent.origin_city} → ${itinerary.intent.dest_city} ${itinerary.recommended_flight.airline}`
                    : '昆明南 - 大理 高铁动车'}
                </p>
                <p className="text-xs text-primary font-bold mt-1">
                  ¥{itinerary?.recommended_flight ? Math.round(itinerary.recommended_flight.price_cny) : '1200'} / 人
                </p>
              </div>
              <div className="bg-surface-container-low p-4 rounded-xl hover:bg-surface-container-high transition-colors cursor-pointer border border-outline-variant/10">
                <div className="flex items-center gap-2 mb-2">
                  <Hotel className="w-4 h-4 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">酒店推荐</span>
                </div>
                <p className="text-sm font-semibold text-on-surface">
                  {itinerary?.recommended_hotel?.name ?? '洱海云端精品民宿'}
                </p>
                <p className="text-xs text-primary font-bold mt-1">
                  ¥{itinerary?.recommended_hotel ? Math.round(itinerary.recommended_hotel.price_per_night_cny) : '300'} / 晚起
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Highlights */}
        <section className="mt-10 mb-4">
          <h4 className="text-xs font-bold text-on-surface-variant flex items-center gap-2 mb-4 uppercase tracking-wider">
            <Bot className="w-4 h-4" />
            本次行程亮点
          </h4>
          {itinerary?.highlights && itinerary.highlights.length > 0 ? (
            <div className="grid grid-cols-4 gap-5">
              {itinerary.highlights.slice(0, 4).map((hl, idx) => {
                const colors = [
                  { bg: 'bg-blue-50/50', border: 'border-blue-100/50', pattern: 'card-pattern-waves', icon: <Clock className="w-5 h-5 text-blue-500 mb-3" /> },
                  { bg: 'bg-emerald-50/50', border: 'border-emerald-100/50', pattern: 'card-pattern-dots', icon: <Wallet className="w-5 h-5 text-emerald-500 mb-3" /> },
                  { bg: 'bg-orange-50/50', border: 'border-orange-100/50', pattern: 'card-pattern-mountains', icon: <Mountain className="w-5 h-5 text-orange-500 mb-3" /> },
                  { bg: 'bg-purple-50/50', border: 'border-purple-100/50', pattern: 'card-pattern-geo', icon: <Network className="w-5 h-5 text-purple-500 mb-3" /> },
                ];
                const c = colors[idx % colors.length];
                return (
                  <div key={idx} className={`relative ${c.bg} p-5 rounded-xl border ${c.border} overflow-hidden ${c.pattern}`}>
                    <div className="flex flex-col h-full relative z-10">
                      {c.icon}
                      <p className="text-xs text-outline leading-relaxed">{hl}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-5">
              <div className="relative bg-blue-50/50 p-5 rounded-xl border border-blue-100/50 overflow-hidden card-pattern-waves">
                <div className="flex flex-col h-full relative z-10">
                  <Clock className="w-5 h-5 text-blue-500 mb-3" />
                  <h5 className="text-sm font-bold text-on-surface mb-1.5">行程节奏合理</h5>
                  <p className="text-xs text-outline leading-relaxed">每日安排适中，游玩与休息更平衡</p>
                </div>
              </div>
              <div className="relative bg-emerald-50/50 p-5 rounded-xl border border-emerald-100/50 overflow-hidden card-pattern-dots">
                <div className="flex flex-col h-full relative z-10">
                  <Wallet className="w-5 h-5 text-emerald-500 mb-3" />
                  <h5 className="text-sm font-bold text-on-surface mb-1.5">预算控制良好</h5>
                  <p className="text-xs text-outline leading-relaxed">交通与住宿分配均衡，整体更省心</p>
                </div>
              </div>
              <div className="relative bg-orange-50/50 p-5 rounded-xl border border-orange-100/50 overflow-hidden card-pattern-mountains">
                <div className="flex flex-col h-full relative z-10">
                  <Mountain className="w-5 h-5 text-orange-500 mb-3" />
                  <h5 className="text-sm font-bold text-on-surface mb-1.5">覆盖核心景点</h5>
                  <p className="text-xs text-outline leading-relaxed">包含古城、洱海与当地特色体验</p>
                </div>
              </div>
              <div className="relative bg-purple-50/50 p-5 rounded-xl border border-purple-100/50 overflow-hidden card-pattern-geo">
                <div className="flex flex-col h-full relative z-10">
                  <Network className="w-5 h-5 text-purple-500 mb-3" />
                  <h5 className="text-sm font-bold text-on-surface mb-1.5">多智能体协同优化</h5>
                  <p className="text-xs text-outline leading-relaxed">综合交通、住宿、预算多维分析</p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Notion AI-style Floating Chat Button + Panel */}
        <div className="fixed bottom-6 right-[324px] z-40">
          <AnimatePresence>
            {chatOpen && (
              <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.95 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="absolute bottom-16 right-0 w-[420px] bg-white/98 backdrop-blur-2xl rounded-2xl border border-outline-variant/15 shadow-[0_12px_48px_rgba(87,94,112,0.18)] overflow-hidden flex flex-col"
                style={{ maxHeight: 'calc(100vh - 160px)' }}
              >
                {/* ── Header ── */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/10 flex-shrink-0">
                  {/* Mascot */}
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-md shadow-primary/30 flex-shrink-0">
                    <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                      <circle cx="16" cy="16" r="12" fill="white" opacity="0.95"/>
                      <ellipse cx="12" cy="14.5" rx="1.8" ry="2.2" fill="#334155">
                        <animate attributeName="ry" values="2.2;0.4;2.2" dur="3s" repeatCount="indefinite" begin="0.8s"/>
                      </ellipse>
                      <ellipse cx="20" cy="14.5" rx="1.8" ry="2.2" fill="#334155">
                        <animate attributeName="ry" values="2.2;0.4;2.2" dur="3s" repeatCount="indefinite" begin="0.8s"/>
                      </ellipse>
                      <path d="M11.5 19.5 Q16 23 20.5 19.5" stroke="#334155" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
                      <g transform="translate(24, 5)">
                        <path d="M0 -3 L0.8 -0.8 L3 0 L0.8 0.8 L0 3 L-0.8 0.8 L-3 0 L-0.8 -0.8 Z" fill="white" opacity="0.9">
                          <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.5s" repeatCount="indefinite"/>
                          <animateTransform attributeName="transform" type="rotate" values="0;180;360" dur="4s" repeatCount="indefinite"/>
                        </path>
                      </g>
                    </svg>
                  </div>
                  {/* Action buttons */}
                  <div className="flex items-center gap-0.5">
                    {/* Share / Upload */}
                    <button className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                    </button>
                    {/* Edit / Compose — Start new chat */}
                    <button
                      onClick={handleNewChat}
                      title="Start new chat"
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    {/* Window / Layout */}
                    <button className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
                      </svg>
                    </button>
                    {/* More (...) */}
                    <button className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>
                      </svg>
                    </button>
                    {/* Minimize / Close */}
                    <button
                      onClick={() => setChatOpen(false)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* ── Messages ── */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-[240px] max-h-[480px]">
                  {chatHistory.length === 0 && (
                    <div className="flex flex-col">
                      <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: 0.1 }}
                        className="text-[14px] text-on-surface leading-relaxed"
                      >
                        你好！我是 OpenClaw AI。你想让我帮你做什么？
                      </motion.p>
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: 0.2 }}
                        className="mt-3 text-[13px] text-on-surface-variant leading-relaxed"
                      >
                        <p>你可以直接告诉我，比如：</p>
                        <ul className="mt-2 space-y-1.5 list-disc list-inside">
                          {(['查询行程中的任何细节', '修改某一天的行程安排', '总结或对比行程方案', '优化预算与交通规划'] as string[]).map(t => (
                            <li key={t}>
                              <button onClick={() => setInputValue(t)} className="hover:text-on-surface transition-colors text-left">{t}</button>
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    </div>
                  )}
                  <AnimatePresence initial={false}>
                    {chatHistory.map((msg, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                        className={msg.role === 'user' ? 'flex justify-end' : ''}
                      >
                        {msg.role === 'user' ? (
                          <div className="inline-block px-4 py-2 bg-surface-container-high text-on-surface text-sm rounded-2xl rounded-br-md max-w-[85%]">
                            {msg.text}
                          </div>
                        ) : (
                          <div className="w-full">
                            {msg.type === 'replanning' ? (
                              <div className="flex items-center gap-3">
                                <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                                <span className="text-sm text-on-surface-variant">{msg.text}</span>
                              </div>
                            ) : msg.type === 'confirm' && !msg.confirmed ? (
                              <div>
                                <p className="text-sm text-on-surface leading-relaxed mb-3">{msg.text}</p>
                                <div className="flex gap-2">
                                  <button onClick={() => handleConfirmReplan(i, 'accepted')} className="px-4 py-1.5 bg-primary text-on-primary text-xs font-bold rounded-lg hover:opacity-90 transition-opacity">更新行程</button>
                                  <button onClick={() => handleConfirmReplan(i, 'dismissed')} className="px-4 py-1.5 bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg hover:bg-surface-container-highest transition-colors">忽略</button>
                                </div>
                              </div>
                            ) : msg.type === 'confirm' && msg.confirmed ? (
                              <span className={`text-sm ${msg.confirmed === 'accepted' ? 'text-emerald-600' : 'text-on-surface-variant'}`}>{msg.text}</span>
                            ) : (
                              <div>
                                <p className="text-[14px] text-on-surface leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                                <div className="flex items-center gap-0.5 mt-2">
                                  {/* Copy */}
                                  <button className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                    </svg>
                                  </button>
                                  {/* Add */}
                                  <button className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                    </svg>
                                  </button>
                                  {/* Thumbs up */}
                                  <button className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                                    <ThumbsUp className="w-3 h-3" />
                                  </button>
                                  {/* Thumbs down */}
                                  <button className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {chatLoading && chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user' && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center gap-1.5 py-1"
                    >
                      <span className="text-[13px] text-on-surface-variant/50 select-none">Thinking</span>
                      {[0, 140, 280].map((delay) => (
                        <span
                          key={delay}
                          className="w-1 h-1 bg-on-surface-variant/40 rounded-full animate-bounce"
                          style={{ animationDelay: `${delay}ms`, animationDuration: '900ms' }}
                        />
                      ))}
                    </motion.div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Error */}
                {chatError && (
                  <div className="mx-3 mb-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
                    {chatError}
                  </div>
                )}

                {/* ── Input Area ── */}
                <div className="p-3 flex-shrink-0">
                  <div className="rounded-xl border border-outline-variant/20 focus-within:border-primary/50 focus-within:shadow-[0_0_0_2px_rgba(103,80,164,0.1)] transition-all">
                    <div className="px-3.5 pt-3 pb-1">
                      <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !chatLoading && handleRefine()}
                        placeholder="Do anything with AI..."
                        className="w-full bg-transparent border-none focus:ring-0 text-sm text-on-surface placeholder-outline/40 outline-none"
                        disabled={chatLoading}
                        autoFocus
                      />
                    </div>
                    <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
                      <div className="flex items-center gap-0.5">
                        <button className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/40 hover:bg-surface-container-low hover:text-on-surface-variant transition-colors">
                          <Plus className="w-4 h-4" />
                        </button>
                        <button className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/40 hover:bg-surface-container-low hover:text-on-surface-variant transition-colors">
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-on-surface-variant/35 px-1.5 select-none">Auto</span>
                        <button className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/40 hover:bg-surface-container-low hover:text-on-surface-variant transition-colors">
                          <Mic className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleRefine}
                          disabled={chatLoading || !inputValue.trim()}
                          className="w-7 h-7 rounded-full flex items-center justify-center bg-primary/10 text-primary hover:bg-primary hover:text-on-primary disabled:opacity-25 disabled:hover:bg-primary/10 disabled:hover:text-primary transition-all"
                        >
                          {chatLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating Toggle Button with AI Mascot */}
          <div className="relative">
            {/* Pulse glow ring */}
            {!chatOpen && (
              <motion.div
                className="absolute inset-0 rounded-full bg-primary/20"
                animate={{ scale: [1, 1.5, 1.5], opacity: [0.5, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
              />
            )}
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setChatOpen(o => !o)}
              className={`relative w-13 h-13 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 ${
                chatOpen
                  ? 'bg-surface-container-highest text-on-surface-variant shadow-black/10'
                  : 'bg-gradient-to-br from-primary via-primary to-primary/80 text-on-primary shadow-primary/30'
              }`}
              style={{ width: 52, height: 52 }}
            >
              <AnimatePresence mode="wait">
                {chatOpen ? (
                  <motion.span key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                    <X className="w-5 h-5" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="open"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1, y: [0, -2, 0] }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ scale: { duration: 0.2 }, opacity: { duration: 0.2 }, y: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } }}
                  >
                    {/* Custom AI mascot SVG */}
                    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Head */}
                      <circle cx="16" cy="16" r="12" fill="white" opacity="0.95"/>
                      {/* Left eye */}
                      <ellipse cx="12" cy="14.5" rx="1.8" ry="2.2" fill="#334155">
                        <animate attributeName="ry" values="2.2;0.4;2.2" dur="3s" repeatCount="indefinite" begin="1s"/>
                      </ellipse>
                      {/* Right eye */}
                      <ellipse cx="20" cy="14.5" rx="1.8" ry="2.2" fill="#334155">
                        <animate attributeName="ry" values="2.2;0.4;2.2" dur="3s" repeatCount="indefinite" begin="1s"/>
                      </ellipse>
                      {/* Smile */}
                      <path d="M11.5 19.5 Q16 23 20.5 19.5" stroke="#334155" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
                      {/* Sparkle top-right */}
                      <g transform="translate(24, 5)">
                        <path d="M0 -3 L0.8 -0.8 L3 0 L0.8 0.8 L0 3 L-0.8 0.8 L-3 0 L-0.8 -0.8 Z" fill="white" opacity="0.9">
                          <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.5s" repeatCount="indefinite"/>
                          <animateTransform attributeName="transform" type="rotate" values="0;180;360" dur="4s" repeatCount="indefinite"/>
                        </path>
                      </g>
                      {/* Sparkle top-left */}
                      <g transform="translate(6, 3)">
                        <path d="M0 -2 L0.5 -0.5 L2 0 L0.5 0.5 L0 2 L-0.5 0.5 L-2 0 L-0.5 -0.5 Z" fill="white" opacity="0.7">
                          <animate attributeName="opacity" values="0.7;0.2;0.7" dur="2s" repeatCount="indefinite" begin="0.5s"/>
                          <animateTransform attributeName="transform" type="rotate" values="0;-180;-360" dur="5s" repeatCount="indefinite"/>
                        </path>
                      </g>
                    </svg>
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
        </div>
      </main>
    </motion.div>
  );
}
