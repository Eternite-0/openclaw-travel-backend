import { memo } from 'react';
import { Bell, Settings } from 'lucide-react';
import avatarImg from '../../images/avatar.jpg';

export const Header = memo(function Header() {
  return (
    <header className="fixed top-0 w-full z-50 bg-surface-container-lowest/80 backdrop-blur-md flex justify-between items-center px-6 h-16 border-b border-outline-variant/20">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-on-surface tracking-tight">OpenTrip</span>
          <span className="text-[10px] font-bold px-2 py-0.5 bg-surface-container-high text-on-surface-variant rounded-full tracking-widest">TRAVEL PLANNER</span>
        </div>
        <div className="hidden md:flex items-center bg-surface-container-low px-4 py-1.5 rounded-full">
          <span className="text-sm font-medium text-primary">OpenClaw Travel Planner</span>
          <span className="ml-2 text-[9px] font-bold bg-primary text-on-primary px-1.5 py-0.5 rounded uppercase tracking-wider">Alpha</span>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4 text-on-surface-variant">
          <Bell className="w-5 h-5 cursor-pointer hover:text-on-surface transition-colors" />
          <Settings className="w-5 h-5 cursor-pointer hover:text-on-surface transition-colors" />
        </div>
        <div className="h-8 w-8 rounded-full bg-surface-container-highest flex items-center justify-center overflow-hidden">
          <img src={avatarImg} alt="User" className="h-full w-full object-cover" />
        </div>
      </div>
    </header>
  );
});
