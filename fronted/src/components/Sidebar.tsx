import { memo } from 'react';
import { Map as MapIcon, History, PlusCircle, UserCog, X } from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: 'home' | 'processing' | 'itinerary' | 'history') => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar = memo(function Sidebar({ currentView, onNavigate, isOpen, onClose }: SidebarProps) {
  const handleNavigate = (view: 'home' | 'processing' | 'itinerary' | 'history') => {
    onNavigate(view);
    onClose?.();
  };

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
        <div className="pt-4 mt-auto space-y-1 border-t border-outline-variant/10">
          <button className="w-full flex items-center gap-3 px-3 py-2 text-on-surface-variant text-sm hover:bg-surface-container-high rounded-lg">
            <UserCog className="w-4 h-4" />
            <span>个人设置</span>
          </button>
        </div>
      </aside>
    </>
  );
});
