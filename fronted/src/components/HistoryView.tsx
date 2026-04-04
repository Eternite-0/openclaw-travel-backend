import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  History, CalendarDays, Wallet, Clock, Plane, ChevronRight, Loader2, Trash2,
} from 'lucide-react';
import type { FinalItinerary, ItinerarySummary, RunningTask } from '../types';
import { fetchTasks, fetchResult, deleteTask } from '../api';

interface HistoryViewProps {
  onViewItem: (r: FinalItinerary) => void;
  runningTask: RunningTask | null;
  onResumeTask: (taskId: string) => void;
}

export function HistoryView({ onViewItem, runningTask, onResumeTask }: HistoryViewProps) {
  const [tasks, setTasks] = useState<ItinerarySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks()
      .then(setTasks)
      .catch(err => setErrorMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleOpen = useCallback(async (taskId: string) => {
    setLoadingTaskId(taskId);
    try {
      const result = await fetchResult(taskId);
      onViewItem(result);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTaskId(null);
    }
  }, [onViewItem]);

  const handleDelete = useCallback(async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (!window.confirm('确定要删除这条历史记录吗？此操作不可撤销。')) return;
    setDeletingTaskId(taskId);
    try {
      await deleteTask(taskId);
      setTasks(prev => prev.filter(t => t.task_id !== taskId));
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingTaskId(null);
    }
  }, []);

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
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleDelete(e, task.task_id)}
                        disabled={deletingTaskId === task.task_id}
                        className="p-1 rounded-lg text-on-surface-variant/40 hover:text-red-500 hover:bg-red-50 transition-all duration-200 disabled:opacity-50"
                        title="删除记录"
                      >
                        {deletingTaskId === task.task_id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
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
