import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Share, Sun, ThumbsUp, Train, Hotel, Clock, Wallet,
  Mountain, Network, User, Bot, Loader2,
  Plus, ArrowUp, X, Mic, SlidersHorizontal, ChevronDown, Check,
  ShoppingCart, PlaneTakeoff, Building2,
} from 'lucide-react';
import type { FinalItinerary, ChatMsg, Conversation } from '../types';
import {
  API_BASE, postChat, pollStatus, fetchResult,
  fetchConversations, createConversation, fetchConversationMessages,
  updateConversationTitle, touchConversation, deleteConversation,
} from '../api';
import type { ChatAttachmentPayload } from '../api';
import { formatDT, buildItineraryContext, prefetchPixabayImage } from '../utils';
import { ActivityImage } from './ActivityImage';
import { DayRouteMap } from './DayRouteMap';

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isReplanUpdateRef = useRef(false);
  useEffect(() => {
    if (isReplanUpdateRef.current) {
      // Replan accepted — keep current activeDay, don't reset.
      isReplanUpdateRef.current = false;
      return;
    }
    setActiveDay(1);
  }, [itinerary]);

  useEffect(() => {
    if (chatEndRef.current && chatHistory.length > 0) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory]);

  useEffect(() => {
    if (!itinerary) return;
    const timer = window.setTimeout(() => {
      itinerary.days.forEach((day) => {
        day.activities.forEach((act) => {
          void prefetchPixabayImage(act.activity, act.location, act.category);
        });
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [itinerary]);

  const handleRefine = useCallback(async (
    overrideText?: string,
    attachments?: ChatAttachmentPayload[],
    displayAttachments?: ChatMsg['attachments'],
    displayTextOverride?: string,
  ) => {
    const text = (overrideText ?? inputValue).trim();
    if (!text || chatLoading) return;
    setChatLoading(true);
    setChatError(null);
    const isFirstMsg = chatHistory.length === 0;
    setChatHistory(h => [...h, { role: 'user', text: displayTextOverride ?? text, attachments: displayAttachments }]);
    setInputValue('');
    let convId = activeConvId;
    if (!convId) {
      try {
        const conv = await createConversation();
        setConversations(prev => [conv, ...prev]);
        setActiveConvId(conv.conversation_id);
        convId = conv.conversation_id;
      } catch {
        convId = sessionId;
      }
    }
    const usedSessionId = convId;
    if (convId && convId !== sessionId) {
      if (isFirstMsg) {
        const title = text.slice(0, 28) + (text.length > 28 ? '...' : '');
        updateConversationTitle(convId, title)
          .then(u => setConversations(prev => prev.map(c => c.conversation_id === convId ? { ...c, title: u.title } : c)))
          .catch(() => {});
      }
      touchConversation(convId).catch(() => {});
    }
    try {
      const ctx = itinerary ? buildItineraryContext(itinerary) : undefined;
      // Ensure backend runs quick/pipeline classification even when itinerary task_id is absent.
      const taskIdForChat = itinerary?.task_id ?? activeConvId ?? sessionId;
      const res = await postChat(text, usedSessionId, taskIdForChat, ctx, attachments);
      if (res.response_type === 'quick') {
        const quickText = (res.quick_reply ?? res.message ?? '').trim();
        if (quickText) {
          setChatHistory(h => [...h, { role: 'assistant', text: quickText }]);
        }
        setChatLoading(false);
      } else if (res.response_type === 'pipeline' && res.task_id) {
        setChatHistory(h => [...h, { role: 'assistant', text: '正在为您重新规划方案，请稍候...', type: 'replanning' }]);
        setReplanTaskId(res.task_id);
      } else {
        const fallbackText = (res.message ?? '').trim();
        if (fallbackText) {
          setChatHistory(h => [...h, { role: 'assistant', text: fallbackText }]);
        }
        setChatLoading(false);
      }
    } catch (err: unknown) {
      setChatHistory(h => h.slice(0, -1));
      setChatError(err instanceof Error ? err.message : String(err));
      setChatLoading(false);
    }
  }, [inputValue, chatLoading, chatHistory.length, itinerary, sessionId, activeConvId]);

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
        isReplanUpdateRef.current = true;
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
      const conv = await createConversation();
      setConversations(prev => [conv, ...prev]);
      setActiveConvId(conv.conversation_id);
    } catch {
      // ignore
    }
    setChatHistory([]);
    setInputValue('');
    setChatError(null);
    setReplanTaskId(null);
  }, []);

  const handleSelectConversation = useCallback(async (convId: string) => {
    if (convId === activeConvId) return;
    setActiveConvId(convId);
    setChatHistory([]);
    setChatError(null);
    setReplanTaskId(null);
    try {
      const msgs = await fetchConversationMessages(convId);
      setChatHistory(msgs.map((m) => ({
        role: m.role as 'user' | 'assistant',
        text: m.content,
        attachments: m.attachments?.map((a) => ({
          name: a.name,
          kind: (a.kind ?? (a.mime_type?.startsWith('image/') ? 'image' : 'file')) as 'image' | 'file',
          data_url: a.data_base64 ? `data:${a.mime_type || 'application/octet-stream'};base64,${a.data_base64}` : undefined,
        })),
      })));
    } catch {
      // ignore
    }
  }, [activeConvId]);

  const handleDeleteConversation = useCallback(async (convId: string) => {
    try {
      await deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.conversation_id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setChatHistory([]);
        setChatError(null);
        setReplanTaskId(null);
      }
    } catch {
      // ignore
    }
  }, [activeConvId]);

  const handleRenameConversation = useCallback(async (convId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    try {
      const updated = await updateConversationTitle(convId, nextTitle);
      setConversations(prev => prev.map(c =>
        c.conversation_id === convId ? { ...c, title: updated.title, updated_at: updated.updated_at } : c
      ));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!chatOpen) return;
    fetchConversations().then(setConversations).catch(() => {});
  }, [chatOpen]);

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
      <main className="ml-0 lg:ml-[220px] pt-16 min-h-screen bg-surface-container-lowest p-4 md:p-6 lg:p-8 pb-24">
        <header className="mb-6 md:mb-8">
          <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-2">
            <h1 className="text-xl md:text-2xl font-extrabold text-on-surface tracking-tight">{title}</h1>
            <span className="text-[9px] font-bold bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded tracking-wider">MULTI-AGENT SYSTEM</span>
          </div>
          <p className="text-on-surface-variant text-xs md:text-sm">由多智能体协同生成的个性化行程，已为您优化交通与住宿链路。</p>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 md:gap-2 mb-6 md:mb-8 p-1 bg-surface-container-low w-full md:w-fit rounded-xl overflow-x-auto">
          {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => (
            <button
              key={day}
              onClick={() => setActiveDay(day)}
              className={`px-3 md:px-6 py-2 rounded-lg text-xs md:text-sm transition-colors whitespace-nowrap ${
                activeDay === day
                  ? 'font-semibold bg-surface-container-lowest text-primary shadow-sm'
                  : 'font-medium text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              第{day}天
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
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
          <div className="lg:col-span-4 space-y-4 md:space-y-6">
            <DayRouteMap activities={currentDay?.activities ?? []} dayNumber={activeDay} city={destCity} />
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
          conversations={conversations}
          activeConvId={activeConvId}
          onSelectConversation={handleSelectConversation}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      </main>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function BookingSidebar({ itinerary, paymentState, onPayment }: {
  itinerary: FinalItinerary | null;
  title: string;
  paymentState: 'idle' | 'processing' | 'success';
  onPayment: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Floating Trigger Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            key="booking-trigger"
            initial={{ opacity: 0, scale: 0.8, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: 20 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsOpen(true)}
            className="fixed right-6 bottom-24 z-30 flex items-center gap-2 bg-primary text-white pl-4 pr-5 py-3 rounded-full shadow-lg shadow-primary/30 hover:bg-primary-dim active:scale-95 transition-colors"
            aria-label="打开预订面板"
          >
            <ShoppingCart className="w-4 h-4" />
            <span className="text-xs font-bold tracking-wide">确认预订</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="booking-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Drawer Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            key="booking-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.9 }}
            className="fixed right-0 top-0 h-full w-full sm:w-[380px] flex flex-col z-50 shadow-[-16px_0_48px_rgba(0,0,0,0.12)]"
          >
            <div className="bg-white h-full flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex justify-between items-center px-6 py-5 border-b border-slate-100 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <ShoppingCart className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="text-lg font-headline font-extrabold tracking-tight text-slate-900">确认预订</h2>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                {/* Flight Detail */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 }}
                >
                  <span className="text-[10px] font-label font-bold text-slate-400 uppercase tracking-[0.12em] mb-3 block">
                    航班详情
                  </span>
                  <div className="flex gap-4 items-start p-4 bg-slate-50 rounded-2xl">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center flex-shrink-0">
                      <PlaneTakeoff className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {itinerary?.recommended_flight ? (
                        <>
                          <h4 className="font-headline font-bold text-sm text-slate-900 truncate">
                            {itinerary.recommended_flight.airline} {itinerary.recommended_flight.flight_number}
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {itinerary.intent.origin_city} → {itinerary.intent.dest_city}
                          </p>
                          <div className="flex justify-between mt-2 pt-2 border-t border-slate-100">
                            <span className="text-[11px] text-slate-500">{formatDT(itinerary.recommended_flight.departure_time)}</span>
                            <span className="text-[11px] font-bold text-slate-900">
                              ¥{Math.round(itinerary.recommended_flight.price_cny).toLocaleString()}
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <h4 className="font-headline font-bold text-sm text-slate-900">中国东方航空 MU5738</h4>
                          <p className="text-xs text-slate-400 mt-0.5">湛江 (ZHA) → 巴黎 (CDG)</p>
                          <div className="flex justify-between mt-2 pt-2 border-t border-slate-100">
                            <span className="text-[11px] text-slate-500">经济舱优惠价</span>
                            <span className="text-[11px] font-bold text-slate-900">¥10,280.00</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>

                {/* Hotel Detail */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.14 }}
                >
                  <span className="text-[10px] font-label font-bold text-slate-400 uppercase tracking-[0.12em] mb-3 block">
                    住宿安排
                  </span>
                  <div className="flex gap-4 items-start p-4 bg-slate-50 rounded-2xl">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {itinerary?.recommended_hotel ? (
                        <>
                          <h4 className="font-headline font-bold text-sm text-slate-900 truncate">
                            {itinerary.recommended_hotel.name}
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">
                            豪华大床房 • {itinerary.days.length}晚
                          </p>
                          <div className="flex justify-between mt-2 pt-2 border-t border-slate-100">
                            <span className="text-[11px] text-slate-500">含早餐</span>
                            <span className="text-[11px] font-bold text-slate-900">
                              ¥{Math.round(itinerary.recommended_hotel.price_per_night_cny * itinerary.days.length).toLocaleString()}
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <h4 className="font-headline font-bold text-sm text-slate-900">巴黎奥特伊假日酒店</h4>
                          <p className="text-xs text-slate-400 mt-0.5">豪华大床房 • 6晚</p>
                          <div className="flex justify-between mt-2 pt-2 border-t border-slate-100">
                            <span className="text-[11px] text-slate-500">含早餐</span>
                            <span className="text-[11px] font-bold text-slate-900">¥7,080.00</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>

                {/* Passengers */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[10px] font-label font-bold text-slate-400 uppercase tracking-[0.12em]">
                      旅客
                    </span>
                    <button className="text-[10px] font-bold text-primary flex items-center gap-1 hover:underline">
                      <Plus className="w-3 h-3" />
                      新增旅客
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 rounded-xl">
                      <User className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-medium text-slate-700">张某某 (主要联系人)</span>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Footer */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
                className="px-6 py-6 border-t border-slate-100 bg-white flex-shrink-0"
              >
                <div className="flex justify-between items-end mb-5">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">总计费用</span>
                    <div className="text-3xl font-headline font-extrabold text-slate-900 mt-1">
                      ¥{itinerary ? Math.round(itinerary.total_estimated_cost_cny).toLocaleString() : '17,360'}
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 mb-1">含税费</span>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsOpen(false)}
                    className="flex-1 bg-slate-100 text-slate-600 py-3.5 rounded-xl font-headline font-bold text-sm hover:bg-slate-200 transition-all"
                  >
                    取消
                  </button>
                  <button
                    onClick={onPayment}
                    disabled={paymentState !== 'idle'}
                    className={`flex-[2] py-3.5 rounded-xl font-headline font-bold text-sm transition-all ${
                      paymentState === 'success'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-primary text-white shadow-lg shadow-primary/20 hover:bg-slate-800'
                    } disabled:opacity-60`}
                  >
                    {paymentState === 'idle'
                      ? '确认支付'
                      : paymentState === 'processing'
                        ? <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                        : '支付成功'
                    }
                  </button>
                </div>
                <p className="text-[10px] text-center text-slate-400 mt-4 leading-relaxed">
                  点击确认即表示您同意我们的旅行政策及供应商服务条款。
                </p>
              </motion.div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
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
      className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-4 md:p-6 shadow-[0_8px_32px_rgba(87,94,112,0.04)] ring-1 ring-outline-variant/10"
    >
      <div className="flex justify-between items-center mb-4 md:mb-8">
        <div>
          <h3 className="text-lg md:text-xl font-bold text-on-surface">
            {currentDay?.theme ?? `${destCity}：精彩一日游`}
          </h3>
          <p className="text-[10px] text-outline uppercase tracking-widest mt-1">Day {activeDay} Schedule</p>
        </div>
        <Share className="w-5 h-5 text-primary cursor-pointer hover:opacity-70" />
      </div>

      <div className="space-y-6 md:space-y-10 relative">
        {/* Timeline Line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-surface-container-high"></div>

        {currentDay?.activities ? currentDay.activities.map((act, idx) => (
          <div key={idx} className="relative flex gap-3 md:gap-6 pl-6 md:pl-8">
            <div className={`absolute left-0 top-1.5 w-4 h-4 rounded-full ${idx === 0 ? 'bg-primary' : 'bg-surface-container-highest'} border-4 border-surface-container-lowest z-10`}></div>
            <div className="flex-grow min-w-0">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 sm:gap-0">
                <h4 className="font-bold text-on-surface text-sm md:text-base">{act.activity}</h4>
                <span className="text-xs font-bold text-primary bg-primary-container/50 px-2 py-1 rounded flex-shrink-0 sm:ml-2 w-fit">{act.time}</span>
              </div>
              <p className="text-xs md:text-sm text-on-surface-variant mt-1 md:mt-2 leading-relaxed">
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
    <section className="mt-6 md:mt-10 mb-4">
      <h4 className="text-xs font-bold text-on-surface-variant flex items-center gap-2 mb-3 md:mb-4 uppercase tracking-wider">
        <Bot className="w-4 h-4" />
        本次行程亮点
      </h4>
      {highlights && highlights.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
          {highlights.slice(0, 4).map((hl, idx) => {
            const colors = [
              { bg: 'bg-blue-50/50', border: 'border-blue-100/50', pattern: 'card-pattern-waves', icon: <Clock className="w-5 h-5 text-blue-500 mb-3" /> },
              { bg: 'bg-emerald-50/50', border: 'border-emerald-100/50', pattern: 'card-pattern-dots', icon: <Wallet className="w-5 h-5 text-emerald-500 mb-3" /> },
              { bg: 'bg-orange-50/50', border: 'border-orange-100/50', pattern: 'card-pattern-mountains', icon: <Mountain className="w-5 h-5 text-orange-500 mb-3" /> },
              { bg: 'bg-purple-50/50', border: 'border-purple-100/50', pattern: 'card-pattern-geo', icon: <Network className="w-5 h-5 text-purple-500 mb-3" /> },
            ];
            const c = colors[idx % colors.length];
            return (
              <div key={idx} className={`relative ${c.bg} p-4 md:p-5 rounded-xl border ${c.border} overflow-hidden ${c.pattern}`}>
                <div className="flex flex-col h-full relative z-10">
                  {c.icon}
                  <p className="text-xs text-outline leading-relaxed">{hl}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
          <div className="relative bg-blue-50/50 p-4 md:p-5 rounded-xl border border-blue-100/50 overflow-hidden card-pattern-waves">
            <div className="flex flex-col h-full relative z-10">
              <Clock className="w-5 h-5 text-blue-500 mb-3" />
              <h5 className="text-sm font-bold text-on-surface mb-1.5">行程节奏合理</h5>
              <p className="text-xs text-outline leading-relaxed">每日安排适中，游玩与休息更平衡</p>
            </div>
          </div>
          <div className="relative bg-emerald-50/50 p-4 md:p-5 rounded-xl border border-emerald-100/50 overflow-hidden card-pattern-dots">
            <div className="flex flex-col h-full relative z-10">
              <Wallet className="w-5 h-5 text-emerald-500 mb-3" />
              <h5 className="text-sm font-bold text-on-surface mb-1.5">预算控制良好</h5>
              <p className="text-xs text-outline leading-relaxed">交通与住宿分配均衡，整体更省心</p>
            </div>
          </div>
          <div className="relative bg-orange-50/50 p-4 md:p-5 rounded-xl border border-orange-100/50 overflow-hidden card-pattern-mountains">
            <div className="flex flex-col h-full relative z-10">
              <Mountain className="w-5 h-5 text-orange-500 mb-3" />
              <h5 className="text-sm font-bold text-on-surface mb-1.5">覆盖核心景点</h5>
              <p className="text-xs text-outline leading-relaxed">包含古城、洱海与当地特色体验</p>
            </div>
          </div>
          <div className="relative bg-purple-50/50 p-4 md:p-5 rounded-xl border border-purple-100/50 overflow-hidden card-pattern-geo">
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
  conversations, activeConvId, onSelectConversation, onRenameConversation, onDeleteConversation,
}: {
  chatOpen: boolean;
  setChatOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  chatHistory: ChatMsg[];
  chatLoading: boolean;
  chatError: string | null;
  inputValue: string;
  setInputValue: (v: string) => void;
  onRefine: (
    overrideText?: string,
    attachments?: ChatAttachmentPayload[],
    displayAttachments?: ChatMsg['attachments'],
    displayTextOverride?: string,
  ) => void;
  onNewChat: () => void;
  onConfirmReplan: (idx: number, action: 'accepted' | 'dismissed') => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  conversations: Conversation[];
  activeConvId: string | null;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [attachments, setAttachments] = useState<Array<{
    id: string;
    name: string;
    kind: 'image' | 'file';
    status: 'uploading' | 'ready';
    mimeType?: string;
    dataBase64?: string;
    sizeBytes?: number;
  }>>([]);
  const recognitionRef = useRef<any>(null);
  const speechBaseInputRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const groups: { label: string; items: Conversation[] }[] = [];
  const today = conversations.filter(c => new Date(c.updated_at) >= todayStart);
  const yesterday = conversations.filter(c => { const d = new Date(c.updated_at); return d >= yesterdayStart && d < todayStart; });
  const older = conversations.filter(c => new Date(c.updated_at) < yesterdayStart);
  if (today.length) groups.push({ label: 'Today', items: today });
  if (yesterday.length) groups.push({ label: 'Yesterday', items: yesterday });
  if (older.length) groups.push({ label: 'Earlier', items: older });

  const activeTitle = conversations.find(c => c.conversation_id === activeConvId)?.title ?? 'New AI chat';
  const activeTitleDisplay = activeTitle.length > 16 ? `${activeTitle.slice(0, 16)}...` : activeTitle;
  const canManageActiveConv = Boolean(activeConvId);

  const handleOpenRenameDialog = useCallback(() => {
    if (!activeConvId) return;
    setRenameValue(activeTitle);
    setHeaderMenuOpen(false);
    setRenameDialogOpen(true);
  }, [activeConvId, activeTitle]);

  const handleSubmitRename = useCallback(() => {
    if (!activeConvId) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) return;
    onRenameConversation(activeConvId, nextTitle);
    setRenameDialogOpen(false);
  }, [activeConvId, renameValue, onRenameConversation]);

  const handleDeleteFromHeaderMenu = useCallback(() => {
    if (!activeConvId) return;
    onDeleteConversation(activeConvId);
    setHeaderMenuOpen(false);
  }, [activeConvId, onDeleteConversation]);

  const addAttachments = useCallback((files: File[]) => {
    if (!files.length) return;
    const readAsDataURL = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const created = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name || (file.type.startsWith('image/') ? 'image.png' : 'file'),
      kind: file.type.startsWith('image/') ? 'image' as const : 'file' as const,
      status: 'uploading' as const,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    }));
    setAttachments(prev => [...created, ...prev]);
    created.forEach(async (item, idx) => {
      try {
        const dataUrl = await readAsDataURL(files[idx]);
        const minimumDelay = 450 + idx * 120;
        setTimeout(() => {
          setAttachments(prev => prev.map(a => (
            a.id === item.id
              ? { ...a, status: 'ready', dataBase64: dataUrl.split(',')[1] ?? '' }
              : a
          )));
        }, minimumDelay);
      } catch {
        setAttachments(prev => prev.filter(a => a.id !== item.id));
      }
    });
  }, []);

  const handlePasteAttachments = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!e.clipboardData?.items) return;
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    addAttachments(files);
  }, [addAttachments]);

  const handlePickFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    addAttachments(files);
    e.currentTarget.value = '';
  }, [addAttachments]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleSubmitChat = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed && attachments.length === 0) return;
    if (attachments.some(a => a.status === 'uploading')) return;
    const readyAttachments = attachments
      .filter(a => a.status === 'ready' && a.dataBase64)
      .slice(0, 6);
    const payloads: ChatAttachmentPayload[] = readyAttachments
      .map(a => ({
        name: a.name,
        mime_type: a.mimeType || (a.kind === 'image' ? 'image/png' : 'application/octet-stream'),
        data_base64: a.dataBase64 || '',
        size_bytes: a.sizeBytes,
      }));
    const displayAttachments: ChatMsg['attachments'] = readyAttachments
      .map(a => ({
        name: a.name,
        kind: a.kind,
        data_url: a.dataBase64 ? `data:${a.mimeType || (a.kind === 'image' ? 'image/png' : 'application/octet-stream')};base64,${a.dataBase64}` : undefined,
      }));
    const composed = trimmed || (payloads.length ? '请根据我上传的附件回答。' : '');
    onRefine(composed, payloads, displayAttachments, trimmed);
    setInputValue('');
    setAttachments([]);
  }, [inputValue, attachments, onRefine, setInputValue]);

  useEffect(() => {
    setAttachments([]);
  }, [activeConvId]);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSpeechSupported(false);
      return;
    }
    setSpeechSupported(true);
    const recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript ?? '';
      }
      const next = transcript.trim();
      const base = speechBaseInputRef.current;
      setInputValue(base && next ? `${base} ${next}` : (base || next));
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, [setInputValue]);

  const handleToggleSpeechInput = useCallback(() => {
    if (!speechSupported || !recognitionRef.current) return;
    if (isListening) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      return;
    }
    speechBaseInputRef.current = inputValue.trim();
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, [speechSupported, isListening, inputValue]);
  return (
    <div className="fixed bottom-4 md:bottom-6 right-4 md:right-6 z-40">
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute bottom-16 right-0 w-[calc(100vw-32px)] sm:w-[380px] md:w-[420px] bg-white/98 backdrop-blur-2xl rounded-2xl border border-outline-variant/15 shadow-[0_12px_48px_rgba(87,94,112,0.18)] overflow-hidden flex flex-col"
            style={{ maxHeight: 'calc(100vh - 160px)' }}
          >
            {/* ── Header ── */}
            <div className="flex items-center px-3 py-2 border-b border-outline-variant/10 flex-shrink-0 gap-2">
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
              {/* Session selector dropdown */}
              <div className="relative flex-1">
                <button
                  onClick={() => setDropdownOpen(o => !o)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-on-surface/75 hover:text-on-surface px-2 py-1 rounded-lg hover:bg-surface-container-low transition-colors max-w-[190px]"
                >
                  <span className="truncate text-left">{activeTitleDisplay}</span>
                  <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {dropdownOpen && <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />}
                <AnimatePresence>
                  {dropdownOpen && (
                    <motion.div
                      key="conv-dropdown"
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      transition={{ duration: 0.12 }}
                      className="absolute top-full left-0 mt-1 w-[220px] bg-white rounded-xl shadow-[0_8px_32px_rgba(87,94,112,0.16)] border border-outline-variant/15 z-50 overflow-hidden py-1.5"
                    >
                      {groups.length === 0 ? (
                        <p className="text-outline/50 text-xs px-3 py-2">暂无历史对话</p>
                      ) : groups.map(g => (
                        <div key={g.label}>
                          <p className="text-outline/60 text-[10px] font-semibold uppercase tracking-wider px-3 pt-2 pb-1">{g.label}</p>
                          {g.items.map(c => (
                            <div
                              key={c.conversation_id}
                              className={`group flex items-center text-[13px] transition-colors ${
                                activeConvId === c.conversation_id
                                  ? 'text-on-surface bg-surface-container-high'
                                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                              }`}
                            >
                              <button
                                onClick={() => { onSelectConversation(c.conversation_id); setDropdownOpen(false); }}
                                className="flex-1 text-left px-3 py-2 flex items-center gap-2 min-w-0"
                              >
                                <span className="truncate">{c.title}</span>
                                {activeConvId === c.conversation_id && <Check className="w-3 h-3 flex-shrink-0 text-primary" />}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteConversation(c.conversation_id); }}
                                className="opacity-0 group-hover:opacity-100 pr-2 text-outline/40 hover:text-red-400 transition-all"
                                title="删除"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
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
                <button
                  onClick={() => setHeaderMenuOpen(o => !o)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>
                  </svg>
                </button>
                {headerMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setHeaderMenuOpen(false)} />}
                <AnimatePresence>
                  {headerMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      transition={{ duration: 0.12 }}
                      className="absolute top-[44px] right-10 z-50 w-44 rounded-xl border border-outline-variant/20 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.12)] py-1.5"
                    >
                      <button
                        onClick={handleOpenRenameDialog}
                        disabled={!canManageActiveConv}
                        className="w-full px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low disabled:opacity-40 disabled:hover:bg-transparent transition-colors flex items-center gap-2"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                        </svg>
                        <span>Rename</span>
                      </button>
                      <button
                        onClick={handleDeleteFromHeaderMenu}
                        disabled={!canManageActiveConv}
                        className="w-full px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors flex items-center gap-2"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                        <span>Delete</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                      <div className="max-w-[85%] flex flex-col items-end gap-2">
                        {msg.attachments && msg.attachments.length > 0 && (() => {
                          const imageAttachments = msg.attachments.filter(a => a.kind === 'image' && a.data_url);
                          const fileAttachments = msg.attachments.filter(a => !(a.kind === 'image' && a.data_url));
                          const visibleImages = imageAttachments.slice(0, 3);
                          const hiddenImageCount = imageAttachments.length - visibleImages.length;
                          const singleImageMode = imageAttachments.length === 1;

                          return (
                            <div className="space-y-2">
                              {imageAttachments.length > 0 && (
                                <div className={singleImageMode ? 'inline-block' : 'flex flex-wrap justify-end gap-2 max-w-[75vw]'}>
                                  {visibleImages.map((att, idx) => (
                                    <div
                                      key={`${att.name}-${idx}`}
                                      className={`relative overflow-hidden ${
                                        singleImageMode
                                          ? 'w-[240px] max-w-[62vw] aspect-[4/3] rounded-2xl border border-outline-variant/15 shadow-[0_6px_18px_rgba(0,0,0,0.08)] bg-white'
                                          : 'w-[108px] h-[108px] rounded-2xl border border-outline-variant/15 bg-white'
                                      }`}
                                    >
                                      <button
                                        onClick={() => setPreviewImage({ src: att.data_url || '', name: att.name })}
                                        className="w-full h-full block"
                                        title="点击放大预览"
                                      >
                                        <img
                                          src={att.data_url}
                                          alt={att.name}
                                          className="w-full h-full object-cover"
                                        />
                                      </button>
                                      {idx === 2 && hiddenImageCount > 0 && (
                                        <div className="absolute inset-0 bg-black/45 text-white text-sm font-semibold flex items-center justify-center">
                                          +{hiddenImageCount}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {fileAttachments.length > 0 && (
                                <div className="flex flex-wrap justify-end gap-1.5 max-w-[75vw]">
                                  {fileAttachments.map((att, idx) => (
                                    <div key={`${att.name}-${idx}`} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] border border-outline-variant/25 bg-white/75 text-on-surface">
                                      <span className="w-2 h-2 rounded-full bg-primary/70 flex-shrink-0" />
                                      <span className="truncate max-w-[160px]">{att.name}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {msg.text && (
                          <div className="inline-block px-4 py-2 bg-surface-container-high text-on-surface text-sm rounded-2xl rounded-br-md">
                            <p>{msg.text}</p>
                          </div>
                        )}
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
                            <div className="prose prose-sm prose-neutral max-w-none text-[14px] leading-relaxed prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-strong:text-on-surface prose-strong:font-semibold prose-headings:text-on-surface prose-headings:font-semibold prose-h3:text-[15px] prose-h4:text-[14px] prose-p:text-on-surface prose-li:text-on-surface">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                            </div>
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
                {attachments.length > 0 && (
                  <div className="px-3.5 pt-3 pb-0.5 flex flex-wrap gap-1.5">
                    {attachments.map((a) => (
                      <div
                        key={a.id}
                        className={`max-w-[190px] inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] border ${
                          a.status === 'uploading'
                            ? 'bg-surface-container-low text-on-surface-variant border-outline-variant/25'
                            : 'bg-surface-container-high text-on-surface border-outline-variant/30'
                        }`}
                      >
                        {a.status === 'uploading' ? (
                          <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-primary/70 flex-shrink-0" />
                        )}
                        <span className="truncate">{a.name}</span>
                        <button
                          onClick={() => handleRemoveAttachment(a.id)}
                          className="text-on-surface-variant/60 hover:text-on-surface transition-colors"
                          title="移除附件"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="px-3.5 pt-3 pb-1">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onPaste={handlePasteAttachments}
                    onKeyDown={(e) => e.key === 'Enter' && !chatLoading && handleSubmitChat()}
                    placeholder="Do anything with AI..."
                    className="w-full bg-transparent border-none focus:ring-0 text-sm text-on-surface placeholder-outline/40 outline-none"
                    disabled={chatLoading}
                    autoFocus
                  />
                </div>
                <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
                  <div className="flex items-center gap-0.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,*/*"
                      className="hidden"
                      onChange={handlePickFiles}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/40 hover:bg-surface-container-low hover:text-on-surface-variant transition-colors"
                      title="添加图片或文件"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/40 hover:bg-surface-container-low hover:text-on-surface-variant transition-colors">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-on-surface-variant/35 px-1.5 select-none">Auto</span>
                <button
                  onClick={handleToggleSpeechInput}
                  disabled={!speechSupported}
                  title={
                    !speechSupported
                      ? '当前浏览器不支持语音输入'
                      : (isListening ? '停止语音输入' : '开始语音输入')
                  }
                  className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                    isListening
                      ? 'text-red-500 bg-red-50'
                      : 'text-on-surface-variant/40 hover:bg-surface-container-low hover:text-on-surface-variant'
                  } disabled:opacity-30 disabled:hover:bg-transparent`}
                >
                  <Mic className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSubmitChat}
                  disabled={chatLoading || attachments.some(a => a.status === 'uploading') || (!inputValue.trim() && attachments.length === 0)}
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

      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/65 flex items-center justify-center p-6"
            onClick={() => setPreviewImage(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.15 }}
              className="relative max-w-[88vw] max-h-[84vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={previewImage.src}
                alt={previewImage.name}
                className="max-w-[88vw] max-h-[84vh] object-contain rounded-2xl shadow-[0_20px_80px_rgba(0,0,0,0.45)] bg-white"
              />
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                title="关闭预览"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renameDialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
            onClick={() => setRenameDialogOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 6 }}
              transition={{ duration: 0.15 }}
              className="w-[360px] rounded-2xl bg-white border border-outline-variant/20 shadow-[0_18px_60px_rgba(0,0,0,0.2)] p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-on-surface">Rename chat</h3>
              <p className="mt-1 text-xs text-on-surface-variant">为当前对话设置新标题</p>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmitRename();
                  if (e.key === 'Escape') setRenameDialogOpen(false);
                }}
                placeholder="输入新的标题"
                className="mt-4 w-full h-10 rounded-lg border border-outline-variant/25 px-3 text-sm text-on-surface outline-none focus:border-primary/60"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setRenameDialogOpen(false)}
                  className="px-3.5 h-9 rounded-lg text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitRename}
                  disabled={!renameValue.trim()}
                  className="px-3.5 h-9 rounded-lg text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity"
                >
                  Save
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
