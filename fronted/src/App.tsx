import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import type { FinalItinerary, RunningTask } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/HomeView';
import { ProcessingView } from './components/ProcessingView';
import { ItineraryView } from './components/ItineraryView';
import { HistoryView } from './components/HistoryView';
import { LoginView } from './components/LoginView';
import { getTokens, logout, fetchBackendConfig, type BackendConfig } from './api';

export default function App() {
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Fetch backend config on mount
  useEffect(() => {
    fetchBackendConfig()
      .then((cfg) => {
        setConfig(cfg);
        // If auth disabled, auto-authenticate; otherwise check token
        if (!cfg.auth_enabled) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(!!getTokens());
        }
      })
      .catch(() => {
        // No backend? Default to auth disabled (for frontend-only development)
        setConfig({ auth_enabled: false });
        setIsAuthenticated(true);
      })
      .finally(() => setConfigLoading(false));
  }, []);
  const [currentView, setCurrentView] = useState<'home' | 'processing' | 'itinerary' | 'history'>('home');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [itinerary, setItinerary] = useState<FinalItinerary | null>(null);
  const [runningTask, setRunningTask] = useState<RunningTask | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  const handleMenuClick = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    // If auth is enabled, go back to login; otherwise stay (shouldn't happen)
    if (config?.auth_enabled !== false) {
      setIsAuthenticated(false);
    }
    setCurrentView('home');
    setItinerary(null);
    setTaskId(null);
  }, [config]);

  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AnimatePresence mode="wait">
        <LoginView key="login" onLogin={() => setIsAuthenticated(true)} />
      </AnimatePresence>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface font-sans selection:bg-primary-container selection:text-on-primary-container">
      <Header onMenuClick={handleMenuClick} />
      <Sidebar 
        currentView={currentView} 
        onNavigate={setCurrentView} 
        isOpen={sidebarOpen}
        onClose={handleSidebarClose}
        onLogout={handleLogout}
      />

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
