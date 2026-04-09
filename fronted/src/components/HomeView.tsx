import { useState, useEffect, useCallback, useMemo, memo, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sun, MapPin, Umbrella, Mountain, Wallet, Users,
  Plus, ArrowUp, Loader2, CalendarDays, Heart, ChevronDown, Minus, PlusCircle, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { postChat } from '../api';

interface HomeViewProps {
  sessionId: string;
  onNavigate: (taskId: string, query: string) => void;
}

type DestinationOption = {
  name: string;
  region: '国内' | '国际';
  country?: string;
  subtitle: string;
  image?: string;
};

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DESTINATION_OPTIONS: DestinationOption[] = [
  { name: '北京', region: '国内', subtitle: '首都 · 历史与文化', image: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=300&q=80' },
  { name: '上海', region: '国内', subtitle: '国际都市 · 城市漫游', image: 'https://images.unsplash.com/photo-1547981609-4b6bf67db7bf?auto=format&fit=crop&w=300&q=80' },
  { name: '广州', region: '国内', subtitle: '美食之都 · 岭南风情' },
  { name: '深圳', region: '国内', subtitle: '现代海岸 · 都市活力' },
  { name: '杭州', region: '国内', subtitle: '西湖 · 江南慢游', image: 'https://images.unsplash.com/photo-1510337550647-e84f83e341ca?auto=format&fit=crop&w=300&q=80' },
  { name: '苏州', region: '国内', subtitle: '园林水乡 · 古典雅致' },
  { name: '南京', region: '国内', subtitle: '六朝古都 · 城市历史' },
  { name: '成都', region: '国内', subtitle: '慢生活 · 熊猫与川味', image: 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=300&q=80' },
  { name: '重庆', region: '国内', subtitle: '山城夜景 · 火锅' },
  { name: '西安', region: '国内', subtitle: '盛唐古韵 · 兵马俑' },
  { name: '武汉', region: '国内', subtitle: '江城烟火 · 樱花季' },
  { name: '长沙', region: '国内', subtitle: '夜生活 · 湘味' },
  { name: '青岛', region: '国内', subtitle: '海滨风光 · 啤酒' },
  { name: '厦门', region: '国内', subtitle: '文艺海岛 · 鼓浪屿', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=300&q=80' },
  { name: '三亚', region: '国内', subtitle: '热带海滨 · 度假', image: 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=300&q=80' },
  { name: '昆明', region: '国内', subtitle: '春城 · 高原气候' },
  { name: '大理', region: '国内', subtitle: '洱海 · 慢生活' },
  { name: '丽江', region: '国内', subtitle: '古城雪山 · 度假', image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=300&q=80' },
  { name: '哈尔滨', region: '国内', subtitle: '冰雪之城 · 欧陆风格' },
  { name: '拉萨', region: '国内', subtitle: '高原圣地 · 人文' },
  { name: '张家界', region: '国内', subtitle: '奇峰峡谷 · 自然风景' },
  { name: '桂林', region: '国内', subtitle: '山水甲天下' },
  { name: '贵阳', region: '国内', subtitle: '避暑 · 喀斯特风光' },
  { name: '福州', region: '国内', subtitle: '闽都文化 · 温泉' },
  { name: '天津', region: '国内', subtitle: '海河夜景 · 近代建筑' },
  { name: '沈阳', region: '国内', subtitle: '东北门户 · 皇城' },
  { name: '大连', region: '国内', subtitle: '浪漫海滨 · 清爽城市' },
  { name: '宁波', region: '国内', subtitle: '东海港城 · 海鲜' },
  { name: '无锡', region: '国内', subtitle: '太湖 · 江南小城' },
  { name: '南昌', region: '国内', subtitle: '赣江风光 · 滕王阁' },
  { name: '新加坡', region: '国际', country: '新加坡', subtitle: '花园城市 · 轻奢度假', image: 'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?auto=format&fit=crop&w=300&q=80' },
  { name: '东京', region: '国际', country: '日本', subtitle: '都市潮流 · 美食购物', image: 'https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?auto=format&fit=crop&w=300&q=80' },
  { name: '大阪', region: '国际', country: '日本', subtitle: '关西烟火 · 亲子友好' },
  { name: '首尔', region: '国际', country: '韩国', subtitle: '韩流时尚 · 城市体验' },
  { name: '曼谷', region: '国际', country: '泰国', subtitle: '热带夜市 · 性价比高' },
  { name: '吉隆坡', region: '国际', country: '马来西亚', subtitle: '多元文化 · 都市休闲', image: 'https://images.unsplash.com/photo-1596422846543-75c6fc197f07?auto=format&fit=crop&w=300&q=80' },
  { name: '巴厘岛', region: '国际', country: '印度尼西亚', subtitle: '海岛度假 · 酒店丰富', image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=300&q=80' },
  { name: '迪拜', region: '国际', country: '阿联酋', subtitle: '现代奢华 · 沙漠体验' },
  { name: '伊斯坦布尔', region: '国际', country: '土耳其', subtitle: '欧亚交汇 · 历史建筑' },
  { name: '巴黎', region: '国际', country: '法国', subtitle: '浪漫艺术 · 城市漫步', image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=300&q=80' },
  { name: '伦敦', region: '国际', country: '英国', subtitle: '经典都会 · 博物馆' },
  { name: '罗马', region: '国际', country: '意大利', subtitle: '古典遗迹 · 美食' },
  { name: '巴塞罗那', region: '国际', country: '西班牙', subtitle: '建筑美学 · 海滨' },
  { name: '纽约', region: '国际', country: '美国', subtitle: '世界之城 · 都市密度', image: 'https://images.unsplash.com/photo-1499092346589-b9b6be3e94b2?auto=format&fit=crop&w=300&q=80' },
  { name: '洛杉矶', region: '国际', country: '美国', subtitle: '阳光海岸 · 主题乐园', image: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=300&q=80' },
  { name: '旧金山', region: '国际', country: '美国', subtitle: '海湾城市 · 公路旅行' },
  { name: '温哥华', region: '国际', country: '加拿大', subtitle: '自然与都市平衡' },
  { name: '多伦多', region: '国际', country: '加拿大', subtitle: '国际都会 · 城市度假' },
  { name: '悉尼', region: '国际', country: '澳大利亚', subtitle: '海港城市 · 地标景观' },
  { name: '墨尔本', region: '国际', country: '澳大利亚', subtitle: '文艺街区 · 咖啡文化', image: 'https://images.unsplash.com/photo-1514395462725-fb4566210144?auto=format&fit=crop&w=300&q=80' },
];

function parseDateString(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function formatMonthTitle(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function getGreetingByHour(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';
  return 'Good Evening';
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sameDay(a: Date | null, b: Date | null) {
  return Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
}

function getMonthGrid(date: Date) {
  const monthStart = startOfMonth(date);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const leadingEmpty = monthStart.getDay();
  const totalCells = Math.ceil((leadingEmpty + monthEnd.getDate()) / 7) * 7;
  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - leadingEmpty + 1;
    if (dayNumber < 1 || dayNumber > monthEnd.getDate()) return null;
    return new Date(date.getFullYear(), date.getMonth(), dayNumber);
  });
}

export function HomeView({ sessionId, onNavigate }: HomeViewProps) {
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detectedCity, setDetectedCity] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'detecting' | 'detected' | 'denied'>('idle');
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerTab, setPlannerTab] = useState<'date' | 'flexible'>('date');
  const [manualDestination, setManualDestination] = useState('');
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [departureLabel, setDepartureLabel] = useState('');
  const [preferenceOpen, setPreferenceOpen] = useState(false);
  const [selectedPreference, setSelectedPreference] = useState('轻松慢游');
  const [startDate, setStartDate] = useState('2026-04-09');
  const [endDate, setEndDate] = useState('2026-04-12');
  const [flexibleDays, setFlexibleDays] = useState(3);
  const [flexibleMonth, setFlexibleMonth] = useState(4);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDateString('2026-04-09')));
  const greeting = useMemo(() => getGreetingByHour(new Date()), []);

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

  const buildMessage = useCallback((text: string): string => {
    if (!detectedCity) return text;
    if (/从|出发地|出发城市|我在|我住|我现在/.test(text)) return text;
    return `${text}（我当前位于${detectedCity}，请以此作为出发地）`;
  }, [detectedCity]);

  const handleAction = useCallback(async (preset?: string) => {
    const text = preset ?? inputValue.trim();
    if (!text || loading) return;
    setLoading(true);
    setErrorMsg(null);
    const finalText = buildMessage(text);
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
  }, [inputValue, loading, buildMessage, sessionId, onNavigate]);

  useEffect(() => {
    if (!plannerOpen) return;
    setDepartureLabel(detectedCity ?? '');
  }, [plannerOpen, detectedCity]);

  useEffect(() => {
    if (!plannerOpen || plannerTab !== 'date') return;
    setVisibleMonth(startOfMonth(parseDateString(startDate)));
  }, [plannerOpen, plannerTab, startDate]);

  const startDateObj = startDate ? parseDateString(startDate) : null;
  const endDateObj = endDate ? parseDateString(endDate) : null;

  const exactDateLabel = (() => {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '请选择出发和返程日期';
    const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日 (${dayCount}天)`;
  })();

  const flexibleDateLabel = `${flexibleMonth}月 · ${flexibleDays}天行程`;

  const handleCalendarDateSelect = useCallback((date: Date) => {
    const nextKey = toDateKey(date);
    if (!startDate || endDate) {
      setStartDate(nextKey);
      setEndDate('');
      return;
    }

    const start = parseDateString(startDate);
    if (date.getTime() < start.getTime()) {
      setStartDate(nextKey);
      return;
    }

    setEndDate(nextKey);
  }, [endDate, startDate]);

  const handleConfirmPlanner = useCallback(() => {
    const destination = manualDestination.trim();
    if (!destination) return;
    const departure = departureLabel.trim();
    const dateText = plannerTab === 'date'
      ? exactDateLabel
      : `${flexibleDateLabel}，时间可灵活安排`;
    const parts = [
      departure ? `出发地${departure}` : '',
      `目的地${destination}`,
      dateText,
      selectedPreference ? `旅行偏好${selectedPreference}` : '',
    ].filter(Boolean);
    setInputValue(parts.join('，'));
    setPlannerOpen(false);
  }, [departureLabel, exactDateLabel, flexibleDateLabel, manualDestination, plannerTab, selectedPreference]);

  const canConfirmPlanner = Boolean(manualDestination.trim()) && (
    plannerTab === 'flexible' || (startDate && endDate)
  );

  const preferenceOptions = ['轻松慢游', '自然风光', '城市美食', '亲子家庭', '高性价比'];
  const dayOptions = [1, 2, 3, 4, 5, 6];
  const monthOptions = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  const rightMonth = addMonths(visibleMonth, 1);
  const leftMonthDays = getMonthGrid(visibleMonth);
  const rightMonthDays = getMonthGrid(rightMonth);
  const filteredDestinations = useMemo(() => {
    const query = manualDestination.trim().toLowerCase();
    const source = query
      ? DESTINATION_OPTIONS.filter((option) => {
        const haystack = `${option.name} ${option.country ?? ''} ${option.subtitle} ${option.region}`.toLowerCase();
        return haystack.includes(query);
      })
      : DESTINATION_OPTIONS;
    return source.slice(0, 14);
  }, [manualDestination]);

  return (
    <motion.main
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="ml-0 lg:ml-[220px] pt-16 min-h-screen bg-surface-container-lowest relative overflow-hidden flex flex-col"
    >
      {/* Background Decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:40px_40px] opacity-40 pointer-events-none"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#ffffff_100%)] pointer-events-none"></div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 flex flex-col items-center justify-center relative z-10">
        <div className="max-w-3xl w-full text-center space-y-3 -mt-10 md:-mt-20 px-4 md:px-8 py-8 md:py-12">
          <div className="flex items-center justify-center gap-3 md:gap-4 mb-1">
            <Sun className="w-8 h-8 md:w-10 md:h-10 text-orange-400 opacity-80 fill-orange-400" />
            <h2 className="text-3xl md:text-5xl font-serif text-slate-800 tracking-tight leading-tight italic">
              {greeting}, Tracy
            </h2>
          </div>
          <p className="text-slate-400 font-sans text-lg md:text-xl font-light tracking-wide">
            Where shall we plan our journey today?
          </p>
        </div>
      </div>

      <div className="w-full max-w-5xl mx-auto px-4 md:px-6 pb-8 md:pb-12 space-y-6 md:space-y-8 relative z-10">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-on-surface-variant/60 text-[10px] font-bold uppercase tracking-[0.2em] mb-1">
            <span className="w-8 h-px bg-current opacity-20"></span>
            <span>快速开始</span>
            <span className="w-8 h-px bg-current opacity-20"></span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 w-full max-w-4xl">
            <QuickStartCard icon={<Umbrella className="w-5 h-5 md:w-6 md:h-6" />} title="三亚五日游" desc="阳光,大海,与放松行程" onClick={() => handleAction('帮我规划三亚五日游，预算8000元')} />
            <QuickStartCard icon={<Mountain className="w-5 h-5 md:w-6 md:h-6" />} title="云南深度游" desc="古镇与高原文化" onClick={() => handleAction('帮我规划云南深度游5天，预算10000元')} />
            <QuickStartCard icon={<Wallet className="w-5 h-5 md:w-6 md:h-6" />} title="穷游旅游计划" desc="最大化体验,最小成本" onClick={() => handleAction('帮我规划一个5天穷游计划，预算3000元')} />
            <QuickStartCard icon={<Users className="w-5 h-5 md:w-6 md:h-6" />} title="家庭旅游" desc="亲子友好与便捷交通" onClick={() => handleAction('帮我规划一次家庭亲子游5天，2大1小，预算15000元')} />
          </div>
        </div>

        {errorMsg && (
          <div className="w-full max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 text-center">
            {errorMsg}
          </div>
        )}

        <div className="relative bg-white/80 backdrop-blur-xl rounded-[2rem] border border-outline-variant/20 shadow-[0_8px_32px_rgba(87,94,112,0.08)] overflow-hidden flex items-center p-1.5 md:p-2 ring-1 ring-white w-full max-w-2xl mx-auto">
          <button
            className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center text-outline hover:text-primary transition-colors"
            onClick={() => setPlannerOpen(true)}
            type="button"
            aria-label="打开目的地与时间选择"
          >
            <Plus className="w-5 h-5 md:w-6 md:h-6" />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && handleAction()}
            placeholder="输入你的旅游需求或目的地..."
            className="flex-1 bg-transparent border-none focus:ring-0 text-on-surface text-sm md:text-[15px] placeholder-outline px-2 h-10 md:h-12 outline-none"
            disabled={loading}
          />
          <div className="flex items-center gap-1 md:gap-2 pr-0.5 md:pr-1">
            <button className="hidden sm:block px-3 md:px-4 py-2 text-xs font-semibold text-on-surface-variant hover:text-primary hover:bg-surface-container-low rounded-full transition-all">智能体设置</button>
            <button
              className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-primary text-white flex items-center justify-center hover:opacity-90 transition-all shadow-md active:scale-95 disabled:opacity-50"
              onClick={() => handleAction()}
              disabled={loading || !inputValue.trim()}
            >
              {loading ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <ArrowUp className="w-4 h-4 md:w-5 md:h-5" />}
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

      <AnimatePresence>
        {plannerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-slate-950/18 backdrop-blur-sm"
              onClick={() => setPlannerOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              className="fixed inset-x-4 top-[10vh] z-50 mx-auto flex max-h-[76vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-outline-variant/20 bg-white shadow-[0_28px_70px_rgba(36,44,68,0.2)]"
            >
              <div className="border-b border-outline-variant/15 px-5 py-4 md:px-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg md:text-xl font-headline font-extrabold text-on-surface">快速创建旅行需求</h3>
                    <p className="mt-1 text-xs md:text-sm text-on-surface-variant">先补充目的地和时间，再继续生成行程</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPlannerOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-container-low text-outline transition-colors hover:text-primary hover:bg-surface-container"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 md:px-6 md:py-5">
                <div className="mb-4 flex flex-wrap items-center gap-2.5 text-sm">
                  <div className="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-4 py-2 text-on-surface">
                    <MapPin className="h-4 w-4 text-primary" />
                    <input
                      value={departureLabel}
                      onChange={(e) => setDepartureLabel(e.target.value)}
                      placeholder="出发地"
                      className="w-28 bg-transparent outline-none placeholder:text-outline"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setDepartureLabel('')}
                    className="text-on-surface-variant transition-colors hover:text-primary"
                  >
                    清空
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.3fr_1fr]">
                  <label className="relative rounded-[1.25rem] border border-outline-variant/20 bg-white px-4 py-4 shadow-sm">
                    <div className="flex items-center gap-3 text-on-surface">
                      <MapPin className="h-5 w-5 text-primary" />
                      <span className="text-lg font-headline font-bold">目的地</span>
                    </div>
                    <input
                      value={manualDestination}
                      onChange={(e) => {
                        setManualDestination(e.target.value);
                        setDestinationOpen(true);
                      }}
                      onFocus={() => setDestinationOpen(true)}
                      placeholder="国家 / 城市 / 地标"
                      className="mt-4 w-full bg-transparent text-base md:text-lg text-on-surface outline-none placeholder:text-outline"
                    />
                    <AnimatePresence>
                      {destinationOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          className="absolute left-0 right-0 top-[calc(100%+10px)] z-20 overflow-hidden rounded-[1.25rem] border border-outline-variant/20 bg-white shadow-[0_18px_45px_rgba(36,44,68,0.16)]"
                        >
                          <div className="border-b border-outline-variant/10 px-4 py-3.5 bg-gradient-to-r from-slate-50 to-white">
                            <div className="flex items-center justify-between">
                              <p className="text-xl font-headline font-extrabold tracking-tight text-slate-900">推荐目的地</p>
                              <button
                                type="button"
                                onClick={() => setDestinationOpen(false)}
                                className="text-sm font-semibold text-on-surface-variant hover:text-primary"
                              >
                                收起
                              </button>
                            </div>
                          </div>
                          <div className="max-h-[320px] overflow-y-auto py-2">
                            {filteredDestinations.map((option) => (
                              <button
                                key={`${option.region}-${option.name}`}
                                type="button"
                                onClick={() => {
                                  setManualDestination(option.name);
                                  setDestinationOpen(false);
                                }}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                              >
                                {option.image ? (
                                  <img
                                    src={option.image}
                                    alt={option.name}
                                    className="h-14 w-14 rounded-2xl object-cover shadow-sm"
                                    draggable={false}
                                  />
                                ) : (
                                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-base font-bold text-white ${option.region === '国内' ? 'bg-gradient-to-br from-[#1677ff] to-[#5aa7ff]' : 'bg-gradient-to-br from-[#7c3aed] to-[#38bdf8]'}`}>
                                    {option.name.slice(0, 2)}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[18px] font-headline font-bold tracking-tight text-slate-900">{option.name}</span>
                                    <span className="rounded-full bg-surface-container-low px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                                      {option.region}
                                    </span>
                                    {option.country && (
                                      <span className="text-xs text-on-surface-variant">{option.country}</span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-[13px] text-slate-500">{option.subtitle}</p>
                                </div>
                              </button>
                            ))}
                            {filteredDestinations.length === 0 && (
                              <div className="px-4 py-8 text-center text-sm text-on-surface-variant">
                                没找到匹配城市，可以直接输入你的目的地
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </label>

                  <div className="rounded-[1.25rem] border border-outline-variant/20 bg-white px-4 py-4 shadow-sm">
                    <div className="flex items-center gap-3 text-on-surface">
                      <CalendarDays className="h-5 w-5 text-primary" />
                      <span className="text-lg font-headline font-bold">日期/时间</span>
                    </div>
                    <p className="mt-4 text-base md:text-lg text-on-surface">
                      {plannerTab === 'date' ? exactDateLabel : flexibleDateLabel}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-4 rounded-[1.5rem] border border-outline-variant/15 bg-surface-container-lowest p-4 shadow-[0_10px_30px_rgba(87,94,112,0.08)]">
                  <div className="mx-auto inline-flex rounded-full bg-surface-container-low p-1">
                    <button
                      type="button"
                      onClick={() => setPlannerTab('date')}
                      className={`rounded-full px-5 py-2 text-base font-bold transition-all ${plannerTab === 'date' ? 'bg-primary text-white shadow-sm' : 'text-on-surface hover:text-primary'}`}
                    >
                      日期
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlannerTab('flexible')}
                      className={`rounded-full px-5 py-2 text-base font-bold transition-all ${plannerTab === 'flexible' ? 'bg-[#1677ff] text-white shadow-sm' : 'text-on-surface hover:text-primary'}`}
                    >
                      灵活时间
                    </button>
                  </div>

                  <AnimatePresence mode="wait">
                    {plannerTab === 'date' ? (
                      <motion.div
                        key="date-mode"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          {[
                            { month: visibleMonth, days: leftMonthDays, align: 'left' as const },
                            { month: rightMonth, days: rightMonthDays, align: 'right' as const },
                          ].map(({ month, days, align }) => (
                            <div key={month.toISOString()} className="rounded-[1.35rem] border border-outline-variant/15 bg-white px-3 py-4">
                              <div className="mb-4 flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => setVisibleMonth((current) => addMonths(current, align === 'left' ? -1 : 1))}
                                  className="flex h-9 w-9 items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container-low hover:text-primary"
                                >
                                  {align === 'left' ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                </button>
                                <h4 className="text-xl font-headline font-extrabold text-on-surface">{formatMonthTitle(month)}</h4>
                                <div className="h-9 w-9" />
                              </div>

                              <div className="grid grid-cols-7 gap-y-2 text-center">
                                {WEEK_LABELS.map((label, index) => (
                                  <div
                                    key={`${month.toISOString()}-${label}`}
                                    className={`text-sm font-medium ${index === 0 || index === 6 ? 'text-[#1d4ed8]' : 'text-on-surface-variant'}`}
                                  >
                                    {label}
                                  </div>
                                ))}

                                {days.map((date, index) => {
                                  if (!date) {
                                    return <div key={`${month.toISOString()}-empty-${index}`} className="h-12 rounded-2xl" />;
                                  }

                                  const isStart = sameDay(date, startDateObj);
                                  const isEnd = sameDay(date, endDateObj);
                                  const isSingle = isStart && !endDate;
                                  const isInRange = Boolean(startDateObj && endDateObj && date >= startDateObj && date <= endDateObj);

                                  return (
                                    <button
                                      key={toDateKey(date)}
                                      type="button"
                                      onClick={() => handleCalendarDateSelect(date)}
                                      className={`relative h-12 rounded-2xl text-xl font-bold transition-all ${
                                        isStart || isEnd || isSingle
                                          ? 'bg-[#315efb] text-white shadow-[0_10px_24px_rgba(49,94,251,0.24)]'
                                          : isInRange
                                            ? 'bg-[#eef3ff] text-on-surface'
                                            : 'text-on-surface hover:bg-surface-container-low'
                                      }`}
                                    >
                                      <span className={`${!isStart && !isEnd && date.getDay() !== 0 && date.getDay() !== 6 ? 'text-on-surface' : ''}`}>
                                        {date.getDate()}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="hidden grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="rounded-2xl border border-outline-variant/15 bg-white px-4 py-3.5">
                          <span className="text-sm font-bold uppercase tracking-wide text-on-surface-variant">开始日期</span>
                          <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="mt-3 w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-base outline-none focus:border-primary"
                          />
                        </label>
                        <label className="rounded-2xl border border-outline-variant/15 bg-white px-4 py-3.5">
                          <span className="text-sm font-bold uppercase tracking-wide text-on-surface-variant">结束日期</span>
                          <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="mt-3 w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-base outline-none focus:border-primary"
                          />
                        </label>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="flexible-mode"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="space-y-5"
                      >
                        <div>
                          <div className="mb-4 flex items-center justify-between">
                            <h4 className="text-xl font-headline font-extrabold text-on-surface">天数</h4>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => setFlexibleDays((value) => Math.max(1, value - 1))}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant/20 text-outline hover:text-primary"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <div className="rounded-xl border border-outline-variant/20 px-4 py-2 text-on-surface-variant">任意天数</div>
                              <button
                                type="button"
                                onClick={() => setFlexibleDays((value) => Math.min(14, value + 1))}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-[#1677ff]/30 text-[#1677ff] hover:bg-[#1677ff]/5"
                              >
                                <PlusCircle className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
                            {dayOptions.map((day) => (
                              <button
                                key={day}
                                type="button"
                                onClick={() => setFlexibleDays(day)}
                                className={`rounded-2xl border px-3 py-3 text-center transition-all ${flexibleDays === day ? 'border-[#1677ff] bg-[#1677ff] text-white shadow-sm' : 'border-outline-variant/20 bg-white text-on-surface hover:border-primary/30'}`}
                              >
                                <div className="text-xl font-bold">{day}天</div>
                                {day === 3 && <div className={`mt-1 text-sm ${flexibleDays === day ? 'text-white/85' : 'text-on-surface-variant'}`}>推荐</div>}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <h4 className="mb-4 text-xl font-headline font-extrabold text-on-surface">月份</h4>
                          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
                            {monthOptions.map((month) => (
                              <button
                                key={month}
                                type="button"
                                onClick={() => setFlexibleMonth(month)}
                                className={`rounded-2xl border px-3 py-3 text-center text-xl font-bold transition-all ${flexibleMonth === month ? 'border-[#1677ff] bg-[#1677ff] text-white shadow-sm' : 'border-outline-variant/20 bg-white text-on-surface hover:border-primary/30'}`}
                              >
                                {month}月
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="border-t border-outline-variant/15 pt-4">
                    <button
                      type="button"
                      onClick={() => setPreferenceOpen((value) => !value)}
                      className="flex items-center gap-3 text-on-surface"
                    >
                      <Heart className="h-5 w-5 text-primary" />
                      <span className="text-xl font-headline font-bold">旅行偏好</span>
                      <ChevronDown className={`h-5 w-5 text-outline transition-transform ${preferenceOpen ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {preferenceOpen && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-4 flex flex-wrap gap-2">
                            {preferenceOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => setSelectedPreference(option)}
                                className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${selectedPreference === option ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface hover:text-primary'}`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              <div className="border-t border-outline-variant/15 bg-white/95 px-5 py-4 md:px-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-on-surface-variant">
                    {manualDestination.trim()
                      ? `将写入：${departureLabel ? `从${departureLabel}出发，` : ''}${manualDestination}，${plannerTab === 'date' ? exactDateLabel : flexibleDateLabel}`
                      : '填写目的地后即可一键写入输入框'}
                  </p>
                  <button
                    type="button"
                    onClick={handleConfirmPlanner}
                    disabled={!canConfirmPlanner}
                    className="rounded-2xl bg-[#1677ff] px-6 py-3 text-base font-bold text-white shadow-[0_14px_28px_rgba(22,119,255,0.22)] transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                  >
                    确定
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.main>
  );
}

const QuickStartCard = memo(function QuickStartCard({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group p-4 text-left bg-white/60 hover:bg-white border border-outline-variant/20 rounded-2xl transition-all duration-300 flex flex-col items-center text-center shadow-sm hover:shadow-md hover:-translate-y-0.5">
      <div className="mb-3 w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-primary-dim group-hover:bg-primary group-hover:text-white transition-all">
        {icon}
      </div>
      <h3 className="text-on-surface font-semibold text-sm mb-1">{title}</h3>
      <p className="text-on-surface-variant text-[11px] opacity-70">{desc}</p>
    </button>
  );
});
