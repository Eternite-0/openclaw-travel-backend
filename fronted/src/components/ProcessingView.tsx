import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Network, CheckCircle2, XCircle, CircleDashed, Loader2, Clock, X,
  Sparkles, Cpu,
} from 'lucide-react';
import type { AgentStatus, FinalItinerary } from '../types';
import { AGENT_STYLE } from '../constants';
import { normalizeAgents } from '../utils';
import { pollStatus, fetchResult } from '../api';
import { AnimatedAgentMessage } from './AnimatedAgentMessage';

/* ── Launching overlay phrases ─────────────────────────────────────────────── */
const LAUNCH_PHRASES = [
  '正在为您策划专属行程...',
  '正在启动智能体集群...',
  '连接旅行数据源...',
  '初始化多 Agent 协同系统...',
];

interface ProcessingViewProps {
  taskId: string;
  onComplete: (r: FinalItinerary) => void;
  onCancel: () => void;
}

export function ProcessingView({ taskId, onComplete, onCancel }: ProcessingViewProps) {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [overallStatus, setOverallStatus] = useState<string>('pending');
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  /* ── Launch animation state ──────────────────────────────────────────────── */
  const [phase, setPhase] = useState<'launching' | 'agents'>('launching');
  const [launchIdx, setLaunchIdx] = useState(0);

  // Cycle through launch phrases
  useEffect(() => {
    if (phase !== 'launching') return;
    const iv = setInterval(() => setLaunchIdx(i => (i + 1) % LAUNCH_PHRASES.length), 1200);
    return () => clearInterval(iv);
  }, [phase]);

  // Transition from launching → agents after first real data arrives or timeout
  useEffect(() => {
    if (phase !== 'launching') return;
    // Auto-transition after 2.5s minimum launch time
    const timer = setTimeout(() => setPhase('agents'), 2500);
    return () => clearTimeout(timer);
  }, [phase]);

  // Also transition when first agent data arrives (but still respect minimum delay)
  useEffect(() => {
    if (phase === 'launching' && agents.length > 0 && elapsedSec >= 2) {
      setPhase('agents');
    }
  }, [agents, elapsedSec, phase]);

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

  const doneCount = useMemo(() => agents.filter(a => a.status === 'done').length, [agents]);
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  /* ── Launching overlay ───────────────────────────────────────────────────── */
  if (phase === 'launching') {
    return (
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="ml-0 lg:ml-[220px] pt-16 min-h-screen bg-surface-container-lowest flex flex-col items-center justify-center relative overflow-hidden"
      >
        {/* Blurred background effect */}
        <div className="absolute inset-0 backdrop-blur-sm bg-white/60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(var(--md-sys-color-primary-rgb,16,109,32),0.06)_0%,transparent_70%)]" />

        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 flex flex-col items-center gap-6"
        >
          {/* Animated icon cluster */}
          <div className="relative w-20 h-20">
            <motion.div
              className="absolute inset-0 bg-primary/10 rounded-full"
              animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute inset-0 bg-primary/8 rounded-full"
              animate={{ scale: [1, 1.6, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
            />
            <div className="w-20 h-20 bg-white rounded-2xl shadow-lg border border-outline-variant/20 flex items-center justify-center relative z-10">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              >
                <Cpu className="w-8 h-8 text-primary" />
              </motion.div>
            </div>
            <motion.div
              className="absolute -top-1 -right-1 w-6 h-6 bg-amber-50 rounded-full flex items-center justify-center border border-amber-200/50 z-20"
              animate={{ scale: [0.8, 1.1, 0.8] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <Sparkles className="w-3 h-3 text-amber-500" />
            </motion.div>
          </div>

          {/* Cycling text */}
          <div className="text-center min-h-[52px] flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.p
                key={launchIdx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="text-base font-semibold text-on-surface"
              >
                {LAUNCH_PHRASES[launchIdx]}
              </motion.p>
            </AnimatePresence>
            <p className="text-xs text-on-surface-variant mt-1.5">OpenClaw 多智能体系统</p>
          </div>

          {/* Subtle loading bar */}
          <div className="w-48 h-1 bg-surface-container-high rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary/60 via-primary to-primary/60 rounded-full"
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: '60%' }}
            />
          </div>
        </motion.div>
      </motion.main>
    );
  }

  /* ── Agent collaboration view ────────────────────────────────────────────── */
  return (
    <motion.main
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="ml-0 lg:ml-[220px] pt-16 min-h-screen bg-surface-container-lowest flex flex-col items-center justify-center relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:40px_40px] opacity-40 pointer-events-none" />

      <div className="max-w-lg w-full mx-4 p-6 md:p-10 bg-white/80 backdrop-blur-xl rounded-[2rem] border border-outline-variant/20 shadow-[0_8px_32px_rgba(87,94,112,0.08)] relative z-10">
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
