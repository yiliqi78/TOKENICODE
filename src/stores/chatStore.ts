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
  planItems?: string[];            // plan steps
  planContent?: string;            // markdown content for plan_review
  // AskUserQuestion fields
  questions?: UserQuestion[];      // question data from AskUserQuestion tool
  // TodoWrite fields
  todoItems?: TodoItem[];          // todo list items
  // File attachments (user-sent images/files)
  attachments?: MessageAttachment[];
  // Command feedback fields (for system messages from slash commands)
  commandType?: 'mode' | 'info' | 'help' | 'action' | 'error' | 'processing';
  commandData?: Record<string, any>;
  // Command processing card fields
  commandStartTime?: number;
  commandCompleted?: boolean;
  // Sub-agent nesting depth (0 = main agent, 1+ = inside Task sub-agent)
  subAgentDepth?: number;
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
  /** Accumulated input tokens from stream events (message_start) */
  inputTokens?: number;
  /** Accumulated output tokens from stream events (message_delta) */
  outputTokens?: number;
  /** Timestamp (Date.now()) when the current turn started — used for elapsed timer */
  turnStartTime?: number;
  /** JSON fingerprint of custom_env used when spawning the CLI process (TK-303).
   *  Compared before sending via stdin to detect stale pre-warm sessions. */
  envFingerprint?: string;
  /** Set when API provider config changed mid-session (TK-303).
   *  If resume fails due to thinking signature mismatch, auto-retry without resume. */
  providerSwitched?: boolean;
  /** The user message text to re-send if provider-switch auto-retry triggers. */
  providerSwitchPendingText?: string;
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export type ActivityPhase = 'idle' | 'thinking' | 'writing' | 'tool' | 'awaiting' | 'completed' | 'error';

export interface ActivityStatus {
  phase: ActivityPhase;
  toolName?: string;  // only when phase === 'tool'
}

// --- Per-session snapshot for multi-session support ---

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

// --- Store State & Actions ---

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  partialText: string;
  partialThinking: string;
  sessionStatus: SessionStatus;
  sessionMeta: SessionMeta;
  activityStatus: ActivityStatus;
  /** Draft input text for the current session (saved/restored on tab switch) */
  inputDraft: string;
  /** Pending file attachments for the current session (saved/restored on tab switch) */
  pendingAttachments: FileAttachment[];
  /** User messages queued while AI is actively processing (not yet sent to stdin) */
  pendingUserMessages: string[];

  /** Per-session snapshot cache: tabId → snapshot */
  sessionCache: Map<string, SessionSnapshot>;

  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  updatePartialMessage: (text: string) => void;
  updatePartialThinking: (text: string) => void;
  setSessionStatus: (status: SessionStatus) => void;
  setActivityStatus: (status: ActivityStatus) => void;
  clearMessages: () => void;
  setSessionMeta: (meta: Partial<SessionMeta>) => void;

  /** Save current state to cache under given tabId */
  saveToCache: (tabId: string) => void;
  /** Restore cached state for given tabId (returns true if found) */
  restoreFromCache: (tabId: string) => boolean;
  /** Remove a session from cache */
  removeFromCache: (tabId: string) => void;
  /** Check if a tabId has cached state */
  hasCachedSession: (tabId: string) => boolean;

  /** Set the input draft text for the current session */
  setInputDraft: (text: string) => void;
  /** Set pending attachments for the current session */
  setPendingAttachments: (files: FileAttachment[]) => void;

  /** Queue a user message to be sent after the current turn completes */
  addPendingMessage: (text: string) => void;
  /** Return and clear all pending user messages */
  flushPendingMessages: () => string[];
  /** Clear pending user messages without returning them */
  clearPendingMessages: () => void;

  /** Rewind conversation to a specific message index (truncates messages[]) */
  rewindToTurn: (startMsgIdx: number) => void;

  /** Add a message to a background session's cache (for stream events arriving while tab is not active) */
  addMessageToCache: (tabId: string, message: ChatMessage) => void;
  /** Update partial text in a background session's cache */
  updatePartialInCache: (tabId: string, text: string) => void;
  /** Update session status in a background session's cache */
  setStatusInCache: (tabId: string, status: SessionStatus) => void;
  /** Update session meta in a background session's cache */
  setMetaInCache: (tabId: string, meta: Partial<SessionMeta>) => void;
  /** Update activity status in a background session's cache */
  setActivityInCache: (tabId: string, status: ActivityStatus) => void;
  /** Update a message in a background session's cache */
  updateMessageInCache: (tabId: string, msgId: string, updates: Partial<ChatMessage>) => void;
}

// --- Helper ---

let messageCounter = 0;

export function generateMessageId(): string {
  messageCounter += 1;
  return `msg_${Date.now()}_${messageCounter}`;
}

// --- Store ---

export const useChatStore = create<ChatState>()((set, get) => ({
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
  sessionCache: new Map(),

  addMessage: (message) =>
    set((state) => {
      // De-duplicate: if a message with the same ID already exists, update it
      // instead of appending a duplicate. This happens when the CLI re-sends
      // a complete assistant message that was previously delivered partially.
      const existingIdx = state.messages.findIndex((m) => m.id === message.id);
      if (existingIdx !== -1) {
        const updated = [...state.messages];
        updated[existingIdx] = { ...updated[existingIdx], ...message };
        return {
          messages: updated,
          ...(message.isPartial ? {} : { partialText: '', isStreaming: false }),
        };
      }
      return {
        messages: [...state.messages, message],
        // When a non-partial message arrives, clear partial buffer
        ...(message.isPartial ? {} : { partialText: '', isStreaming: false }),
      };
    }),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    })),

  updatePartialMessage: (text) =>
    set((state) => ({
      partialText: state.partialText + text,
      isStreaming: true,
      activityStatus: { phase: 'writing' as ActivityPhase },
    })),

  updatePartialThinking: (text) =>
    set((state) => ({
      partialThinking: state.partialThinking + text,
      isStreaming: true,
      activityStatus: { phase: 'thinking' as ActivityPhase },
    })),

  setSessionStatus: (status) => {
    // Sync running state to sessionStore for tab indicators
    const tabId = useSessionStore.getState().selectedSessionId;
    if (tabId) {
      useSessionStore.getState().setSessionRunning(tabId, status === 'running');
    }
    set(() => ({
      sessionStatus: status,
      // Reset streaming state when session ends
      ...(status === 'completed' || status === 'error'
        ? { isStreaming: false, partialText: '', partialThinking: '' }
        : {}),
      // Sync activity status with session status
      ...(status === 'completed' ? { activityStatus: { phase: 'completed' as ActivityPhase } }
        : status === 'error' ? { activityStatus: { phase: 'error' as ActivityPhase } }
        : status === 'idle' ? { activityStatus: { phase: 'idle' as ActivityPhase } }
        : {}),
    }));
  },

  setActivityStatus: (activityStatus) =>
    set(() => ({ activityStatus })),

  clearMessages: () =>
    set(() => ({
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
    })),

  setSessionMeta: (meta) =>
    set((state) => ({
      sessionMeta: { ...state.sessionMeta, ...meta },
    })),

  setInputDraft: (text) => set({ inputDraft: text }),
  setPendingAttachments: (files) => set({ pendingAttachments: files }),

  addPendingMessage: (text) =>
    set((state) => ({ pendingUserMessages: [...state.pendingUserMessages, text] })),

  flushPendingMessages: () => {
    const msgs = get().pendingUserMessages;
    set({ pendingUserMessages: [] });
    return msgs;
  },

  clearPendingMessages: () => set({ pendingUserMessages: [] }),

  rewindToTurn: (startMsgIdx) =>
    set((state) => {
      // Guard against invalid index — if out of bounds, keep messages intact
      if (startMsgIdx < 0 || startMsgIdx > state.messages.length) {
        console.warn('[chatStore] rewindToTurn: invalid index', startMsgIdx, 'total:', state.messages.length);
        return {
          isStreaming: false,
          partialText: '',
          partialThinking: '',
          activityStatus: { phase: 'idle' as ActivityPhase },
        };
      }
      return {
        messages: state.messages.slice(0, startMsgIdx),
        isStreaming: false,
        partialText: '',
        partialThinking: '',
        // Keep sessionMeta (sessionId needed for resume), reset transient state
        activityStatus: { phase: 'idle' as ActivityPhase },
      };
    }),

  // --- Session cache operations ---

  saveToCache: (tabId) => {
    const { messages, isStreaming, partialText, partialThinking, sessionStatus, sessionMeta, activityStatus, inputDraft, pendingAttachments, pendingUserMessages, sessionCache } = get();
    const next = new Map(sessionCache);
    next.set(tabId, {
      messages: [...messages],
      isStreaming,
      partialText,
      partialThinking,
      sessionStatus,
      sessionMeta: { ...sessionMeta },
      activityStatus: { ...activityStatus },
      inputDraft,
      pendingAttachments: [...pendingAttachments],
      pendingUserMessages: [...pendingUserMessages],
    });
    set({ sessionCache: next });
  },

  restoreFromCache: (tabId) => {
    const snapshot = get().sessionCache.get(tabId);
    if (!snapshot) return false;
    set({
      messages: [...snapshot.messages],
      isStreaming: snapshot.isStreaming,
      partialText: snapshot.partialText,
      partialThinking: snapshot.partialThinking || '',
      sessionStatus: snapshot.sessionStatus,
      sessionMeta: { ...snapshot.sessionMeta },
      activityStatus: { ...snapshot.activityStatus },
      inputDraft: snapshot.inputDraft || '',
      pendingAttachments: snapshot.pendingAttachments ? [...snapshot.pendingAttachments] : [],
      pendingUserMessages: snapshot.pendingUserMessages ? [...snapshot.pendingUserMessages] : [],
    });
    return true;
  },

  removeFromCache: (tabId) => {
    const next = new Map(get().sessionCache);
    next.delete(tabId);
    set({ sessionCache: next });
  },

  hasCachedSession: (tabId) => get().sessionCache.has(tabId),

  // --- Background session cache mutations (for stream events arriving while not active tab) ---

  addMessageToCache: (tabId, message) => {
    const cache = get().sessionCache;
    const snapshot = cache.get(tabId);
    const next = new Map(cache);
    if (!snapshot) {
      // Initialize cache for sessions that were moved to background before first save
      next.set(tabId, {
        messages: [message],
        isStreaming: false,
        partialText: '',
        partialThinking: '',
        sessionStatus: 'running',
        sessionMeta: {},
        activityStatus: { phase: 'idle' as ActivityPhase },
        inputDraft: '',
        pendingAttachments: [],
        pendingUserMessages: [],
      });
      set({ sessionCache: next });
      return;
    }
    // De-duplicate: update existing message if ID matches
    const existingIdx = snapshot.messages.findIndex((m) => m.id === message.id);
    const messages = existingIdx !== -1
      ? snapshot.messages.map((m, i) => i === existingIdx ? { ...m, ...message } : m)
      : [...snapshot.messages, message];
    next.set(tabId, {
      ...snapshot,
      messages,
      ...(message.isPartial ? {} : { partialText: '', isStreaming: false }),
    });
    set({ sessionCache: next });
  },

  updatePartialInCache: (tabId, text) => {
    const cache = get().sessionCache;
    const snapshot = cache.get(tabId);
    if (!snapshot) {
      // Initialize cache with the partial text
      const next = new Map(cache);
      next.set(tabId, {
        messages: [],
        isStreaming: true,
        partialText: text,
        partialThinking: '',
        sessionStatus: 'running',
        sessionMeta: {},
        activityStatus: { phase: 'idle' as ActivityPhase },
        inputDraft: '',
        pendingAttachments: [],
        pendingUserMessages: [],
      });
      set({ sessionCache: next });
      return;
    }
    const next = new Map(cache);
    next.set(tabId, {
      ...snapshot,
      partialText: snapshot.partialText + text,
      isStreaming: true,
    });
    set({ sessionCache: next });
  },

  setStatusInCache: (tabId, status) => {
    const cache = get().sessionCache;
    const snapshot = cache.get(tabId);
    // Also sync running state indicator
    useSessionStore.getState().setSessionRunning(tabId, status === 'running');
    const next = new Map(cache);
    if (!snapshot) {
      next.set(tabId, {
        messages: [],
        isStreaming: false,
        partialText: '',
        partialThinking: '',
        sessionStatus: status,
        sessionMeta: {},
        activityStatus: { phase: (status === 'running' ? 'thinking' : status) as ActivityPhase },
        inputDraft: '',
        pendingAttachments: [],
        pendingUserMessages: [],
      });
      set({ sessionCache: next });
      return;
    }
    next.set(tabId, {
      ...snapshot,
      sessionStatus: status,
      ...(status === 'completed' || status === 'error'
        ? { isStreaming: false, partialText: '', partialThinking: '' }
        : {}),
      ...(status === 'completed' ? { activityStatus: { phase: 'completed' as ActivityPhase } }
        : status === 'error' ? { activityStatus: { phase: 'error' as ActivityPhase } }
        : status === 'idle' ? { activityStatus: { phase: 'idle' as ActivityPhase } }
        : {}),
    });
    set({ sessionCache: next });
  },

  setMetaInCache: (tabId, meta) => {
    const cache = get().sessionCache;
    const snapshot = cache.get(tabId);
    if (!snapshot) return;
    const next = new Map(cache);
    next.set(tabId, {
      ...snapshot,
      sessionMeta: { ...snapshot.sessionMeta, ...meta },
    });
    set({ sessionCache: next });
  },

  setActivityInCache: (tabId, status) => {
    const cache = get().sessionCache;
    const snapshot = cache.get(tabId);
    if (!snapshot) return;
    const next = new Map(cache);
    next.set(tabId, { ...snapshot, activityStatus: status });
    set({ sessionCache: next });
  },

  updateMessageInCache: (tabId, msgId, updates) => {
    const cache = get().sessionCache;
    const snapshot = cache.get(tabId);
    if (!snapshot) return;
    const next = new Map(cache);
    next.set(tabId, {
      ...snapshot,
      messages: snapshot.messages.map((m) =>
        m.id === msgId ? { ...m, ...updates } : m,
      ),
    });
    set({ sessionCache: next });
  },
}));
