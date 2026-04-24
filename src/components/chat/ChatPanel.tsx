import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { create } from 'zustand';
import { useChatStore, useActiveTab, type ChatMessage } from '../../stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { ToolGroup } from './ToolGroup';
import { InputBar } from './InputBar';
import { ExportMenu } from '../conversations/ExportMenu';
import { UpdateButton } from '../shared/UpdateButton';
import { useSettingsStore, MODEL_OPTIONS, mapSessionModeToPermissionMode } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useFileStore } from '../../stores/fileStore';
import { useAgentStore } from '../../stores/agentStore';
import { AgentPanel } from '../agents/AgentPanel';
// bridge import removed — spawn goes through sessionLifecycle module
import { open } from '@tauri-apps/plugin-dialog';
import { useT } from '../../lib/i18n';
import { envFingerprint, is1MModel as isOneMillionModel, resolveModelForProvider, spawnConfigHash } from '../../lib/api-provider';
import { useProviderStore } from '../../stores/providerStore';
import { spawnSession } from '../../lib/sessionLifecycle';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { SetupWizard } from '../setup/SetupWizard';
import { AiAvatar } from '../shared/AiAvatar';
import { UserAvatar } from '../shared/UserAvatar';
import { useFindInPage } from '../../hooks/useFindInPage';
import { FindBar } from './FindBar';
import { formatElapsedCompact } from '../../lib/elapsed-time';
import { formatRetryDelaySeconds, isRateLimitRetry, type ApiRetryStatus } from '../../lib/api-retry';

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
  const widthRef = useRef(width);
  widthRef.current = width;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = widthRef.current;

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
  }, []);

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

function formatApiRetryText(retry: ApiRetryStatus, t: (key: string) => string): string {
  const attempt = retry.attempt
    ? retry.maxRetries
      ? t('chat.apiRetryAttempt')
        .replace('{attempt}', String(retry.attempt))
        .replace('{max}', String(retry.maxRetries))
      : t('chat.apiRetryAttemptOnly').replace('{attempt}', String(retry.attempt))
    : '';
  const base = isRateLimitRetry(retry)
    ? t('chat.apiRetryRateLimit')
    : t('chat.apiRetryGeneric');
  const delay = formatRetryDelaySeconds(retry.retryDelayMs);
  const delayText = delay ? ` ${t('chat.apiRetryDelay').replace('{delay}', delay)}` : '';
  return `${base.replace('{attempt}', attempt ? ` ${attempt}` : '')}${delayText}`;
}

/** Activity indicator with elapsed time and token count */
function ActivityIndicator({ activityStatus, sessionMeta, sessionStatus }: {
  activityStatus: { phase: string; toolName?: string };
  sessionMeta: { turnStartTime?: number; outputTokens?: number; inputTokens?: number; lastProgressAt?: number; apiRetry?: ApiRetryStatus };
  sessionStatus?: string;
}) {
  const t = useT();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isStopping = sessionStatus === 'stopping';
  const retryStatus = !isStopping ? sessionMeta.apiRetry : undefined;
  const isStarting = sessionStatus === 'running'
    && activityStatus.phase === 'idle';
  const retryText = retryStatus ? formatApiRetryText(retryStatus, t) : null;
  const phaseText = isStopping ? t('chat.stopping')
    : retryText ? retryText
    : isStarting ? t('chat.startingAgent')
    : activityStatus.phase === 'thinking' ? t('chat.thinking')
    : activityStatus.phase === 'writing' ? t('chat.writing')
    : activityStatus.phase === 'tool' ? `${t('chat.runningTool')}: ${activityStatus.toolName || ''}`
    : activityStatus.phase === 'awaiting' ? t('chat.awaiting')
    : activityStatus.phase === 'reconnecting' ? t('chat.reconnecting')
    : t('chat.running');

  const elapsed = sessionMeta.turnStartTime ? formatElapsedCompact(now - sessionMeta.turnStartTime) : null;
  const tokens = sessionMeta.outputTokens ? formatTokens(sessionMeta.outputTokens) : null;
  const statsText = elapsed
    ? tokens ? `(${elapsed} · ↓ ${tokens})` : `(${elapsed})`
    : null;

  // Context pressure warning: threshold depends on model context window size
  // 1M models → warn at 600K; others at 120K (60% of 200K).
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const resolvedModel = resolveModelForProvider(selectedModel);
  const is1MContextModel = isOneMillionModel(resolvedModel);
  const contextWindow = is1MContextModel ? 1_000_000 : 200_000;
  const inputTokens = sessionMeta.inputTokens || 0;
  const contextWarning = !isStopping && inputTokens > contextWindow * 0.6;

  // Stall detection: 120s of silence (no stream activity), not total elapsed time.
  const stallWarning = !isStopping
    && !!sessionMeta.lastProgressAt
    && !!elapsed
    && (now - sessionMeta.lastProgressAt) > 120_000;

  const isRetrying = Boolean(retryStatus);
  const isThinking = !isRetrying && !isStopping && !isStarting && activityStatus.phase === 'thinking';

  return (
    <div className={`flex items-center gap-1.5 py-1 ${isStopping ? 'px-2.5 rounded-full border border-warning/20 bg-warning/5 w-fit' : ''}`}>
      {isStopping ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-warning/25 border-t-warning animate-spin flex-shrink-0" />
      ) : (
        <span className={`text-sm font-medium leading-none text-accent
          ${isThinking ? '' : 'animate-pulse-soft'}`}>/</span>
      )}
      <span className="text-sm text-text-muted">
        {isThinking ? <CyclingThinkingText /> : phaseText}
        {statsText && (
          <span className={`ml-1.5 ${stallWarning ? 'text-red-400' : 'text-text-tertiary'}`}>{statsText}</span>
        )}
      </span>
      {stallWarning && (
        <span className="text-xs text-red-400 ml-2 flex items-center gap-1">
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          {t('chat.stallWarning')}
        </span>
      )}
      {contextWarning && !stallWarning && (
        <span className="text-xs text-amber-500 ml-2 flex items-center gap-1"
              title={t('chat.tokenWarning')}>
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          {t('chat.tokenWarning')}
        </span>
      )}
    </div>
  );
}

export function ChatPanel() {
  const t = useT();
  const messages = useActiveTab((t) => t.messages);
  const isStreaming = useActiveTab((t) => t.isStreaming);
  const partialText = useActiveTab((t) => t.partialText);
  const partialThinking = useActiveTab((t) => t.partialThinking);
  const sessionStatus = useActiveTab((t) => t.sessionStatus);
  const sessionMeta = useActiveTab((t) => t.sessionMeta);
  const activityStatus = useActiveTab((t) => t.activityStatus);
  const pendingUserMessages = useActiveTab((t) => t.pendingUserMessages);
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const toggleSecondaryPanel = useSettingsStore((s) => s.toggleSecondaryPanel);
  const agentPanelOpen = useSettingsStore((s) => s.agentPanelOpen);
  const toggleAgentPanel = useSettingsStore((s) => s.toggleAgentPanel);
  const sessionMode = useSettingsStore((s) => s.sessionMode);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const directoryMissing = useFileStore((s) => s.directoryMissing);
  const activeProvider = useProviderStore((s) => {
    if (!s.activeProviderId) return null;
    return s.providers.find((p) => p.id === s.activeProviderId) ?? null;
  });
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const isFilePreviewMode = !!useFileStore((s) => s.selectedFile);

  // Agent activity for floating button badge
  const agents = useAgentStore((s) => s.agents);
  const activeAgentCount = useMemo(
    () => Array.from(agents.values()).filter(
      (a) => a.phase !== 'completed' && a.phase !== 'error'
    ).length,
    [agents],
  );
  const totalAgentCount = agents.size;

  const showPlanPanel = usePlanPanelStore((s) => s.open);
  const closePlanPanel = usePlanPanelStore((s) => s.close);


  // Listen for internal file tree drag-drop (mouse-based, not HTML5 drag-and-drop)
  // HTML5 drag events don't work in Tauri because dragDropEnabled: true intercepts them.
  // Listen for file-chip click → open file in secondary panel's file browser
  useEffect(() => {
    const onOpenFile = (e: Event) => {
      const filePath = (e as CustomEvent<string>).detail;
      if (!filePath) return;
      // Open secondary panel to files tab and select the file
      useSettingsStore.getState().setSecondaryTab('files');
      useFileStore.getState().selectFile(filePath);
    };
    window.addEventListener('tokenicode:open-file', onOpenFile);
    return () => window.removeEventListener('tokenicode:open-file', onOpenFile);
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
  const find = useFindInPage(scrollRef);
  const thinkingPreRef = useRef<HTMLPreElement>(null);
  const isNearBottomRef = useRef(true);
  // When user scrolls up via wheel, suppress auto-scroll until they return to bottom
  const userScrollingUpRef = useRef(false);
  // Show "scroll to bottom" button when user is far from bottom
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Track whether user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Consider "near bottom" if within 80px of the end
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isNearBottomRef.current = nearBottom;
    // Show scroll-to-bottom button when far from bottom (>300px)
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
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

  // Auto-scroll the internal thinking <pre> to bottom as new content streams in
  useEffect(() => {
    const el = thinkingPreRef.current;
    if (el && partialThinking) {
      el.scrollTop = el.scrollHeight;
    }
  }, [partialThinking]);

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
        {/* Left: model name + project hint */}
        <div className="flex items-center gap-3 pointer-events-none">
          {sessionMeta.model && (
            <span className="text-sm font-medium text-text-muted">
              {getModelDisplayName(sessionMeta.model)}
            </span>
          )}
          {workingDirectory && (
            <span className="text-[10px] text-text-tertiary truncate max-w-[160px]"
              title={workingDirectory}>
              {workingDirectory.split(/[\\/]/).pop()}
            </span>
          )}
        </div>

        {/* Integrated status: Agent + API route — left-aligned with color dots */}
        <div className="relative flex items-center gap-3 ml-3">
          {/* Agent status — clickable dot + label → opens AgentPanel */}
          <button onClick={toggleAgentPanel}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg
              transition-smooth text-[9px]
              ${agentPanelOpen ? 'bg-accent/10' : 'hover:bg-bg-secondary/50'}`}
            title={t('agents.toggle')}>
            <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 transition-smooth
              ${activeAgentCount > 0
                ? 'bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse-soft'
                : totalAgentCount > 0
                  ? 'bg-success'
                  : 'bg-text-tertiary/30'}`} />
            <span className={`${activeAgentCount > 0 ? 'text-amber-400' : totalAgentCount > 0 ? 'text-success' : 'text-text-tertiary'}`}>
              Agent{totalAgentCount > 1 ? ` (${totalAgentCount})` : ''}
            </span>
          </button>

          {/* API route status — dot + label */}
          <div className="flex items-center gap-1.5 text-[9px]">
            <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 transition-smooth
              ${sessionStatus === 'running'
                ? 'bg-success shadow-[0_0_6px_var(--color-accent-glow)] animate-pulse-soft'
                : sessionStatus === 'error'
                  ? 'bg-error'
                  : 'bg-text-tertiary/30'}`} />
            <span className="text-text-tertiary">
              {activeProvider ? (activeProvider.name || 'Custom') : 'CLI'}
            </span>
          </div>

          {/* Current session mode indicator */}
          <div className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded
            ${sessionMode === 'bypass'
              ? 'text-warning/80'
              : 'text-text-tertiary'}`}>
            <span>{t(`mode.${sessionMode}`)}</span>
          </div>

          {/* Floating agent panel popover — anchored to agent button */}
          {agentPanelOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={toggleAgentPanel} />
              <div className="absolute left-0 top-full mt-2 z-50
                w-72 max-h-80 rounded-xl border border-border-subtle
                bg-bg-primary shadow-lg overflow-y-auto">
                <AgentPanel />
              </div>
            </>
          )}
        </div>

        {/* Spacer + right-side actions */}
        <div className="ml-auto flex items-center" />
        <UpdateButton />
        <ExportMenu sessionPath={currentSessionPath} />
        <button onClick={toggleSecondaryPanel}
          className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-tertiary
            transition-smooth" title={t('chat.toggleFiles')}>
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
      {find.isOpen && <FindBar {...find} />}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="chat-messages"
        className="flex-1 overflow-y-auto px-5 py-6 selectable"
      >
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
            {/* Streaming thinking — auto-collapse as soon as assistant text becomes visible. */}
            {isStreaming && partialThinking && (() => {
              const hasVisiblePartialText = partialText.trim().length > 0;
              return (
              <div className="ml-11 mt-1">
                <details
                  key={hasVisiblePartialText ? 'collapsed' : 'open'}
                  {...(!hasVisiblePartialText ? { open: true } : {})}
                  className="group"
                >
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
                  <pre ref={thinkingPreRef} className="ml-5 mt-0.5 text-[11px] text-text-tertiary
                    whitespace-pre-wrap max-h-48 overflow-y-auto
                    font-mono leading-relaxed">
                    {partialThinking}
                  </pre>
                </details>
              </div>
              );
            })()}
            {isStreaming && partialText && (() => {
              // Hide streaming text while an unresolved question is pending —
              // the CLI may keep sending text_delta events for the next turn's
              // content, but the user needs to answer the question first.
              // Check both resolved flag AND interactionState to handle edge
              // cases where setInteractionState hasn't propagated yet.
              const hasPendingQuestion = messages.some(
                (m) => m.type === 'question' && !m.resolved
                  && m.interactionState !== 'resolved' && m.interactionState !== 'sending',
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
                </div>
              </div>
              );
            })()}
            {/* Pending user messages — queued while AI is streaming.
                Rendered AFTER partialText bubble so they visually queue up
                behind the streaming reply. Each one becomes a real user
                message bubble when the current turn completes and the
                FIFO drain in useStreamProcessor sends it. */}
            {pendingUserMessages && pendingUserMessages.length > 0 && pendingUserMessages.map((pending, idx) => (
              <div key={`pending_${idx}`} className="flex justify-end gap-3 mt-4">
                <div className="flex flex-col items-end max-w-[75%] opacity-60">
                  <div className="bg-bg-elevated border border-border-subtle text-text-primary
                    rounded-2xl rounded-br-md px-4 py-2.5 leading-relaxed whitespace-pre-wrap break-words">
                    {pending.text}
                  </div>
                  <span className="text-[10px] text-text-tertiary mt-1 mr-1 flex items-center gap-1">
                    <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 5v3l2 1.5" strokeLinecap="round" />
                    </svg>
                    {t('chat.queued')}
                  </span>
                </div>
                <UserAvatar size="w-8 h-8 text-xs" className="mt-0.5 flex-shrink-0" />
              </div>
            ))}
            {/* Inline activity status indicator — like Claude Desktop App */}
            {(sessionStatus === 'running' || sessionStatus === 'reconnecting' || sessionStatus === 'stopping' || activityStatus.phase === 'awaiting') && (
              <ActivityIndicator activityStatus={activityStatus} sessionMeta={sessionMeta} sessionStatus={sessionStatus} />
            )}
          </div>
        )}
      </div>

      {/* Scroll to bottom FAB */}
      {showScrollBtn && (
        <button
          onClick={() => {
            const el = scrollRef.current;
            if (el) {
              el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
              userScrollingUpRef.current = false;
            }
          }}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10
            w-8 h-8 rounded-full bg-bg-card border border-border-subtle
            shadow-md hover:shadow-lg flex items-center justify-center
            text-text-muted hover:text-text-primary transition-smooth
            cursor-pointer opacity-80 hover:opacity-100"
          title={t('chat.scrollToBottom')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 2v10M3 8l4 4 4-4" />
          </svg>
        </button>
      )}

      {/* Directory missing banner */}
      {workingDirectory && directoryMissing && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-xl bg-status-warning/10 border border-status-warning/30
          flex items-center gap-3 text-sm text-text-secondary">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="flex-shrink-0 text-status-warning">
            <path d="M8 1.5L1.5 13h13L8 1.5z" strokeLinejoin="round" />
            <path d="M8 6v3" strokeLinecap="round" />
            <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
          </svg>
          <span className="flex-1">{t('project.directoryMissing')}</span>
          <button
            onClick={async () => {
              const selected = await open({ directory: true, multiple: false, title: t('project.selectFolder') });
              if (selected) useSettingsStore.getState().setWorkingDirectory(selected as string);
            }}
            className="px-3 py-1 rounded-lg text-xs font-medium
              bg-status-warning/20 hover:bg-status-warning/30
              text-status-warning transition-smooth"
          >
            {t('project.reselect')}
          </button>
        </div>
      )}

      {/* Input — only show when a project folder is selected and exists */}
      {workingDirectory && !directoryMissing && <InputBar />}
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
  const currentTab = useSessionStore.getState().selectedSessionId;
  if (currentTab) useChatStore.getState().resetTab(currentTab);

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
    const settings = useSettingsStore.getState();
    const model = resolveModelForProvider(settings.selectedModel);
    const providerId = useProviderStore.getState().activeProviderId || '';
    const permissionMode = mapSessionModeToPermissionMode(settings.sessionMode);

    // Ensure tab exists before writing sessionMeta
    useChatStore.getState().ensureTab(draftId);
    useChatStore.getState().setSessionMeta(draftId, {
      stdinReady: false,
      pendingReadyMessage: undefined,
    });

    // Phase 2 §2.1: capture spawn-time fingerprint and config hash BEFORE
    // the async spawn so they reflect the config actually used, not whatever
    // the user might change while the spawn is in flight.
    const preEnvFingerprint = envFingerprint();
    const preSpawnConfigHash = spawnConfigHash();

    // Use lifecycle module for unified spawn
    const spawnResult = await spawnSession({
      tabId: draftId,
      stdinId: preWarmId,
      cwdSnapshot: folderPath,
      configSnapshot: {
        model,
        providerId,
        thinkingLevel: settings.thinkingLevel,
        permissionMode,
      },
      sessionModeSnapshot: settings.sessionMode,
      sessionParams: {
        prompt: '',  // empty = pre-warm, no message sent
        cwd: folderPath,
        model,
        session_id: preWarmId,
        thinking_level: settings.thinkingLevel,
        provider_id: providerId || undefined,
        permission_mode: permissionMode,
      },
      onStream: (msg: any) => {
        // Forward to InputBar's handler via a global
        const handler = (window as any).__claudeStreamHandler;
        if (handler) {
          const queue: any[] = (window as any).__claudeStreamQueue;
          if (queue && queue.length > 0) {
            const pending = queue.splice(0);
            for (const queued of pending) handler(queued);
          }
          handler(msg);
        } else {
          if (!(window as any).__claudeStreamQueue) (window as any).__claudeStreamQueue = [];
          (window as any).__claudeStreamQueue.push(msg);
        }
      },
      onStderr: (line: string) => {
        console.warn('[TOKENICODE] pre-warm stderr:', line);
      },
      setRunning: false,
    });

    // Write additional meta (uses pre-captured values to avoid race)
    useChatStore.getState().setSessionMeta(draftId, {
      sessionId: spawnResult.sessionInfo.cli_session_id ?? undefined,
      envFingerprint: preEnvFingerprint,
      spawnedModel: model,
      stdinReady: false,
      pendingReadyMessage: undefined,
      // Phase 2 §2.1: lock in the pre-warm spawn config hash so the first
      // real user submit can detect drift correctly.
      // Uses pre-computed value captured before async spawn to avoid
      // race with user config changes during the spawn window.
      spawnConfigHash: preSpawnConfigHash,
    });
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
      {/* App icon — customizable AI avatar */}
      <AiAvatar size="w-20 h-20" rounded="rounded-3xl" className="mb-6 shadow-glow" />
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
      {/* App icon — customizable AI avatar */}
      <AiAvatar size="w-16 h-16" rounded="rounded-2xl" className="mb-5 shadow-glow" />
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
