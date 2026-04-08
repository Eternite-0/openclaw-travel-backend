import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Share, Sun, ThumbsUp, Train, Hotel, Clock, Wallet,
  Mountain, Network, User, Bot, Loader2,
  Plus, ArrowUp, ArrowLeft, X, Mic, SlidersHorizontal, ChevronDown, Check,
  ShoppingCart, PlaneTakeoff, Building2, MapPin, CalendarDays, Users,
  Wifi, UtensilsCrossed, CarFront, Castle, Trees, Star,
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
      />

      {/* Main Content */}
      <main className="ml-0 lg:ml-[220px] pt-16 min-h-screen bg-surface-container-lowest px-4 md:px-6 lg:px-8 pb-24">
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
            <RecommendationShowcaseWidget itinerary={itinerary} />
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

interface SelectableHotel {
  id: string;
  name: string;
  subtitle: string;
  area: string;
  locationLabel: string;
  themeLabel: string;
  rating: number;
  pricePerNightCny: number;
  totalPriceCny: number;
  bookingTip: string;
  highlights: string[];
  image: string;
  badge: string;
  locationHighlights: Array<{ title: string; subtitle: string; icon: 'castle' | 'trees' | 'hotel' }>;
  amenities: string[];
  roomTypes: Array<{
    name: string;
    description: string;
    pricePerNightCny: number;
    image: string;
    badge?: string;
  }>;
  review: {
    score: number;
    label: string;
    quotes: Array<{ text: string; author: string }>;
    breakdown: Array<{ label: string; score: number }>;
    entries: Array<{
      author: string;
      meta: string;
      title: string;
      body: string;
      rating: number;
      sentiment: 'good' | 'poor';
      avatar: string;
      tags?: Array<{ label: string; tone: 'positive' | 'negative' }>;
      gallery?: string[];
    }>;
  };
}

function HotelSelectionView({
  hotels,
  selectedHotelId,
  onSelect,
  onConfirm,
  onViewDetails,
  destinationLabel,
  dateLabel,
  guestsLabel,
}: {
  hotels: SelectableHotel[];
  selectedHotelId: string;
  onSelect: (hotelId: string) => void;
  onConfirm: () => void;
  onViewDetails: (hotelId: string) => void;
  destinationLabel: string;
  dateLabel: string;
  guestsLabel: string;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const priceValues = hotels.map((hotel) => hotel.pricePerNightCny);
  const minHotelPrice = priceValues.length ? Math.min(...priceValues) : 0;
  const maxHotelPrice = priceValues.length ? Math.max(...priceValues) : 10000;
  const availableAmenities = Array.from(new Set(hotels.flatMap((hotel) => hotel.amenities)));
  const [priceRange, setPriceRange] = useState<[number, number]>([minHotelPrice, maxHotelPrice]);
  const [minRating, setMinRating] = useState(0);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const selectedHotel = hotels.find(hotel => hotel.id === selectedHotelId) ?? hotels[0];
  const filteredHotels = hotels.filter((hotel) => (
    hotel.pricePerNightCny >= priceRange[0]
    && hotel.pricePerNightCny <= priceRange[1]
    && hotel.rating >= minRating
    && selectedAmenities.every((amenity) => hotel.amenities.includes(amenity))
  ));
  const visibleHotels = filteredHotels.length > 0 ? filteredHotels : hotels;

  useEffect(() => {
    setPriceRange(([currentMin, currentMax]) => [
      Math.max(minHotelPrice, Math.min(currentMin, maxHotelPrice)),
      Math.max(minHotelPrice, Math.min(currentMax, maxHotelPrice)),
    ]);
  }, [minHotelPrice, maxHotelPrice]);

  const toggleAmenity = useCallback((amenity: string) => {
    setSelectedAmenities((prev) => (
      prev.includes(amenity)
        ? prev.filter((item) => item !== amenity)
        : [...prev, amenity]
    ));
  }, []);

  const resetFilters = useCallback(() => {
    setPriceRange([minHotelPrice, maxHotelPrice]);
    setMinRating(0);
    setSelectedAmenities([]);
  }, [minHotelPrice, maxHotelPrice]);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-surface-container-lowest">
        <section className="mb-4">
          <div className="bg-surface-container-lowest rounded-2xl p-3 shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex flex-col gap-2 ring-1 ring-outline-variant/10">
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center gap-3 bg-surface-container-low px-4 py-2 rounded-xl">
                <MapPin className="w-4 h-4 text-primary" />
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-primary/50 uppercase tracking-widest leading-none mb-0.5">目的地</span>
                  <span className="font-bold text-sm text-on-surface">{destinationLabel}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-3 bg-surface-container-low px-4 py-2 rounded-xl">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-primary/50 uppercase tracking-widest leading-none mb-0.5">日期</span>
                    <span className="font-bold text-sm text-on-surface">{dateLabel}</span>
                  </div>
                </div>
                <div className="flex-1 flex items-center gap-3 bg-surface-container-low px-4 py-2 rounded-xl">
                  <Users className="w-4 h-4 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-primary/50 uppercase tracking-widest leading-none mb-0.5">人数</span>
                    <span className="font-bold text-sm text-on-surface">{guestsLabel}</span>
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              className="bg-primary text-on-primary py-2.5 rounded-xl shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">筛选</span>
            </button>
          </div>
        </section>

        <div className="mb-4 flex justify-between items-center px-1">
          <div>
            <h3 className="text-lg font-extrabold text-primary tracking-tight">京都精选酒店</h3>
            <p className="text-on-surface-variant text-[11px]">{visibleHotels.length} 家符合条件</p>
          </div>
          <span className="text-[10px] font-bold text-primary bg-primary-fixed px-2 py-1 rounded-full uppercase tracking-wider">综合排序</span>
        </div>

        <div className="grid grid-cols-1 gap-4 pb-2">
          {visibleHotels.map((hotel) => {
            const isSelected = hotel.id === selectedHotelId;

            return (
              <motion.button
                key={hotel.id}
                layout
                type="button"
                onClick={() => onSelect(hotel.id)}
                transition={{ layout: { type: 'spring', stiffness: 280, damping: 28, mass: 0.9 } }}
                className={`group cursor-pointer text-left w-full rounded-2xl overflow-hidden bg-surface-container-lowest ring-1 border-none transition-shadow duration-300 ${
                  isSelected
                    ? 'ring-primary/35 shadow-[0_18px_40px_rgba(70,76,95,0.14)]'
                    : 'ring-outline-variant/10 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:shadow-[0_12px_30px_rgba(70,76,95,0.08)]'
                }`}
              >
                <motion.div
                  layout
                  transition={{ layout: { type: 'spring', stiffness: 280, damping: 28, mass: 0.9 } }}
                  className={isSelected ? 'flex flex-col' : 'flex h-32'}
                >
                  <div className={`${isSelected ? 'h-48 w-full' : 'w-1/3 h-full'} overflow-hidden relative`}>
                    <img
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      alt={hotel.name}
                      src={hotel.image}
                    />
                    <div className={`absolute ${isSelected ? 'top-3 left-3' : 'top-2 right-2'} bg-white/85 backdrop-blur px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm`}>
                      <span className="text-[11px] leading-none text-amber-500">★</span>
                      <span className="text-[10px] font-bold text-on-surface">{hotel.rating.toFixed(1)}</span>
                    </div>
                    {isSelected && (
                      <div className="absolute top-3 right-3">
                        <span className="bg-tertiary-container/90 backdrop-blur text-on-tertiary-container text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest">VIP 臻选</span>
                      </div>
                    )}
                  </div>

                  <div className={isSelected ? 'p-4 flex flex-col gap-3' : 'w-2/3 p-3 flex flex-col justify-between'}>
                    <div>
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <h4 className={`${isSelected ? 'text-lg' : 'text-sm'} font-extrabold text-primary line-clamp-1`}>{hotel.name}</h4>
                          <p className={`${isSelected ? 'text-sm font-bold text-primary/60' : 'text-[11px] text-on-surface-variant'} mt-1 line-clamp-1`}>{hotel.subtitle}</p>
                        </div>
                        {isSelected && (
                          <div className="flex items-center gap-1 bg-surface-container px-2 py-1 rounded-lg flex-shrink-0">
                            <span className="text-[11px] font-bold text-on-surface">{hotel.badge}</span>
                          </div>
                        )}
                      </div>
                      <p className={`${isSelected ? 'text-xs line-clamp-2 leading-relaxed mt-2' : 'text-[11px] line-clamp-2 mt-1'} text-on-surface-variant`}>{hotel.bookingTip}</p>
                    </div>

                    <div className="flex items-center justify-between mt-auto gap-2">
                      <div className="flex items-baseline gap-1">
                        <span className={`${isSelected ? 'text-lg' : 'text-sm'} font-extrabold text-primary`}>¥{hotel.pricePerNightCny.toLocaleString()}</span>
                        <span className="text-[9px] font-medium text-on-surface-variant">/ 晚</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewDetails(hotel.id);
                          }}
                          className="font-bold text-[11px] px-3 py-1 rounded-lg border border-primary/20 text-primary bg-white hover:bg-primary/5 transition-all active:scale-95"
                        >
                          查看详情
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(hotel.id);
                          }}
                          className={`font-bold text-[11px] px-3 py-1 rounded-lg transition-all active:scale-95 ${
                            isSelected
                              ? 'text-on-primary bg-primary shadow-md shadow-primary/20'
                              : 'text-on-surface-variant bg-surface-container hover:bg-surface-container-high'
                          }`}
                          aria-pressed={isSelected}
                        >
                          {isSelected ? '已选择' : '选择'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {filterOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFilterOpen(false)}
              className="absolute inset-0 bg-black/20 backdrop-blur-[2px] z-10"
            />
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 28, scale: 0.98 }}
              transition={{ duration: 0.22 }}
              className="absolute inset-x-4 bottom-24 z-20 rounded-[28px] bg-white border border-outline-variant/20 shadow-[0_24px_80px_rgba(25,28,30,0.18)] p-5"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h4 className="text-lg font-headline font-extrabold text-primary">筛选酒店</h4>
                  <p className="text-[11px] text-on-surface-variant mt-1">选择偏好，优化酒店展示体验</p>
                </div>
                <button type="button" onClick={() => setFilterOpen(false)} className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-outline">预算</span>
                    <span className="text-sm font-bold text-primary">¥{priceRange[0].toLocaleString()} - ¥{priceRange[1].toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface-container-low rounded-2xl p-3">
                      <p className="text-[10px] font-bold text-outline uppercase tracking-wider">最低价</p>
                      <input
                        type="range"
                        min={minHotelPrice}
                        max={maxHotelPrice}
                        step={50}
                        value={priceRange[0]}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          setPriceRange(([_, max]) => [Math.min(next, max), max]);
                        }}
                        className="mt-3 w-full accent-[var(--color-primary)]"
                      />
                    </div>
                    <div className="bg-surface-container-low rounded-2xl p-3">
                      <p className="text-[10px] font-bold text-outline uppercase tracking-wider">最高价</p>
                      <input
                        type="range"
                        min={minHotelPrice}
                        max={maxHotelPrice}
                        step={50}
                        value={priceRange[1]}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          setPriceRange(([min]) => [min, Math.max(next, min)]);
                        }}
                        className="mt-3 w-full accent-[var(--color-primary)]"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-outline">评分</span>
                    <span className="text-sm font-bold text-primary">{minRating === 0 ? '不限' : `${minRating.toFixed(1)}+`}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[0, 4.5, 4.8, 4.9].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMinRating(value)}
                        className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${
                          minRating === value
                            ? 'bg-primary text-on-primary border-primary shadow-sm'
                            : 'bg-surface-container-low text-on-surface border-outline-variant/20'
                        }`}
                      >
                        {value === 0 ? '不限' : `${value.toFixed(1)}+`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-outline">设施</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableAmenities.map((amenity) => (
                      <button
                        key={amenity}
                        type="button"
                        onClick={() => toggleAmenity(amenity)}
                        className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${
                          selectedAmenities.includes(amenity)
                            ? 'bg-primary text-on-primary border-primary shadow-sm'
                            : 'bg-surface-container-low text-on-surface border-outline-variant/20'
                        }`}
                      >
                        {amenity}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="flex-1 py-3 rounded-2xl bg-surface-container-low text-on-surface font-bold text-sm"
                >
                  重置
                </button>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="flex-[1.3] py-3 rounded-2xl bg-primary text-on-primary font-bold text-sm shadow-lg shadow-primary/20"
                >
                  确认
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="px-5 py-4 border-t border-outline-variant/10 bg-white/90 backdrop-blur-2xl flex-shrink-0"
      >
        <button
          onClick={onConfirm}
          className="w-full bg-primary text-white py-3 rounded-xl font-headline font-bold text-sm shadow-lg shadow-primary/20 hover:bg-primary-dim active:scale-[0.99] transition-all"
        >
          使用「{selectedHotel?.name ?? '当前酒店'}」
        </button>
      </motion.div>
    </>
  );
}

function HotelDetailView({
  hotel,
  onBack,
  onToggleNestedView,
  selectedRoomName,
  onSelectRoom,
}: {
  hotel: SelectableHotel;
  onBack: () => void;
  onToggleNestedView?: (isNested: boolean) => void;
  selectedRoomName?: string | null;
  onSelectRoom?: (roomName: string) => void;
}) {
  const roomsScrollerRef = useRef<HTMLDivElement>(null);
  const [showReviewDetails, setShowReviewDetails] = useState(false);
  const dragStateRef = useRef<{ isDragging: boolean; hasMoved: boolean; startX: number; startScrollLeft: number }>({
    isDragging: false,
    hasMoved: false,
    startX: 0,
    startScrollLeft: 0,
  });

  const amenityIcons = {
    'Free Wi-Fi': Wifi,
    Spa: Sun,
    Dining: UtensilsCrossed,
    Parking: CarFront,
    Butler: User,
    Onsen: Mountain,
    'Boat Transfer': Train,
  } satisfies Record<string, React.ComponentType<{ className?: string }>>;

  const locationIcons = {
    castle: Castle,
    trees: Trees,
    hotel: Hotel,
  } satisfies Record<'castle' | 'trees' | 'hotel', React.ComponentType<{ className?: string }>>;

  const handleRoomsPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = roomsScrollerRef.current;
    if (!container) return;
    if ((event.target as HTMLElement).closest('button')) return;

    dragStateRef.current = {
      isDragging: true,
      hasMoved: false,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
    };
    container.setPointerCapture(event.pointerId);
  }, []);

  const handleRoomsPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = roomsScrollerRef.current;
    const dragState = dragStateRef.current;
    if (!container || !dragState.isDragging) return;

    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 4) {
      dragStateRef.current.hasMoved = true;
    }
    container.scrollLeft = dragState.startScrollLeft - deltaX;
  }, []);

  const handleRoomsPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = roomsScrollerRef.current;
    if (!container) return;

    dragStateRef.current.isDragging = false;
    dragStateRef.current.hasMoved = false;
    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleRoomsPointerLeave = useCallback(() => {
    dragStateRef.current.isDragging = false;
    dragStateRef.current.hasMoved = false;
  }, []);

  useEffect(() => {
    onToggleNestedView?.(showReviewDetails);
    return () => onToggleNestedView?.(false);
  }, [showReviewDetails, onToggleNestedView]);

  if (showReviewDetails) {
    return (
      <HotelReviewDetailView
        hotel={hotel}
        onBack={() => setShowReviewDetails(false)}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface-container-lowest">
      <section className="relative h-[360px] w-full">
        <img
          alt={hotel.name}
          className="w-full h-full object-cover"
          src={hotel.image}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute top-4 right-4 flex items-center justify-end">
          <button
            type="button"
            className="w-10 h-10 rounded-full bg-white/85 backdrop-blur flex items-center justify-center text-primary shadow-sm"
          >
            <Share className="w-4 h-4" />
          </button>
        </div>
        <div className="absolute bottom-0 left-0 w-full p-6 pb-7">
          <div className="flex items-center gap-1 mb-2 text-tertiary-fixed">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star key={index} className="w-3.5 h-3.5 fill-current stroke-0" />
            ))}
            <span className="text-white text-[10px] font-extrabold ml-2 tracking-[0.2em] uppercase">{hotel.themeLabel}</span>
          </div>
          <h3 className="font-headline text-3xl font-extrabold text-white leading-tight tracking-tight">{hotel.name}</h3>
          <div className="flex items-center mt-2 text-white/90">
            <MapPin className="w-4 h-4 mr-1.5" />
            <span className="text-sm font-medium">{hotel.locationLabel}</span>
          </div>
        </div>
      </section>

      <div className="px-5 mt-5 relative z-10">
        <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-[0_8px_32px_rgba(25,28,30,0.08)] grid grid-cols-2 gap-4">
          <div>
            <h4 className="font-headline text-[10px] font-extrabold uppercase tracking-widest text-primary mb-3 opacity-70">The Location</h4>
            <ul className="space-y-3">
              {hotel.locationHighlights.map((item) => {
                const Icon = locationIcons[item.icon];
                return (
                  <li key={item.title} className="flex items-start gap-2.5">
                    <Icon className="w-4 h-4 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-bold leading-tight">{item.title}</p>
                      <p className="text-[10px] text-secondary">{item.subtitle}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="border-l border-outline-variant/20 pl-4">
            <h4 className="font-headline text-[10px] font-extrabold uppercase tracking-widest text-primary mb-3 opacity-70">Amenities</h4>
            <div className="grid grid-cols-2 gap-y-3 gap-x-2">
              {hotel.amenities.map((amenity) => {
                const Icon = amenityIcons[amenity] ?? Hotel;
                return (
                  <div key={amenity} className="flex flex-col items-center text-center">
                    <Icon className="w-5 h-5 text-primary mb-1" />
                    <span className="text-[8px] font-bold uppercase tracking-tighter">{amenity}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <section className="mt-8">
        <div className="px-5 flex justify-between items-end mb-3">
          <div>
            <h4 className="font-headline text-xl font-black text-primary tracking-tight">Available Rooms</h4>
            <p className="text-secondary text-[11px]">Select your sanctuary</p>
          </div>
          <button type="button" className="text-primary font-extrabold text-[10px] uppercase tracking-widest pb-1">View All</button>
        </div>
        <div
          ref={roomsScrollerRef}
          onPointerDown={handleRoomsPointerDown}
          onPointerMove={handleRoomsPointerMove}
          onPointerUp={handleRoomsPointerUp}
          onPointerCancel={handleRoomsPointerUp}
          onPointerLeave={handleRoomsPointerLeave}
          className="hotel-rooms-scroller flex overflow-x-auto gap-4 px-5 pb-3"
        >
          {hotel.roomTypes.map((room) => (
            <motion.div
              key={room.name}
              layout
              onClick={() => onSelectRoom?.(room.name)}
              animate={{
                y: selectedRoomName === room.name ? -4 : 0,
                scale: selectedRoomName === room.name ? 1.01 : 1,
              }}
              transition={{ type: 'spring', stiffness: 320, damping: 24, mass: 0.8 }}
              className={`flex-none w-[260px] bg-surface-container-lowest rounded-2xl overflow-hidden shadow-sm border transition-all ${
                selectedRoomName === room.name
                  ? 'border-primary/35 ring-1 ring-primary/20 shadow-[0_16px_36px_rgba(70,76,95,0.12)]'
                  : 'border-outline-variant/10 cursor-pointer'
              }`}
            >
              <div className="h-40 relative">
                <img
                  alt={room.name}
                  className="w-full h-full object-cover"
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  src={room.image}
                />
                {room.badge && (
                  <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-md px-2 py-0.5 rounded-full shadow-sm">
                    <p className="text-[8px] font-black text-primary uppercase tracking-tighter">{room.badge}</p>
                  </div>
                )}
              </div>
              <div className="p-3">
                <h5 className="font-headline font-bold text-sm mb-0.5">{room.name}</h5>
                <p className="text-secondary text-[10px] mb-3 line-clamp-2">{room.description}</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[8px] text-secondary uppercase font-black tracking-widest">Per Night</p>
                    <p className="text-primary font-black text-base">¥{room.pricePerNightCny.toLocaleString()}</p>
                  </div>
                  <motion.button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectRoom?.(room.name);
                    }}
                    aria-pressed={selectedRoomName === room.name}
                    animate={{
                      scale: selectedRoomName === room.name ? 1 : 0.96,
                    }}
                    transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                    className={`px-4 py-2 rounded-2xl text-[9px] font-extrabold uppercase tracking-widest border-[3px] transition-all active:scale-95 ${
                      selectedRoomName === room.name
                        ? 'bg-primary text-white border-slate-800 shadow-[0_8px_18px_rgba(70,76,95,0.2)]'
                        : 'bg-white text-primary border-slate-700 hover:bg-primary/5'
                    }`}
                  >
                    {selectedRoomName === room.name ? 'Selected' : 'Select'}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mt-8 px-5 pb-28">
        <h4 className="font-headline text-xl font-black text-primary tracking-tight mb-4">Guest Sentiment</h4>
        <div className="bg-primary-container p-5 rounded-2xl relative overflow-hidden shadow-lg">
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/5 rounded-full blur-2xl" />
          <div className="flex items-center justify-between mb-4">
            <div>
              <h5 className="font-headline text-2xl font-black text-slate-700">{hotel.review.score.toFixed(1)}<span className="text-base text-slate-500">/5</span></h5>
              <p className="text-[9px] uppercase tracking-[0.2em] font-extrabold text-slate-500">{hotel.review.label}</p>
            </div>
            <div className="text-xs font-black text-slate-600 bg-white/35 px-3 py-1 rounded-full">{hotel.badge}</div>
          </div>
          <div className="space-y-3">
            {hotel.review.quotes.map((quote, index) => (
              <div key={`${quote.author}-${index}`} className={index === 0 ? 'relative' : 'pt-3 border-t border-white/10'}>
                <p className={`text-[13px] italic text-slate-600 leading-snug ${index === 0 ? 'pl-4' : ''}`}>"{quote.text}"</p>
                <p className={`text-[8px] font-extrabold text-slate-400 mt-0.5 uppercase tracking-[0.15em] ${index === 0 ? 'pl-4' : ''}`}>- {quote.author}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowReviewDetails(true)}
            className="w-full mt-4 py-2.5 rounded-lg border border-slate-700 text-slate-700 text-[9px] font-black uppercase tracking-widest hover:bg-white/20 transition-colors"
          >
            Read Reviews
          </button>
        </div>
      </section>

      <div className="fixed bottom-0 right-0 w-full sm:w-[420px] z-10 bg-white/90 backdrop-blur-2xl px-5 pt-3 pb-5 border-t border-slate-200/40 shadow-[0_-8px_32px_rgba(25,28,30,0.08)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[8px] text-secondary font-black uppercase tracking-[0.2em] mb-0.5">Starting From</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-headline font-black text-primary tracking-tighter">
                ¥{(hotel.roomTypes.find((room) => room.name === selectedRoomName)?.pricePerNightCny ?? hotel.pricePerNightCny).toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-secondary opacity-70">/ night</span>
            </div>
          </div>
          <button type="button" className="bg-primary text-white px-7 py-3 rounded-xl font-headline font-black text-xs tracking-[0.15em] uppercase shadow-lg shadow-primary/20 active:scale-95 transition-all">
            Book Now
          </button>
        </div>
      </div>
    </div>
  );
}

function HotelReviewDetailView({
  hotel,
  onBack,
}: {
  hotel: SelectableHotel;
  onBack: () => void;
}) {
  const [reviewFilter, setReviewFilter] = useState<'all' | 'good' | 'poor'>('all');

  const filteredEntries = hotel.review.entries.filter((entry) => {
    if (reviewFilter === 'all') return true;
    return entry.sentiment === reviewFilter;
  });
  const goodCount = hotel.review.entries.filter((entry) => entry.sentiment === 'good').length;
  const poorCount = hotel.review.entries.filter((entry) => entry.sentiment === 'poor').length;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-container-lowest text-on-background min-h-full">
      <header className="sticky top-0 z-20 bg-surface/85 backdrop-blur-xl flex items-center justify-between px-5 h-14 border-b border-outline-variant/30">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="active:scale-95 transition-transform p-1 text-on-surface">
            <ArrowLeft className="w-[22px] h-[22px]" />
          </button>
          <h1 className="font-bold text-base text-on-surface">Review Details</h1>
        </div>
        <button type="button" className="active:scale-95 transition-transform p-1 text-on-surface">
          <Share className="w-[20px] h-[20px]" />
        </button>
      </header>

      <main className="pt-5 pb-24 px-5 max-w-2xl mx-auto">
        <div className="mb-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-2xl font-extrabold text-primary tracking-tight">{hotel.name}</h2>
            <div className="flex items-center gap-1 bg-primary/5 px-2 py-0.5 rounded-lg border border-primary/10">
              <Star className="w-[14px] h-[14px] text-primary fill-current stroke-0" />
              <span className="text-primary font-bold text-sm">{hotel.review.score.toFixed(1)}</span>
            </div>
          </div>
          <p className="text-on-surface-variant text-[13px] mt-1 flex items-center gap-1 font-medium">
            <MapPin className="w-3.5 h-3.5" />
            {hotel.locationLabel}
          </p>
        </div>

        <section className="grid grid-cols-4 gap-3 mb-8">
          {hotel.review.breakdown.map((item) => (
            <div key={item.label} className="bg-surface-container-low/40 border border-outline-variant/20 p-3 rounded-xl flex flex-col items-start justify-between min-h-[72px]">
              <span className="text-[10px] font-bold text-outline uppercase tracking-wider">{item.label}</span>
              <span className="text-lg font-bold text-primary leading-none">{item.score.toFixed(1)}</span>
            </div>
          ))}
        </section>

        <nav className="flex gap-2 mb-6 overflow-x-auto pb-1 hotel-rooms-scroller">
          <button
            type="button"
            onClick={() => setReviewFilter('all')}
            className={`px-5 py-2 rounded-full font-bold text-xs whitespace-nowrap transition-all shadow-sm ${
              reviewFilter === 'all'
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface font-semibold border border-transparent hover:border-outline-variant/30'
            }`}
          >
            All ({hotel.review.entries.length})
          </button>
          <button
            type="button"
            onClick={() => setReviewFilter('good')}
            className={`px-5 py-2 rounded-full text-xs whitespace-nowrap border transition-all ${
              reviewFilter === 'good'
                ? 'bg-primary text-on-primary font-bold border-primary'
                : 'bg-surface-container text-on-surface font-semibold border-transparent hover:border-outline-variant/30'
            }`}
          >
            Good Reviews ({goodCount})
          </button>
          <button
            type="button"
            onClick={() => setReviewFilter('poor')}
            className={`px-5 py-2 rounded-full text-xs whitespace-nowrap border transition-all ${
              reviewFilter === 'poor'
                ? 'bg-primary text-on-primary font-bold border-primary'
                : 'bg-surface-container text-on-surface font-semibold border-transparent hover:border-outline-variant/30'
            }`}
          >
            Poor Reviews ({poorCount})
          </button>
        </nav>

        <div className="space-y-4">
          {filteredEntries.map((entry, index) => (
            <article key={`${entry.author}-${index}`} className="bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/40 shadow-sm">
              <div className="flex justify-between items-center mb-3 gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img alt={entry.author} className="w-10 h-10 rounded-full object-cover ring-2 ring-background" src={entry.avatar} />
                  <div className="min-w-0">
                    <h4 className="font-bold text-primary text-sm leading-tight">{entry.author}</h4>
                    <span className="text-[10px] text-outline font-medium">{entry.meta}</span>
                  </div>
                </div>
                <div className="flex text-tertiary flex-shrink-0">
                  {Array.from({ length: 5 }).map((_, starIndex) => (
                    <Star
                      key={starIndex}
                      className={`w-3.5 h-3.5 ${starIndex < entry.rating ? 'fill-current stroke-0' : 'text-outline-variant'}`}
                    />
                  ))}
                </div>
              </div>
              <h5 className="font-bold text-primary mb-2 text-base leading-snug">{entry.title}</h5>
              <p className="text-on-surface-variant text-[13px] leading-relaxed mb-4">{entry.body}</p>

              {entry.tags && entry.tags.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {entry.tags.map((tag) => (
                    <span
                      key={tag.label}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border ${
                        tag.tone === 'negative'
                          ? 'bg-error-container/40 text-error border-error/5'
                          : 'bg-primary/5 text-primary border-primary/5'
                      }`}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              )}

              {entry.gallery && entry.gallery.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pt-1">
                  {entry.gallery.map((image, imageIndex) => (
                    <div key={`${imageIndex}-${image}`} className="w-16 h-16 rounded-xl overflow-hidden bg-surface-container-high border border-outline-variant/20 flex-shrink-0">
                      <img alt={`${entry.author} review`} className="w-full h-full object-cover" src={image} />
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

function BookingSidebar({ itinerary }: {
  itinerary: FinalItinerary | null;
  title: string;
}) {
  type PassengerFormState = {
    name: string;
    role: string;
    countLabel: string;
  };

  const [isOpen, setIsOpen] = useState(false);
  const [isHotelPickerOpen, setIsHotelPickerOpen] = useState(false);
  const [detailHotelId, setDetailHotelId] = useState<string | null>(null);
  const [isNestedDetailView, setIsNestedDetailView] = useState(false);
  const [selectedRoomByHotel, setSelectedRoomByHotel] = useState<Record<string, string>>({});
  const [passengers, setPassengers] = useState<Array<PassengerFormState & { id: string; completed: boolean }>>([
    { id: 'primary', name: '张某某', role: '主要联系人', countLabel: '1位成人', completed: true },
  ]);
  const [passengerModalOpen, setPassengerModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [paymentMode, setPaymentMode] = useState<'combined' | 'split'>('combined');
  const [combinedPaymentState, setCombinedPaymentState] = useState<'idle' | 'processing' | 'success'>('idle');
  const [splitPaymentState, setSplitPaymentState] = useState<{
    flight: 'idle' | 'processing' | 'success';
    hotel: 'idle' | 'processing' | 'success';
  }>({
    flight: 'idle',
    hotel: 'idle',
  });
  const [newPassenger, setNewPassenger] = useState<PassengerFormState>({
    name: '',
    role: '同行旅客',
    countLabel: '1位成人',
  });

  const totalNights = itinerary?.days.length ?? 3;
  const flightPrice = itinerary?.recommended_flight
    ? Math.round(itinerary.recommended_flight.price_cny)
    : 1580;
  const baseHotelTotalPrice = itinerary?.recommended_hotel
    ? Math.round(
      itinerary.recommended_hotel.total_price_cny
      || itinerary.recommended_hotel.price_per_night_cny * totalNights,
    )
    : 1840;
  const departureTime = itinerary?.recommended_flight?.departure_time ? formatDT(itinerary.recommended_flight.departure_time) : '14:20';
  const arrivalTime = itinerary?.recommended_flight?.arrival_time ? formatDT(itinerary.recommended_flight.arrival_time) : '17:35';
  const durationLabel = itinerary?.recommended_flight?.duration_hours
    ? `${Math.floor(itinerary.recommended_flight.duration_hours)}H ${Math.round((itinerary.recommended_flight.duration_hours % 1) * 60)}M`
    : '3H 15M';
  const originCity = itinerary?.intent.origin_city ?? '上海';
  const destCity = itinerary?.intent.dest_city ?? '昆明';
  const flightCode = itinerary?.recommended_flight?.flight_number ?? 'MU5798';

  const hotelOptions = useMemo<SelectableHotel[]>(() => {
    const recommendedName = itinerary?.recommended_hotel?.name ?? `${destCity} Holiday Inn`;
    const recommendedRating = itinerary?.recommended_hotel?.stars
      ? Math.min(5, Math.max(4.2, itinerary.recommended_hotel.stars))
      : 4.8;

    return [
      {
        id: 'recommended',
        name: recommendedName,
        subtitle: `${destCity}柏悦酒店`,
        area: itinerary?.recommended_hotel?.area ?? `${destCity}核心区域`,
        locationLabel: `${itinerary?.recommended_hotel?.area ?? `${destCity}核心区域`}, ${destCity}, ${itinerary?.intent.dest_country ?? 'Japan'}`,
        themeLabel: 'Luxury Heritage',
        rating: recommendedRating,
        pricePerNightCny: Math.round(baseHotelTotalPrice / Math.max(totalNights, 1)),
        totalPriceCny: baseHotelTotalPrice,
        bookingTip: itinerary?.recommended_hotel?.booking_tip ?? '舒适高分酒店，适合城市漫游与短住。',
        highlights: itinerary?.recommended_hotel?.highlights?.slice(0, 3) ?? ['含早餐', '免费取消', '近商圈'],
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAZAVDAS5vry2vxBq9L2Cv3FjC44Po466vDUriL4CS9mhTTsfauAjDSeM2bBgSdsfxNiFLP446RRR2SPLoWWRnLUooYiLch5HkjfvVyi6LPSTWvvGpe-qqBV1xQnV24Ybo-i0vxk6eNMu4tm3DYf1C4StTh8PEZtzdyJY6804WcjSY-b1oJrPBqEqfTKQa-GIwS9bxKLpmNtWXiqlYm7ISzbVYGxB09tTgz3lTZ347YLLFFr-BSCW9tPlsP7Lm6Y67S4d4-4F7emWE',
        badge: itinerary?.recommended_hotel?.stars ? `${itinerary.recommended_hotel.stars}星` : '精选',
        locationHighlights: [
          { title: `${destCity}老城地标`, subtitle: '5 min walk', icon: 'castle' },
          { title: '文化街区', subtitle: '8 min walk', icon: 'trees' },
        ],
        amenities: ['Free Wi-Fi', 'Dining', 'Parking', 'Spa'],
        roomTypes: [
          {
            name: 'Deluxe King',
            description: `城景, 45sqm, 1 King bed`,
            pricePerNightCny: Math.round(baseHotelTotalPrice / Math.max(totalNights, 1)),
            image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80',
            badge: 'Best Seller',
          },
          {
            name: 'Executive Twin',
            description: `高楼层, 52sqm, 2 Twin beds`,
            pricePerNightCny: Math.round(baseHotelTotalPrice / Math.max(totalNights, 1)) + 320,
            image: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=80',
          },
        ],
        review: {
          score: recommendedRating,
          label: 'Exceptional',
          quotes: [
            { text: 'The location is convenient and the room feels calm after a full day out.', author: 'Lina C.' },
            { text: 'Great balance between comfort, service and value for a city stay.', author: 'Marcus T.' },
          ],
          breakdown: [
            { label: 'Clean', score: 5.0 },
            { label: 'Service', score: 4.9 },
            { label: 'Locale', score: 5.0 },
            { label: 'Value', score: 4.8 },
          ],
          entries: [
            {
              author: 'Alexandra Chen',
              meta: 'Oct 12, 2023 • Verified Stay',
              title: 'Amazing service and convenient city access',
              body: 'The attention to detail here is excellent. Staff were proactive, and the room felt calm and polished after long days exploring the city.',
              rating: 5,
              sentiment: 'good',
              avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
              tags: [
                { label: 'EXCELLENT LOCATION', tone: 'positive' },
                { label: 'SMOOTH CHECK-IN', tone: 'positive' },
              ],
            },
            {
              author: 'Marcus Tan',
              meta: 'Sep 28, 2023 • Solo Traveler',
              title: 'Strong value with only minor breakfast delays',
              body: 'The hotel is stylish and efficient. Breakfast got crowded around peak time, but overall service and comfort still made the stay feel premium.',
              rating: 4,
              sentiment: 'poor',
              avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
              tags: [
                { label: 'BREAKFAST QUEUE', tone: 'negative' },
                { label: 'QUIET ROOMS', tone: 'positive' },
              ],
            },
            {
              author: 'Sienna Mori',
              meta: 'Aug 15, 2023 • Verified Stay',
              title: 'Comfortable and easy to settle into',
              body: 'A very balanced stay overall. Good light, restful rooms, and a location that makes moving around the destination very easy.',
              rating: 5,
              sentiment: 'good',
              avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=200&q=80',
              gallery: [
                'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=300&q=80',
                'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=300&q=80',
              ],
            },
          ],
        },
      },
      {
        id: 'ritz',
        name: 'The Ritz-Carlton, Kyoto',
        subtitle: '京都丽思卡尔顿酒店',
        area: '鸭川河畔',
        locationLabel: 'Kamogawa Riverside, Kyoto, Japan',
        themeLabel: 'Riverfront Luxury',
        rating: 4.8,
        pricePerNightCny: 7200,
        totalPriceCny: 7200 * totalNights,
        bookingTip: '坐落于鸭川河畔，不仅拥有如画风景，更提供顶级日式管家服务。',
        highlights: ['含早餐', '免费取消', '河景房'],
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAb5RG0eCg7GlKTBSBId_PHdj8B1zfYnkm9z6JMjf4zaVRAc-8CgZxfCU4bBVTqYJq8CCoez6UQ22-eDLMsLD1OgU9hpaBpkSVHKMAzHL4L7genBMShpF_SOmcg-FyNGPjuPLjB7sagb_bFP46QT-WSvwl2vel9uMr6A9zAazrZ1-SD9ZJmza41zx3lFovgNo8eQTqsa_vS8daSkXLd1sVQflNuD3PHmy4xh-ohxeuvFjtOgSt5jcSGBVqXuPH68RBrY63qWp8fEgU',
        badge: '奢华',
        locationHighlights: [
          { title: 'Kamogawa River', subtitle: '2 min walk', icon: 'trees' },
          { title: 'Gion District', subtitle: '10 min drive', icon: 'castle' },
        ],
        amenities: ['Free Wi-Fi', 'Dining', 'Spa', 'Butler'],
        roomTypes: [
          {
            name: 'Garden Terrace King',
            description: 'Garden view, 56sqm, 1 King bed',
            pricePerNightCny: 7200,
            image: 'https://images.unsplash.com/photo-1522798514-97ceb8c4f1c8?auto=format&fit=crop&w=1200&q=80',
            badge: 'Popular',
          },
          {
            name: 'River Suite',
            description: 'River view, 78sqm, lounge access',
            pricePerNightCny: 8900,
            image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
          },
        ],
        review: {
          score: 4.8,
          label: 'World Class',
          quotes: [
            { text: 'Service is polished and the river setting makes the whole stay memorable.', author: 'Julianne V.' },
            { text: 'Concierge support and dining were both exceptional.', author: 'Marc O.' },
          ],
          breakdown: [
            { label: 'Clean', score: 5.0 },
            { label: 'Service', score: 4.9 },
            { label: 'Locale', score: 4.9 },
            { label: 'Value', score: 4.7 },
          ],
          entries: [
            {
              author: 'Alexandra Chen',
              meta: 'Oct 12, 2023 • Verified Stay',
              title: 'Amazing service and unparalleled views',
              body: 'The attention to detail here is extraordinary. The staff anticipated every need. The architecture blends modern luxury with traditional craftsmanship.',
              rating: 5,
              sentiment: 'good',
              avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
              tags: [
                { label: 'EXCELLENT LOCATION', tone: 'positive' },
                { label: 'LUXURY INTERIOR', tone: 'positive' },
              ],
            },
            {
              author: 'Julian Vance',
              meta: 'Sep 28, 2023 • Solo Traveler',
              title: 'Stunning but some operational hiccups',
              body: 'The hotel is a masterpiece. However, breakfast queue was 20 mins and some public areas were livelier than expected in the evening.',
              rating: 4,
              sentiment: 'poor',
              avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
              tags: [
                { label: 'BREAKFAST QUEUE', tone: 'negative' },
                { label: 'A BIT NOISY', tone: 'negative' },
              ],
            },
            {
              author: 'Sienna Mori',
              meta: 'Aug 15, 2023 • Verified Stay',
              title: 'A peaceful sanctuary in the heart of Kyoto',
              body: 'Staying here felt like a private villa. Garden views are spectacular and dinner at Yasaka was a highlight.',
              rating: 5,
              sentiment: 'good',
              avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=200&q=80',
              gallery: [
                'https://images.unsplash.com/photo-1522798514-97ceb8c4f1c8?auto=format&fit=crop&w=300&q=80',
                'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=300&q=80',
              ],
            },
          ],
        },
      },
      {
        id: 'hoshinoya',
        name: 'Hoshinoya Kyoto',
        subtitle: '虹夕诺雅 京都',
        area: '岚山景区',
        locationLabel: 'Arashiyama Hillside, Kyoto, Japan',
        themeLabel: 'Zen Retreat',
        rating: 4.9,
        pricePerNightCny: 6500,
        totalPriceCny: 6500 * totalNights,
        bookingTip: '乘坐私人船只开启隐居之旅，在岚山怀抱中享受禅意慢生活。',
        highlights: ['含接驳', '免费取消', '近景区'],
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDWJC1DnGNLISjOIZrBnW0zPJeuCfHiIg_Ashi6h-WKverh8VZSD11GeP84WVI_yZGtSyE3ys7vVHhApPXxaz8NXNjWIV10-foCZSt209ldhxSF8eTPnAiXeSFnbMMPYvUGL5F3qQ9EPXdB5jT3n1koGwJfqshkI5L8BWtyqIDYo6sN4BxbZInAyhz87eBcqIvnuaOW1PyZUrQ3o5JDyPz6t4Gi1m9W5hxBtoXQSONh8E6pswdp6I-yXVJfqfcyMvahu0NXD5XKycM',
        badge: '臻选',
        locationHighlights: [
          { title: 'Arashiyama Bamboo Grove', subtitle: '6 min walk', icon: 'trees' },
          { title: 'Private Boat Pier', subtitle: 'At hotel entrance', icon: 'hotel' },
        ],
        amenities: ['Free Wi-Fi', 'Dining', 'Onsen', 'Boat Transfer'],
        roomTypes: [
          {
            name: 'River Pavilion',
            description: 'River view, 58sqm, tatami living area',
            pricePerNightCny: 6500,
            image: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=80',
            badge: 'Signature',
          },
          {
            name: 'Hillside Suite',
            description: 'Forest view, 72sqm, private lounge',
            pricePerNightCny: 7600,
            image: 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80',
          },
        ],
        review: {
          score: 4.9,
          label: 'Serene Escape',
          quotes: [
            { text: 'Arriving by boat makes the experience feel truly special.', author: 'Nadia P.' },
            { text: 'Quiet, refined and deeply restorative after a busy itinerary.', author: 'Ken S.' },
          ],
          breakdown: [
            { label: 'Clean', score: 5.0 },
            { label: 'Service', score: 5.0 },
            { label: 'Locale', score: 4.8 },
            { label: 'Value', score: 4.7 },
          ],
          entries: [
            {
              author: 'Nadia Park',
              meta: 'Nov 03, 2023 • Couple Trip',
              title: 'Beautiful arrival and deeply calming stay',
              body: 'The boat transfer sets the tone immediately. Once inside, everything feels quiet, thoughtful and beautifully paced.',
              rating: 5,
              sentiment: 'good',
              avatar: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=200&q=80',
              tags: [
                { label: 'UNIQUE ARRIVAL', tone: 'positive' },
                { label: 'ZEN ATMOSPHERE', tone: 'positive' },
              ],
            },
            {
              author: 'Ken Sato',
              meta: 'Sep 11, 2023 • Verified Stay',
              title: 'Refined and restorative',
              body: 'A great property when you want a slower rhythm. Dining was very good, though transport into busier areas takes a bit more planning.',
              rating: 5,
              sentiment: 'poor',
              avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=80',
              tags: [
                { label: 'PEACEFUL', tone: 'positive' },
                { label: 'REMOTE FEEL', tone: 'negative' },
              ],
            },
            {
              author: 'Mika Ito',
              meta: 'Aug 21, 2023 • Verified Stay',
              title: 'A hidden retreat with beautiful textures',
              body: 'Loved the materials, the views, and the feeling of privacy. One of the most distinctive stays in Kyoto.',
              rating: 5,
              sentiment: 'good',
              avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80',
              gallery: [
                'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=300&q=80',
                'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=300&q=80',
              ],
            },
          ],
        },
      },
    ];
  }, [itinerary, destCity, totalNights, baseHotelTotalPrice]);

  const [selectedHotelId, setSelectedHotelId] = useState<string>('recommended');

  useEffect(() => {
    if (!hotelOptions.some(hotel => hotel.id === selectedHotelId)) {
      setSelectedHotelId(hotelOptions[0]?.id ?? 'recommended');
    }
  }, [hotelOptions, selectedHotelId]);

  useEffect(() => {
    if (detailHotelId && !hotelOptions.some(hotel => hotel.id === detailHotelId)) {
      setDetailHotelId(null);
    }
  }, [detailHotelId, hotelOptions]);

  useEffect(() => {
    setSelectedRoomByHotel((prev) => {
      const next = { ...prev };
      let changed = false;

      hotelOptions.forEach((hotel) => {
        const selectedRoomName = next[hotel.id];
        if (selectedRoomName && !hotel.roomTypes.some((room) => room.name === selectedRoomName)) {
          delete next[hotel.id];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [hotelOptions]);

  const selectedHotel = hotelOptions.find(hotel => hotel.id === selectedHotelId) ?? hotelOptions[0];
  const detailHotel = hotelOptions.find(hotel => hotel.id === detailHotelId) ?? null;
  const selectedRoomName = selectedHotel ? selectedRoomByHotel[selectedHotel.id] : undefined;
  const selectedRoom = selectedHotel?.roomTypes.find((room) => room.name === selectedRoomName);
  const hotelName = selectedHotel?.name ?? `${destCity} Holiday Inn`;
  const hotelArea = selectedHotel?.area ?? `${destCity}核心区域`;
  const hotelRating = selectedHotel?.rating ?? 4.8;
  const hotelBookingTip = selectedHotel?.bookingTip ?? '舒适高分酒店，适合城市漫游与短住。';
  const hotelHighlights = selectedHotel?.highlights ?? ['含早餐', '免费取消', '近商圈'];
  const hotelImage = selectedHotel?.image ?? 'https://lh3.googleusercontent.com/aida-public/AB6AXuAZAVDAS5vry2vxBq9L2Cv3FjC44Po466vDUriL4CS9mhTTsfauAjDSeM2bBgSdsfxNiFLP446RRR2SPLoWWRnLUooYiLch5HkjfvVyi6LPSTWvvGpe-qqBV1xQnV24Ybo-i0vxk6eNMu4tm3DYf1C4StTh8PEZtzdyJY6804WcjSY-b1oJrPBqEqfTKQa-GIwS9bxKLpmNtWXiqlYm7ISzbVYGxB09tTgz3lTZ347YLLFFr-BSCW9tPlsP7Lm6Y67S4d4-4F7emWE';
  const hotelBadge = selectedHotel?.badge ?? '精选';
  const defaultHotelNightPrice = selectedHotel?.pricePerNightCny ?? Math.round(baseHotelTotalPrice / Math.max(totalNights, 1));
  const hotelNightPrice = selectedRoom?.pricePerNightCny ?? defaultHotelNightPrice;
  const hotelTotalPrice = hotelNightPrice * Math.max(totalNights, 1);
  const totalBookingPrice = flightPrice + hotelTotalPrice;
  const destinationLabel = `${destCity}, ${itinerary?.intent.dest_country ?? '日本'}`;
  const checkInDateLabel = itinerary?.intent.departure_date ? formatDT(itinerary.intent.departure_date) : '11.12';
  const checkOutDateLabel = itinerary?.intent.return_date ? formatDT(itinerary.intent.return_date) : '11.15';
  const dateLabel = `${checkInDateLabel} - ${checkOutDateLabel}`;
  const guestsLabel = `${itinerary?.intent.travelers ?? 2}人, 1间`;
  const handleCreatePassenger = useCallback(() => {
    const name = newPassenger.name.trim();
    if (!name) return;

    setPassengers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name,
        role: newPassenger.role.trim() || '同行旅客',
        countLabel: newPassenger.countLabel.trim() || '1位成人',
        completed: true,
      },
    ]);
    setNewPassenger({ name: '', role: '同行旅客', countLabel: '1位成人' });
    setPassengerModalOpen(false);
  }, [newPassenger]);
  const handleSplitPayment = useCallback((target: 'flight' | 'hotel') => {
    setSplitPaymentState((prev) => ({ ...prev, [target]: 'processing' }));
    window.setTimeout(() => {
      setSplitPaymentState((prev) => ({ ...prev, [target]: 'success' }));
    }, 1200);
  }, []);
  const handleCombinedPayment = useCallback(() => {
    setCombinedPaymentState('processing');
    window.setTimeout(() => {
      setCombinedPaymentState('success');
    }, 1200);
  }, []);
  const allSplitPaymentsComplete = splitPaymentState.flight === 'success' && splitPaymentState.hotel === 'success';

  useEffect(() => {
    if (paymentMode === 'split') {
      setCombinedPaymentState('idle');
    }
  }, [paymentMode]);

  useEffect(() => {
    const openBookingPanel = () => {
      setDetailHotelId(null);
      setIsHotelPickerOpen(false);
      setIsOpen(true);
    };

    const openRecommendedHotelDetails = () => {
      const recommendedHotelId = hotelOptions[0]?.id ?? 'recommended';
      setSelectedHotelId(recommendedHotelId);
      setDetailHotelId(recommendedHotelId);
      setIsHotelPickerOpen(false);
      setIsOpen(true);
    };

    window.addEventListener('open-booking-panel', openBookingPanel);
    window.addEventListener('open-recommended-hotel-details', openRecommendedHotelDetails);

    return () => {
      window.removeEventListener('open-booking-panel', openBookingPanel);
      window.removeEventListener('open-recommended-hotel-details', openRecommendedHotelDetails);
    };
  }, [hotelOptions]);

  return (
    <>
      {/* Floating Trigger Button */}
      <AnimatePresence>
        {false && !isOpen && (
          <motion.button
            key="booking-trigger"
            initial={{ opacity: 0, scale: 0.8, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: 20 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsOpen(true)}
            className="fixed right-6 bottom-24 z-30 w-[240px] rounded-[26px] overflow-hidden bg-gradient-to-br from-primary via-primary to-primary-dim text-white shadow-[0_18px_40px_rgba(70,76,95,0.28)] hover:shadow-[0_22px_48px_rgba(70,76,95,0.34)] active:scale-[0.98] transition-all text-left"
            aria-label="打开预订面板"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_34%)] pointer-events-none" />
            <div className="relative px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black tracking-[0.2em] uppercase text-white/70">Recommended Booking</p>
                  <h3 className="mt-1 text-lg font-headline font-extrabold tracking-tight text-white">机票 + 酒店预订</h3>
                  <p className="mt-1 text-[11px] text-white/80 leading-relaxed">查看系统推荐的航班、酒店和支付方案</p>
                </div>
                <div className="w-11 h-11 rounded-2xl bg-white/14 backdrop-blur border border-white/15 flex items-center justify-center shadow-inner">
                  <ShoppingCart className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-white/85">
                <div className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2.5 py-1 border border-white/12">
                  <PlaneTakeoff className="w-3 h-3" />
                  <span>航班推荐</span>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2.5 py-1 border border-white/12">
                  <Building2 className="w-3 h-3" />
                  <span>酒店推荐</span>
                </div>
              </div>
            </div>
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
            className="fixed right-0 top-0 h-full w-full sm:w-[420px] flex flex-col z-50 shadow-[-16px_0_48px_rgba(0,0,0,0.12)]"
          >
            <div className="bg-surface h-full flex flex-col overflow-hidden">
              {/* Header */}
              {!isNestedDetailView && (
                <div className="flex justify-between items-center px-6 py-5 border-b border-outline-variant/10 bg-surface/90 backdrop-blur-xl flex-shrink-0">
                <div className="flex items-center gap-3">
                  {isHotelPickerOpen ? (
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        if (detailHotel) {
                          setDetailHotelId(null);
                          return;
                        }
                        setIsHotelPickerOpen(false);
                      }}
                      className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shadow-sm"
                    >
                      <ArrowLeft className="w-4 h-4 text-primary" />
                    </motion.button>
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shadow-sm">
                      <ShoppingCart className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-label font-bold uppercase tracking-[0.24em] text-outline">Quiet Voyager</p>
                    <h2 className="text-lg font-headline font-extrabold tracking-tight text-on-surface">
                      {detailHotel ? 'Hotel Details' : isHotelPickerOpen ? 'Select Hotel' : '确认预订'}
                    </h2>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    setDetailHotelId(null);
                    setIsHotelPickerOpen(false);
                    setIsOpen(false);
                  }}
                  className="w-8 h-8 rounded-full hover:bg-black/5 flex items-center justify-center text-outline"
                >
                  <X className="w-4 h-4" />
                </motion.button>
                </div>
              )}

              {detailHotel ? (
                <HotelDetailView
                  hotel={detailHotel}
                  onBack={() => setDetailHotelId(null)}
                  onToggleNestedView={setIsNestedDetailView}
                  selectedRoomName={selectedRoomByHotel[detailHotel.id] ?? null}
                  onSelectRoom={(roomName) => {
                    setSelectedRoomByHotel((prev) => ({ ...prev, [detailHotel.id]: roomName }));
                  }}
                />
              ) : isHotelPickerOpen ? (
                <HotelSelectionView
                  hotels={hotelOptions}
                  selectedHotelId={selectedHotelId}
                  onSelect={setSelectedHotelId}
                  onConfirm={() => setIsHotelPickerOpen(false)}
                  onViewDetails={(hotelId) => {
                    setSelectedHotelId(hotelId);
                    setDetailHotelId(hotelId);
                  }}
                  destinationLabel={destinationLabel}
                  dateLabel={dateLabel}
                  guestsLabel={guestsLabel}
                />
              ) : (
                <>
                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
                {/* Flight Detail */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 }}
                >
                  <div className="flex items-center justify-between px-1 mb-3">
                    <span className="text-[10px] font-label font-bold text-outline uppercase tracking-[0.18em] block">
                      航班详情
                    </span>
                    <span className="text-[10px] font-label font-bold uppercase tracking-widest text-outline">航班 {flightCode}</span>
                  </div>
                  <div className="bg-surface-container-lowest rounded-[20px] p-5 shadow-[0_4px_20px_rgb(0,0,0,0.03)] ring-1 ring-outline-variant/10 relative overflow-hidden">
                    <div className="flex justify-between items-center relative z-10 gap-3">
                      <div className="text-left min-w-0">
                        <p className="text-2xl font-headline font-extrabold text-on-surface">{departureTime}</p>
                        <p className="text-[11px] font-label font-semibold text-on-surface-variant uppercase tracking-tight truncate">{originCity}</p>
                      </div>
                      <div className="flex-1 px-2 flex flex-col items-center">
                        <div className="w-full flex items-center gap-2">
                          <div className="h-px flex-1 bg-outline-variant/30"></div>
                          <PlaneTakeoff className="w-4 h-4 text-primary/50" />
                          <div className="h-px flex-1 bg-outline-variant/30"></div>
                        </div>
                        <p className="text-[9px] font-label font-bold text-primary mt-1">{durationLabel}</p>
                      </div>
                      <div className="text-right min-w-0">
                        <p className="text-2xl font-headline font-extrabold text-on-surface">{arrivalTime}</p>
                        <p className="text-[11px] font-label font-semibold text-on-surface-variant uppercase tracking-tight truncate">{destCity}</p>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-outline-variant/10 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center flex-shrink-0">
                          <PlaneTakeoff className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <span className="text-xs font-label font-semibold text-on-surface truncate">
                          {itinerary?.recommended_flight?.airline ?? '东方航空'} • 经济舱
                        </span>
                      </div>
                      <span className="text-[10px] font-label text-outline whitespace-nowrap">¥{flightPrice.toLocaleString()}</span>
                    </div>
                  </div>
                </motion.div>

                {/* Hotel Detail */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.14 }}
                >
                  <div className="flex items-center justify-between px-1 mb-3">
                    <span className="text-[10px] font-label font-bold text-outline uppercase tracking-[0.18em] block">
                      酒店预订
                    </span>
                    <button
                      onClick={() => setIsHotelPickerOpen(true)}
                      className="text-xs font-label font-semibold text-primary underline underline-offset-4"
                    >
                      更换
                    </button>
                  </div>
                  <div className="bg-surface-container-lowest rounded-[20px] overflow-hidden shadow-[0_4px_20px_rgb(0,0,0,0.03)] ring-1 ring-outline-variant/10">
                    <div className="relative h-52">
                      <img
                        alt={hotelName}
                        className="w-full h-full object-cover"
                        src={hotelImage}
                      />
                      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur px-2.5 py-1 rounded-full shadow-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] leading-none text-amber-500">★</span>
                          <span className="text-[10px] font-bold text-on-surface">{hotelRating.toFixed(1)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-5 space-y-4">
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="text-xl font-headline font-extrabold text-on-surface tracking-tight truncate">{hotelName}</h4>
                            <p className="text-[11px] font-label text-on-surface-variant mt-1 flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{hotelArea}</span>
                            </p>
                            {selectedRoom && (
                              <p className="text-[11px] font-label text-primary/70 mt-1">已选房型: {selectedRoom.name}</p>
                            )}
                          </div>
                          <div className="px-2.5 py-1 rounded-full bg-primary/8 text-primary text-[10px] font-bold whitespace-nowrap">
                            {hotelBadge}
                          </div>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">{hotelBookingTip}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-surface-container-low rounded-xl p-3">
                          <p className="text-[9px] font-label font-bold text-outline uppercase tracking-wider">入住</p>
                          <p className="text-xs font-headline font-bold text-primary mt-1">
                            {itinerary?.intent.departure_date ? formatDT(itinerary.intent.departure_date) : 'May 12'}
                          </p>
                        </div>
                        <div className="bg-surface-container-low rounded-xl p-3">
                          <p className="text-[9px] font-label font-bold text-outline uppercase tracking-wider">时长</p>
                          <p className="text-xs font-headline font-bold text-primary mt-1">{totalNights} 晚</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {hotelHighlights.map((highlight) => (
                          <span
                            key={highlight}
                            className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2.5 py-1 text-[10px] font-bold text-on-secondary-container"
                          >
                            <Check className="w-3 h-3" />
                            {highlight}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-1 gap-3">
                        <p className="text-base font-headline font-extrabold text-on-surface">
                          ¥{hotelTotalPrice.toLocaleString()}
                          <span className="text-[10px] font-label text-outline font-normal ml-1">总房费</span>
                        </p>
                        <button
                          onClick={() => setDetailHotelId(selectedHotel?.id ?? null)}
                          className="px-4 py-2 rounded-xl border border-primary/20 text-primary font-label font-bold text-xs hover:bg-primary/5 active:scale-95 transition-all whitespace-nowrap"
                        >
                          查看详情
                        </button>
                      </div>
                      <p className="text-[10px] text-outline -mt-2">¥{hotelNightPrice.toLocaleString()} / 晚</p>
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
                    <span className="text-[10px] font-label font-bold text-outline uppercase tracking-[0.12em]">
                      旅客
                    </span>
                    <button
                      type="button"
                      onClick={() => setPassengerModalOpen(true)}
                      className="text-[10px] font-bold text-primary flex items-center gap-1 hover:underline"
                    >
                      <Plus className="w-3 h-3" />
                      新增旅客
                    </button>
                  </div>
                  <div className="space-y-2">
                    {passengers.map((passenger) => (
                      <div
                        key={passenger.id}
                        className="flex items-center gap-3 px-4 py-3 bg-surface-container-lowest rounded-2xl ring-1 ring-outline-variant/10 shadow-[0_4px_20px_rgb(0,0,0,0.02)]"
                      >
                        <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-on-surface">{passenger.name}</p>
                          <p className="text-[11px] text-on-surface-variant mt-0.5">{passenger.role} · {passenger.countLabel}</p>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 whitespace-nowrap">
                          <Check className="w-3 h-3" />
                          {passenger.completed ? '已完善' : '待补充'}
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-surface-container px-3 py-3">
                        <p className="text-[9px] font-label font-bold text-outline uppercase tracking-wider">支付方式</p>
                        <p className="text-xs font-bold text-on-surface mt-1">{paymentMethod === 'wechat' ? '微信支付' : '支付宝支付'}</p>
                      </div>
                      <div className="rounded-2xl bg-surface-container px-3 py-3">
                        <p className="text-[9px] font-label font-bold text-outline uppercase tracking-wider">确认时限</p>
                        <p className="text-xs font-bold text-on-surface mt-1">30 分钟</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
                  </div>

                  {/* Footer */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.22 }}
                    className="px-6 py-5 border-t border-outline-variant/10 bg-white/90 backdrop-blur-2xl flex-shrink-0"
                  >
                <div className="flex justify-between items-end mb-4 gap-4">
                  <div>
                    <span className="text-[10px] font-bold text-outline uppercase tracking-widest">总预订金额</span>
                    <div className="text-3xl font-headline font-extrabold text-primary mt-1 leading-none">
                      ¥{totalBookingPrice.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-outline">航班 ¥{flightPrice.toLocaleString()}</p>
                    <p className="text-[10px] text-outline mt-0.5">酒店 ¥{hotelTotalPrice.toLocaleString()}</p>
                  </div>
                </div>
                <div className="mb-4 rounded-[24px] border border-outline-variant/15 bg-gradient-to-br from-surface-container-lowest to-surface-container-low p-4 shadow-[0_10px_30px_rgba(87,94,112,0.06)]">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[10px] font-bold text-outline uppercase tracking-widest">支付方式</p>
                      <p className="text-[11px] text-on-surface-variant mt-1">选择你偏好的付款渠道</p>
                    </div>
                    <div className="text-[10px] font-bold text-primary bg-primary/8 px-2.5 py-1 rounded-full">
                      {paymentMethod === 'wechat' ? '微信支付' : '支付宝支付'}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('wechat')}
                      className={`rounded-[22px] border p-3 text-left transition-all ${
                        paymentMethod === 'wechat'
                          ? 'bg-[#e9fbf3] border-[#22c55e]/30 shadow-[0_10px_24px_rgba(34,197,94,0.16)]'
                          : 'bg-white/90 border-outline-variant/20 hover:border-primary/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-white shadow-sm border border-outline-variant/10 flex items-center justify-center overflow-hidden">
                          <img src="/images/wechat.png" alt="微信支付" className="w-7 h-7 object-contain" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-on-surface">微信支付</p>
                          <p className="text-[11px] text-on-surface-variant mt-0.5">推荐移动端快速付款</p>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('alipay')}
                      className={`rounded-[22px] border p-3 text-left transition-all ${
                        paymentMethod === 'alipay'
                          ? 'bg-[#eef4ff] border-[#3b82f6]/30 shadow-[0_10px_24px_rgba(59,130,246,0.16)]'
                          : 'bg-white/90 border-outline-variant/20 hover:border-primary/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-white shadow-sm border border-outline-variant/10 flex items-center justify-center overflow-hidden">
                          <img src="/images/alipay.png" alt="支付宝支付" className="w-7 h-7 object-contain" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-on-surface">支付宝支付</p>
                          <p className="text-[11px] text-on-surface-variant mt-0.5">适合分开支付与转账</p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-[0.95fr_1.25fr] gap-3 mb-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMode('split')}
                    className={`py-3.5 rounded-2xl font-headline font-bold text-sm transition-all ${
                      paymentMode === 'split'
                        ? 'bg-secondary-container text-on-secondary-container ring-1 ring-primary/15 shadow-[0_10px_24px_rgba(87,94,112,0.1)]'
                        : 'bg-surface-container-low text-on-surface-variant hover:bg-secondary-container/70'
                    }`}
                  >
                    分开支付
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (paymentMode === 'split') {
                        setPaymentMode('combined');
                        return;
                      }
                      handleCombinedPayment();
                    }}
                    disabled={paymentMode === 'combined' && combinedPaymentState !== 'idle'}
                    className={`py-3.5 rounded-2xl font-headline font-bold text-sm transition-all ${
                      combinedPaymentState === 'success'
                        ? 'bg-emerald-500 text-white'
                        : paymentMethod === 'wechat'
                          ? 'bg-[#22c55e] text-white shadow-lg shadow-[#22c55e]/20 hover:bg-[#16a34a]'
                          : 'bg-[#2563eb] text-white shadow-lg shadow-[#2563eb]/20 hover:bg-[#1d4ed8]'
                    } disabled:opacity-60`}
                  >
                    {paymentMode === 'split'
                      ? '切换组合支付'
                      : combinedPaymentState === 'idle'
                        ? '组合支付'
                        : combinedPaymentState === 'processing'
                        ? <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                        : '支付成功'
                    }
                  </button>
                </div>
                {paymentMode === 'split' && (
                  <div className="mb-3 space-y-3">
                    <div className="rounded-[22px] bg-surface-container-low px-4 py-3 border border-outline-variant/15">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-on-surface">已选择分开支付</p>
                          <p className="text-[11px] text-on-surface-variant mt-1">
                            航班与酒店可分别使用{paymentMethod === 'wechat' ? '微信支付' : '支付宝支付'}完成付款。
                          </p>
                        </div>
                        <div className={`text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                          allSplitPaymentsComplete ? 'text-emerald-700 bg-emerald-50' : 'text-primary bg-white/80'
                        }`}>
                          {allSplitPaymentsComplete ? '已全部支付' : 'Split Mode'}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-[22px] border border-outline-variant/15 bg-white p-4 shadow-[0_10px_30px_rgba(87,94,112,0.06)]">
                        <p className="text-[10px] font-bold text-outline uppercase tracking-widest">航班支付</p>
                        <p className="text-xl font-headline font-extrabold text-primary mt-2">¥{flightPrice.toLocaleString()}</p>
                        <p className="text-[11px] text-on-surface-variant mt-1">使用{paymentMethod === 'wechat' ? '微信支付' : '支付宝支付'}支付航班</p>
                        <button
                          type="button"
                          onClick={() => handleSplitPayment('flight')}
                          disabled={splitPaymentState.flight !== 'idle'}
                          className={`mt-4 w-full py-2.5 rounded-2xl font-bold text-xs transition-all ${
                            splitPaymentState.flight === 'success'
                              ? 'bg-emerald-500 text-white'
                              : paymentMethod === 'wechat'
                                ? 'bg-[#22c55e] text-white'
                                : 'bg-[#2563eb] text-white'
                          } disabled:opacity-70`}
                        >
                          {splitPaymentState.flight === 'idle'
                            ? '支付航班'
                            : splitPaymentState.flight === 'processing'
                              ? '支付中...'
                              : '航班已支付'}
                        </button>
                      </div>
                      <div className="rounded-[22px] border border-outline-variant/15 bg-white p-4 shadow-[0_10px_30px_rgba(87,94,112,0.06)]">
                        <p className="text-[10px] font-bold text-outline uppercase tracking-widest">酒店支付</p>
                        <p className="text-xl font-headline font-extrabold text-primary mt-2">¥{hotelTotalPrice.toLocaleString()}</p>
                        <p className="text-[11px] text-on-surface-variant mt-1">使用{paymentMethod === 'wechat' ? '微信支付' : '支付宝支付'}支付酒店</p>
                        <button
                          type="button"
                          onClick={() => handleSplitPayment('hotel')}
                          disabled={splitPaymentState.hotel !== 'idle'}
                          className={`mt-4 w-full py-2.5 rounded-2xl font-bold text-xs transition-all ${
                            splitPaymentState.hotel === 'success'
                              ? 'bg-emerald-500 text-white'
                              : paymentMethod === 'wechat'
                                ? 'bg-[#22c55e] text-white'
                                : 'bg-[#2563eb] text-white'
                          } disabled:opacity-70`}
                        >
                          {splitPaymentState.hotel === 'idle'
                            ? '支付酒店'
                            : splitPaymentState.hotel === 'processing'
                              ? '支付中...'
                              : '酒店已支付'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] text-outline">
                  <div className="inline-flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    <span>价格已锁定 30 分钟</span>
                  </div>
                  <span>含税费</span>
                </div>
                <p className="text-[10px] text-center text-outline mt-3 leading-relaxed">
                  点击支付即表示您同意旅行政策及酒店/航司服务条款。
                </p>
                  </motion.div>
                </>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {passengerModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPassengerModalOpen(false)}
              className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 28, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-x-4 bottom-6 z-[70] sm:left-auto sm:right-6 sm:w-[388px] rounded-[28px] bg-white border border-outline-variant/20 shadow-[0_24px_80px_rgba(25,28,30,0.2)] p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-headline font-extrabold text-primary">新增旅客</h3>
                  <p className="text-[11px] text-on-surface-variant mt-1">填写旅客信息后将加入预订列表</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPassengerModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center text-primary"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-outline">姓名</span>
                  <input
                    type="text"
                    value={newPassenger.name}
                    onChange={(event) => setNewPassenger((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="例如 王小明"
                    className="mt-2 w-full h-11 rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 text-sm text-on-surface outline-none focus:border-primary/40"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-outline">身份</span>
                  <input
                    type="text"
                    value={newPassenger.role}
                    onChange={(event) => setNewPassenger((prev) => ({ ...prev, role: event.target.value }))}
                    placeholder="例如 同行旅客"
                    className="mt-2 w-full h-11 rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 text-sm text-on-surface outline-none focus:border-primary/40"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-outline">人数说明</span>
                  <input
                    type="text"
                    value={newPassenger.countLabel}
                    onChange={(event) => setNewPassenger((prev) => ({ ...prev, countLabel: event.target.value }))}
                    placeholder="例如 1位成人"
                    className="mt-2 w-full h-11 rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 text-sm text-on-surface outline-none focus:border-primary/40"
                  />
                </label>
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  type="button"
                  onClick={() => setPassengerModalOpen(false)}
                  className="flex-1 py-3 rounded-2xl bg-surface-container-low text-on-surface font-bold text-sm"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleCreatePassenger}
                  disabled={!newPassenger.name.trim()}
                  className="flex-[1.2] py-3 rounded-2xl bg-primary text-on-primary font-bold text-sm shadow-lg shadow-primary/20 disabled:opacity-40"
                >
                  保存旅客
                </button>
              </div>
            </motion.div>
          </>
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

function RecommendationShowcaseWidget({ itinerary }: { itinerary: FinalItinerary | null }) {
  const openBookingPanel = () => {
    window.dispatchEvent(new CustomEvent('open-booking-panel'));
  };

  const openHotelDetails = () => {
    window.dispatchEvent(new CustomEvent('open-recommended-hotel-details'));
  };

  const hotelName = itinerary?.recommended_hotel?.name ?? '洱海云端精品民宿';
  const hotelPrice = itinerary?.recommended_hotel ? Math.round(itinerary.recommended_hotel.price_per_night_cny) : 300;
  const hotelArea = itinerary?.recommended_hotel?.area ?? '大理古村码头附近';
  const hotelRating = itinerary?.recommended_hotel?.stars ? itinerary.recommended_hotel.stars.toFixed(1) : '4.9';
  const hotelTags = itinerary?.recommended_hotel?.highlights?.slice(0, 3) ?? ['洱海海景', '设计师民宿', '免费早餐'];
  const hotelDescription = itinerary?.recommended_hotel?.booking_tip ?? '坐落于洱海之畔，推窗见海，感受苍山洱海的宁静与美好。';
  const hotelImage = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1400&q=80';

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
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        className="relative overflow-hidden rounded-[24px] border border-white/20 shadow-[0_16px_36px_rgba(49,65,101,0.18)]"
      >
        <div className="absolute inset-0">
          <img
            src={hotelImage}
            alt={hotelName}
            className="h-full w-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#5676aa]/32 via-[#364667]/52 to-[#252f45]/86" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.24),transparent_34%)]" />
        </div>

        <div className="relative flex min-h-[206px] flex-col justify-between p-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/18 px-2.5 py-1 text-[10px] font-bold backdrop-blur-md border border-white/15">
              <Hotel className="h-3.5 w-3.5" />
              <span>精选民宿</span>
            </div>
            <button
              type="button"
              onClick={openBookingPanel}
              className="flex h-10 w-10 items-center justify-center rounded-[18px] border border-white/20 bg-white/12 backdrop-blur-md transition-all hover:bg-white/18 active:scale-95"
              aria-label="打开预订面板"
            >
              <ShoppingCart className="h-4.5 w-4.5" />
            </button>
          </div>

          <div className="max-w-[390px] space-y-2.5">
            <div>
              <h5 className="text-[22px] sm:text-[24px] font-headline font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_6px_24px_rgba(0,0,0,0.28)]">
                {hotelName}
              </h5>
              <p className="mt-1 text-lg font-black tracking-tight text-white/95">
                ¥{hotelPrice}
                <span className="ml-1 text-sm font-bold text-white/80">/ 晚起</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {hotelTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/12 bg-white/14 px-2.5 py-1 text-[10px] font-semibold text-white/92 backdrop-blur-md"
                >
                  {tag}
                </span>
              ))}
            </div>

            <p className="max-w-[420px] text-[13px] leading-6 text-white/88 line-clamp-2">
              {hotelDescription}
            </p>

            <div className="flex flex-wrap items-center gap-3 text-[13px] font-semibold text-white/88">
              <div className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                <span>{hotelArea}</span>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 fill-current" />
                <span>{hotelRating}（128条评价）</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={openBookingPanel}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[13px] font-bold text-primary shadow-[0_8px_18px_rgba(255,255,255,0.16)] transition-all hover:-translate-y-0.5 active:scale-95"
            >
              <PlaneTakeoff className="h-3.5 w-3.5" />
              <span>航班推荐</span>
            </button>
            <button
              type="button"
              onClick={openHotelDetails}
              className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-[13px] font-bold text-white backdrop-blur-md transition-all hover:bg-white/16 active:scale-95"
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>查看房型</span>
            </button>
          </div>
        </div>
      </motion.div>
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
