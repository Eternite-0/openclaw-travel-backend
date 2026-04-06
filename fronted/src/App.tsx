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
import { SettingsView } from './components/SettingsView';
import { getTokens, logout, fetchBackendConfig, fetchUserProfile, type BackendConfig } from './api';

export default function App() {
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayUsername, setDisplayUsername] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Fetch backend config on mount
  useEffect(() => {
    fetchBackendConfig()
      .then((cfg) => {
        setConfig(cfg);
        if (!cfg.auth_enabled) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(!!getTokens());
        }
      })
      .catch(() => {
        setConfig({ auth_enabled: false });
        setIsAuthenticated(true);
      })
      .finally(() => setConfigLoading(false));
  }, []);

  // Sync user profile (avatar + username) whenever authenticated
  useEffect(() => {
    if (!isAuthenticated) { setAvatarUrl(null); setDisplayUsername(''); setUserEmail(null); return; }
    // Immediately show username from token while profile loads
    const tokens = getTokens();
    if (tokens?.username) setDisplayUsername(tokens.username);
    fetchUserProfile()
      .then((p) => { setAvatarUrl(p.avatar_url); setDisplayUsername(p.username); setUserEmail(p.email); })
      .catch(() => {});
  }, [isAuthenticated]);
  const [currentView, setCurrentView] = useState<'home' | 'processing' | 'itinerary' | 'history' | 'settings'>('home');
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

  const handleOpenSettings = useCallback(() => {
    setSidebarOpen(false);
    setCurrentView('settings');
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

  if (currentView === 'settings') {
    return (
      <AnimatePresence mode="wait">
        <SettingsView key="settings" onBack={() => setCurrentView('home')} onLogout={handleLogout} />
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
        onLogout={config?.auth_enabled ? handleLogout : undefined}
        onOpenSettings={handleOpenSettings}
        avatarUrl={avatarUrl}
        username={displayUsername}
        email={userEmail}
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
