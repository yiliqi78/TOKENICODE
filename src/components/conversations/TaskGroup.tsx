import { useState, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SessionListItem } from '../../lib/tauri-bridge';
import { SessionItem } from './SessionItem';
import type { SessionGroup } from '../../stores/groupStore';

interface TaskGroupProps {
  group: SessionGroup;
  /** Member sessions, already ordered (in-group-pinned first). */
  sessions: SessionListItem[];
  isExpanded: boolean;

  // Session item shared props
  selectedId: string | null;
  runningSessions: Set<string>;
  archivedSessions: Set<string>;
  customPreviews: Record<string, string>;
  multiSelect: boolean;
  selectedIds: Set<string>;
  renamingSessionId?: string | null;
  onLoadSession: (s: SessionListItem) => void;
  onSessionContextMenu: (e: React.MouseEvent, s: SessionListItem) => void;
  onRenameSession: (id: string, name: string) => void;
  onToggleCheck: (id: string, shift?: boolean) => void;
  onRenameDone?: () => void;

  // Group-level
  onToggleCollapse: (groupId: string) => void;
  onGroupContextMenu: (e: React.MouseEvent, groupId: string) => void;
  /** Whether this group is in inline-rename mode (driven by parent). */
  isRenaming?: boolean;
  onRenameGroupCommit: (groupId: string, label: string) => void;
  onRenameCancel: () => void;
  /** Create a new session that lands straight in this group (card-head ➕). */
  onNewSessionInGroup: (groupId: string) => void;
}

export function TaskGroup({
  group,
  sessions,
  isExpanded,
  selectedId,
  runningSessions,
  archivedSessions,
  customPreviews,
  multiSelect,
  selectedIds,
  renamingSessionId,
  onLoadSession,
  onSessionContextMenu,
  onRenameSession,
  onToggleCheck,
  onRenameDone,
  onToggleCollapse,
  onGroupContextMenu,
  isRenaming,
  onRenameGroupCommit,
  onRenameCancel,
  onNewSessionInGroup,
}: TaskGroupProps) {
  const [draft, setDraft] = useState(group.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const pinnedSet = new Set(group.pinnedInGroup);

  // Sortable wiring — the card is the sortable node, but only the six-dot
  // handle carries the drag listeners (so clicking the body still toggles).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    if (isRenaming) {
      setDraft(group.label);
      // Focus + select after the input mounts.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isRenaming, group.label]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== group.label) onRenameGroupCommit(group.id, next);
    else onRenameCancel();
  };

  const getDisplayName = (session: SessionListItem) =>
    customPreviews[session.id] || session.preview || '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mx-1 mb-2 rounded-xl bg-bg-card border border-border-subtle
        overflow-hidden
        ${isDragging ? 'opacity-80 relative z-10' : ''}`}
    >
      {/* Card header */}
      <div
        onClick={() => !isRenaming && onToggleCollapse(group.id)}
        onContextMenu={(e) => onGroupContextMenu(e, group.id)}
        className="w-full flex items-center gap-2 pl-2 pr-2 py-2 cursor-pointer
          bg-bg-secondary/30 hover:bg-bg-secondary/50 transition-smooth group"
        role="button"
        tabIndex={0}
      >
        {/* Six-dot drag handle — the only drag origin */}
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none
            select-none text-text-tertiary/70 hover:text-text-tertiary
            transition-colors"
          title="拖动调整组的顺序"
          aria-label="拖动调整组的顺序"
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden>
            <circle cx="2" cy="2" r="1" />
            <circle cx="6" cy="2" r="1" />
            <circle cx="2" cy="6" r="1" />
            <circle cx="6" cy="6" r="1" />
            <circle cx="2" cy="10" r="1" />
            <circle cx="6" cy="10" r="1" />
          </svg>
        </span>

        {/* Group label or inline rename input */}
        {isRenaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') onRenameCancel();
            }}
            className="flex-1 min-w-0 bg-bg-tertiary text-[13px] font-semibold
              text-text-primary px-1.5 py-0.5 rounded-md outline-none
              border border-border-focus"
          />
        ) : (
          <span className="text-[13px] font-semibold text-text-primary
            truncate flex-1 text-left min-w-0">
            {group.label}
          </span>
        )}

        {/* Member count */}
        <span className="text-[11px] text-text-tertiary flex-shrink-0 tabular-nums">
          {sessions.length}
        </span>

        {/* New-session-in-group — dark rounded square (reference card language) */}
        <button
          onClick={(e) => { e.stopPropagation(); onNewSessionInGroup(group.id); }}
          className="flex-shrink-0 p-0.5 flex items-center justify-center
            text-text-tertiary hover:text-accent transition-smooth"
          title="在这个组里新建会话"
          aria-label="在这个组里新建会话"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>

      {/* Members */}
      {isExpanded && sessions.length > 0 && (
        <div className="px-1.5 pb-1.5 pt-1.5 border-t border-border-subtle/70">
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isSelected={selectedId === session.id}
              isRunning={runningSessions.has(session.id)}
              isPinned={pinnedSet.has(session.id)}
              isArchived={archivedSessions.has(session.id)}
              displayName={getDisplayName(session)}
              multiSelect={multiSelect}
              isChecked={selectedIds.has(session.id)}
              onSelect={onLoadSession}
              onContextMenu={onSessionContextMenu}
              onRename={onRenameSession}
              onToggleCheck={onToggleCheck}
              triggerRename={renamingSessionId === session.id}
              onRenameDone={onRenameDone}
              inset="group"
            />
          ))}
        </div>
      )}

      {/* Empty group hint */}
      {isExpanded && sessions.length === 0 && (
        <div className="px-3 py-2 text-[11px] text-text-tertiary/70 select-none
          border-t border-border-subtle/70">
          空组 · 右键已有会话选「加入任务组」
        </div>
      )}
    </div>
  );
}
