import { memo } from 'react';
import { Map as MapIcon, History, PlusCircle, UserCog } from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: 'home' | 'processing' | 'itinerary' | 'history') => void;
}

export const Sidebar = memo(function Sidebar({ currentView, onNavigate }: SidebarProps) {
  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-64px)] w-[220px] bg-surface-container-low flex flex-col p-4 space-y-2 z-40 border-r border-outline-variant/20">
      <div className="mb-6 px-2 mt-2">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">AI Workbench</h2>
        <p className="text-[9px] text-outline tracking-wider mt-1 uppercase">Professional Orchestration</p>
      </div>
      <nav className="flex-grow space-y-1">
        <button
          onClick={() => onNavigate('itinerary')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'itinerary' ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
        >
          <MapIcon className="w-4 h-4" />
          <span className="text-sm font-medium">当前任务</span>
        </button>
        <button
          onClick={() => onNavigate('history')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'history' ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
        >
          <History className="w-4 h-4" />
          <span className="text-sm">历史规划</span>
        </button>
        <button
          onClick={() => onNavigate('home')}
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
  );
});
