import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { create } from 'zustand';
import { useChatStore, type ChatMessage } from '../../stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { ToolGroup } from './ToolGroup';
import { InputBar } from './InputBar';
import { ExportMenu } from '../conversations/ExportMenu';
import { useSettingsStore, MODEL_OPTIONS } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useFileStore } from '../../stores/fileStore';
import { bridge, onClaudeStream, onClaudeStderr } from '../../lib/tauri-bridge';
import { open } from '@tauri-apps/plugin-dialog';
import { useT } from '../../lib/i18n';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { SetupWizard } from '../setup/SetupWizard';
import { endTreeDrag } from '../../lib/drag-state';

/** Shared plan panel toggle — used by ChatPanel (panel) and InputBar (button) */
export const usePlanPanelStore = create<{
  open: boolean;
  toggle: () => void;
  close: () => void;
}>()((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

/** Resizable right-side plan panel */
function PlanPanel({ planMessages, onClose }: {
  planMessages: ChatMessage[];
  onClose: () => void;
}) {
  const t = useT();
  const [width, setWidth] = useState(420);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      // Dragging left edge → moving left = wider
      const delta = startX.current - ev.clientX;
      const newWidth = Math.max(280, Math.min(800, startW.current + delta));
      setWidth(newWidth);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  return (
    <div
      className="absolute right-3 top-3 bottom-3 z-20
        bg-bg-card/80 backdrop-blur-xl border border-white/10 rounded-2xl
        shadow-2xl shadow-black/20
        flex flex-col overflow-hidden"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize
          hover:bg-accent/20 active:bg-accent/30 transition-colors z-10"
        onMouseDown={handleMouseDown}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5
        border-b border-border-subtle bg-accent/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="text-accent">
            <path d="M2 3.5h10M2 7h8M2 10.5h5" />
          </svg>
          <span className="text-xs font-semibold text-text-primary">
            {t('msg.planTitle')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-bg-tertiary text-text-tertiary
            transition-smooth cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {planMessages.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4">
            {t('msg.noPlan')}
          </p>
        ) : (
          planMessages.map((planMsg) => (
            <div key={planMsg.id} className="text-sm leading-relaxed">
              <MarkdownRenderer content={planMsg.planContent || planMsg.content || ''} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Map raw model ID to friendly display name */
function getModelDisplayName(modelId: string): string {
  const option = MODEL_OPTIONS.find((m) => modelId.includes(m.id));
  return option?.short || modelId;
}


/** Format token count: "3.2k" for >=1000, raw number for <1000 */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Format elapsed seconds into "Xm Ys" or "Xs" */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

/** Cycling typewriter text for thinking phase — like Claude Code website "Built for > coders" */
const THINKING_WORD_COUNT = 17;
const TYPING_SPEED = 80;      // ms per character (typing)
const DELETING_SPEED = 40;    // ms per character (deleting)
const PAUSE_DURATION = 2500;  // ms to hold full word
const TRANSITION_DELAY = 300; // ms between delete and next word

/** Fisher-Yates shuffle, always starts with index 0 ("思考中"/"Thinking") */
function shuffledOrder(count: number): number[] {
  const arr = Array.from({ length: count }, (_, i) => i);
  for (let i = arr.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(Math.random() * i); // skip index 0
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function CyclingThinkingText() {
  const t = useT();
  const [order, setOrder] = useState(() => shuffledOrder(THINKING_WORD_COUNT));
  const [cursor, setCursor] = useState(0);
  const [displayText, setDisplayText] = useState('');
  const [phase, setPhase] = useState<'typing' | 'pausing' | 'deleting' | 'waiting'>('typing');

  const wordIndex = order[cursor];
  const fullWord = t(`chat.thinkingCycle.${wordIndex}`);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (phase === 'typing') {
      if (displayText.length < fullWord.length) {
        timer = setTimeout(() => {
          setDisplayText(fullWord.slice(0, displayText.length + 1));
        }, TYPING_SPEED);
      } else {
        timer = setTimeout(() => setPhase('pausing'), 0);
      }
    } else if (phase === 'pausing') {
      timer = setTimeout(() => setPhase('deleting'), PAUSE_DURATION);
    } else if (phase === 'deleting') {
      if (displayText.length > 0) {
        timer = setTimeout(() => {
          setDisplayText(displayText.slice(0, -1));
        }, DELETING_SPEED);
      } else {
        const nextCursor = cursor + 1;
        if (nextCursor >= THINKING_WORD_COUNT) {
          // Reshuffle when all words shown
          setOrder(shuffledOrder(THINKING_WORD_COUNT));
          setCursor(0);
        } else {
          setCursor(nextCursor);
        }
        setPhase('waiting');
      }
    } else if (phase === 'waiting') {
      timer = setTimeout(() => {
        setDisplayText('');
        setPhase('typing');
      }, TRANSITION_DELAY);
    }

    return () => clearTimeout(timer);
  }, [displayText, phase, fullWord, cursor]);

  return (
    <span className="inline-flex items-baseline">
      <span>{displayText}</span>
      <span className="text-text-tertiary">...</span>
    </span>
  );
}

/** Activity indicator with elapsed time and token count */
function ActivityIndicator({ activityStatus, sessionMeta }: {
  activityStatus: { phase: string; toolName?: string };
  sessionMeta: { turnStartTime?: number; outputTokens?: number };
}) {
  const t = useT();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const phaseText = activityStatus.phase === 'thinking' ? t('chat.thinking')
    : activityStatus.phase === 'writing' ? t('chat.writing')
    : activityStatus.phase === 'tool' ? `${t('chat.runningTool')}: ${activityStatus.toolName || ''}`
    : activityStatus.phase === 'awaiting' ? t('chat.awaiting')
    : t('chat.running');

  const elapsed = sessionMeta.turnStartTime ? formatElapsed(now - sessionMeta.turnStartTime) : null;
  const tokens = sessionMeta.outputTokens ? formatTokens(sessionMeta.outputTokens) : null;
  const statsText = elapsed
    ? tokens ? `(${elapsed} · ↓ ${tokens})` : `(${elapsed})`
    : null;

  const isThinking = activityStatus.phase === 'thinking';

  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className={`text-sm font-medium leading-none text-accent
        ${isThinking ? '' : 'animate-pulse-soft'}`}>/</span>
      <span className="text-sm text-text-muted">
        {isThinking ? <CyclingThinkingText /> : phaseText}
        {statsText && (
          <span className="text-text-tertiary ml-1.5">{statsText}</span>
        )}
      </span>
    </div>
  );
}

export function ChatPanel() {
  const t = useT();
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const partialText = useChatStore((s) => s.partialText);
  const partialThinking = useChatStore((s) => s.partialThinking);
  const sessionStatus = useChatStore((s) => s.sessionStatus);
  const sessionMeta = useChatStore((s) => s.sessionMeta);
  const activityStatus = useChatStore((s) => s.activityStatus);
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const toggleSecondaryPanel = useSettingsStore((s) => s.toggleSecondaryPanel);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const isFilePreviewMode = !!useFileStore((s) => s.selectedFile);

  const showPlanPanel = usePlanPanelStore((s) => s.open);
  const closePlanPanel = usePlanPanelStore((s) => s.close);


  // Listen for internal file tree drag-drop (mouse-based, not HTML5 drag-and-drop)
  // HTML5 drag events don't work in Tauri because dragDropEnabled: true intercepts them
  useEffect(() => {
    const onTreeDrop = () => {
      const treePath = endTreeDrag();
      if (treePath) {
        const currentDraft = useChatStore.getState().inputDraft;
        const prefix = currentDraft && !currentDraft.endsWith('\n') && !currentDraft.endsWith(' ') ? ' ' : '';
        useChatStore.getState().setInputDraft(currentDraft + prefix + treePath);
      }
    };
    window.addEventListener('tree-drag-drop', onTreeDrop);
    return () => {
      window.removeEventListener('tree-drag-drop', onTreeDrop);
    };
  }, []);

  // --- Tool grouping: group 3+ consecutive tool_use messages ---
  type DisplayItem =
    | { kind: 'message'; msg: ChatMessage; idx: number }
    | { kind: 'tool_group'; msgs: ChatMessage[]; startIdx: number };

  const displayItems = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = [];
    let i = 0;
    while (i < messages.length) {
      // Detect runs of consecutive tool_use messages
      if (messages[i].type === 'tool_use') {
        let j = i;
        while (j < messages.length && messages[j].type === 'tool_use') j++;
        const runLength = j - i;
        if (runLength >= 3) {
          items.push({ kind: 'tool_group', msgs: messages.slice(i, j), startIdx: i });
          i = j;
          continue;
        }
      }
      items.push({ kind: 'message', msg: messages[i], idx: i });
      i++;
    }
    return items;
  }, [messages]);

  // Collect plan review messages from the session (created by ExitPlanMode)
  const planMessages = useMemo(
    () => messages.filter((m) => m.type === 'plan_review' || m.type === 'plan' || m.planContent),
    [messages],
  );

  // Find the path of the currently selected session for export
  const currentSessionPath = sessions.find(
    (s) => s.id === selectedSessionId
  )?.path;

  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  // When user scrolls up via wheel, suppress auto-scroll until they return to bottom
  const userScrollingUpRef = useRef(false);

  // Track whether user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Consider "near bottom" if within 80px of the end
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isNearBottomRef.current = nearBottom;
    // Reset the scroll-up lock once user returns to bottom
    if (nearBottom) {
      userScrollingUpRef.current = false;
    }
  }, []);

  // Detect intentional upward scroll via wheel event
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        // User is scrolling up — suppress auto-scroll
        userScrollingUpRef.current = true;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Auto-scroll to bottom only when already near bottom and user isn't scrolling up
  useEffect(() => {
    if (isNearBottomRef.current && !userScrollingUpRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, partialText, partialThinking, activityStatus]);

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar — with extra top padding for macOS traffic lights */}
      <div
        className="flex items-center h-[68px] pt-[20px] px-5 border-b border-border-subtle
        flex-shrink-0 bg-bg-chat cursor-default">
        {/* Show sidebar toggle when sidebar is not visible:
            either user closed it, or it's hidden by file preview mode */}
        {(!sidebarOpen || isFilePreviewMode) && (
          <button onClick={toggleSidebar}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-tertiary
              transition-smooth mr-3" title={t('chat.showSidebar')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </button>
        )}
        <div className="flex items-center gap-3 pointer-events-none">
          {sessionMeta.model && (
            <span className="text-sm font-medium text-text-muted">
              {getModelDisplayName(sessionMeta.model)}
            </span>
          )}
          {/* Subtle project hint */}
          {workingDirectory && (
            <span className="text-[10px] text-text-tertiary truncate max-w-[160px]"
              title={workingDirectory}>
              {workingDirectory.split(/[\\/]/).pop()}
            </span>
          )}
        </div>
        <ExportMenu sessionPath={currentSessionPath} />
        <button onClick={toggleSecondaryPanel}
          className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-tertiary
            transition-smooth ml-auto" title={t('chat.toggleFiles')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <path d="M10 2v12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 min-h-0 relative">
      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-5 py-6 selectable">
        {!workingDirectory && messages.length === 0 && !isStreaming ? (
          <WelcomeScreen />
        ) : messages.length === 0 && !isStreaming ? (
          <EmptyReadyState />
        ) : (
          <div className="max-w-3xl mx-auto">
            {displayItems.map((item, displayIdx) => {
              // Determine spacing based on item type
              const isCompact = item.kind === 'tool_group'
                || (item.kind === 'message' && ['tool_use', 'tool_result', 'thinking', 'todo', 'plan', 'plan_review'].includes(item.msg.type));
              const prevItem = displayIdx > 0 ? displayItems[displayIdx - 1] : null;
              const prevIsCompact = prevItem && (
                prevItem.kind === 'tool_group'
                || (prevItem.kind === 'message' && ['tool_use', 'tool_result', 'thinking', 'todo', 'plan', 'plan_review'].includes(prevItem.msg.type))
              );
              const spacing = displayIdx === 0
                ? ''
                : isCompact && prevIsCompact
                  ? 'mt-0.5'
                  : isCompact || prevIsCompact
                    ? 'mt-2'
                    : 'mt-5';

              if (item.kind === 'tool_group') {
                return (
                  <div key={`tg_${item.msgs[0].id}`} className={spacing}>
                    <ToolGroup messages={item.msgs} />
                  </div>
                );
              }

              const msg = item.msg;
              const idx = item.idx;
              // Show avatar only for the FIRST assistant text in a turn.
              let isFirstInGroup = true;
              if (msg.role === 'assistant' && msg.type === 'text') {
                for (let j = idx - 1; j >= 0; j--) {
                  const prev = messages[j];
                  if (prev.role === 'user') break;
                  if (prev.role === 'assistant' && prev.type === 'text') {
                    isFirstInGroup = false;
                    break;
                  }
                }
              }
              return (
                <div key={msg.id} className={spacing}>
                  <MessageBubble message={msg} isFirstInGroup={isFirstInGroup} />
                </div>
              );
            })}
            {/* Streaming thinking — collapsible like ThinkingMsg but with pulse cursor */}
            {isStreaming && partialThinking && (
              <div className="ml-11 mt-1">
                <details open className="group">
                  <summary className="flex items-center gap-1.5 py-1
                    cursor-pointer text-[11px] text-text-tertiary list-none select-none">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                      stroke="currentColor" strokeWidth="1.5"
                      className="transition-transform duration-150 group-open:rotate-90">
                      <path d="M3 2l4 3-4 3" />
                    </svg>
                    {t('msg.thinking')}
                    <span className="inline-block w-1.5 h-3 bg-text-tertiary ml-0.5
                      animate-pulse-soft rounded-sm" />
                  </summary>
                  <pre className="ml-5 mt-0.5 text-[11px] text-text-tertiary
                    whitespace-pre-wrap max-h-48 overflow-y-auto
                    font-mono leading-relaxed">
                    {partialThinking}
                  </pre>
                </details>
              </div>
            )}
            {isStreaming && partialText && (() => {
              // Hide streaming text while an unresolved question is pending —
              // the CLI may keep sending text_delta events for the next turn's
              // content, but the user needs to answer the question first.
              const hasPendingQuestion = messages.some(
                (m) => m.type === 'question' && !m.resolved,
              );
              if (hasPendingQuestion) return null;

              // Check if there's already an assistant text in this turn
              let showStreamAvatar = true;
              for (let j = messages.length - 1; j >= 0; j--) {
                if (messages[j].role === 'user') break;
                if (messages[j].role === 'assistant' && messages[j].type === 'text') {
                  showStreamAvatar = false;
                  break;
                }
              }
              return (
              <div className="flex gap-3 mt-2">
                {showStreamAvatar ? (
                  <div className="w-8 h-8 rounded-[10px] bg-accent
                    flex items-center justify-center flex-shrink-0 text-text-inverse
                    text-xs font-bold shadow-md mt-0.5">C</div>
                ) : (
                  <div className="w-8 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0 text-base text-text-primary leading-relaxed">
                  <MarkdownRenderer content={partialText} />
                  <span className="inline-block w-2 h-5 bg-accent ml-0.5
                    animate-pulse-soft rounded-sm shadow-[0_0_8px_var(--color-accent-glow)]" />
                </div>
              </div>
              );
            })()}
            {/* Inline activity status indicator — like Claude Desktop App */}
            {(sessionStatus === 'running' || activityStatus.phase === 'awaiting') && (
              <ActivityIndicator activityStatus={activityStatus} sessionMeta={sessionMeta} />
            )}
          </div>
        )}
      </div>

      {/* Input — only show when a project folder is selected */}
      {workingDirectory && <InputBar />}
      </div>{/* end main chat area */}

      {/* Right-side plan panel (resizable) */}
      {showPlanPanel && (
        <PlanPanel
          planMessages={planMessages}
          onClose={closePlanPanel}
        />
      )}
      </div>{/* end flex row */}
    </div>
  );
}

/** Start a new draft conversation for the given folder and pre-warm the CLI process */
async function startDraftSession(folderPath: string) {
  useSettingsStore.getState().setWorkingDirectory(folderPath);
  useChatStore.getState().clearMessages();
  useChatStore.getState().setSessionMeta({});
  useChatStore.getState().setSessionStatus('idle');

  // Reuse existing draft tab if one is already selected, otherwise create a new one
  const currentTabId = useSessionStore.getState().selectedSessionId;
  const currentSession = useSessionStore.getState().sessions.find(
    (s) => s.id === currentTabId,
  );
  let draftId: string;
  if (currentSession && currentSession.path === '') {
    // Reuse the existing draft — just update its project info
    draftId = currentSession.id;
    useSessionStore.getState().updateDraftProject(draftId, folderPath);
  } else {
    // No draft selected — create a new one
    draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    useSessionStore.getState().addDraftSession(draftId, folderPath);
  }

  // Pre-warm: spawn CLI process in background so first message is fast.
  // Send empty prompt — Rust will skip the NDJSON send.
  const preWarmId = `desk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    // Register stream listeners before spawning
    const unlisten = await onClaudeStream(preWarmId, (msg: any) => {
      // Tag message with stdinId so the handler can route to correct session
      msg.__stdinId = preWarmId;
      // Forward to InputBar's handler via a global — will be overridden when InputBar mounts
      if ((window as any).__claudeStreamHandler) {
        (window as any).__claudeStreamHandler(msg);
      }
    });
    const unlistenStderr = await onClaudeStderr(preWarmId, (line: string) => {
      // Log pre-warm stderr for debugging (errors here explain why CLI may fail)
      console.warn('[TOKENICODE] pre-warm stderr:', line);
    });

    // Store unlisten per stdinId for multi-session support
    if (!(window as any).__claudeUnlisteners) {
      (window as any).__claudeUnlisteners = {};
    }
    (window as any).__claudeUnlisteners[preWarmId] = () => {
      unlisten();
      unlistenStderr();
    };
    // Keep backward-compat single reference for current active session
    (window as any).__claudeUnlisten = (window as any).__claudeUnlisteners[preWarmId];

    const session = await bridge.startSession({
      prompt: '',  // empty = pre-warm, no message sent
      cwd: folderPath,
      model: useSettingsStore.getState().selectedModel,
      session_id: preWarmId,
      dangerously_skip_permissions: useSettingsStore.getState().sessionMode === 'bypass',
      thinking_enabled: useSettingsStore.getState().thinkingEnabled,
    });

    // Store stdinId so InputBar can send the first message via stdin
    useChatStore.getState().setSessionMeta({
      sessionId: session.session_id,
      stdinId: preWarmId,
    });

    // Register stdinId → tabId mapping for background stream routing
    useSessionStore.getState().registerStdinTab(preWarmId, draftId);

    bridge.trackSession(session.session_id).catch(() => {});
  } catch {
    // Pre-warm failed — InputBar will spawn on first message instead
  }
}

/** Welcome screen shown when no project folder is selected */
function WelcomeScreen() {
  const t = useT();
  const setupCompleted = useSettingsStore((s) => s.setupCompleted);
  const recentProjects = useFileStore((s) => s.recentProjects);
  const fetchProjects = useFileStore((s) => s.fetchRecentProjects);

  useEffect(() => { fetchProjects(); }, []);

  const handlePickFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('project.selectFolder'),
    });
    if (selected) {
      startDraftSession(selected as string);
    }
  }, [t]);

  // Show SetupWizard if setup has not been completed
  if (!setupCompleted) {
    return <SetupWizard />;
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      {/* App icon — inverts between light/dark, slash follows accent */}
      <div className="w-20 h-20 rounded-3xl bg-black dark:bg-white
        flex items-center justify-center mb-6 shadow-glow">
        <svg width="80" height="80" viewBox="0 0 171 171" fill="none">
          <path d="M66.79 58.73L40.33 85.19L66.79 111.66L57.53 120.92L21.8 85.19L57.53 49.47Z" className="fill-white dark:fill-black" />
          <path d="M111.5 49.47L147.22 85.19L111.5 120.92L102.24 111.66L128.7 85.19L102.24 58.73Z" className="fill-white dark:fill-black" />
          <path d="M90.01 39.92L102.01 39.92L79.24 129.92L67.24 129.92L79.24 81.92Z" fill="var(--color-icon-slash)" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-accent mb-2">
        {t('chat.welcome')}
      </h2>
      <p className="text-sm text-text-muted max-w-sm leading-relaxed mb-6">
        {t('welcome.subtitle')}
      </p>

      {/* Primary action: new chat with folder picker */}
      <button
        onClick={handlePickFolder}
        className="px-6 py-3 rounded-[20px] text-sm font-medium
          bg-accent hover:bg-accent-hover text-text-inverse
          hover:shadow-glow transition-smooth
          flex items-center gap-2 mb-8"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h4l2 2h6v7H2V4z" />
        </svg>
        {t('welcome.newChat')}
      </button>

      {/* Recent projects */}
      {recentProjects.length > 0 && (
        <div className="w-full max-w-sm">
          <div className="text-[11px] font-medium text-text-tertiary uppercase
            tracking-wider mb-3">
            {t('welcome.recentProjects')}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {recentProjects.slice(0, 6).map((project) => (
              <button
                key={project.path}
                onClick={() => startDraftSession(project.path)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5
                  rounded-lg border border-border-subtle text-xs
                  text-text-muted hover:border-accent hover:text-accent
                  hover:bg-accent/5 transition-smooth"
                title={project.shortPath}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="1.5"
                  className="flex-shrink-0 text-text-tertiary">
                  <path d="M2 4h4l2 2h6v7H2V4z" />
                </svg>
                {project.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Empty state shown when project is selected but no messages yet */
function EmptyReadyState() {
  const t = useT();
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      {/* App icon — inverts between light/dark, slash follows accent */}
      <div className="w-16 h-16 rounded-2xl bg-black dark:bg-white
        flex items-center justify-center mb-5 shadow-glow">
        <svg width="64" height="64" viewBox="0 0 171 171" fill="none">
          <path d="M66.79 58.73L40.33 85.19L66.79 111.66L57.53 120.92L21.8 85.19L57.53 49.47Z" className="fill-white dark:fill-black" />
          <path d="M111.5 49.47L147.22 85.19L111.5 120.92L102.24 111.66L128.7 85.19L102.24 58.73Z" className="fill-white dark:fill-black" />
          <path d="M90.01 39.92L102.01 39.92L79.24 129.92L67.24 129.92L79.24 81.92Z" fill="var(--color-icon-slash)" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-accent mb-1">
        {t('chat.welcome')}
      </h2>
      <p className="text-sm text-text-muted max-w-sm leading-relaxed">
        {t('chat.welcomeWithProject')}
      </p>
      {workingDirectory && (
        <p className="text-xs text-text-tertiary mt-2 truncate max-w-xs">
          {workingDirectory}
        </p>
      )}
    </div>
  );
}
