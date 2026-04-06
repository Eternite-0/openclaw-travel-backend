import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { Map as MapIcon, History, PlusCircle, Settings, LogOut, Globe, HelpCircle, ChevronRight, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: 'home' | 'processing' | 'itinerary' | 'history' | 'settings') => void;
  isOpen?: boolean;
  onClose?: () => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  avatarUrl?: string | null;
  username?: string;
  email?: string | null;
}

export const Sidebar = memo(function Sidebar({ currentView, onNavigate, isOpen, onClose, onLogout, onOpenSettings, avatarUrl, username, email }: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleNavigate = (view: 'home' | 'processing' | 'itinerary' | 'history' | 'settings') => {
    onNavigate(view);
    onClose?.();
  };

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Close popup on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen, closeMenu]);

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      
      {/* Sidebar */}
      <aside 
        className={`
          fixed left-0 top-16 h-[calc(100vh-64px)] w-[220px] bg-surface-container-low 
          flex flex-col p-4 space-y-2 z-40 border-r border-outline-variant/20
          transition-transform duration-300 ease-in-out
          lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Mobile Close Button */}
        <button
          onClick={onClose}
          className="lg:hidden absolute top-2 right-2 p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant"
          aria-label="关闭菜单"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-6 px-2 mt-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">AI Workbench</h2>
          <p className="text-[9px] text-outline tracking-wider mt-1 uppercase">Professional Orchestration</p>
        </div>
        <nav className="flex-grow space-y-1">
          <button
            onClick={() => handleNavigate('itinerary')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'itinerary' ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            <MapIcon className="w-4 h-4" />
            <span className="text-sm font-medium">当前任务</span>
          </button>
          <button
            onClick={() => handleNavigate('history')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'history' ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            <History className="w-4 h-4" />
            <span className="text-sm">历史规划</span>
          </button>
          <button
            onClick={() => handleNavigate('home')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'home' ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            <PlusCircle className="w-4 h-4" />
            <span className="text-sm">新建任务</span>
          </button>
        </nav>

        {/* Bottom avatar bar + popup */}
        <div className="mt-auto pt-3 border-t border-outline-variant/10 relative" ref={menuRef}>
          {/* Popup menu */}
          <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute bottom-full left-0 right-0 mb-2 mx-1 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-outline-variant/15 py-1.5 z-50 origin-bottom">
              {/* Email */}
              {email && (
                <div className="px-4 py-2 text-xs text-on-surface-variant truncate border-b border-outline-variant/10 mb-1">
                  {email}
                </div>
              )}

              {/* Settings */}
              <button
                onClick={() => { closeMenu(); onOpenSettings?.(); onClose?.(); }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <Settings className="w-4 h-4 text-on-surface-variant" />
                <span>个人设置</span>
              </button>

              {/* Language */}
              <button
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <Globe className="w-4 h-4 text-on-surface-variant" />
                <span className="flex-1 text-left">语言</span>
                <ChevronRight className="w-3.5 h-3.5 text-outline" />
              </button>

              {/* Get help */}
              <button
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <HelpCircle className="w-4 h-4 text-on-surface-variant" />
                <span>获取帮助</span>
              </button>

              {/* Logout */}
              {onLogout && (
                <>
                  <div className="my-1 border-t border-outline-variant/10" />
                  <button
                    onClick={() => { closeMenu(); onLogout(); }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                  >
                    <LogOut className="w-4 h-4 text-on-surface-variant" />
                    <span>登出</span>
                  </button>
                </>
              )}
            </motion.div>
          )}
          </AnimatePresence>

          {/* Avatar bar trigger */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center overflow-hidden shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={username ?? 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="text-xs font-bold text-primary">
                  {(username ?? 'U').charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-medium text-on-surface truncate">{username || '用户'}</p>
              <p className="text-[10px] text-outline truncate">个人账户</p>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
});
