/**
 * RewindPanel — two-phase popover for conversation rewind.
 * Matches Claude Code CLI's rewind behavior:
 *   Phase 1: Turn list (oldest first, newest at bottom), ↑↓ navigate, Enter select
 *   Phase 2: 5 action options, ↑↓ or 1-5 navigate, Enter confirm
 *   Esc: back (phase 2→1) or close (phase 1→dismiss)
 *
 * All 5 options are functional:
 *   1. Restore code and conversation
 *   2. Restore conversation only
 *   3. Restore code only
 *   4. Summarize from here
 *   5. Cancel
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useRewind, type RewindAction } from '../../hooks/useRewind';
import { shortFilePath, relativeTime, type Turn } from '../../lib/turns';
import { useT } from '../../lib/i18n';

interface RewindPanelProps {
  onClose: () => void;
}

export function RewindPanel({ onClose }: RewindPanelProps) {
  const t = useT();
  const { turns, executeRewind } = useRewind();
  const [selectedTurn, setSelectedTurn] = useState<Turn | null>(null);
  // Start focused on the newest turn (last item in chronological list)
  const [focusedIndex, setFocusedIndex] = useState(Math.max(turns.length - 1, 0));
  const [actionIndex, setActionIndex] = useState(1); // default to option 2 (restore conversation)
  // Track mouse hover separately: -1 means no hover, use keyboard focusedIndex
  const [hoveredTurnIdx, setHoveredTurnIdx] = useState(-1);
  const [hoveredActionIdx, setHoveredActionIdx] = useState(-1);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Chronological order: oldest first, newest last (standard chat layout)
  const displayTurns = turns;
  const currentTurnI = turns.length - 1; // newest turn at end

  // --- Auto-scroll to bottom on mount (newest turns visible) ---
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, []);

  // --- Close on outside click ---
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  // --- Action definitions ---
  const actions: { label: string; action: RewindAction | 'cancel' }[] = [
    { label: t('rewind.restoreAll'), action: 'restore_all' },
    { label: t('rewind.restoreConversation'), action: 'restore_conversation' },
    { label: t('rewind.restoreCode'), action: 'restore_code' },
    { label: t('rewind.summarize'), action: 'summarize' },
    { label: t('rewind.cancel'), action: 'cancel' },
  ];

  // --- Execute action by index ---
  const doAction = useCallback(async (idx: number) => {
    if (!selectedTurn) return;
    const a = actions[idx];
    if (!a) return;

    if (a.action === 'cancel') {
      onClose();
      return;
    }

    await executeRewind(selectedTurn, a.action);
    onClose();
  }, [selectedTurn, executeRewind, onClose]);

  // --- Keyboard navigation (capture phase to intercept before InputBar) ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedTurn) {
          setSelectedTurn(null);
          setActionIndex(1);
          setHoveredActionIdx(-1);
          setHoveredTurnIdx(-1);
        } else {
          onClose();
        }
        return;
      }

      if (!selectedTurn) {
        // Phase 1: turn list — all turns are selectable including current
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHoveredTurnIdx(-1); // clear mouse hover on keyboard nav
          setFocusedIndex((i) => {
            const next = Math.min(i + 1, displayTurns.length - 1);
            scrollItemIntoView(next);
            return next;
          });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHoveredTurnIdx(-1);
          setFocusedIndex((i) => {
            const next = Math.max(i - 1, 0);
            scrollItemIntoView(next);
            return next;
          });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const activeIdx = hoveredTurnIdx >= 0 ? hoveredTurnIdx : focusedIndex;
          const turn = displayTurns[activeIdx];
          if (turn) {
            setSelectedTurn(turn);
            setActionIndex(1); // default to option 2
            setHoveredActionIdx(-1);
          }
        }
      } else {
        // Phase 2: action options
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHoveredActionIdx(-1);
          setActionIndex((i) => Math.min(i + 1, actions.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHoveredActionIdx(-1);
          setActionIndex((i) => Math.max(i - 1, 0));
        } else if (e.key >= '1' && e.key <= '5') {
          e.preventDefault();
          const idx = parseInt(e.key, 10) - 1;
          setActionIndex(idx);
          setHoveredActionIdx(-1);
          doAction(idx);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const activeIdx = hoveredActionIdx >= 0 ? hoveredActionIdx : actionIndex;
          doAction(activeIdx);
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [selectedTurn, focusedIndex, actionIndex, hoveredTurnIdx, hoveredActionIdx, displayTurns, doAction, onClose]);

  const scrollItemIntoView = (idx: number) => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-turn-idx]');
    items[idx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // ==================== Phase 2: Confirmation ====================
  if (selectedTurn) {
    return (
      <div ref={panelRef}
        className="absolute bottom-full left-0 right-0 mb-2 mx-auto max-w-3xl
          rounded-xl border border-border-subtle bg-bg-card shadow-xl
          overflow-hidden animate-in slide-in-from-bottom-2 duration-200 z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5
          border-b border-border-subtle bg-amber-500/5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSelectedTurn(null); setActionIndex(1); setHoveredActionIdx(-1); setHoveredTurnIdx(-1); }}
              className="p-1 rounded-md hover:bg-bg-tertiary text-text-tertiary
                transition-smooth"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 2L4 6l4 4" />
              </svg>
            </button>
            <span className="text-xs font-semibold text-text-primary">
              {t('rewind.confirm').replace('{n}', String(selectedTurn.index))}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-bg-tertiary text-text-tertiary
              transition-smooth"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>

        {/* Turn preview */}
        <div className="px-4 py-3">
          <div className="flex items-start gap-2 mb-4">
            <div className="w-1 self-stretch rounded-full bg-amber-400/40 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-text-primary leading-relaxed truncate">
                {selectedTurn.userContent}
              </p>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                {relativeTime(selectedTurn.timestamp)}
              </p>
            </div>
          </div>

          {/* Action options */}
          <div className="space-y-1.5"
            onMouseLeave={() => setHoveredActionIdx(-1)}
          >
            {actions.map((a, i) => {
              // Determine active: mouse hover wins over keyboard
              const isActive = hoveredActionIdx >= 0
                ? hoveredActionIdx === i
                : actionIndex === i;
              const isCancel = a.action === 'cancel';
              const isPrimary = i === 1; // "Restore conversation" is highlighted

              return (
                <button
                  key={i}
                  onClick={() => doAction(i)}
                  onMouseEnter={() => setHoveredActionIdx(i)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg
                    text-xs transition-smooth
                    ${isPrimary
                      ? isActive
                        ? 'font-medium text-accent bg-accent/15 border border-accent/30 ring-1 ring-accent/20'
                        : 'font-medium text-accent bg-accent/10 border border-accent/20'
                      : isCancel
                        ? isActive
                          ? 'text-text-primary bg-bg-tertiary ring-1 ring-border-focus'
                          : 'text-text-muted'
                        : isActive
                          ? 'text-text-primary bg-bg-secondary ring-1 ring-border-focus'
                          : 'text-text-muted'
                    }`}
                >
                  <span className={`w-5 text-center ${isPrimary ? '' : 'text-text-tertiary'}`}>
                    {i + 1}.
                  </span>
                  <span>{a.label}</span>
                  {isPrimary && (
                    <span className="ml-auto text-[10px] opacity-60">←</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ==================== Phase 1: Turn list ====================
  return (
    <div ref={panelRef}
      className="absolute bottom-full left-0 right-0 mb-2 mx-auto max-w-3xl
        rounded-xl border border-border-subtle bg-bg-card shadow-xl
        max-h-72 overflow-hidden animate-in slide-in-from-bottom-2 duration-200 z-50
        flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5
        border-b border-border-subtle bg-amber-500/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="text-amber-500">
            <path d="M2 7a5 5 0 019.33-2.5M12 7a5 5 0 01-9.33 2.5"
              strokeLinecap="round" />
            <path d="M11 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 12V9h3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs font-semibold text-text-primary">
            {t('rewind.title')}
          </span>
          <span className="text-[10px] text-text-muted">
            ({turns.length})
          </span>
          <span className="text-[10px] text-text-tertiary ml-1">
            ↑↓ Enter
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-bg-tertiary text-text-tertiary
            transition-smooth"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>

      {/* Turn list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5"
        onMouseLeave={() => setHoveredTurnIdx(-1)}
      >
        {displayTurns.map((turn, i) => {
          const isCurrent = i === currentTurnI;
          // Mouse hover wins over keyboard focus; all turns are selectable
          const isActive = hoveredTurnIdx >= 0
            ? hoveredTurnIdx === i
            : focusedIndex === i;
          return (
            <button
              key={turn.userMessageId}
              data-turn-idx={i}
              onClick={() => {
                setSelectedTurn(turn);
                setActionIndex(1); // default to option 2
                setHoveredActionIdx(-1);
              }}
              onMouseEnter={() => setHoveredTurnIdx(i)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-smooth cursor-pointer
                ${isActive
                  ? 'bg-bg-tertiary ring-1 ring-border-focus'
                  : ''
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {/* Turn number badge */}
                <span className={`flex-shrink-0 w-5 h-5 rounded-full
                  text-[10px] font-bold flex items-center justify-center
                  ${isActive
                    ? 'bg-accent/10 text-accent'
                    : 'bg-bg-secondary text-text-tertiary'
                  }`}>
                  {turn.index}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isCurrent && (
                      <span className="text-[10px] font-medium text-accent">
                        {t('rewind.current')}
                      </span>
                    )}
                    <span className="text-xs text-text-primary truncate">
                      {turn.userContent}
                    </span>
                  </div>

                  {/* Code changes */}
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {turn.codeChanges.length > 0 ? (
                      turn.codeChanges.slice(0, 3).map((change, ci) => (
                        <span key={ci} className={`text-[10px] px-1.5 py-0.5 rounded
                          ${change.action === 'terminal'
                            ? 'bg-blue-500/10 text-blue-400'
                            : change.action === 'created'
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-amber-500/10 text-amber-400'
                          }`}>
                          {change.action === 'terminal' ? '⌘' : ''}
                          {shortFilePath(change.filePath)}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-text-tertiary">
                        {t('rewind.noChanges')}
                      </span>
                    )}
                    {turn.codeChanges.length > 3 && (
                      <span className="text-[10px] text-text-tertiary">
                        +{turn.codeChanges.length - 3}
                      </span>
                    )}
                  </div>
                </div>

                {/* Timestamp */}
                <span className="flex-shrink-0 text-[10px] text-text-tertiary">
                  {relativeTime(turn.timestamp)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
