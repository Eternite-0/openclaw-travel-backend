import { useState, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import type { FinalItinerary, RunningTask } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/HomeView';
import { ProcessingView } from './components/ProcessingView';
import { ItineraryView } from './components/ItineraryView';
import { HistoryView } from './components/HistoryView';

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
      <Header />
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />

      <AnimatePresence mode="wait">
        {currentView === 'home' && (
          <div key="home">
            <HomeView sessionId={sessionId} onNavigate={handleNavigateToProcessing} />
          </div>
        )}
        {currentView === 'processing' && taskId && (
          <div key="processing">
            <ProcessingView taskId={taskId} onComplete={handleProcessingComplete} onCancel={handleCancelTask} />
          </div>
        )}
        {currentView === 'itinerary' && (
          <div key="itinerary">
            <ItineraryView itinerary={itinerary} sessionId={sessionId} onUpdateItinerary={handleUpdateItinerary} />
          </div>
        )}
        {currentView === 'history' && (
          <div key="history">
            <HistoryView onViewItem={handleViewHistoryItem} runningTask={runningTask} onResumeTask={handleResumeTask} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
