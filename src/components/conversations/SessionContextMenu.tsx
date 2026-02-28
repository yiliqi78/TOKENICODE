import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SessionListItem } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

interface SessionContextMenuProps {
  x: number;
  y: number;
  session: SessionListItem;
  onRename: (session: SessionListItem) => void;
  onRevealInFinder: (session: SessionListItem) => void;
  onExport: (session: SessionListItem) => void;
  onDelete: (session: SessionListItem) => void;
  onPin?: (session: SessionListItem) => void;
  onArchive?: (session: SessionListItem) => void;
  isPinned?: boolean;
  isArchived?: boolean;
  onClose: () => void;
}

export function SessionContextMenu({
  x,
  y,
  session,
  onRename,
  onRevealInFinder,
  onExport,
  onDelete,
  onPin,
  onArchive,
  isPinned,
  isArchived,
  onClose,
}: SessionContextMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[160px] py-1.5 rounded-xl
        bg-bg-card border border-border-subtle shadow-xl animate-fade-in"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => { onClose(); onRename(session); }}
        className="w-full flex items-center gap-2.5 px-3 py-1.5
          text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
        </svg>
        {t('conv.rename')}
      </button>

      {onPin && (
        <button
          onClick={() => { onClose(); onPin(session); }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5
            text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 2L14 6.5L8.5 12L6 14L4.5 11.5L2 9.5L4 7.5L9.5 2z" />
            <path d="M4.5 11.5L1.5 14.5" />
          </svg>
          {isPinned ? t('conv.unpin') : t('conv.pin')}
        </button>
      )}

      {onArchive && (
        <button
          onClick={() => { onClose(); onArchive(session); }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5
            text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="2" width="14" height="4" rx="1" />
            <path d="M2 6v7a1 1 0 001 1h10a1 1 0 001-1V6" />
            <path d="M6 9h4" />
          </svg>
          {isArchived ? t('conv.unarchive') : t('conv.archive')}
        </button>
      )}

      {session.path && (
        <button
          onClick={() => { onClose(); onRevealInFinder(session); }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5
            text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 4h4l2 2h6v7H2V4z" />
          </svg>
          {t('conv.revealInFinder')}
        </button>
      )}

      {session.path && (
        <button
          onClick={() => { onClose(); onExport(session); }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5
            text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 14h8M8 2v9M5 8l3 3 3-3" />
          </svg>
          {t('conv.export')}
        </button>
      )}

      <div className="my-1 border-t border-border-subtle" />

      <button
        onClick={() => { onClose(); onDelete(session); }}
        className="w-full flex items-center gap-2.5 px-3 py-1.5
          text-xs text-red-500 hover:bg-red-500/10 transition-smooth"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
        </svg>
        {t('conv.delete')}
      </button>
    </div>,
    document.body,
  );
}

/** Project-level context menu */
interface ProjectContextMenuProps {
  x: number;
  y: number;
  project: string;
  onNewSession: (project: string) => void;
  onDeleteAll: (project: string) => void;
  onSelectMode?: (project: string) => void;
  onClose: () => void;
}

export function ProjectContextMenu({
  x,
  y,
  project,
  onNewSession,
  onDeleteAll,
  onSelectMode,
  onClose,
}: ProjectContextMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[160px] py-1.5 rounded-xl
        bg-bg-card border border-border-subtle shadow-xl animate-fade-in"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => { onClose(); onNewSession(project); }}
        className="w-full flex items-center gap-2.5 px-3 py-1.5
          text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M8 3v10M3 8h10" />
        </svg>
        {t('conv.newChat')}
      </button>

      {onSelectMode && (
        <>
          <button
            onClick={() => { onClose(); onSelectMode(project); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5
              text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="5" height="5" rx="1" />
              <rect x="9" y="2" width="5" height="5" rx="1" />
              <rect x="2" y="9" width="5" height="5" rx="1" />
              <rect x="9" y="9" width="5" height="5" rx="1" />
            </svg>
            {t('conv.selectMode')}
          </button>
        </>
      )}

      <div className="my-1 border-t border-border-subtle" />

      <button
        onClick={() => { onClose(); onDeleteAll(project); }}
        className="w-full flex items-center gap-2.5 px-3 py-1.5
          text-xs text-red-500 hover:bg-red-500/10 transition-smooth"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
        </svg>
        {t('conv.deleteAll')}
      </button>
    </div>,
    document.body,
  );
}
