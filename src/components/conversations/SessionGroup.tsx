import { useMemo } from 'react';
import { SessionListItem } from '../../lib/tauri-bridge';
import { SessionItem } from './SessionItem';
import { useT } from '../../lib/i18n';

/** Determine date category for a timestamp */
function getDateCategory(ms: number): 'today' | 'yesterday' | 'thisWeek' | 'earlier' {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;

  // Calculate start of current week (Monday)
  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = todayStart - daysToMonday * 86400000;

  if (ms >= todayStart) return 'today';
  if (ms >= yesterdayStart) return 'yesterday';
  if (ms >= weekStart) return 'thisWeek';
  return 'earlier';
}

interface SessionGroupProps {
  projectKey: string;
  projectLabel: string;
  projectPath: string;
  sessions: SessionListItem[];
  isExpanded: boolean;
  selectedId: string | null;
  runningSessions: Set<string>;
  pinnedSessions: Set<string>;
  archivedSessions: Set<string>;
  customPreviews: Record<string, string>;
  multiSelect: boolean;
  selectedIds: Set<string>;
  onToggleCollapse: (project: string) => void;
  onContextMenu: (e: React.MouseEvent, session: SessionListItem) => void;
  onProjectContextMenu: (e: React.MouseEvent, project: string) => void;
  onLoadSession: (session: SessionListItem) => void;
  onRename: (sessionId: string, newName: string) => void;
  onNewSession: (project: string) => void;
  onToggleCheck: (sessionId: string) => void;
}

export function SessionGroup({
  projectKey,
  projectLabel: label,
  projectPath,
  sessions,
  isExpanded,
  selectedId,
  runningSessions,
  pinnedSessions,
  archivedSessions,
  customPreviews,
  multiSelect,
  selectedIds,
  onToggleCollapse,
  onContextMenu,
  onProjectContextMenu,
  onLoadSession,
  onRename,
  onNewSession,
  onToggleCheck,
}: SessionGroupProps) {
  const t = useT();

  // Split into pinned and unpinned, then group unpinned by date
  const { pinnedItems, dateGroups } = useMemo(() => {
    const pinned: SessionListItem[] = [];
    const unpinned: SessionListItem[] = [];

    for (const s of sessions) {
      if (pinnedSessions.has(s.id)) {
        pinned.push(s);
      } else {
        unpinned.push(s);
      }
    }

    // Group unpinned by date category
    const groups: { category: string; label: string; items: SessionListItem[] }[] = [];
    const categoryMap = new Map<string, SessionListItem[]>();

    for (const s of unpinned) {
      const cat = getDateCategory(s.modifiedAt);
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat)!.push(s);
    }

    // Define order
    const categoryOrder: Array<{ key: string; label: string }> = [
      { key: 'today', label: t('conv.today') },
      { key: 'yesterday', label: t('conv.yesterday') },
      { key: 'thisWeek', label: t('conv.thisWeek') },
      { key: 'earlier', label: t('conv.older') },
    ];

    for (const { key, label } of categoryOrder) {
      const items = categoryMap.get(key);
      if (items && items.length > 0) {
        groups.push({ category: key, label, items });
      }
    }

    return { pinnedItems: pinned, dateGroups: groups };
  }, [sessions, pinnedSessions, t]);

  const getDisplayName = (session: SessionListItem) =>
    customPreviews[session.id] || session.preview || '';

  return (
    <div className="mb-1">
      {/* Project header */}
      <button
        onClick={() => onToggleCollapse(projectKey)}
        onContextMenu={(e) => onProjectContextMenu(e, projectKey)}
        className="w-full flex items-center gap-2 px-3 py-1.5
          hover:bg-bg-secondary rounded-lg transition-smooth group"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className={`text-accent transition-transform
            ${isExpanded ? 'rotate-90' : ''}`}>
          <path d="M3 1l4 4-4 4" />
        </svg>
        <span className="text-[13px] font-extrabold text-text-primary
          truncate flex-1 text-left">
          {label}
        </span>
        <span className="text-[11px] text-text-tertiary flex-shrink-0">
          {sessions.length} {t('conv.sessions')}
        </span>
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onNewSession(projectKey); }}
          className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
            hover:bg-bg-tertiary transition-smooth text-text-tertiary hover:text-accent"
          title={t('conv.newChat')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </span>
      </button>

      {/* Project path */}
      {isExpanded && projectKey !== label && (
        <div className="px-7 pb-0.5">
          <span className="text-[10px] text-text-tertiary truncate block">
            {projectPath}
          </span>
        </div>
      )}

      {/* Sessions */}
      {isExpanded && (
        <div>
          {/* Pinned sessions */}
          {pinnedItems.length > 0 && (
            <>
              {pinnedItems.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isSelected={selectedId === session.id}
                  isRunning={runningSessions.has(session.id)}
                  isPinned={true}
                  isArchived={archivedSessions.has(session.id)}
                  displayName={getDisplayName(session)}
                  multiSelect={multiSelect}
                  isChecked={selectedIds.has(session.id)}
                  onSelect={onLoadSession}
                  onContextMenu={onContextMenu}
                  onRename={onRename}
                  onToggleCheck={onToggleCheck}
                />
              ))}
              {dateGroups.length > 0 && (
                <div className="my-1 mx-7 border-t border-border-subtle/50" />
              )}
            </>
          )}

          {/* Date-grouped sessions */}
          {dateGroups.map(({ category, label: dateLabel, items }) => (
            <div key={category}>
              <div className="text-[11px] text-text-tertiary font-medium px-7 py-1 mt-1
                select-none">
                {dateLabel}
              </div>
              {items.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isSelected={selectedId === session.id}
                  isRunning={runningSessions.has(session.id)}
                  isPinned={false}
                  isArchived={archivedSessions.has(session.id)}
                  displayName={getDisplayName(session)}
                  multiSelect={multiSelect}
                  isChecked={selectedIds.has(session.id)}
                  onSelect={onLoadSession}
                  onContextMenu={onContextMenu}
                  onRename={onRename}
                  onToggleCheck={onToggleCheck}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
