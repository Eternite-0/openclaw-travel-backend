import { useState, useEffect, useCallback, memo, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  Sun, MapPin, Umbrella, Mountain, Wallet, Users,
  Plus, ArrowUp, Loader2,
} from 'lucide-react';
import { postChat } from '../api';

interface HomeViewProps {
  sessionId: string;
  onNavigate: (taskId: string, query: string) => void;
}

export function HomeView({ sessionId, onNavigate }: HomeViewProps) {
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
