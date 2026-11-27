import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';
import { preloadAuthModal, preloadAddNovelModal, preloadSettingsModal } from '../App';
import {
  IconSoundwave,
  IconBook,
  IconPlus,
  IconSettings,
  IconUser,
  IconMoon,
  IconSun,
  IconScroll,
} from './icons';

export const Icon = React.memo(function Icon({ name, className = 'w-4 h-4', ...props }) {
  switch (name) {
    case 'soundwave':
      return <IconSoundwave className={className} {...props} />;
    case 'book':
      return <IconBook className={className} {...props} />;
    case 'plus':
      return <IconPlus className={className} {...props} />;
    case 'settings':
      return <IconSettings className={className} {...props} />;
    case 'user':
      return <IconUser className={className} {...props} />;
    case 'moon':
      return <IconMoon className={className} {...props} />;
    case 'sun':
      return <IconSun className={className} {...props} />;
    case 'scroll':
      return <IconScroll className={className} {...props} />;
    default:
      return null;
  }
});

export default function SidebarNav({
  currentView,
  onNavigate,
  onOpenSettings,
  onOpenAuth,
  onOpenAddNovel,
}) {
  const { user, role, isAuthenticated, isWriterOrAdmin, logout } = useAuth();
  const { theme, cycleTheme } = useTheme();

  const themeLabel = theme === 'dark' ? 'Dark Stage' : 'Light Stage';

  return (
    <>
      {/* Mobile Bottom Navigation Bar (Hidden in Reader View for Immersive Reading) */}
      <nav
        className={`sm:hidden fixed bottom-0 left-0 right-0 z-50 h-14 bg-[var(--bg-bar)] border-t border-[var(--border-subtle)] items-center justify-around px-1.5 ${
          currentView === 'reader' ? 'hidden' : 'flex'
        }`}
        aria-label="Mobile Navigation"
      >
        <button
          onClick={() => onNavigate('catalog')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 text-[9px] font-mono uppercase tracking-wider transition-all duration-100 ease-out active:scale-95 cursor-pointer ${
            currentView === 'catalog' ? 'text-[var(--text-main)] font-bold' : 'text-[var(--text-sub)]'
          }`}
          aria-label="Library"
        >
          <Icon name="book" className="w-4 h-4" />
          <span>Library</span>
        </button>

        <button
          onClick={() => onNavigate('archive')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 text-[9px] font-mono uppercase tracking-wider transition-all duration-100 ease-out active:scale-95 cursor-pointer ${
            currentView === 'archive' ? 'text-[var(--text-main)] font-bold' : 'text-[var(--text-sub)]'
          }`}
          aria-label="Archive"
        >
          <Icon name="scroll" className="w-4 h-4" />
          <span>Archive</span>
        </button>

        <button
          onClick={() => onNavigate('voices')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 text-[9px] font-mono uppercase tracking-wider transition-all duration-100 ease-out active:scale-95 cursor-pointer ${
            currentView === 'voices' ? 'text-[var(--text-main)] font-bold' : 'text-[var(--text-sub)]'
          }`}
          aria-label="Voices"
        >
          <Icon name="soundwave" className="w-4 h-4" />
          <span>Voices</span>
        </button>

        <button
          onClick={() => onNavigate('reader')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 text-[9px] font-mono uppercase tracking-wider transition-all duration-100 ease-out active:scale-95 cursor-pointer ${
            currentView === 'reader' ? 'text-[var(--text-main)] font-bold' : 'text-[var(--text-sub)]'
          }`}
          aria-label="Reader"
        >
          <Icon name="book" className="w-4 h-4" />
          <span>Reader</span>
        </button>

        <button
          onClick={() => onNavigate('upload')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 text-[9px] font-mono uppercase tracking-wider transition-all duration-100 ease-out active:scale-95 cursor-pointer ${
            currentView === 'upload' ? 'text-[var(--text-main)] font-bold' : 'text-[var(--text-sub)]'
          }`}
          aria-label="Upload Studio"
        >
          <Icon name="plus" className="w-4 h-4" />
          <span>Upload</span>
        </button>
      </nav>
    </>
  );
}
