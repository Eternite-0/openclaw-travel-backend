import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Share, MapPin, Sun, ThumbsUp, Train, Hotel, Clock, Wallet,
  Mountain, Network, User, Bot, Loader2,
  Plus, ArrowUp, X, Mic, SlidersHorizontal,
} from 'lucide-react';
import type { FinalItinerary, ChatMsg } from '../types';
import { API_BASE, postChat, pollStatus, fetchResult } from '../api';
import { formatDT, buildItineraryContext, fetchPixabayImage } from '../utils';
import { ActivityImage } from './ActivityImage';

interface ItineraryViewProps {
  itinerary: FinalItinerary | null;
  sessionId: string;
  onUpdateItinerary: (updated: FinalItinerary) => void;
}

export function ItineraryView({
  itinerary, sessionId, onUpdateItinerary,
}: ItineraryViewProps) {
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

  const handleRefine = useCallback(async () => {
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
  }, [inputValue, chatLoading, itinerary, sessionId]);

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

  const handlePayment = useCallback(() => {
    setPaymentState('processing');
    setTimeout(() => setPaymentState('success'), 1500);
  }, []);

  const handleNewChat = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/sessions/${sessionId}/clear`, { method: 'POST' });
    } catch {
      // best-effort; clear frontend regardless
    }
    setChatHistory([]);
    setInputValue('');
    setChatError(null);
    setReplanTaskId(null);
  }, [sessionId]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Right Sidebar */}
      <BookingSidebar
        itinerary={itinerary}
        title={title}
        paymentState={paymentState}
        onPayment={handlePayment}
      />

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
          <ScheduleCard
            scheduleKey={scheduleKey}
            currentDay={currentDay}
            destCity={destCity}
            destCountry={destCountry}
            activeDay={activeDay}
            activeIndex={activeIndex}
          />

          {/* Right Widgets */}
          <div className="col-span-4 space-y-6">
            <MapWidget destCity={destCity} />
            <WeatherWidget destCity={destCity} activeDay={activeDay} currentWeather={currentWeather} />
            <RecommendationsWidget itinerary={itinerary} />
          </div>
        </div>

        {/* Highlights */}
        <HighlightsSection highlights={itinerary?.highlights} />

        {/* Floating Chat */}
        <ChatPanel
          chatOpen={chatOpen}
          setChatOpen={setChatOpen}
          chatHistory={chatHistory}
          chatLoading={chatLoading}
          chatError={chatError}
          inputValue={inputValue}
          setInputValue={setInputValue}
          onRefine={handleRefine}
          onNewChat={handleNewChat}
          onConfirmReplan={handleConfirmReplan}
          chatEndRef={chatEndRef}
        />
      </main>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function BookingSidebar({ itinerary, title, paymentState, onPayment }: {
  itinerary: FinalItinerary | null;
  title: string;
  paymentState: 'idle' | 'processing' | 'success';
  onPayment: () => void;
}) {
  return (
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
            onClick={onPayment}
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
  );
}

function ScheduleCard({ scheduleKey, currentDay, destCity, destCountry, activeDay, activeIndex }: {
  scheduleKey: number;
  currentDay: FinalItinerary['days'][number] | undefined;
  destCity: string;
  destCountry: string;
  activeDay: number;
  activeIndex: number;
}) {
  return (
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
  );
}

function MapWidget({ destCity }: { destCity: string }) {
  return (
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
  );
}

function WeatherWidget({ destCity, activeDay, currentWeather }: {
  destCity: string;
  activeDay: number;
  currentWeather: FinalItinerary['weather']['daily'][number] | undefined;
}) {
  return (
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
  );
}

function RecommendationsWidget({ itinerary }: { itinerary: FinalItinerary | null }) {
  return (
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
  );
}

function HighlightsSection({ highlights }: { highlights: string[] | undefined }) {
  return (
    <section className="mt-10 mb-4">
      <h4 className="text-xs font-bold text-on-surface-variant flex items-center gap-2 mb-4 uppercase tracking-wider">
        <Bot className="w-4 h-4" />
        本次行程亮点
      </h4>
      {highlights && highlights.length > 0 ? (
        <div className="grid grid-cols-4 gap-5">
          {highlights.slice(0, 4).map((hl, idx) => {
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
  );
}

function ChatPanel({
  chatOpen, setChatOpen, chatHistory, chatLoading, chatError,
  inputValue, setInputValue, onRefine, onNewChat, onConfirmReplan, chatEndRef,
}: {
  chatOpen: boolean;
  setChatOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  chatHistory: ChatMsg[];
  chatLoading: boolean;
  chatError: string | null;
  inputValue: string;
  setInputValue: (v: string) => void;
  onRefine: () => void;
  onNewChat: () => void;
  onConfirmReplan: (idx: number, action: 'accepted' | 'dismissed') => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
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
                <button className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                </button>
                <button
                  onClick={onNewChat}
                  title="Start new chat"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
                  </svg>
                </button>
                <button className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>
                  </svg>
                </button>
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
                              <button onClick={() => onConfirmReplan(i, 'accepted')} className="px-4 py-1.5 bg-primary text-on-primary text-xs font-bold rounded-lg hover:opacity-90 transition-opacity">更新行程</button>
                              <button onClick={() => onConfirmReplan(i, 'dismissed')} className="px-4 py-1.5 bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg hover:bg-surface-container-highest transition-colors">忽略</button>
                            </div>
                          </div>
                        ) : msg.type === 'confirm' && msg.confirmed ? (
                          <span className={`text-sm ${msg.confirmed === 'accepted' ? 'text-emerald-600' : 'text-on-surface-variant'}`}>{msg.text}</span>
                        ) : (
                          <div>
                            <p className="text-[14px] text-on-surface leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                            <div className="flex items-center gap-0.5 mt-2">
                              <button className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                              </button>
                              <button className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                              </button>
                              <button className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors">
                                <ThumbsUp className="w-3 h-3" />
                              </button>
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
                    onKeyDown={(e) => e.key === 'Enter' && !chatLoading && onRefine()}
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
                      onClick={onRefine}
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
  );
}
