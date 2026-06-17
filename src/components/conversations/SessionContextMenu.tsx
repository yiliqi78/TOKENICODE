import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SessionListItem } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

/** A group option offered in the "add to group" section. */
export interface GroupOption {
  id: string;
  label: string;
}

interface SessionContextMenuProps {
  x: number;
  y: number;
  session: SessionListItem;
  onRename: (session: SessionListItem) => void;
  onRevealInFinder: (session: SessionListItem) => void;
  onCopyPath: (session: SessionListItem) => void;
  onExport: (session: SessionListItem) => void;
  onDelete: (session: SessionListItem) => void;
  onPin?: (session: SessionListItem) => void;
  isPinned?: boolean;
  // --- Session grouping ---
  /** Create a new group in this session's workspace and drop it in. */
  onCreateGroupWithSession?: (session: SessionListItem) => void;
  /** Groups in this session's workspace it can be moved into (excludes current). */
  availableGroups?: GroupOption[];
  onAddToGroup?: (session: SessionListItem, groupId: string) => void;
  /** Non-null when the session is currently in a group → enables "remove". */
  currentGroupId?: string | null;
  onRemoveFromGroup?: (session: SessionListItem) => void;
  onClose: () => void;
}

const itemCls =
  'tc-context-menu-item';

export function SessionContextMenu({
  x,
  y,
  session,
  onRename,
  onRevealInFinder,
  onCopyPath,
  onExport,
  onDelete,
  onPin,
  isPinned,
  onCreateGroupWithSession,
  availableGroups,
  onAddToGroup,
  currentGroupId,
  onRemoveFromGroup,
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

  const showGrouping =
    !!onCreateGroupWithSession || !!onRemoveFromGroup || (availableGroups?.length ?? 0) > 0;

  return createPortal(
    <div
      ref={menuRef}
      className="tc-context-menu z-[9999] min-w-[200px] animate-fade-in
        max-h-[70vh] overflow-y-auto"
      style={{ left: x, top: y }}
    >
      <button onClick={() => { onClose(); onRename(session); }} className={itemCls}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
        </svg>
        {t('conv.rename')}
      </button>

      {onPin && (
        <button onClick={() => { onClose(); onPin(session); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 2L14 6.5L8.5 12L6 14L4.5 11.5L2 9.5L4 7.5L9.5 2z" />
            <path d="M4.5 11.5L1.5 14.5" />
          </svg>
          {isPinned ? t('conv.unpin') : t('conv.pin')}
        </button>
      )}

      {/* --- Session grouping --- */}
      {showGrouping && <div className="tc-context-menu-separator" />}

      {onCreateGroupWithSession && (
        <button onClick={() => { onClose(); onCreateGroupWithSession(session); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
            <path d="M8 5.5v5M5.5 8h5" />
          </svg>
          创建任务组
        </button>
      )}

      {availableGroups && availableGroups.length > 0 && onAddToGroup && (
        <>
          <div className="tc-context-menu-label">
            加入任务组
          </div>
          {availableGroups.map((g) => (
            <button
              key={g.id}
              onClick={() => { onClose(); onAddToGroup(session, g.id); }}
              className={itemCls}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                className="text-accent/70">
                <rect x="3" y="3" width="10" height="10" rx="2.5" />
              </svg>
              <span className="truncate">{g.label}</span>
            </button>
          ))}
        </>
      )}

      {currentGroupId && onRemoveFromGroup && (
        <button onClick={() => { onClose(); onRemoveFromGroup(session); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h10" />
          </svg>
          移出任务组
        </button>
      )}

      {(session.path || true) && <div className="tc-context-menu-separator" />}

      {session.path && (
        <button onClick={() => { onClose(); onRevealInFinder(session); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 4h4l2 2h6v7H2V4z" />
          </svg>
          {t('conv.revealInFinder')}
        </button>
      )}

      {session.path && (
        <button onClick={() => { onClose(); onCopyPath(session); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="5" width="8" height="8" rx="1.5" />
            <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" />
          </svg>
          {t('conv.copyPath')}
        </button>
      )}

      {session.path && (
        <button onClick={() => { onClose(); onExport(session); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 14h8M8 2v9M5 8l3 3 3-3" />
          </svg>
          {t('conv.export')}
        </button>
      )}

      <div className="tc-context-menu-separator" />

      <button
        onClick={() => { onClose(); onDelete(session); }}
        className="tc-context-menu-item tc-context-menu-item-danger"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
        </svg>
        {t('conv.delete')}
      </button>
    </div>,
    document.body,
  );
}

/** Project-level (workspace) context menu */
interface ProjectContextMenuProps {
  x: number;
  y: number;
  project: string;
  onNewSession: (project: string) => void;
  onCreateGroup?: (project: string) => void;
  onDeleteAll: (project: string) => void;
  onSelectMode?: (project: string) => void;
  onClose: () => void;
}

export function ProjectContextMenu({
  x,
  y,
  project,
  onNewSession,
  onCreateGroup,
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
      className="tc-context-menu z-[9999] min-w-[190px] animate-fade-in"
      style={{ left: x, top: y }}
    >
      <button onClick={() => { onClose(); onNewSession(project); }} className={itemCls}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M8 3v10M3 8h10" />
        </svg>
        {t('conv.newChat')}
      </button>

      {onCreateGroup && (
        <button onClick={() => { onClose(); onCreateGroup(project); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
            <path d="M8 5.5v5M5.5 8h5" />
          </svg>
          创建任务组
        </button>
      )}

      {onSelectMode && (
        <button onClick={() => { onClose(); onSelectMode(project); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="5" height="5" rx="1" />
            <rect x="9" y="2" width="5" height="5" rx="1" />
            <rect x="2" y="9" width="5" height="5" rx="1" />
            <rect x="9" y="9" width="5" height="5" rx="1" />
          </svg>
          {t('conv.selectMode')}
        </button>
      )}

      <div className="tc-context-menu-separator" />

      <button
        onClick={() => { onClose(); onDeleteAll(project); }}
        className="tc-context-menu-item tc-context-menu-item-danger"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
        </svg>
        {t('conv.deleteAll')}
      </button>
    </div>,
    document.body,
  );
}

/** Group-level context menu (rename / delete a task group) */
interface GroupContextMenuProps {
  x: number;
  y: number;
  groupId: string;
  onRename: (groupId: string) => void;
  onExport?: (groupId: string) => void;
  onDelete: (groupId: string) => void;
  onClose: () => void;
}

export function GroupContextMenu({
  x,
  y,
  groupId,
  onRename,
  onExport,
  onDelete,
  onClose,
}: GroupContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
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
      className="tc-context-menu z-[9999] min-w-[180px] animate-fade-in"
      style={{ left: x, top: y }}
    >
      <button onClick={() => { onClose(); onRename(groupId); }} className={itemCls}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
        </svg>
        重命名任务组
      </button>

      {onExport && (
        <button onClick={() => { onClose(); onExport(groupId); }} className={itemCls}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 14h8M8 2v8M5 7l3 3 3-3" />
            <path d="M3 4h2M11 4h2" />
          </svg>
          导出整组 Session
        </button>
      )}

      <div className="tc-context-menu-separator" />

      <button
        onClick={() => { onClose(); onDelete(groupId); }}
        className="tc-context-menu-item tc-context-menu-item-danger"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
        </svg>
        删除任务组
      </button>
    </div>,
    document.body,
  );
}
