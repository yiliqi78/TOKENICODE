import { create } from 'zustand';
import { useSessionStore } from './sessionStore';
import type { FileAttachment } from '../hooks/useFileAttachments';

// --- Types ---

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface MessageAttachment {
  name: string;
  path: string;
  isImage: boolean;
  preview?: string;  // base64 data URL (thumbnail)
}

export type InteractionState = 'pending' | 'sending' | 'resolved' | 'failed' | 'expired';

export interface PermissionRequestData {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  description?: string;
  toolUseId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'tool_use' | 'thinking' | 'tool_result' | 'permission' | 'plan' | 'plan_review' | 'question' | 'todo';
  content: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: string;
  toolResultContent?: string;      // tool result content merged from tool_result stream events
  isPartial?: boolean;
  timestamp: number;
  // Interactive message fields
  permissionTool?: string;         // tool requesting permission
  permissionDescription?: string;  // what the tool wants to do
  resolved?: boolean;              // whether the user responded
  // SDK control protocol permission data (Phase 2)
  interactionState?: InteractionState;
  interactionError?: string;
  permissionData?: PermissionRequestData;
  planItems?: string[];            // plan steps
  planContent?: string;            // markdown content for plan_review
  // AskUserQuestion fields
  questions?: UserQuestion[];      // question data from AskUserQuestion tool
  // TodoWrite fields
  todoItems?: TodoItem[];          // todo list items
  // File attachments (user-sent images/files)
  attachments?: MessageAttachment[];
  // Command feedback fields (for system messages from slash commands)
  commandType?: 'mode' | 'model-switch' | 'info' | 'help' | 'action' | 'error' | 'processing';
  commandData?: Record<string, any>;
  // Command processing card fields
  commandStartTime?: number;
  commandCompleted?: boolean;
  // Sub-agent nesting depth (0 = main agent, 1+ = inside Task sub-agent)
  subAgentDepth?: number;
  // CLI checkpoint UUID for file restoration (from --replay-user-messages)
  checkpointUuid?: string;
}

export interface SessionMeta {
  model?: string;
  cost?: number;
  duration?: number;
  turns?: number;
  sessionId?: string;
  /** The desk-generated ID used as key in Rust StdinManager for sending follow-up messages */
  stdinId?: string;
  /** Message ID of a pending processing card (for CLI slash commands) */
  pendingCommandMsgId?: string;
  /** Accumulated input tokens from stream events (message_start) — per turn, reset each turn */
  inputTokens?: number;
  /** Accumulated output tokens from stream events (message_delta) — per turn, reset each turn */
  outputTokens?: number;
  /** Cumulative input tokens across ALL turns in this session/task */
  totalInputTokens?: number;
  /** Cumulative output tokens across ALL turns in this session/task */
  totalOutputTokens?: number;
  /** Timestamp (Date.now()) when the current turn started — used for elapsed timer */
  turnStartTime?: number;
  /** Timestamp of last stream activity — used for stall detection instead of total elapsed */
  lastProgressAt?: number;
  /** JSON fingerprint of the active provider config used when spawning the CLI process.
   *  Compared before sending via stdin to detect stale pre-warm sessions. */
  envFingerprint?: string;
  /** Snapshot of sessionMode at session spawn — per-session isolation (Phase 4) */
  snapshotMode?: import('./settingsStore').SessionMode;
  /** Snapshot of selectedModel at session spawn — per-session isolation (Phase 4) */
  snapshotModel?: string;
  /** Snapshot of thinkingLevel at session spawn — per-session isolation (Phase 4) */
  snapshotThinking?: import('./settingsStore').ThinkingLevel;
  /** The resolved model name used when spawning the CLI process.
   *  Compared before sending via stdin to detect mid-session model switches. */
  spawnedModel?: string;
  /** Set when API provider config changed mid-session (TK-303).
   *  If resume fails due to thinking signature mismatch, auto-retry without resume. */
  providerSwitched?: boolean;
  /** The user message text to re-send if provider-switch auto-retry triggers. */
  providerSwitchPendingText?: string;
  /** Set when model changed mid-session.
   *  If resume fails due to thinking signature mismatch, auto-retry without resume. */
  modelSwitched?: boolean;
  /** The user message text to re-send if model-switch auto-retry triggers. */
  modelSwitchPendingText?: string;
  /** Rate limit info from CLI rate_limit_event (latest per rateLimitType) */
  rateLimits?: Record<string, {
    rateLimitType: string;
    resetsAt: number;
    isUsingOverage?: boolean;
    overageStatus?: string;
    overageDisabledReason?: string;
  }>;
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export type ActivityPhase = 'idle' | 'thinking' | 'writing' | 'tool' | 'awaiting' | 'completed' | 'error';

export interface ActivityStatus {
  phase: ActivityPhase;
  toolName?: string;  // only when phase === 'tool'
}

// --- Per-session snapshot (backward compat type — kept for external consumers) ---

export interface SessionSnapshot {
  messages: ChatMessage[];
  isStreaming: boolean;
  partialText: string;
  partialThinking: string;
  sessionStatus: SessionStatus;
  sessionMeta: SessionMeta;
  activityStatus: ActivityStatus;
  inputDraft: string;
  pendingAttachments: FileAttachment[];
  /** User messages queued while AI is actively processing (not yet sent to stdin) */
  pendingUserMessages: string[];
}

// --- Tab session: the ONLY place session data lives ---

export interface TabSession {
  tabId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  partialText: string;
  partialThinking: string;
  sessionStatus: SessionStatus;
  sessionMeta: SessionMeta;
  activityStatus: ActivityStatus;
  inputDraft: string;
  pendingAttachments: FileAttachment[];
  pendingUserMessages: string[];
}

// --- Store State & Actions ---

interface ChatState {
  /** All tab data — the ONLY place session data lives */
  tabs: Map<string, TabSession>;

  // --- Tab-level operations (all take tabId) ---
  addMessage: (tabId: string, message: ChatMessage) => void;
  updateMessage: (tabId: string, id: string, updates: Partial<ChatMessage>) => void;
  updatePartialMessage: (tabId: string, text: string) => void;
  updatePartialThinking: (tabId: string, text: string) => void;
  setSessionStatus: (tabId: string, status: SessionStatus) => void;
  setActivityStatus: (tabId: string, status: ActivityStatus) => void;
  /** Clear messages and UI state but PRESERVE sessionMeta (for session reload) */
  clearMessages: (tabId: string) => void;
  /** Full reset: clear everything including sessionMeta (for new session / /clear) */
  resetTab: (tabId: string) => void;
  setSessionMeta: (tabId: string, meta: Partial<SessionMeta>) => void;
  setInputDraft: (tabId: string, text: string) => void;
  setPendingAttachments: (tabId: string, files: FileAttachment[]) => void;
  addPendingMessage: (tabId: string, text: string) => void;
  flushPendingMessages: (tabId: string) => string[];
  clearPendingMessages: (tabId: string) => void;
  rewindToTurn: (tabId: string, startMsgIdx: number) => void;
  setInteractionState: (tabId: string, msgId: string, state: InteractionState, error?: string) => void;
  getActiveInteraction: (tabId: string) => ChatMessage | undefined;

  // --- Tab lifecycle ---
  ensureTab: (tabId: string) => void;
  removeTab: (tabId: string) => void;
  getTab: (tabId: string) => TabSession | undefined;

  // --- Backward compat: sessionCache alias + *InCache methods ---
  /** @deprecated Alias for tabs. Kept for gradual migration. */
  sessionCache: Map<string, SessionSnapshot>;
  /** @deprecated Data already lives in tabs. Kept for call sites that save before switching. */
  saveToCache: (tabId: string) => void;
  /** @deprecated Just checks tab existence. Kept for backward compat. */
  restoreFromCache: (tabId: string) => boolean;
  removeFromCache: (tabId: string) => void;
  hasCachedSession: (tabId: string) => boolean;
  /** @deprecated Use addMessage(tabId, message) directly. */
  addMessageToCache: (tabId: string, message: ChatMessage) => void;
  /** @deprecated Use updatePartialMessage(tabId, text) directly. */
  updatePartialInCache: (tabId: string, text: string) => void;
  /** @deprecated Use updatePartialThinking(tabId, thinking) directly. */
  updatePartialThinkingInCache: (tabId: string, thinking: string) => void;
  /** @deprecated Use setSessionStatus(tabId, status) directly. */
  setStatusInCache: (tabId: string, status: SessionStatus) => void;
  /** @deprecated Use setSessionMeta(tabId, meta) directly. */
  setMetaInCache: (tabId: string, meta: Partial<SessionMeta>) => void;
  /** @deprecated Use setActivityStatus(tabId, status) directly. */
  setActivityInCache: (tabId: string, status: ActivityStatus) => void;
  /** @deprecated Use updateMessage(tabId, msgId, updates) directly. */
  updateMessageInCache: (tabId: string, msgId: string, updates: Partial<ChatMessage>) => void;
}

// --- Helpers ---

let messageCounter = 0;

export function generateMessageId(): string {
  messageCounter += 1;
  return `msg_${Date.now()}_${messageCounter}`;
}

/** Default empty tab for when no tab is selected */
const EMPTY_TAB: TabSession = {
  tabId: '',
  messages: [],
  isStreaming: false,
  partialText: '',
  partialThinking: '',
  sessionStatus: 'idle',
  sessionMeta: {},
  activityStatus: { phase: 'idle' },
  inputDraft: '',
  pendingAttachments: [],
  pendingUserMessages: [],
};

function createTab(tabId: string): TabSession {
  return { ...EMPTY_TAB, tabId };
}

/** Maximum number of tabs kept in memory. LRU eviction applies to idle tabs. */
const MAX_CACHE = 8;

/**
 * Immutable Map update helper: get tab, apply updater, return new Map.
 * Returns undefined if tab doesn't exist (caller should return {} to skip).
 */
function updateTab(
  tabs: Map<string, TabSession>,
  tabId: string,
  updater: (tab: TabSession) => TabSession,
): { tabs: Map<string, TabSession>; sessionCache: Map<string, TabSession> } | undefined {
  const tab = tabs.get(tabId);
  if (!tab) return undefined;
  const newTabs = new Map(tabs);
  newTabs.set(tabId, updater(tab));
  return { tabs: newTabs, sessionCache: newTabs };
}

// --- Selector helpers ---

/**
 * React hook: select a field from the active tab.
 * Usage: `useActiveTab(t => t.messages)`
 */
export function useActiveTab<T>(selector: (tab: TabSession) => T): T {
  return useChatStore((state) => {
    const tabId = useSessionStore.getState().selectedSessionId;
    const tab = tabId ? state.tabs.get(tabId) : undefined;
    return selector(tab ?? EMPTY_TAB);
  });
}

/**
 * Imperative: get active tab data (for non-React contexts).
 */
export function getActiveTabState(): TabSession {
  const tabId = useSessionStore.getState().selectedSessionId;
  const tab = tabId ? useChatStore.getState().tabs.get(tabId) : undefined;
  return tab ?? EMPTY_TAB;
}

// --- Store ---

export const useChatStore = create<ChatState>()((set, get) => ({
  tabs: new Map(),
  sessionCache: new Map(),   // alias — always kept in sync with tabs

  // ------------------------------------------------------------------
  // Tab-level operations
  // ------------------------------------------------------------------

  addMessage: (tabId, message) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => {
        // De-duplicate: if a message with the same ID already exists, update it
        // instead of appending a duplicate. This happens when the CLI re-sends
        // a complete assistant message that was previously delivered partially.
        const existingIdx = tab.messages.findIndex((m) => m.id === message.id);
        const messages = existingIdx !== -1
          ? tab.messages.map((m, i) => i === existingIdx ? { ...m, ...message } : m)
          : [...tab.messages, message];
        return { ...tab, messages };
        // NOTE: partialText/isStreaming are NOT cleared here. Clearing is handled
        // explicitly by clearPartial() in the result/process_exit handlers and
        // in the assistant message handler when a text block supersedes streaming.
      });
      return result ?? {};
    }),

  updateMessage: (tabId, id, updates) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        messages: tab.messages.map((m) =>
          m.id === id ? { ...m, ...updates } : m,
        ),
      }));
      return result ?? {};
    }),

  updatePartialMessage: (tabId, text) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        partialText: tab.partialText + text,
        isStreaming: true,
        activityStatus: { phase: 'writing' as ActivityPhase },
      }));
      return result ?? {};
    }),

  updatePartialThinking: (tabId, text) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        partialThinking: tab.partialThinking + text,
        isStreaming: true,
        activityStatus: { phase: 'thinking' as ActivityPhase },
      }));
      return result ?? {};
    }),

  setSessionStatus: (tabId, status) => {
    // Sync running state to sessionStore for tab indicators
    useSessionStore.getState().setSessionRunning(tabId, status === 'running');
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        sessionStatus: status,
        // Reset streaming state when session ends
        ...(status === 'completed' || status === 'error' || status === 'idle'
          ? { isStreaming: false, partialText: '', partialThinking: '' }
          : {}),
        // Sync activity status with session status
        ...(status === 'completed' ? { activityStatus: { phase: 'completed' as ActivityPhase } }
          : status === 'error' ? { activityStatus: { phase: 'error' as ActivityPhase } }
          : status === 'idle' ? { activityStatus: { phase: 'idle' as ActivityPhase } }
          : {}),
      }));
      return result ?? {};
    });
  },

  setActivityStatus: (tabId, status) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        activityStatus: status,
      }));
      return result ?? {};
    }),

  clearMessages: (tabId) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        messages: [],
        isStreaming: false,
        partialText: '',
        partialThinking: '',
        sessionStatus: 'idle',
        // Preserve sessionMeta (especially sessionId for resume)
        activityStatus: { phase: 'idle' },
        inputDraft: '',
        pendingAttachments: [],
        pendingUserMessages: [],
      }));
      return result ?? {};
    }),

  resetTab: (tabId) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, () => createTab(tabId));
      return result ?? {};
    }),

  setSessionMeta: (tabId, meta) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        sessionMeta: { ...tab.sessionMeta, ...meta },
      }));
      return result ?? {};
    }),

  setInputDraft: (tabId, text) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        inputDraft: text,
      }));
      return result ?? {};
    }),

  setPendingAttachments: (tabId, files) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        pendingAttachments: files,
      }));
      return result ?? {};
    }),

  addPendingMessage: (tabId, text) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        pendingUserMessages: [...tab.pendingUserMessages, text],
      }));
      return result ?? {};
    }),

  flushPendingMessages: (tabId) => {
    const tab = get().tabs.get(tabId);
    if (!tab) return [];
    const msgs = tab.pendingUserMessages;
    set((state) => {
      const r = updateTab(state.tabs, tabId, (t) => ({
        ...t,
        pendingUserMessages: [],
      }));
      return r ?? {};
    });
    return msgs;
  },

  clearPendingMessages: (tabId) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        pendingUserMessages: [],
      }));
      return result ?? {};
    }),

  rewindToTurn: (tabId, startMsgIdx) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => {
        // Guard against invalid index — if out of bounds, keep messages intact
        if (startMsgIdx < 0 || startMsgIdx > tab.messages.length) {
          console.warn('[chatStore] rewindToTurn: invalid index', startMsgIdx, 'total:', tab.messages.length);
          return {
            ...tab,
            isStreaming: false,
            partialText: '',
            partialThinking: '',
            activityStatus: { phase: 'idle' as ActivityPhase },
          };
        }
        return {
          ...tab,
          messages: tab.messages.slice(0, startMsgIdx),
          isStreaming: false,
          partialText: '',
          partialThinking: '',
          // Keep sessionMeta (sessionId needed for resume), reset transient state
          activityStatus: { phase: 'idle' as ActivityPhase },
        };
      });
      return result ?? {};
    }),

  setInteractionState: (tabId, msgId, interactionState, error) =>
    set((state) => {
      const result = updateTab(state.tabs, tabId, (tab) => ({
        ...tab,
        messages: tab.messages.map((m) =>
          m.id === msgId ? {
            ...m,
            interactionState,
            interactionError: error,
            resolved: interactionState === 'resolved',
          } : m,
        ),
      }));
      return result ?? {};
    }),

  getActiveInteraction: (tabId) => {
    const tab = get().tabs.get(tabId);
    if (!tab) return undefined;
    // Return the last message with an active (pending) interaction
    for (let i = tab.messages.length - 1; i >= 0; i--) {
      const m = tab.messages[i];
      if ((m.type === 'permission' || m.type === 'question') && m.interactionState === 'pending') {
        return m;
      }
    }
    return undefined;
  },

  // ------------------------------------------------------------------
  // Tab lifecycle
  // ------------------------------------------------------------------

  ensureTab: (tabId) => {
    if (get().tabs.has(tabId)) return;
    const newTabs = new Map(get().tabs);
    newTabs.set(tabId, createTab(tabId));
    // LRU eviction — keep at most MAX_CACHE tabs
    // Never evict tabs that are actively streaming — their disk JSONL may have
    // been compacted, so the tab is the only source of full history (#32 fix)
    if (newTabs.size > MAX_CACHE) {
      const keysIter = newTabs.keys();
      while (newTabs.size > MAX_CACHE) {
        const oldest = keysIter.next().value;
        if (oldest === undefined) break;
        if (oldest === tabId) continue; // don't evict the tab we're creating
        const entry = newTabs.get(oldest);
        if (entry?.isStreaming || entry?.sessionStatus === 'running') continue; // protect active
        newTabs.delete(oldest);
      }
      // If all candidates are streaming, allow cache to exceed MAX_CACHE
    }
    set({ tabs: newTabs, sessionCache: newTabs });
  },

  removeTab: (tabId) => {
    const newTabs = new Map(get().tabs);
    newTabs.delete(tabId);
    set({ tabs: newTabs, sessionCache: newTabs });
  },

  getTab: (tabId) => get().tabs.get(tabId),

  // ------------------------------------------------------------------
  // Backward compat: sessionCache + *InCache methods
  // ------------------------------------------------------------------

  saveToCache: (tabId) => {
    // In v2, data already lives in tabs. This is effectively a no-op.
    // However, we still ensure the tab exists (some call sites save before switching
    // and may not have called ensureTab yet).
    get().ensureTab(tabId);
  },

  restoreFromCache: (tabId) => {
    const tab = get().tabs.get(tabId);
    if (!tab) return false;
    // #27/#30 safety net: if tab has zero messages but this is a persisted session
    // (has a disk path), treat as cache miss so the caller falls back to disk load.
    if (tab.messages.length === 0 && !tab.isStreaming && !tab.partialText) {
      const session = useSessionStore.getState().sessions.find((s) => s.id === tabId);
      if (session?.path) {
        const newTabs = new Map(get().tabs);
        newTabs.delete(tabId);
        set({ tabs: newTabs, sessionCache: newTabs });
        return false;
      }
    }
    // TK-329: Validate stdinId ownership — prevent cross-tab contamination
    if (tab.sessionMeta.stdinId) {
      const ownerTab = useSessionStore.getState().getTabForStdin(tab.sessionMeta.stdinId);
      if (ownerTab && ownerTab !== tabId) {
        // Fix: strip stdinId that belongs to another tab
        set((state) => {
          const result = updateTab(state.tabs, tabId, (t) => ({
            ...t,
            sessionMeta: { ...t.sessionMeta, stdinId: undefined },
          }));
          return result ?? {};
        });
      }
    }
    // Sync running state to sessionStore for sidebar indicator (FI-1 fix)
    useSessionStore.getState().setSessionRunning(tabId, tab.sessionStatus === 'running');
    return true;
  },

  removeFromCache: (tabId) => {
    get().removeTab(tabId);
  },

  hasCachedSession: (tabId) => get().tabs.has(tabId),

  // *InCache methods — delegate directly to tab-level methods

  addMessageToCache: (tabId, message) => {
    // #27/#30 fix: skip if no tab entry — creating a tab with only this single
    // message risks losing real history if the entry was LRU-evicted.
    if (!get().tabs.has(tabId)) return;
    get().addMessage(tabId, message);
  },

  updatePartialInCache: (tabId, text) => {
    if (!get().tabs.has(tabId)) return;
    get().updatePartialMessage(tabId, text);
  },

  updatePartialThinkingInCache: (tabId, thinking) => {
    if (!get().tabs.has(tabId)) return;
    get().updatePartialThinking(tabId, thinking);
  },

  setStatusInCache: (tabId, status) => {
    // Always sync running state indicator, even without a tab
    useSessionStore.getState().setSessionRunning(tabId, status === 'running');
    if (!get().tabs.has(tabId)) return;
    get().setSessionStatus(tabId, status);
  },

  setMetaInCache: (tabId, meta) => {
    if (!get().tabs.has(tabId)) return;
    get().setSessionMeta(tabId, meta);
  },

  setActivityInCache: (tabId, status) => {
    if (!get().tabs.has(tabId)) return;
    get().setActivityStatus(tabId, status);
  },

  updateMessageInCache: (tabId, msgId, updates) => {
    if (!get().tabs.has(tabId)) return;
    get().updateMessage(tabId, msgId, updates);
  },
}));
