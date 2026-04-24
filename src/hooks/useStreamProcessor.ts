import { useCallback, useRef, type MutableRefObject } from 'react';
import { useChatStore, generateMessageId, type ChatMessage } from '../stores/chatStore';
import { useSettingsStore, mapSessionModeToPermissionMode, getEffectiveMode, getEffectiveThinking } from '../stores/settingsStore';
import { useSessionStore, setOrphanDrainCallback } from '../stores/sessionStore';
import { useAgentStore, resolveAgentId, getAgentDepth } from '../stores/agentStore';
import { useCommandStore } from '../stores/commandStore';
import { useFileStore } from '../stores/fileStore';
import { bridge } from '../lib/tauri-bridge';
import { envFingerprint, resolveModelForProvider, spawnConfigHash, getAutoCompactThreshold } from '../lib/api-provider';
import { buildApiRetryStatus } from '../lib/api-retry';
import { useProviderStore } from '../stores/providerStore';
import { t } from '../lib/i18n';
import {
  clearPreservedThinkingSnapshot,
  filterThinkingDeltaAfterPreservedSnapshot,
  rememberPreservedThinkingSnapshot,
} from '../stream/thinkingDedupe';
import {
  checkOwnership,
  handleProcessExitFinalize,
  cleanupStdinRoute,
  spawnSession,
  teardownSession,
  waitForStdinCleared,
  hasAutoCompactFired,
  markAutoCompactFired,
  getRecentlyFinalizedStdin,
} from '../lib/sessionLifecycle';

// --- Error classification for user-facing messages ---
// Each pattern maps to a friendly i18n key. Matched errors show the friendly
// message as primary text with raw error in a collapsible details block.
// Unmatched errors get a generic fallback + raw details.
const ERROR_CATEGORIES: ReadonlyArray<{ pattern: RegExp; i18nKey: string }> = [
  { pattern: /40[13]|unauthorized|invalid.*key|api.key.*invalid/i, i18nKey: 'error.invalidKey' },
  { pattern: /429|rate.limit|too.many.request/i, i18nKey: 'error.rateLimit' },
  { pattern: /quota|insufficient.*balance|credit|billing/i, i18nKey: 'error.quotaExceeded' },
  { pattern: /model.*not.found|invalid.*model|not_found.*model/i, i18nKey: 'error.modelNotFound' },
  { pattern: /timeout|timed?.out|ECONNREFUSED|ECONNRESET|ENOTFOUND/i, i18nKey: 'error.networkError' },
  { pattern: /network|fetch.failed|dns/i, i18nKey: 'error.networkError' },
  { pattern: /permission.denied|operation.not.permitted|access.denied|forbidden/i, i18nKey: 'error.permissionDenied' },
  { pattern: /overloaded|capacity|503|service.unavailable/i, i18nKey: 'error.serviceUnavailable' },
  { pattern: /not.installed|command.not.found/i, i18nKey: 'error.cliNotInstalled' },
  { pattern: /token.*limit|context.*length|too.long/i, i18nKey: 'error.tokenLimit' },
];

export function formatErrorForUser(raw: string): string {
  if (!raw || raw.length < 10) return raw;
  const match = ERROR_CATEGORIES.find((c) => c.pattern.test(raw));
  const friendly = match ? t(match.i18nKey) : t('error.genericFallback');
  return `${friendly}\n\n<details>\n<summary>${t('error.showDetails')}</summary>\n\n\`\`\`\n${raw}\n\`\`\`\n\n</details>`;
}

/** S18 (v3 §4.3): allowlist of CLI-internal placeholder result strings that
 *  must not leak into the user-visible conversation. The CLI emits these as
 *  default values for certain non-success result frames (e.g. when the model
 *  is told to reply with `No response requested.` after a tool-only turn).
 *  They are meaningful to the CLI's internal state machine but pure noise
 *  for the end user. */
const CLI_INTERNAL_PLACEHOLDERS: readonly string[] = [
  'No response requested.',
  'No response requested',
  '(no content)',
  'No content',
];

function isCliPlaceholder(text: string | undefined | null): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return CLI_INTERNAL_PLACEHOLDERS.some((p) => trimmed === p);
}

// --- Streaming text buffer ---
// Ownership of the rAF buffer, orphan queue, and completion guard lives in
// StreamController (src/stream/StreamController.ts). This module is now a
// thin call-site for the singleton. See roadmap §4.3.1.
import { streamController, DEFAULT_CONFIG as _STREAM_CONFIG } from '../stream/instance';

/** Drain any orphan buffer for the given stdinId into its newly known tab.
 *  Called by sessionStore.registerStdinTab via the registered callback. */
export function drainOrphanBuffer(stdinId: string, tabId: string) {
  streamController.drainOrphan(stdinId, tabId, (msg: unknown) => {
    const globalWindow = window as any;
    const handler = globalWindow.__claudeStreamHandler;
    if (typeof handler === 'function') {
      handler(msg);
      return;
    }
    if (!Array.isArray(globalWindow.__claudeStreamQueue)) {
      globalWindow.__claudeStreamQueue = [];
    }
    globalWindow.__claudeStreamQueue.push(msg);
  });
}

/** Test-only seam for orphan-queue regression coverage. Not part of the
 *  runtime API surface — do not import from production code. */
export const __orphanTesting = {
  stash: (stdinId: string, text: string, thinking: string) =>
    streamController.stashOrphan(stdinId, text, thinking),
  stashEvent: (stdinId: string, event: unknown) =>
    streamController.stashOrphanEvent(stdinId, event),
  expire: () => streamController.expireOrphans(),
  size: (): number => streamController.__testing.orphansSize(),
  has: (stdinId: string): boolean => streamController.__testing.hasOrphan(stdinId),
  get: (stdinId: string) => streamController.__testing.getOrphan(stdinId),
  clear: () => streamController.__testing.clear(),
  totalChars: (): number => streamController.__testing.orphanTotalChars(),
  TTL_MS: _STREAM_CONFIG.ttlMs,
  PER_STDIN_CAP: _STREAM_CONFIG.perStdinCapChars,
  TOTAL_CAP: _STREAM_CONFIG.totalCapChars,
};

// Register the drain callback so sessionStore.registerStdinTab can flush
// orphaned buffers without creating a circular import dependency.
setOrphanDrainCallback(drainOrphanBuffer);

// --- Shared pendingCommand completion helper (#27) ---
// Both foreground and background handlers must clear pendingCommandMsgId when
// a result or assistant event arrives. Without this, slash commands like /compact
// that complete on a background tab leave the spinner stuck forever.
interface CompletePendingCommandOpts {
  output?: string;
  costSummary?: { cost: string; duration: string; turns: string | number; input: string; output: string; };
}

export function completePendingCommand(tabId: string, opts: CompletePendingCommandOpts = {}) {
  const store = useChatStore.getState();
  const tab = store.getTab(tabId);
  const pendingCmdMsgId = tab?.sessionMeta.pendingCommandMsgId;
  if (!pendingCmdMsgId) return;
  const cmdMsg = (tab?.messages ?? []).find((m) => m.id === pendingCmdMsgId);
  store.updateMessage(tabId, pendingCmdMsgId, {
    commandCompleted: true,
    commandData: {
      ...cmdMsg?.commandData,
      ...(opts.output !== undefined ? { output: opts.output } : {}),
      ...(opts.costSummary ? { costSummary: opts.costSummary } : {}),
      completedAt: Date.now(),
    },
  });
  store.setSessionMeta(tabId, { pendingCommandMsgId: undefined });
}

function markStdinReady(tabId: string, stdinId: string | undefined, model: string | undefined) {
  const store = useChatStore.getState();
  const tab = store.getTab(tabId);
  const meta = tab?.sessionMeta ?? {};
  const pendingReady = meta.pendingReadyMessage;
  const shouldStartTurn = tab?.sessionStatus === 'running' && !meta.turnStartTime;
  const startedAt = shouldStartTurn ? Date.now() : undefined;

  store.setSessionMeta(tabId, {
    ...(model !== undefined ? { model } : {}),
    stdinReady: true,
    ...(shouldStartTurn ? {
      turnStartTime: startedAt,
      lastProgressAt: startedAt,
      inputTokens: 0,
      outputTokens: 0,
    } : {}),
    ...(pendingReady?.stdinId === stdinId ? { pendingReadyMessage: undefined } : {}),
  });

  if (shouldStartTurn) {
    store.setActivityStatus(tabId, {
      phase: shouldRenderThinkingForTab(tabId) ? 'thinking' : 'writing',
    });
  }

  if (stdinId && pendingReady?.stdinId === stdinId) {
    bridge.sendStdin(stdinId, pendingReady.text).catch((err) => {
      console.error('[TOKENICODE] Failed to flush ready-gated message:', err);
      cleanupStdinRoute(stdinId);
      store.setSessionMeta(tabId, {
        stdinId: undefined,
        stdinReady: false,
        pendingReadyMessage: undefined,
        pendingTurnMessageId: undefined,
        pendingTurnInput: undefined,
        pendingTurnAttachments: undefined,
        turnStartTime: undefined,
        lastProgressAt: undefined,
        apiRetry: undefined,
      });
      store.setSessionStatus(tabId, 'error');
      store.addMessage(tabId, {
        id: generateMessageId(),
        role: 'system',
        type: 'text',
        content: '预热会话就绪后发送首条消息失败，请重发一次。',
        timestamp: Date.now(),
      });
    });
  }
}

/** Flush any buffered streaming text immediately (call before clearPartial).
 *  If stdinId is provided, flush only that session's buffer.
 *  If omitted, flush ALL buffers (backward compat). */
export function flushStreamBuffer(stdinId?: string) {
  streamController.flush(stdinId);
}

function buildThinkingSnapshot(msgUuid: string | undefined, content: any[]) {
  const thinkingBlocks = content.filter(
    (b: any) => b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.length > 0,
  );
  if (thinkingBlocks.length === 0) return null;
  return {
    id: msgUuid ? `${msgUuid}_thinking` : generateMessageId(),
    content: thinkingBlocks.map((b: any) => b.thinking).join(''),
  };
}

function appendDedupedThinking(base: string, next: string) {
  if (!base) return next;
  if (!next) return base;

  const trimmedNext = next.trim();
  const trimmedBase = base.trim();
  if (!trimmedNext) return base;
  if (!trimmedBase) return next;
  if (base.includes(trimmedNext)) return base;
  if (next.includes(trimmedBase)) return next;

  const maxOverlap = Math.min(base.length, next.length);
  for (let len = maxOverlap; len > 0; len--) {
    if (base.endsWith(next.slice(0, len))) {
      return base + next.slice(len);
    }
  }
  return base + next;
}

function mergeThinkingContent(...parts: Array<string | undefined>) {
  const merged = parts.reduce<string>((acc, part) => {
    if (!part || part.trim().length === 0) return acc;
    return appendDedupedThinking(acc, part);
  }, '');
  return merged.trim();
}

function buildCommittedThinkingId(msgUuid: string | undefined) {
  return msgUuid ? `${msgUuid}__thinking_committed` : undefined;
}

function resolveThinkingPersistence(
  msgUuid: string | undefined,
  content: any[],
  partialThinking: string | undefined,
  bufferedThinking?: string,
) {
  const snapshot = buildThinkingSnapshot(msgUuid, content);
  const mergedContent = mergeThinkingContent(
    snapshot?.content,
    partialThinking,
    bufferedThinking,
  );
  if (!mergedContent) return null;
  return {
    id: snapshot?.id ?? (msgUuid ? `${msgUuid}_thinking` : generateMessageId()),
    content: mergedContent,
  };
}

function shouldMaterializeThinkingSnapshot(content: any[], hasTextBlock: boolean) {
  if (hasTextBlock) return true;
  return content.some(
    (b: any) =>
      b.type === 'tool_use'
      || b.type === 'tool_result'
      || b.type === 'todo',
  );
}

function isPureThinkingOnlySnapshot(content: any[]) {
  return content.length > 0
    && content.every((b: any) => b.type === 'thinking')
    && content.some(
      (b: any) => typeof b.thinking === 'string' && b.thinking.length > 0,
    );
}

function shouldCreateStreamingToolPlaceholder(toolName: string | undefined) {
  return Boolean(
    toolName
      && toolName !== 'ExitPlanMode'
      && toolName !== 'Task'
      && toolName !== 'Agent'
      && toolName !== 'TaskCreate'
      && toolName !== 'SendMessage'
      && toolName !== 'AskUserQuestion',
  );
}

function shouldRenderThinkingForTab(tabId: string) {
  const tab = useChatStore.getState().getTab(tabId);
  return getEffectiveThinking(tab?.sessionMeta) !== 'off';
}

function clearLivePartialThinking(tabId: string, stdinId?: string) {
  if (stdinId) streamController.clearThinking(stdinId);
  clearPreservedThinkingSnapshot(tabId, stdinId);
  const store = useChatStore.getState();
  const tab = store.getTab(tabId);
  if (!tab?.partialThinking) return;
  const nextTabs = new Map(store.tabs);
  nextTabs.set(tabId, { ...tab, partialThinking: '' });
  useChatStore.setState({ tabs: nextTabs, sessionCache: nextTabs });
}

function clearLivePartialText(tabId: string, stdinId?: string) {
  if (stdinId) streamController.flush(stdinId);
  const store = useChatStore.getState();
  const tab = store.getTab(tabId);
  if (!tab?.partialText) return;
  const nextTabs = new Map(store.tabs);
  nextTabs.set(tabId, {
    ...tab,
    partialText: '',
    isStreaming: Boolean(tab.partialThinking),
  });
  useChatStore.setState({ tabs: nextTabs, sessionCache: nextTabs });
}

function preserveLiveThinkingSnapshot(params: {
  tabId: string;
  thinkingPersistence: { id: string; content: string } | null;
  stdinId?: string;
}) {
  const { tabId, thinkingPersistence, stdinId } = params;
  if (!shouldRenderThinkingForTab(tabId)) {
    clearLivePartialThinking(tabId, stdinId);
    return false;
  }
  if (!thinkingPersistence?.content) return false;
  if (stdinId) streamController.clearThinking(stdinId);
  rememberPreservedThinkingSnapshot(tabId, stdinId, thinkingPersistence.content);

  useChatStore.setState((state) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return {};
    const nextThinking = mergeThinkingContent(tab.partialThinking, thinkingPersistence.content);
    if (!nextThinking || nextThinking === tab.partialThinking) return {};
    const nextTabs = new Map(state.tabs);
    nextTabs.set(tabId, {
      ...tab,
      partialThinking: nextThinking,
      isStreaming: true,
      activityStatus:
        tab.activityStatus.phase === 'tool'
          || tab.activityStatus.phase === 'awaiting'
          || tab.activityStatus.phase === 'writing'
          ? tab.activityStatus
          : tab.partialText.length > 0
            ? { phase: 'writing' as const }
            : { phase: 'thinking' as const },
    });
    return { tabs: nextTabs, sessionCache: nextTabs };
  });
  return true;
}

function appendLiveThinkingDelta(tabId: string, delta: string, stdinId?: string) {
  if (!delta) return;
  if (!shouldRenderThinkingForTab(tabId)) {
    clearLivePartialThinking(tabId, stdinId);
    return;
  }
  const currentThinking = useChatStore.getState().getTab(tabId)?.partialThinking ?? '';
  const filtered = filterThinkingDeltaAfterPreservedSnapshot({
    tabId,
    stdinId,
    currentThinking,
    delta,
  });
  if (filtered) useChatStore.getState().updatePartialThinking(tabId, filtered);
}

function commitThinkingAtTurnBoundary(params: {
  tabId: string;
  msgUuid: string | undefined;
  timestamp: number;
  subAgentDepth?: number;
  stdinId?: string;
}) {
  const {
    tabId,
    msgUuid,
    timestamp,
    subAgentDepth,
    stdinId,
  } = params;
  const tab = useChatStore.getState().getTab(tabId);
  const bufferedThinking = stdinId
    ? streamController.peekBufferedThinking(stdinId)
    : undefined;
  const thinkingPersistence = resolveThinkingPersistence(
    msgUuid,
    [],
    tab?.partialThinking,
    bufferedThinking,
  );
  return commitThinkingBeforeAssistantText({
    tabId,
    msgUuid,
    thinkingPersistence,
    timestamp,
    subAgentDepth,
    stdinId,
  });
}

function finalizeBackgroundAssistantStreamingState(params: {
  tabId: string;
  hasTextBlock: boolean;
  hasAskUserQuestion: boolean;
  shouldMaterializeThinking: boolean;
  thinkingPersistence: { id: string; content: string } | null;
  stdinId?: string;
}) {
  const {
    tabId,
    hasTextBlock,
    hasAskUserQuestion,
    shouldMaterializeThinking,
    thinkingPersistence,
    stdinId,
  } = params;
  if (stdinId) {
    if (hasTextBlock) {
      streamController.clearPartial(stdinId);
    } else if (hasAskUserQuestion) {
      streamController.flush(stdinId);
    } else if (shouldMaterializeThinking && thinkingPersistence) {
      streamController.clearThinking(stdinId);
    }
  }
  useChatStore.setState((state) => {
    const latestTab = state.tabs.get(tabId);
    if (!latestTab) return {};

    if (hasTextBlock) {
      const nextTabs = new Map(state.tabs);
      nextTabs.set(tabId, {
        ...latestTab,
        partialText: '',
        partialThinking: '',
        isStreaming: false,
      });
      return { tabs: nextTabs, sessionCache: nextTabs };
    }

    if (hasAskUserQuestion && latestTab.partialText) {
      const nextPartialThinking = shouldMaterializeThinking && thinkingPersistence
        ? ''
        : latestTab.partialThinking;
      const nextTabs = new Map(state.tabs);
      nextTabs.set(tabId, {
        ...latestTab,
        partialText: '',
        partialThinking: nextPartialThinking,
        isStreaming: Boolean(nextPartialThinking),
      });
      return { tabs: nextTabs, sessionCache: nextTabs };
    }

    if (latestTab.partialThinking && shouldMaterializeThinking && thinkingPersistence) {
      const nextTabs = new Map(state.tabs);
      nextTabs.set(tabId, { ...latestTab, partialThinking: '' });
      return { tabs: nextTabs, sessionCache: nextTabs };
    }

    return {};
  });
}

function commitThinkingBeforeAssistantText(params: {
  tabId: string;
  msgUuid: string | undefined;
  thinkingPersistence: { id: string; content: string } | null;
  timestamp: number;
  subAgentDepth?: number;
  stdinId?: string;
}) {
  const {
    tabId,
    msgUuid,
    thinkingPersistence,
    timestamp,
    subAgentDepth,
    stdinId,
  } = params;
  if (!thinkingPersistence) return false;

  const store = useChatStore.getState();
  const tab = store.getTab(tabId);
  if (!tab) return false;
  if (!shouldRenderThinkingForTab(tabId)) {
    clearLivePartialThinking(tabId, stdinId);
    return false;
  }

  const committedId = buildCommittedThinkingId(msgUuid) ?? thinkingPersistence.id;
  const legacyId = msgUuid ? `${msgUuid}_thinking` : undefined;
  const existingThinking = tab.messages.find((message) =>
    message.type === 'thinking'
      && (message.id === committedId || message.id === legacyId),
  );

  if (existingThinking) {
    if (
      existingThinking.content !== thinkingPersistence.content
      || existingThinking.subAgentDepth !== subAgentDepth
    ) {
      store.updateMessage(tabId, existingThinking.id, {
        content: thinkingPersistence.content,
        ...(subAgentDepth !== undefined ? { subAgentDepth } : {}),
      });
    }
    clearLivePartialThinking(tabId, stdinId);
    return true;
  }

  store.addMessage(tabId, {
    id: committedId,
    role: 'assistant',
    type: 'thinking',
    content: thinkingPersistence.content,
    ...(subAgentDepth !== undefined ? { subAgentDepth } : {}),
    timestamp,
  });
  clearLivePartialThinking(tabId, stdinId);
  return true;
}

function resolveToolResultTargetMessageId(
  messages: ChatMessage[],
  toolUseId: string | undefined,
  toolName: string | undefined,
) {
  if (toolUseId) {
    const directTarget = messages.find((message) => message.id === toolUseId);
    if (directTarget) return directTarget.id;
  }
  if (!toolName) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message.role === 'assistant'
      && message.toolName === toolName
      && message.type !== 'tool_result'
      && !message.toolCompleted
    ) {
      return message.id;
    }
  }
  return undefined;
}

export const __streamThinkingTesting = {
  buildThinkingSnapshot,
  buildCommittedThinkingId,
  resolveThinkingPersistence,
  mergeThinkingContent,
  shouldMaterializeThinkingSnapshot,
  isPureThinkingOnlySnapshot,
  shouldCreateStreamingToolPlaceholder,
  clearLivePartialText,
  preserveLiveThinkingSnapshot,
  appendLiveThinkingDelta,
  commitThinkingBeforeAssistantText,
  commitThinkingAtTurnBoundary,
  finalizeBackgroundAssistantStreamingState,
};

export const __streamRetryTesting = {
  recordApiRetry,
  shouldClearApiRetryForEvent,
};

// --- File tree auto-refresh on file-mutating tool completions ---
// Tools that may create/modify/delete files in the working directory.
const FILE_MUTATING_TOOLS = new Set([
  'Write', 'Edit', 'MultiEdit', 'Bash', 'BatchTool',
]);

// Debounce tree refresh to batch rapid tool completions (e.g. parallel agents).
let _fileRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function _scheduleFileTreeRefresh() {
  if (_fileRefreshTimer) return; // already scheduled
  _fileRefreshTimer = setTimeout(() => {
    _fileRefreshTimer = null;
    useFileStore.getState().refreshTree();
  }, 300);
}

/**
 * If the tool_result's parent tool_use was a file-mutating tool,
 * schedule a debounced file tree refresh.
 */
function _maybeRefreshFileTree(tabId: string, toolUseId?: string, toolName?: string) {
  // Fast path: tool_name available directly on the message
  if (toolName && FILE_MUTATING_TOOLS.has(toolName)) {
    _scheduleFileTreeRefresh();
    return;
  }
  // Fallback: look up parent tool_use message
  if (toolUseId) {
    const messages = useChatStore.getState().getTab(tabId)?.messages ?? [];
    const parent = messages.find((m) => m.id === toolUseId);
    if (parent?.toolName && FILE_MUTATING_TOOLS.has(parent.toolName)) {
      _scheduleFileTreeRefresh();
    }
  }
}

function isAssistantResumeEvidenceEvent(msg: any): boolean {
  if (msg.type === 'assistant' || msg.type === 'content_block_delta') return true;
  if (msg.type !== 'stream_event') return false;
  const evtType = msg.event?.type;
  return evtType === 'message_start'
    || evtType === 'message_delta'
    || evtType === 'content_block_start'
    || evtType === 'content_block_delta'
    || evtType === 'content_block_stop';
}

function shouldClearApiRetryForEvent(msg: any): boolean {
  if (msg.type === 'system') {
    return msg.subtype === 'init' || msg.subtype === 'error';
  }
  if (msg.type === 'stream_event') {
    const evtType = msg.event?.type;
    return evtType === 'message_start'
      || evtType === 'message_delta'
      || evtType === 'content_block_start'
      || evtType === 'content_block_delta'
      || evtType === 'content_block_stop';
  }
  return msg.type === 'assistant'
    || msg.type === 'content_block_delta'
    || msg.type === 'result'
    || msg.type === 'process_exit'
    || msg.type === 'tokenicode_permission_request'
    || msg.type === 'tool_result';
}

function recordApiRetry(tabId: string, msg: any): void {
  useChatStore.getState().setSessionMeta(tabId, {
    apiRetry: buildApiRetryStatus(msg),
    lastProgressAt: Date.now(),
  });
}

/**
 * Configuration refs and callbacks that the stream processor needs
 * from the parent InputBar component.
 */
export interface StreamProcessorConfig {
  exitPlanModeSeenRef: MutableRefObject<boolean>;
  silentRestartRef: MutableRefObject<boolean>;
  handleSubmitRef: MutableRefObject<() => void>;
  handleStderrLineRef: MutableRefObject<(line: string, sid: string) => void>;
  /** Last stderr error line — displayed to user if process exits without response */
  lastStderrRef: MutableRefObject<string>;
  setInputSync: (text: string) => void;
}

/**
 * useStreamProcessor — extracts stream message handling from InputBar.
 *
 * Returns handleStreamMessage (foreground) and handleBackgroundStreamMessage
 * (background tab routing) as stable callbacks.
 */
export function useStreamProcessor(config: StreamProcessorConfig) {
  const {
    exitPlanModeSeenRef,
    silentRestartRef,
    handleSubmitRef,
    handleStderrLineRef,
    lastStderrRef,
    setInputSync,
  } = config;
  const lastProgressWriteRef = useRef<Record<string, number>>({});

  const markStreamProgress = useCallback((tabId: string, msg: any) => {
    const isHighFrequencyDelta =
      (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta')
      || msg.type === 'content_block_delta';
    const now = Date.now();
    const last = lastProgressWriteRef.current[tabId] ?? 0;
    const tab = useChatStore.getState().getTab(tabId);
    const shouldClearApiRetry = shouldClearApiRetryForEvent(msg);
    if (isHighFrequencyDelta && now - last < 250 && !(shouldClearApiRetry && tab?.sessionMeta.apiRetry)) return;
    lastProgressWriteRef.current[tabId] = now;
    const shouldClearTurnMeta = msg.type !== 'system'
      && msg.type !== 'process_exit'
      && tab?.sessionStatus !== 'stopping';
    const hasResumeEvidence = isAssistantResumeEvidenceEvent(msg);

    useChatStore.getState().setSessionMeta(tabId, {
      lastProgressAt: now,
      ...(hasResumeEvidence ? { turnAcceptedForResume: true } : {}),
      ...(shouldClearApiRetry ? { apiRetry: undefined } : {}),
      ...(shouldClearTurnMeta
        ? {
          pendingTurnMessageId: undefined,
          pendingTurnInput: undefined,
          pendingTurnAttachments: undefined,
          interruptedAssistantText: undefined,
        }
        : {}),
    });
  }, []);

  /**
   * Handle stream messages for a background (non-active) tab — route to cache.
   */
  const handleBackgroundStreamMessage = useCallback((msg: any, tabId: string) => {
    const store = useChatStore.getState();

    // Ownership guard: reject stale messages from old processes (F5 fix).
    if (msg.__stdinId) {
      const bgTab = store.getTab(tabId);
      if (bgTab?.sessionMeta.stdinId && bgTab.sessionMeta.stdinId !== msg.__stdinId) {
        return; // stale message — discard
      }
    }

    // Update progress for stall detection without writing Zustand state for every token.
    markStreamProgress(tabId, msg);

    switch (msg.type) {
      case 'tokenicode_permission_request': {
        // ExitPlanMode: auto-approve in non-plan modes; add plan_review card in plan mode
        if (msg.tool_name === 'ExitPlanMode') {
          const bgMeta = store.getTab(tabId)?.sessionMeta;
          if (getEffectiveMode(bgMeta) !== 'plan') {
            const stdinId = msg.__stdinId;
            if (stdinId) {
              bridge.respondPermission(stdinId, msg.request_id, true, undefined, msg.tool_use_id, msg.input);
            }
            return;
          }
          const bgTab = store.getTab(tabId);
          const bgExisting = bgTab?.messages.find((m) => m.id === 'plan_review_current' && !m.resolved);
          if (!bgExisting) {
            let bgPlanContent = '';
            if (bgTab) {
              for (let i = bgTab.messages.length - 1; i >= 0; i--) {
                if (bgTab.messages[i].role === 'assistant' && bgTab.messages[i].type === 'text' && bgTab.messages[i].content) {
                  bgPlanContent = bgTab.messages[i].content;
                  break;
                }
              }
            }
            store.addMessage(tabId, {
              id: 'plan_review_current',
              role: 'assistant', type: 'plan_review',
              content: bgPlanContent, planContent: bgPlanContent,
              resolved: false, timestamp: Date.now(),
              permissionData: {
                requestId: msg.request_id,
                toolName: msg.tool_name,
                input: msg.input,
                toolUseId: msg.tool_use_id,
              },
            });
          } else {
            store.updateMessage(tabId, 'plan_review_current', {
              permissionData: {
                requestId: msg.request_id,
                toolName: msg.tool_name,
                input: msg.input,
                toolUseId: msg.tool_use_id,
              },
            });
          }
          store.setActivityStatus(tabId, { phase: 'awaiting' });
          return;
        }
        // AskUserQuestion: add question card to tab
        if (msg.tool_name === 'AskUserQuestion') {
          const bgTab = store.getTab(tabId);
          const questionId = msg.tool_use_id || 'ask_question_current';
          const existing = bgTab?.messages.find((m) => m.id === questionId && m.type === 'question')
            || bgTab?.messages.find((m) => m.type === 'question' && !m.resolved && m.toolName === 'AskUserQuestion');
          const ownerStdinId = (msg.__stdinId as string | undefined)
            ?? bgTab?.sessionMeta.stdinId;
          clearLivePartialText(tabId, ownerStdinId);
          if (existing) {
            store.updateMessage(tabId, existing.id, {
              permissionData: {
                requestId: msg.request_id,
                toolName: msg.tool_name,
                input: msg.input,
                toolUseId: msg.tool_use_id,
              },
              toolInput: msg.input,
              owner: existing.owner
                ?? (ownerStdinId ? { tabId, stdinId: ownerStdinId } : undefined),
            });
            return;
          }
          const questions = msg.input?.questions;
          store.addMessage(tabId, {
            id: questionId,
            role: 'assistant', type: 'question',
            content: '', toolName: 'AskUserQuestion',
            toolInput: msg.input,
            questions: Array.isArray(questions) ? questions : [],
            resolved: false, timestamp: Date.now(),
            permissionData: {
              requestId: msg.request_id,
              toolName: msg.tool_name,
              input: msg.input,
              toolUseId: msg.tool_use_id,
            },
            owner: ownerStdinId ? { tabId, stdinId: ownerStdinId } : undefined,
          });
          store.setActivityStatus(tabId, { phase: 'awaiting' });
          return;
        }
        // Regular permission: add permission card to tab
        const bgTab = store.getTab(tabId);
        const existingPerm = bgTab?.messages.find(
          (m) => m.type === 'permission'
            && m.permissionData?.requestId === msg.request_id
            && m.interactionState !== 'failed'
        );
        if (existingPerm) return;
        store.addMessage(tabId, {
          id: generateMessageId(),
          role: 'assistant', type: 'permission',
          content: msg.description || `${msg.tool_name} wants to execute`,
          permissionTool: msg.tool_name,
          permissionDescription: msg.description || '',
          timestamp: Date.now(),
          interactionState: 'pending',
          permissionData: {
            requestId: msg.request_id,
            toolName: msg.tool_name,
            input: msg.input,
            description: msg.description,
            toolUseId: msg.tool_use_id,
          },
        });
        store.setActivityStatus(tabId, { phase: 'awaiting' });
        break;
      }
      case 'stream_event': {
        const evt = msg.event;
        if (!evt) break;
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text) store.updatePartialMessage(tabId, text);
        } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
          // F1 (#57): background tabs must handle thinking_delta too,
          // otherwise thinking content is silently lost on tab switch.
          const thinking = evt.delta.thinking || '';
          if (shouldRenderThinkingForTab(tabId)) {
            appendLiveThinkingDelta(tabId, thinking, msg.__stdinId as string | undefined);
          } else if (msg.__stdinId) {
            streamController.clearThinking(msg.__stdinId as string);
          }
        }
        // Early detection: create plan_review card for background tab (Plan mode only).
        // Bypass auto-approves via Rust backend — no UI card needed.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode'
            && getEffectiveMode(store.getTab(tabId)?.sessionMeta) === 'plan') {
          const bgTab = store.getTab(tabId);
          const bgExisting = bgTab?.messages.find((m) => m.id === 'plan_review_current');
          if (!bgExisting || !bgExisting.resolved) {
            let bgPlanContent = '';
            if (bgTab) {
              for (let i = bgTab.messages.length - 1; i >= 0; i--) {
                const m = bgTab.messages[i];
                if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                  bgPlanContent = m.toolInput.content;
                  break;
                }
              }
            }
            store.addMessage(tabId, {
              id: 'plan_review_current',
              role: 'assistant', type: 'plan_review',
              content: bgPlanContent, planContent: bgPlanContent,
              resolved: false, timestamp: Date.now(),
            });
            store.setActivityStatus(tabId, { phase: 'awaiting' });
          }
        }
        // Track tokens in background sessions (per-turn + cumulative total)
        if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
          const bgTab = store.getTab(tabId);
          const delta = evt.message.usage.input_tokens;
          store.setSessionMeta(tabId, {
            inputTokens: (bgTab?.sessionMeta.inputTokens || 0) + delta,
            totalInputTokens: (bgTab?.sessionMeta.totalInputTokens || 0) + delta,
          });
        }
        if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
          const bgTab = store.getTab(tabId);
          const delta = evt.usage.output_tokens;
          store.setSessionMeta(tabId, {
            outputTokens: (bgTab?.sessionMeta.outputTokens || 0) + delta,
            totalOutputTokens: (bgTab?.sessionMeta.totalOutputTokens || 0) + delta,
          });
        }
        break;
      }
      case 'assistant': {
        // Clear pending command on assistant event (same as foreground)
        completePendingCommand(tabId);
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;
        // Selectively clear partial in tab — only wipe partialText if a text
        // block is present (which supersedes streaming text). Otherwise, preserve
        // it to avoid intermediate thinking-only messages destroying streaming text.
        const bgHasTextBlock = content.some((b: any) => b.type === 'text' && b.text);
        const bgHasAskUserQuestion = content.some(
          (b: any) => b.type === 'tool_use' && b.name === 'AskUserQuestion',
        );
        const bgShouldRenderThinking = shouldRenderThinkingForTab(tabId);
        const bgIsPureThinkingOnly = bgShouldRenderThinking && isPureThinkingOnlySnapshot(content);
        const bgShouldMaterializeThinking = bgShouldRenderThinking
          && shouldMaterializeThinkingSnapshot(content, bgHasTextBlock);
        const bgTab = store.getTab(tabId);
        const bgStdinId = msg.__stdinId as string | undefined;
        const bgBufferedThinking = bgStdinId
          ? streamController.peekBufferedThinking(bgStdinId)
          : undefined;
        const bgThinkingPersistence = bgShouldRenderThinking
          ? resolveThinkingPersistence(
            msg.uuid,
            content,
            bgTab?.partialThinking,
            bgBufferedThinking,
          )
          : null;
        if (!bgShouldMaterializeThinking && bgIsPureThinkingOnly && bgThinkingPersistence) {
          preserveLiveThinkingSnapshot({
            tabId,
            thinkingPersistence: bgThinkingPersistence,
            stdinId: bgStdinId,
          });
        }
        let bgThinkingMessageEmitted = bgHasTextBlock
          ? commitThinkingBeforeAssistantText({
            tabId,
            msgUuid: msg.uuid,
            thinkingPersistence: bgThinkingPersistence,
            timestamp: Date.now(),
            stdinId: bgStdinId,
          })
          : false;
        finalizeBackgroundAssistantStreamingState({
          tabId,
          hasTextBlock: bgHasTextBlock,
          hasAskUserQuestion: bgHasAskUserQuestion,
          shouldMaterializeThinking: bgShouldMaterializeThinking,
          thinkingPersistence: bgThinkingPersistence,
          stdinId: bgStdinId,
        });
        // Skip text blocks when AskUserQuestion is present — the
        // interactive question UI makes them redundant.
        for (let blockIdx = 0; blockIdx < content.length; blockIdx++) {
          const block = content[blockIdx];
          if (block.type === 'text') {
            if (bgHasAskUserQuestion) continue;
            const textId = msg.uuid ? `${msg.uuid}_text_${blockIdx}` : generateMessageId();
            store.addMessage(tabId, {
              id: textId,
              role: 'assistant', type: 'text',
              content: block.text, timestamp: Date.now(),
            });
          } else if (block.type === 'tool_use') {
            // Code mode: suppress EnterPlanMode/ExitPlanMode (transparent to user)
            if (getEffectiveMode(store.getTab(tabId)?.sessionMeta) === 'code'
                && (block.name === 'EnterPlanMode' || block.name === 'ExitPlanMode')) {
              if (block.name === 'ExitPlanMode') exitPlanModeSeenRef.current = true;
              continue;
            }
            if (block.name === 'AskUserQuestion') {
              const questions = block.input?.questions;
              const bgQuestionId = block.id || generateMessageId();
              // Guard: skip if question already exists in background tab (resolved or not)
              const bgSnap = store.getTab(tabId);
              const bgExisting = bgSnap?.messages.find(
                (m) => m.id === bgQuestionId && m.type === 'question',
              );
              if (bgExisting) break;

              const bgOwnerStdinId = (msg.__stdinId as string | undefined)
                ?? bgSnap?.sessionMeta.stdinId;
              store.addMessage(tabId, {
                id: bgQuestionId,
                role: 'assistant', type: 'question',
                content: '', toolName: block.name,
                toolInput: block.input,
                questions: Array.isArray(questions) ? questions : [],
                resolved: false, timestamp: Date.now(),
                owner: bgOwnerStdinId ? { tabId, stdinId: bgOwnerStdinId } : undefined,
              });
            } else if (block.name === 'TodoWrite' && block.input?.todos) {
              store.addMessage(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'todo',
                content: '', toolName: block.name,
                toolInput: block.input,
                todoItems: block.input.todos,
                timestamp: Date.now(),
              });
            } else if (block.name === 'ExitPlanMode') {
              // Show as regular tool_use in plan/bypass modes
              store.addMessage(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'tool_use',
                content: '', toolName: block.name,
                toolInput: block.input, timestamp: Date.now(),
              });
              // Only create plan_review card in Plan mode.
              // Bypass auto-approves via Rust backend — no UI card needed.
              if (getEffectiveMode(store.getTab(tabId)?.sessionMeta) === 'plan') {
                const bgSnap2 = store.getTab(tabId);
                let bgPlanContent = '';
                if (bgSnap2) {
                  for (let i = bgSnap2.messages.length - 1; i >= 0; i--) {
                    const m = bgSnap2.messages[i];
                    if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                      bgPlanContent = m.toolInput.content;
                      break;
                    }
                  }
                }
                const bgToolExists = block.id && bgSnap2?.messages.some(
                  (m) => m.id === block.id && m.toolName === 'ExitPlanMode',
                );
                const bgResolvedReview = bgSnap2?.messages.find(
                  (m) => m.type === 'plan_review' && m.resolved,
                );
                if (!(bgToolExists && bgResolvedReview)) {
                  store.addMessage(tabId, {
                    id: 'plan_review_current',
                    role: 'assistant', type: 'plan_review',
                    content: bgPlanContent, planContent: bgPlanContent,
                    resolved: false, timestamp: Date.now(),
                  });
                  store.setActivityStatus(tabId, { phase: 'awaiting' });
                }
              }
            } else {
              store.addMessage(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'tool_use',
                content: '', toolName: block.name,
                toolInput: block.input, timestamp: Date.now(),
              });
            }
          } else if (block.type === 'thinking') {
            if (!bgShouldRenderThinking) continue;
            if (bgThinkingMessageEmitted) continue;
            store.setActivityStatus(tabId, { phase: 'thinking' });
            if (bgShouldMaterializeThinking && bgThinkingPersistence) {
              bgThinkingMessageEmitted = commitThinkingBeforeAssistantText({
                tabId,
                msgUuid: msg.uuid,
                thinkingPersistence: bgThinkingPersistence,
                timestamp: Date.now(),
                stdinId: bgStdinId,
              });
            }
          }
        }
        if (bgShouldMaterializeThinking && bgThinkingPersistence && !bgThinkingMessageEmitted) {
          commitThinkingBeforeAssistantText({
            tabId,
            msgUuid: msg.uuid,
            thinkingPersistence: bgThinkingPersistence,
            timestamp: Date.now(),
            stdinId: bgStdinId,
          });
        }
        break;
      }
      case 'user':
      case 'human': {
        const userContent = msg.message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === 'tool_result') {
              const resultText = Array.isArray(block.content)
                ? block.content.map((b: any) => typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '').join('')
                : typeof block.content === 'string' ? block.content : '';
              const targetId = resolveToolResultTargetMessageId(
                store.getTab(tabId)?.messages ?? [],
                block.tool_use_id,
                undefined,
              );
              if (targetId) {
                store.updateMessage(tabId, targetId, {
                  toolCompleted: true,
                  ...(resultText ? { toolResultContent: resultText } : {}),
                });
              }
            }
          }
        }
        break;
      }
      case 'tool_result': {
        const resultContent = Array.isArray(msg.content)
          ? msg.content.map((b: any) => typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '').join('')
          : typeof msg.content === 'string' ? msg.content : msg.output || '';
        const targetId = resolveToolResultTargetMessageId(
          store.getTab(tabId)?.messages ?? [],
          msg.tool_use_id,
          msg.tool_name,
        );
        if (targetId) {
          // Backfill AskUserQuestion type/questions in background tab
          const bgTab = store.getTab(tabId);
          const parentMsg = bgTab?.messages.find((m) => m.id === targetId);
          const bgUpdates: Partial<ChatMessage> = {
            toolCompleted: true,
            ...(resultContent ? { toolResultContent: resultContent } : {}),
          };
          if (parentMsg?.toolName === 'AskUserQuestion') {
            if (parentMsg.type !== 'question') {
              bgUpdates.type = 'question';
              bgUpdates.resolved = false;
            }
            if (!parentMsg.questions || parentMsg.questions.length === 0) {
              const qs = parentMsg.toolInput?.questions;
              if (Array.isArray(qs) && qs.length > 0) {
                bgUpdates.questions = qs;
              }
            }
          }
          store.updateMessage(tabId, targetId, bgUpdates);
          // Auto-refresh file tree when file-mutating tools complete
          _maybeRefreshFileTree(tabId, targetId, msg.tool_name);
        }
        break;
      }
      case 'result': {
        // Capture stopping state BEFORE status update — needed for drain guard below
        const bgWasStopping = store.getTab(tabId)?.sessionStatus === 'stopping';
        const bgResultTab = store.getTab(tabId);
        const bgResultStdinId = (msg.__stdinId as string | undefined)
          ?? bgResultTab?.sessionMeta.stdinId;
        const bgFinalizedRoute = bgResultStdinId ? getRecentlyFinalizedStdin(bgResultStdinId) : undefined;
        const bgIsUserStopResult = msg.subtype !== 'success'
          && (
            bgWasStopping
            || bgResultTab?.sessionMeta.teardownReason === 'stop'
            || bgFinalizedRoute?.reason === 'stop'
            || msg.subtype === 'user_abort'
          );

        if (bgIsUserStopResult) {
          if (bgResultStdinId && bgWasStopping) {
            handleProcessExitFinalize(bgResultStdinId);
          } else {
            store.setSessionStatus(tabId, 'stopped');
            store.setSessionMeta(tabId, {
              stdinReady: false,
              pendingReadyMessage: undefined,
              turnStartTime: undefined,
              lastProgressAt: undefined,
              apiRetry: undefined,
            });
          }
          useSessionStore.getState().fetchSessions();
          break;
        }

        commitThinkingAtTurnBoundary({
          tabId,
          msgUuid: msg.uuid,
          timestamp: Date.now(),
          stdinId: bgResultStdinId,
        });

        // Clear pending command on result (e.g. /compact completing on background tab)
        completePendingCommand(tabId, {
          costSummary: msg.total_cost_usd != null ? {
            cost: `$${msg.total_cost_usd?.toFixed(4) || '0'}`,
            duration: msg.duration_ms ? `${(msg.duration_ms / 1000).toFixed(1)}s` : '',
            turns: msg.num_turns ?? '',
            input: msg.usage?.input_tokens?.toLocaleString() ?? '',
            output: msg.usage?.output_tokens?.toLocaleString() ?? '',
          } : undefined,
        });
        store.setSessionStatus(tabId, msg.subtype === 'success' ? 'completed' : 'error');
        {
          const bgTab = store.getTab(tabId);
          const prevMeta = bgTab?.sessionMeta;
          const resultInput = msg.usage?.input_tokens || 0;
          const resultOutput = msg.usage?.output_tokens || 0;
          const streamedInput = prevMeta?.inputTokens || 0;
          const streamedOutput = prevMeta?.outputTokens || 0;
          store.setSessionMeta(tabId, {
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
            turns: msg.num_turns,
            inputTokens: resultInput,
            outputTokens: resultOutput,
            totalInputTokens: (prevMeta?.totalInputTokens || 0) + (resultInput - streamedInput),
            totalOutputTokens: (prevMeta?.totalOutputTokens || 0) + (resultOutput - streamedOutput),
            turnStartTime: undefined,
            lastProgressAt: undefined,
            apiRetry: undefined,
          });
        }
        if (typeof msg.result === 'string' && msg.result && !isCliPlaceholder(msg.result)) {
          // Only add if not already delivered via 'assistant' event
          const bgTab = store.getTab(tabId);
          const bgIsDuplicate = bgTab?.messages.some(
            (m) => m.role === 'assistant' && m.type === 'text'
              && m.content === msg.result,
          );
          if (!bgIsDuplicate) {
            store.addMessage(tabId, {
              id: msg.uuid || generateMessageId(),
              role: 'assistant', type: 'text',
              content: msg.result, timestamp: Date.now(),
            });
          }
        }
        // BATCH drain for background tabs: same as foreground — combine
        // ALL pending messages into a single user turn.
        // Decision 5: stopping state blocks drain pending.
        // Use bgWasStopping (captured BEFORE setSessionStatus above) because the
        // status was already overwritten to completed/error by the time we get here.
        //
        // Phase 2 §6: before sending, verify the config hash captured at enqueue
        // time still matches the current spawnConfigHash. If not, the user
        // changed provider / model / thinking mid-turn and the queued text
        // would be processed on a stale process — backfill to inputDraft instead.
        {
          const bgDrainTab = store.getTab(tabId);
          const bgAllPending = bgDrainTab?.pendingUserMessages ?? [];
          const bgFlushStdinId = bgDrainTab?.sessionMeta.stdinId;
          if (bgAllPending.length > 0 && bgFlushStdinId && !bgWasStopping) {
            const bgCurrentHash = spawnConfigHash();
            const bgHashMismatch = bgAllPending.some(
              (p) => p.enqueueConfigHash !== undefined && p.enqueueConfigHash !== bgCurrentHash,
            );
            // Also detect stdinId drift: if the process was restarted since
            // enqueue, the stdinId will differ and the queued text should not
            // be sent to the new process.
            const bgStdinMismatch = bgAllPending.some(
              (p) => p.enqueueStdinId !== undefined && p.enqueueStdinId !== bgFlushStdinId,
            );
            if (bgHashMismatch || bgStdinMismatch) {
              store.restorePendingQueueToDraft(tabId);
              if (useSessionStore.getState().selectedSessionId === tabId) {
                setInputSync(store.getTab(tabId)?.inputDraft ?? '');
              }
              console.warn('[TC:bg] Config changed mid-queue — pending messages restored to draft');
            } else {
              const bgCombined = bgAllPending.map((p) => p.text).join('\n\n');
              store.clearPendingMessages(tabId);
              store.addMessage(tabId, {
                id: generateMessageId(),
                role: 'user',
                type: 'text',
                content: bgCombined,
                timestamp: Date.now(),
              });
              store.setSessionStatus(tabId, 'running');
              store.setSessionMeta(tabId, { turnStartTime: Date.now(), lastProgressAt: Date.now(), inputTokens: 0, outputTokens: 0 });
              store.setActivityStatus(tabId, { phase: 'thinking' });
              bridge.sendStdin(bgFlushStdinId, bgCombined).catch((err) => {
                console.error('[TC:bg] Failed to send pending messages:', err);
                const bgDraft = store.getTab(tabId)?.inputDraft ?? '';
                store.setInputDraft(tabId, bgDraft ? `${bgDraft}\n\n${bgCombined}` : bgCombined);
                cleanupStdinRoute(bgFlushStdinId);
                store.setSessionMeta(tabId, {
                  stdinId: undefined,
                  stdinReady: false,
                  pendingReadyMessage: undefined,
                });
                store.setSessionStatus(tabId, 'error');
              });
            }
          }
        }

        useSessionStore.getState().fetchSessions();

        // S13 fix: Auto-compact for background tabs (same as foreground)
        {
          const bgCompactTab = store.getTab(tabId);
          const bgResultInputTokens = msg.usage?.input_tokens || 0;
          const bgCompactStdinId = bgCompactTab?.sessionMeta.stdinId;
          const bgCompactThreshold = getAutoCompactThreshold(bgCompactTab?.sessionMeta.spawnedModel);
          if (bgResultInputTokens > bgCompactThreshold && !hasAutoCompactFired(tabId) && bgCompactStdinId && msg.subtype === 'success') {
            markAutoCompactFired(tabId);
            console.log('[TOKENICODE] Background tab auto-compact triggered:', tabId, 'inputTokens =', bgResultInputTokens);
            const bgCompactMsgId = generateMessageId();
            const bgCompactStartedAt = Date.now();
            store.addMessage(tabId, {
              id: bgCompactMsgId,
              role: 'system',
              type: 'text',
              content: t('chat.autoCompacting'),
              commandType: 'processing',
              commandData: { command: '/compact' },
              commandStartTime: bgCompactStartedAt,
              timestamp: Date.now(),
            });
            store.setSessionMeta(tabId, { pendingCommandMsgId: bgCompactMsgId });
            store.setSessionStatus(tabId, 'running');
            store.setSessionMeta(tabId, {
              turnStartTime: bgCompactStartedAt,
              lastProgressAt: bgCompactStartedAt,
              inputTokens: 0,
              outputTokens: 0,
            });
            store.setActivityStatus(tabId, { phase: 'thinking' });
            bridge.sendStdin(bgCompactStdinId, '/compact').catch((err) => {
              console.error('[TOKENICODE] Background tab auto-compact failed:', err);
              completePendingCommand(tabId, { output: 'Compact failed to start' });
              if (store.getTab(tabId)?.sessionStatus === 'running') {
                store.setSessionStatus(tabId, 'error');
              }
            });
            setTimeout(() => {
              const meta = store.getTab(tabId)?.sessionMeta ?? {};
              if (meta.pendingCommandMsgId === bgCompactMsgId) {
                completePendingCommand(tabId, { output: 'Compact timed out' });
                if (store.getTab(tabId)?.sessionStatus === 'running') {
                  store.setSessionStatus(tabId, 'idle');
                }
              }
            }, 15_000);
          }
        }

        // AI Title Generation for background tabs (same 3rd-turn logic)
        if (msg.subtype === 'success') {
          const customPreviews = useSessionStore.getState().customPreviews;
          if (!customPreviews[tabId]) {
            const bgTab = store.getTab(tabId);
            const bgUserMsgs = bgTab?.messages.filter(
              (m) => m.role === 'user' && m.type === 'text' && m.content,
            ) || [];
            const bgAssistantMsgs = bgTab?.messages.filter(
              (m) => m.role === 'assistant' && m.type === 'text' && m.content,
            ) || [];
            if (bgUserMsgs.length >= 3 && bgAssistantMsgs.length >= 3) {
              const userMsg = bgUserMsgs.map((m) => m.content).join('\n').slice(0, 500);
              const assistantMsg = bgAssistantMsgs.map((m) => m.content).join('\n').slice(0, 500);
              bridge.generateSessionTitle(userMsg, assistantMsg, useProviderStore.getState().activeProviderId || undefined)
                .then((title) => {
                  if (title) {
                    useSessionStore.getState().setCustomPreview(tabId, title);
                  }
                })
                .catch((e) => {
                  // Silently ignore SKIP errors (e.g. no haiku mapping for provider)
                  if (!String(e).includes('SKIP:')) console.warn('Title gen failed:', e);
                });
            }
          }
        }
        break;
      }
      case 'rate_limit_event': {
        const bgRli = msg.rate_limit_info;
        if (bgRli && bgRli.rateLimitType) {
          const bgTab = store.getTab(tabId);
          const prevLimits = bgTab?.sessionMeta?.rateLimits || {};
          store.setSessionMeta(tabId, {
            rateLimits: {
              ...prevLimits,
              [bgRli.rateLimitType]: {
                rateLimitType: bgRli.rateLimitType,
                resetsAt: bgRli.resetsAt,
                isUsingOverage: bgRli.isUsingOverage,
                overageStatus: bgRli.overageStatus,
                overageDisabledReason: bgRli.overageDisabledReason,
              },
            },
          });
        }
        break;
      }
      case 'process_exit': {
        const bgStdinId = msg.__stdinId;

        // Ownership guard for background exit
        if (bgStdinId) {
          const ownership = checkOwnership(bgStdinId);
          if (!ownership.valid) {
            cleanupStdinRoute(bgStdinId);
            break;
          }
        }

        // Delegate full finalization to lifecycle module (idempotent)
        if (bgStdinId) {
          store.setSessionMeta(tabId, {
            stdinReady: false,
            pendingReadyMessage: undefined,
          });
          handleProcessExitFinalize(bgStdinId);
        } else {
          // Fallback: no stdinId on message
          store.setSessionStatus(tabId, 'idle');
          store.setSessionMeta(tabId, {
            stdinId: undefined,
            stdinReady: false,
            pendingReadyMessage: undefined,
          });
          useSessionStore.getState().fetchSessions();
        }
        break;
      }
      case 'system':
        if (msg.subtype === 'init') {
          markStdinReady(tabId, msg.__stdinId, msg.model);
        } else if (msg.subtype === 'error') {
          // FI-3: Surface system errors in background tabs too
          store.addMessage(tabId, {
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: formatErrorForUser(msg.message || msg.error || 'System error'),
            timestamp: Date.now(),
          });
        } else if (msg.subtype === 'api_retry') {
          recordApiRetry(tabId, msg);
        }
        break;
      default:
        if (msg.type === 'content_block_delta') {
          if (msg.delta?.type === 'text_delta') {
            const text = msg.delta?.text || '';
            if (text) {
              store.updatePartialMessage(tabId, text);
            }
          } else if (msg.delta?.type === 'thinking_delta') {
            const thinking = msg.delta?.thinking || '';
            if (thinking && shouldRenderThinkingForTab(tabId)) {
              appendLiveThinkingDelta(tabId, thinking, msg.__stdinId as string | undefined);
            } else if (thinking && msg.__stdinId) {
              streamController.clearThinking(msg.__stdinId as string);
            }
          }
        }
        break;
    }
  }, [exitPlanModeSeenRef, markStreamProgress]);

  /**
   * Handle stream messages for the foreground (active) tab.
   */
  const handleStreamMessage = useCallback((msg: any) => {
    if (!msg || !msg.type) return;

    try { // P1-4: error boundary — prevent uncaught exceptions from crashing the stream pipeline

    // Diagnostic: log first message and unrecognized types
    const KNOWN_TYPES = new Set([
      'tokenicode_permission_request', 'stream_event', 'system', 'assistant',
      'user', 'human', 'tool_result', 'tool_use_summary', 'result', 'process_exit',
      'content_block_delta', 'rate_limit_event',
    ]);
    if (msg.type === 'system' || msg.type === 'process_exit') {
      console.log('[TOKENICODE:stream]', msg.type, msg.subtype || '', msg.__stdinId || '');
    }
    if (!KNOWN_TYPES.has(msg.type)) {
      console.warn('[TOKENICODE:stream] unhandled message type:', msg.type, msg);
    }

    // --- Background routing: detect if this stream belongs to a non-active tab ---
    // MUST run before tokenicode_permission_request and all other handlers
    // to prevent messages from background sessions leaking into the active tab.
    const msgStdinId = msg.__stdinId;
    const directOwnerTabId = msgStdinId
      ? useSessionStore.getState().getTabForStdin(msgStdinId)
      : undefined;
    const finalizedRoute = msgStdinId ? getRecentlyFinalizedStdin(msgStdinId) : undefined;
    const isFinalizedUserStopEvent = !directOwnerTabId && finalizedRoute?.reason === 'stop';
    if (isFinalizedUserStopEvent) {
      if (msg.type === 'result') {
        useChatStore.getState().setSessionStatus(finalizedRoute.tabId, 'stopped');
        useChatStore.getState().setSessionMeta(finalizedRoute.tabId, {
          stdinReady: false,
          pendingReadyMessage: undefined,
          turnStartTime: undefined,
          lastProgressAt: undefined,
          apiRetry: undefined,
        });
        useSessionStore.getState().fetchSessions();
      }
      return;
    }
    const ownerTabId = directOwnerTabId;
    const activeTabId = useSessionStore.getState().selectedSessionId;

    const isBackground = ownerTabId && ownerTabId !== activeTabId;

    // If stream belongs to a background tab, route key events to cache and return
    if (isBackground) {
      // Diagnostic: log background routing for non-trivial message types
      if (msg.type !== 'stream_event') {
        console.log('[TOKENICODE:route] background:', msg.type, 'owner:', ownerTabId, 'active:', activeTabId);
      }
      handleBackgroundStreamMessage(msg, ownerTabId);
      return;
    }

    // Resolve tabId once for all foreground store calls.
    // NEW-E fix: if ownerTabId is undefined (no stdinToTab mapping), stash to
    // orphan queue instead of falling through to activeTabId.
    if (!ownerTabId && msgStdinId) {
      streamController.stashOrphanEvent(msgStdinId, msg);
      return;
    }

    const initialTabId = ownerTabId || activeTabId;
    if (!initialTabId) return;
    let tabId: string = initialTabId;

    // Ownership guard: reject stale messages BEFORE any state writes (F4 fix).
    // Must run before permission handling, cliResumeId capture, or switch block.
    if (msgStdinId) {
      const guardTab = useChatStore.getState().getTab(tabId);
      if (guardTab?.sessionMeta.stdinId && guardTab.sessionMeta.stdinId !== msgStdinId) {
        return; // stale message from old process — discard
      }
    }

    // Update progress for stall detection without writing Zustand state for every token.
    markStreamProgress(tabId, msg);

    // --- SDK Permission Request (routed through stream channel for reliability) ---
    if (msg.type === 'tokenicode_permission_request') {

      // ExitPlanMode: only show PlanReviewCard in Plan mode.
      // In other modes, auto-approve so the CLI continues without blocking.
      if (msg.tool_name === 'ExitPlanMode') {
        const tabState = useChatStore.getState().getTab(tabId);
        if (getEffectiveMode(tabState?.sessionMeta) !== 'plan') {
          // Auto-approve: CLI doesn't need user confirmation outside Plan mode
          const stdinId = msg.__stdinId;
          if (stdinId) {
            bridge.respondPermission(stdinId, msg.request_id, true, undefined, msg.tool_use_id, msg.input);
          }
          return;
        }
        const chatStore = useChatStore.getState();
        const messages = tabState?.messages ?? [];
        const permData = {
          requestId: msg.request_id,
          toolName: msg.tool_name,
          input: msg.input,
          description: msg.description,
          toolUseId: msg.tool_use_id,
        };
        const planReview = messages.find((m) => m.id === 'plan_review_current' && !m.resolved);
        if (planReview) {
          chatStore.updateMessage(tabId, 'plan_review_current', { permissionData: permData });
        } else {
          // PlanReviewCard not yet created — create one with permission data
          let planContent = '';
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].type === 'text' && messages[i].content) {
              planContent = messages[i].content;
              break;
            }
          }
          chatStore.addMessage(tabId, {
            id: 'plan_review_current',
            role: 'assistant',
            type: 'plan_review',
            content: planContent,
            planContent: planContent,
            resolved: false,
            permissionData: permData,
            timestamp: Date.now(),
          });
          chatStore.setActivityStatus(tabId, { phase: 'awaiting' });
        }
        return;
      }

      // AskUserQuestion: create QuestionCard instead of PermissionCard.
      // User answers are sent back via respondPermission(updatedInput) — NOT sendStdin.
      if (msg.tool_name === 'AskUserQuestion') {
        const chatStore = useChatStore.getState();
        const messages = chatStore.getTab(tabId)?.messages ?? [];
        const questionId = msg.tool_use_id || 'ask_question_current';
        // Search by exact ID first, then fall back to any unresolved AskUserQuestion.
        // This handles the race condition where the assistant message arrives first
        // with block.id (e.g. "toolu_01abc") and the control_request arrives later
        // with a different or missing tool_use_id.
        const existing = messages.find((m) => m.id === questionId && m.type === 'question')
          || messages.find((m) => m.type === 'question' && !m.resolved && m.toolName === 'AskUserQuestion');
        if (existing) {
          // Patch permissionData so QuestionCard uses respondPermission (SDK path)
          // instead of sendStdin (legacy path). Always update — even if permissionData
          // exists — because a new control_request supersedes a stale one.
          const existingOwnerStdin = (msg.__stdinId as string | undefined)
            ?? chatStore.getTab(tabId)?.sessionMeta.stdinId;
          clearLivePartialText(tabId, existingOwnerStdin);
          chatStore.updateMessage(tabId, existing.id, {
            permissionData: {
              requestId: msg.request_id,
              toolName: msg.tool_name,
              input: msg.input,
              toolUseId: msg.tool_use_id,
            },
            toolInput: msg.input,
            owner: existing.owner
              ?? (existingOwnerStdin ? { tabId, stdinId: existingOwnerStdin } : undefined),
          });
          return;
        }
        const questions = msg.input?.questions;
        // Phase 4 §5.3 (S3): stamp the owning tab/stdin so the card's answer
        // handler can use the spawning context instead of getActiveTabState().
        const ownerStdinId = (msg.__stdinId as string | undefined)
          ?? chatStore.getTab(tabId)?.sessionMeta.stdinId;
        clearLivePartialText(tabId, ownerStdinId);
        chatStore.addMessage(tabId, {
          id: questionId,
          role: 'assistant',
          type: 'question',
          content: '',
          toolName: 'AskUserQuestion',
          toolInput: msg.input,
          questions: Array.isArray(questions) ? questions : [],
          resolved: false,
          timestamp: Date.now(),
          // Attach permission data so QuestionCard uses respondPermission instead of sendStdin
          permissionData: {
            requestId: msg.request_id,
            toolName: msg.tool_name,
            input: msg.input,
            toolUseId: msg.tool_use_id,
          },
          owner: ownerStdinId ? { tabId, stdinId: ownerStdinId } : undefined,
        });
        chatStore.setActivityStatus(tabId, { phase: 'awaiting' });
        return;
      }

      // Dedup: skip if we already have a non-failed PermissionCard for this request_id
      const chatStore = useChatStore.getState();
      const messages = chatStore.getTab(tabId)?.messages ?? [];
      const existingPerm = messages.find(
        (m) => m.type === 'permission'
          && m.permissionData?.requestId === msg.request_id
          && m.interactionState !== 'failed'
      );
      if (existingPerm) {
        return;
      }
      chatStore.addMessage(tabId, {
        id: generateMessageId(),
        role: 'assistant',
        type: 'permission',
        content: msg.description || `${msg.tool_name} wants to execute`,
        permissionTool: msg.tool_name,
        permissionDescription: msg.description || '',
        timestamp: Date.now(),
        interactionState: 'pending',
        permissionData: {
          requestId: msg.request_id,
          toolName: msg.tool_name,
          input: msg.input,
          description: msg.description,
          toolUseId: msg.tool_use_id,
        },
      });
      chatStore.setActivityStatus(tabId, { phase: 'awaiting' });
      return;
    }

    const cs = useChatStore.getState();
    const addMessage = (message: ChatMessage) => cs.addMessage(tabId, message);
    const setSessionStatus = (status: import('../stores/chatStore').SessionStatus) => cs.setSessionStatus(tabId, status);
    const setSessionMeta = (meta: Partial<import('../stores/chatStore').SessionMeta>) => cs.setSessionMeta(tabId, meta);
    const setActivityStatus = (status: import('../stores/chatStore').ActivityStatus) => cs.setActivityStatus(tabId, status);
    const agentActions = useAgentStore.getState();
    const agentId = resolveAgentId(msg.parent_tool_use_id, agentActions.agents);
    const agentDepth = getAgentDepth(agentId, agentActions.agents);

    // Capture the CLI's own session ID from stream events (used for --resume)
    const cliSessionId = msg.session_id || msg.sessionId;
    if (cliSessionId) {
      // Write to cliResumeId (the primary resume credential) in sessionStore
      const currentResumeId = useSessionStore.getState().sessions.find((s) => s.id === tabId)?.cliResumeId;
      if (currentResumeId !== cliSessionId) {
        // Also write to sessionMeta.sessionId for backward compat
        setSessionMeta({ sessionId: cliSessionId });
        // Also store in sessionStore for hadRealExchange-guarded resume
        useSessionStore.getState().setCliResumeId(tabId, cliSessionId);
        bridge.trackSession(cliSessionId).catch(() => {});

        // Promote draft tabs to the real CLI session ID so they merge with
        // disk sessions. Non-draft tabs are never physically deleted here:
        // resume evidence, not heuristic deletion, preserves continuity.
        if (tabId.startsWith('draft_')) {
          // Migrate tab data under old key to new real key
          const chatState = useChatStore.getState();
          const tabData = chatState.getTab(tabId);
          if (tabData) {
            const newTabs = new Map(chatState.tabs);
            newTabs.set(cliSessionId, { ...tabData, tabId: cliSessionId });
            newTabs.delete(tabId);
            useChatStore.setState({ tabs: newTabs, sessionCache: newTabs });
          }
          useSessionStore.getState().promoteDraft(tabId, cliSessionId);
          tabId = cliSessionId;
        }

        useSessionStore.getState().fetchSessions();
      }
    }

    // Helper: clear accumulated partial text for THIS tab only.
    // B1: flush must be scoped to msgStdinId — calling flushStreamBuffer() with
    //     no args previously wiped every active session's rAF buffer, causing
    //     cross-tab data loss when one tab's turn completed while another was
    //     streaming. B2: buffer drop happens inside flushStreamBuffer (delete
    //     from _streamBuffers) so no late rAF can repopulate this tab's partial
    //     after we clear it below — flush → clear is atomic w.r.t. this tab.
    const clearPartial = () => {
      if (msgStdinId) flushStreamBuffer(msgStdinId);
      const tabData = useChatStore.getState().getTab(tabId);
      if (tabData && (tabData.isStreaming || tabData.partialText || tabData.partialThinking)) {
        const newTabs = new Map(useChatStore.getState().tabs);
        newTabs.set(tabId, { ...tabData, partialText: '', partialThinking: '', isStreaming: false });
        useChatStore.setState({ tabs: newTabs, sessionCache: newTabs });
      }
    };

    // Ownership guard: verify that the message's stdinId still matches
    // the tab's current stdinId. Stale messages from old processes that
    // arrive after a Provider/Model switch are silently dropped.
    if (msgStdinId) {
      const currentTab = useChatStore.getState().getTab(tabId);
      if (currentTab?.sessionMeta.stdinId && currentTab.sessionMeta.stdinId !== msgStdinId) {
        // Stale message from old process — skip
        return;
      }
    }

    switch (msg.type) {
      // --- stream_event: wrapper for real-time streaming events from --include-partial-messages ---
      case 'stream_event': {
        const evt = msg.event;
        if (!evt) break;

        // Diagnostic: log tool_use starts for debugging plan mode flow
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          console.log('[TOKENICODE:stream] tool_use start:', evt.content_block.name);

          // UX: immediately surface that a tool is running. Without this, the
          // user sees no feedback during long tool input streams (e.g. Write
          // streaming a 2000-word article takes ~50s, during which the
          // ActivityIndicator stays in 'thinking' phase and no card appears).
          // We add a placeholder tool_use card keyed by the content_block.id;
          // when case 'assistant' arrives with the full message, addMessage's
          // id-based dedup will merge the actual toolInput into this card.
          // Skip ExitPlanMode (handled by plan_review path) and Task/Agent/
          // TaskCreate/SendMessage (handled by agent registration below).
          const toolName = evt.content_block.name;
          if (shouldCreateStreamingToolPlaceholder(toolName)) {
            setActivityStatus({ phase: 'tool', toolName });
            agentActions.updatePhase(agentId, 'tool', toolName);
            addMessage({
              id: evt.content_block.id || `tool_placeholder_${Date.now()}`,
              role: 'assistant',
              type: 'tool_use',
              content: '',
              toolName,
              toolInput: {},
              subAgentDepth: agentDepth,
              timestamp: Date.now(),
            });
          }
        }

        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text && msgStdinId) {
            streamController.appendText(msgStdinId, text);
            agentActions.updatePhase(agentId, 'writing');
          }
        } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
          const thinkingText = evt.delta.thinking || '';
          if (thinkingText && msgStdinId) {
            if (shouldRenderThinkingForTab(tabId)) {
              streamController.appendThinking(msgStdinId, thinkingText);
              agentActions.updatePhase(agentId, 'thinking');
            } else {
              streamController.clearThinking(msgStdinId);
              setActivityStatus({ phase: 'writing' });
              agentActions.updatePhase(agentId, 'writing');
            }
          } else {
            setActivityStatus({ phase: shouldRenderThinkingForTab(tabId) ? 'thinking' : 'writing' });
            agentActions.updatePhase(agentId, shouldRenderThinkingForTab(tabId) ? 'thinking' : 'writing');
          }
        }

        // Early agent creation: register sub-agent as soon as Agent/Task tool_use
        // starts streaming, so subsequent events resolve to the correct agent.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && (evt.content_block?.name === 'Task' || evt.content_block?.name === 'Agent')) {
          agentActions.upsertAgent({
            id: evt.content_block.id || `task_${Date.now()}`,
            parentId: agentId,
            description: '',
            phase: 'spawning',
            startTime: Date.now(),
            isMain: false,
          });
        }
        // Agent Team tools (TaskCreate, SendMessage): register as visible agents
        // so the agent panel shows team activity. These run in separate CLI processes
        // so we won't get real-time progress, but visibility is the goal.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && (evt.content_block?.name === 'TaskCreate' || evt.content_block?.name === 'SendMessage')) {
          agentActions.upsertAgent({
            id: evt.content_block.id || `team_${Date.now()}`,
            parentId: agentId,
            description: '',
            phase: 'tool',
            startTime: Date.now(),
            isMain: false,
          });
        }
        // Early detection: create plan_review card ONLY in explicit Plan mode.
        // In Code mode the CLI handles ExitPlanMode natively.
        // In Bypass mode the Rust backend auto-approves — no UI card needed.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode'
            && getEffectiveMode(useChatStore.getState().getTab(tabId)?.sessionMeta) === 'plan') {
          const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);

          // Guard: if plan_review_current already exists and was resolved,
          // this is a replay after plan approval — don't create a new card.
          const existingReview = currentMessages.find((m) => m.id === 'plan_review_current');
          if (!existingReview || !existingReview.resolved) {
            let planContent = '';
            for (let i = currentMessages.length - 1; i >= 0; i--) {
              const m = currentMessages[i];
              if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                planContent = m.toolInput.content;
                break;
              }
            }

            addMessage({
              id: 'plan_review_current',
              role: 'assistant',
              type: 'plan_review',
              content: planContent,
              planContent: planContent,
              resolved: false,
              timestamp: Date.now(),
            });
            setActivityStatus({ phase: 'awaiting' });
          }
        }

        // Track input tokens from message_start (per-turn + cumulative total)
        if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
          const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
          const delta = evt.message.usage.input_tokens;
          setSessionMeta({
            inputTokens: (meta.inputTokens || 0) + delta,
            totalInputTokens: (meta.totalInputTokens || 0) + delta,
          });
        }

        // Track output tokens from message_delta (per-turn + cumulative total)
        if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
          const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
          const delta = evt.usage.output_tokens;
          setSessionMeta({
            outputTokens: (meta.outputTokens || 0) + delta,
            totalOutputTokens: (meta.totalOutputTokens || 0) + delta,
          });
        }
        break;
      }

      case 'system':
        if (msg.subtype === 'init') {
          markStdinReady(tabId, msg.__stdinId, msg.model);
        } else if (msg.subtype === 'error') {
          // FI-3: Surface system-level errors instead of silently dropping them
          const rawError = msg.message || msg.error || 'System error';
          addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: formatErrorForUser(rawError),
            timestamp: Date.now(),
          });
        } else if (msg.subtype === 'api_retry') {
          recordApiRetry(tabId, msg);
        } else if (
          msg.subtype === 'hook_started' ||
          msg.subtype === 'hook_progress' ||
          msg.subtype === 'hook_response' ||
          msg.subtype === 'status'
        ) {
          // Hook lifecycle + status events — silently ignore (no UI for these in TC)
        } else {
          // FI-3: Log unknown subtypes so we know what we're missing
          console.warn('[TOKENICODE] Unhandled system subtype:', msg.subtype, msg);
        }
        break;

      case 'assistant': {
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;

        // With --include-partial-messages, intermediate assistant messages arrive
        // frequently. We must NOT aggressively wipe streaming text state when the
        // message only contains a thinking block (no text block yet).
        const hasTextBlock = content.some((b: any) => b.type === 'text' && b.text);
        const hasAskUserQuestion = content.some(
          (b: any) => b.type === 'tool_use' && b.name === 'AskUserQuestion',
        );
        const shouldRenderThinking = shouldRenderThinkingForTab(tabId);
        const isPureThinkingOnly = shouldRenderThinking && isPureThinkingOnlySnapshot(content);
        const shouldMaterializeThinking = shouldRenderThinking
          && shouldMaterializeThinkingSnapshot(content, hasTextBlock);
        const currentTab = useChatStore.getState().getTab(tabId);
        const bufferedThinking = msgStdinId
          ? streamController.peekBufferedThinking(msgStdinId)
          : undefined;
        const thinkingPersistence = shouldRenderThinking
          ? resolveThinkingPersistence(
            msg.uuid,
            content,
            currentTab?.partialThinking,
            bufferedThinking,
          )
          : null;
        if (!shouldMaterializeThinking && isPureThinkingOnly && thinkingPersistence) {
          preserveLiveThinkingSnapshot({
            tabId,
            thinkingPersistence,
            stdinId: msgStdinId,
          });
        }
        const committedThinkingBeforeText = hasTextBlock
          ? commitThinkingBeforeAssistantText({
            tabId,
            msgUuid: msg.uuid,
            thinkingPersistence,
            timestamp: Date.now(),
            subAgentDepth: agentDepth,
            stdinId: msgStdinId,
          })
          : false;

        if (hasTextBlock) {
          // Full clear — the text block supersedes streaming partial text
          clearPartial();
        } else if (hasAskUserQuestion) {
          clearLivePartialText(tabId, msgStdinId);
        }

        // If there's a pending slash command processing card, mark it as
        // completed now — the assistant response means the CLI has responded.
        // Some commands (e.g. /compact) may not emit a 'result' event.
        const pendingCmd = useChatStore.getState().getTab(tabId)?.sessionMeta.pendingCommandMsgId;
        if (pendingCmd) {
          useChatStore.getState().updateMessage(tabId, pendingCmd, {
            commandCompleted: true,
            commandData: {
              ...(useChatStore.getState().getTab(tabId)?.messages ?? []).find((m) => m.id === pendingCmd)?.commandData,
              completedAt: Date.now(),
            },
          });
          useChatStore.getState().setSessionMeta(tabId, { pendingCommandMsgId: undefined });
        }

        // If this message contains AskUserQuestion, skip text blocks —
        // the interactive question UI makes them redundant and avoids
        // showing raw question descriptions alongside the rich UI.
        let thinkingMessageEmitted = committedThinkingBeforeText;

        for (let blockIdx = 0; blockIdx < content.length; blockIdx++) {
          const block = content[blockIdx];
          if (block.type === 'text') {
            if (hasAskUserQuestion) continue;
            setActivityStatus({ phase: 'writing' });
            agentActions.updatePhase(agentId, 'writing');
            // Use msg.uuid + block index as stable ID so re-delivered
            // messages de-duplicate correctly in the store.
            const textId = msg.uuid ? `${msg.uuid}_text_${blockIdx}` : generateMessageId();
            addMessage({
              id: textId,
              role: 'assistant',
              type: 'text',
              content: block.text,
              subAgentDepth: agentDepth,
              timestamp: Date.now(),
            });
          } else if (block.type === 'tool_use') {
            // Code mode: EnterPlanMode/ExitPlanMode are transparent — CLI handles internally.
            // Don't show tool cards; track ExitPlanMode for auto-restart if CLI exits.
            if (getEffectiveMode(useChatStore.getState().getTab(tabId)?.sessionMeta) === 'code'
                && (block.name === 'EnterPlanMode' || block.name === 'ExitPlanMode')) {
              if (block.name === 'ExitPlanMode') exitPlanModeSeenRef.current = true;
              continue;
            }
            setActivityStatus({ phase: 'tool', toolName: block.name });
            if (block.name === 'Task' || block.name === 'Agent') {
              agentActions.upsertAgent({
                id: block.id || generateMessageId(),
                parentId: agentId,
                description: block.input?.description || block.input?.prompt || '',
                phase: 'spawning',
                startTime: Date.now(),
                isMain: false,
              });
            } else if (block.name === 'TaskCreate' || block.name === 'SendMessage') {
              // Agent Team tasks/messages: register as visible agents in the tree.
              // These run in separate CLI processes so we won't get progress events,
              // but showing them makes the team activity visible in the agent panel.
              agentActions.upsertAgent({
                id: block.id || `team_${Date.now()}`,
                parentId: agentId,
                description: block.input?.subject || block.input?.description || block.input?.recipient || '',
                phase: 'tool',
                startTime: Date.now(),
                isMain: false,
              });
            } else {
              agentActions.updatePhase(agentId, 'tool', block.name);
            }

            if (block.name === 'AskUserQuestion') {
              // Use a stable sentinel ID so re-delivered blocks de-duplicate
              // instead of creating duplicate question cards (TK-103).
              const questionId = block.id || 'ask_question_current';

              // Guard: skip if question already exists (resolved or not).
              // Search by exact ID first, then by any AskUserQuestion card —
              // the control_request handler may have already created one with
              // a different ID (e.g. 'ask_question_current' vs 'toolu_01abc').
              const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);
              const existingQuestion = currentMessages.find(
                (m) => m.id === questionId && m.type === 'question',
              ) || currentMessages.find(
                (m) => m.type === 'question' && !m.resolved && m.toolName === 'AskUserQuestion',
              );
              if (existingQuestion) {
                // Already exists — just ensure awaiting state if unresolved
                if (!existingQuestion.resolved) {
                  setActivityStatus({ phase: 'awaiting' });
                }
                break;
              }

              const questions = block.input?.questions;
              const fgOwnerStdinId = (msg.__stdinId as string | undefined)
                ?? useChatStore.getState().getTab(tabId)?.sessionMeta.stdinId;
              addMessage({
                id: questionId,
                role: 'assistant',
                type: 'question',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                questions: Array.isArray(questions) ? questions : [],
                resolved: false,
                subAgentDepth: agentDepth,
                timestamp: Date.now(),
                owner: fgOwnerStdinId ? { tabId, stdinId: fgOwnerStdinId } : undefined,
              });
              // Mark as awaiting user input (consistent with ExitPlanMode)
              setActivityStatus({ phase: 'awaiting' });
            } else if (block.name === 'TodoWrite' && block.input?.todos) {
              addMessage({
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'todo',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                todoItems: block.input.todos,
                subAgentDepth: agentDepth,
                timestamp: Date.now(),
              });
            } else if (block.name === 'ExitPlanMode') {
              // Show ExitPlanMode as a collapsible tool_use (like other tools)
              addMessage({
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'tool_use',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                subAgentDepth: agentDepth,
                timestamp: Date.now(),
              });

              // Only create plan_review card in Plan mode.
              // In Code mode the CLI handles ExitPlanMode natively.
              // In Bypass mode the Rust backend auto-approves — no UI card needed.
              if (getEffectiveMode(useChatStore.getState().getTab(tabId)?.sessionMeta) === 'plan') {
                const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);

                // Guard: skip if already approved (replay)
                const toolAlreadyExisted = block.id && currentMessages.some(
                  (m) => m.id === block.id && m.toolName === 'ExitPlanMode',
                );
                const existingReview = currentMessages.find(
                  (m) => m.type === 'plan_review' && m.resolved,
                );
                if (!(toolAlreadyExisted && existingReview)) {
                  let planContent = '';
                  for (let i = currentMessages.length - 1; i >= 0; i--) {
                    const m = currentMessages[i];
                    if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                      planContent = m.toolInput.content;
                      break;
                    }
                  }

                  addMessage({
                    id: 'plan_review_current',
                    role: 'assistant',
                    type: 'plan_review',
                    content: planContent,
                    planContent: planContent,
                    resolved: false,
                    timestamp: Date.now(),
                  });
                  setActivityStatus({ phase: 'awaiting' });
                }
              }
            } else {
              addMessage({
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'tool_use',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                subAgentDepth: agentDepth,
                timestamp: Date.now(),
              });

            }
          } else if (block.type === 'thinking') {
            if (!shouldRenderThinking) continue;
            // Complete thinking block arrived — clear streaming thinking text.
            // DON'T override activityStatus here: if text is currently streaming,
            // the phase should remain 'writing'. The streaming events (thinking_delta,
            // text_delta) are the source of truth for activity phase.
            if (thinkingMessageEmitted) continue;
            agentActions.updatePhase(agentId, 'thinking');
            if (shouldMaterializeThinking && thinkingPersistence) {
              thinkingMessageEmitted = commitThinkingBeforeAssistantText({
                tabId,
                msgUuid: msg.uuid,
                thinkingPersistence,
                timestamp: Date.now(),
                subAgentDepth: agentDepth,
                stdinId: msgStdinId,
              });
            }
          }
        }
        if (shouldMaterializeThinking && thinkingPersistence && !thinkingMessageEmitted) {
          commitThinkingBeforeAssistantText({
            tabId,
            msgUuid: msg.uuid,
            thinkingPersistence,
            timestamp: Date.now(),
            subAgentDepth: agentDepth,
            stdinId: msgStdinId,
          });
        }

        // NOTE: No save/restore hack needed here. addMessage no longer clears
        // partialText/isStreaming as a side effect (TK-322 fix), so intermediate
        // assistant messages with only thinking/tool_use blocks won't wipe
        // streaming text state.
        break;
      }

      case 'user':
      case 'human': {
        // Store CLI checkpoint UUID on the most recent user message (for rewind).
        // Only store from genuine user-input messages, NOT tool-result messages.
        // Tool-result user messages have content with tool_result blocks and their
        // UUIDs don't match the file-history-snapshot messageId used by --rewind-files.
        {
          const content = msg.message?.content;
          const isToolResult = Array.isArray(content)
            && content.some((b: any) => b.type === 'tool_result');
          if (msg.uuid && !isToolResult) {
            const allMsgs = useChatStore.getState().getTab(tabId)?.messages ?? [];
            for (let i = allMsgs.length - 1; i >= 0; i--) {
              if (allMsgs[i].role === 'user') {
                console.log('[stream] Storing checkpointUuid:', msg.uuid, 'on msg:', allMsgs[i].id);
                useChatStore.getState().updateMessage(tabId, allMsgs[i].id, { checkpointUuid: msg.uuid });
                break;
              }
            }
          }
        }

        const userContent = msg.message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === 'tool_result') {
              const resultText = Array.isArray(block.content)
                ? block.content.map((b: any) => typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '').join('')
                : typeof block.content === 'string'
                  ? block.content
                  : '';
              const targetId = resolveToolResultTargetMessageId(
                useChatStore.getState().getTab(tabId)?.messages ?? [],
                block.tool_use_id,
                undefined,
              );
              if (targetId) {
                useChatStore.getState().updateMessage(tabId, targetId, {
                  toolCompleted: true,
                  ...(resultText ? { toolResultContent: resultText } : {}),
                });
              }
            }
          }
        }
        if (msg.tool_use_result) {
          const tur = msg.tool_use_result;
          const resultText = typeof tur === 'string' ? tur
            : typeof tur.stdout === 'string' ? tur.stdout
            : typeof tur.content === 'string' ? tur.content
            : Array.isArray(tur.content) ? tur.content.map((b: any) => typeof b.text === 'string' ? b.text : '').join('')
            : typeof tur.content === 'object' && tur.content?.text ? String(tur.content.text)
            : '';
          if (Array.isArray(userContent)) {
            for (const block of userContent) {
              const targetId = resolveToolResultTargetMessageId(
                useChatStore.getState().getTab(tabId)?.messages ?? [],
                block.tool_use_id,
                undefined,
              );
              if (targetId) {
                useChatStore.getState().updateMessage(tabId, targetId, {
                  toolCompleted: true,
                  ...(resultText ? { toolResultContent: resultText } : {}),
                });
              }
            }
          }
        }
        break;
      }

      case 'tool_result': {
        const resultContent = Array.isArray(msg.content)
          ? msg.content.map((b: any) => typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '').join('')
          : typeof msg.content === 'string'
            ? msg.content
            : msg.output || '';

        const toolUseId = msg.tool_use_id;
        // Auto-refresh file tree when file-mutating tools complete
        _maybeRefreshFileTree(tabId, toolUseId, msg.tool_name);
        const targetId = resolveToolResultTargetMessageId(
          useChatStore.getState().getTab(tabId)?.messages ?? [],
          toolUseId,
          msg.tool_name,
        );

        if (targetId) {
          const currentMessages = useChatStore.getState().getTab(tabId)?.messages ?? [];
          const parentMsg = currentMessages.find((m) => m.id === targetId);
          if (parentMsg) {
            const updates: Partial<ChatMessage> = {
              toolCompleted: true,
              ...(resultContent ? { toolResultContent: resultContent } : {}),
            };

            // Backfill: if parent is AskUserQuestion created with empty questions
            // (due to streaming), or was mis-typed as tool_use, fix it now.
            if (parentMsg.toolName === 'AskUserQuestion') {
              if (parentMsg.type !== 'question') {
                updates.type = 'question';
                updates.resolved = false;
              }
              if (!parentMsg.questions || parentMsg.questions.length === 0) {
                // Try to extract questions from toolInput (may have been populated
                // by a later assistant message with complete content)
                const qs = parentMsg.toolInput?.questions;
                if (Array.isArray(qs) && qs.length > 0) {
                  updates.questions = qs;
                }
              }
            }

            useChatStore.getState().updateMessage(tabId, targetId, updates);
            break;
          }
        }
        // Complete Agent Team agents when their tool result arrives
        if (toolUseId && agentActions.agents.has(toolUseId)) {
          agentActions.completeAgent(toolUseId, 'completed');
        }
        addMessage({
          id: msg.uuid || generateMessageId(),
          role: 'assistant',
          type: 'tool_result',
          content: resultContent,
          toolName: msg.tool_name,
          subAgentDepth: agentDepth,
          timestamp: Date.now(),
        });
        break;
      }

      case 'tool_use_summary':
        break;

      case 'result': {
        // Capture stopping state BEFORE any status updates — needed for drain guard later
        const fgResultTab = useChatStore.getState().getTab(tabId);
        const fgWasStopping = fgResultTab?.sessionStatus === 'stopping';
        const fgFinalizedRoute = msgStdinId ? getRecentlyFinalizedStdin(msgStdinId) : undefined;
        const fgErrorText = [msg.result, msg.error, msg.content]
          .filter(Boolean)
          .map(String)
          .join(' ')
          .trim();
        const fgIsUserStopResult = msg.subtype !== 'success'
          && (
            fgWasStopping
            || fgResultTab?.sessionMeta.teardownReason === 'stop'
            || fgFinalizedRoute?.reason === 'stop'
            || msg.subtype === 'user_abort'
          );

        // Sub-agent results carry parent_tool_use_id — they must NOT terminate the
        // main session. Only the main agent's result (no parent_tool_use_id) ends the
        // session. Without this guard, the first parallel sub-agent to complete would
        // call setSessionStatus('completed') and freeze the UI mid-run.
        if (msg.parent_tool_use_id) {
          agentActions.completeAgent(
            resolveAgentId(msg.parent_tool_use_id, agentActions.agents),
            msg.subtype === 'success' ? 'completed' : 'error',
          );
          break;
        }

        if (fgIsUserStopResult) {
          if (msgStdinId && fgWasStopping) {
            handleProcessExitFinalize(msgStdinId);
          } else {
            setSessionStatus('stopped');
            setSessionMeta({
              stdinReady: false,
              pendingReadyMessage: undefined,
              turnStartTime: undefined,
              lastProgressAt: undefined,
              apiRetry: undefined,
            });
          }
          agentActions.completeAll('error');
          useSessionStore.getState().fetchSessions();
          break;
        }

        commitThinkingAtTurnBoundary({
          tabId,
          msgUuid: msg.uuid,
          timestamp: Date.now(),
          subAgentDepth: agentDepth,
          stdinId: msgStdinId,
        });

        // Clear any remaining partial text before marking turn complete
        clearPartial();

        // --- TK-303: Auto-retry on thinking signature error after provider/model switch ---
        // When user switches API provider or model mid-conversation, we attempt to resume
        // the session. If the new provider/model rejects the old thinking block signatures,
        // we automatically retry without resume to preserve UX continuity.
        if (msg.subtype !== 'success') {
          const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
          // Build a combined error string from all possible error fields
          const errorText = fgErrorText;
          const isThinkingSignatureError = /invalid.*signature.*thinking|thinking.*invalid.*signature/i.test(errorText);

          const switchedFlag = meta.providerSwitched || meta.modelSwitched;
          const pendingText = meta.providerSwitchPendingText || meta.modelSwitchPendingText;
          // Find last user message as fallback retry text when no pendingText is set
          const lastUserMsg = !pendingText
            ? [...(useChatStore.getState().getTab(tabId)?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content
            : undefined;
          const retryCandidate = pendingText || (typeof lastUserMsg === 'string' ? lastUserMsg : undefined);
          if (isThinkingSignatureError && retryCandidate) {
            const switchType = switchedFlag ? (meta.modelSwitched ? '模型' : 'API 提供商') : '会话';
            console.warn(`[TOKENICODE] Thinking signature error after ${switchType} switch — auto-retrying without resume`);
            const retryText = retryCandidate;

            // Kill the current (failed) process + clean up listeners via lifecycle module
            const failedStdinId = meta.stdinId;
            if (failedStdinId) {
              bridge.killSession(failedStdinId).catch(() => {});
              cleanupStdinRoute(failedStdinId);
            }

            // Clear sessionId (abandon resume) and switch flags
            setSessionMeta({
              sessionId: undefined,
              stdinId: undefined,
              stdinReady: false,
              pendingReadyMessage: undefined,
              providerSwitched: false,
              providerSwitchPendingText: undefined,
              modelSwitched: false,
              modelSwitchPendingText: undefined,
            });
            // Also clear cliResumeId in sessionStore
            // NEW-F fix: use owning tabId from stdinToTab mapping, NOT selectedSessionId
            const retryTabId = tabId;
            useSessionStore.getState().setCliResumeId(retryTabId, null);

            // Show system notice
            addMessage({
              id: generateMessageId(),
              role: 'system',
              type: 'text',
              content: `已切换${switchType}，正在重新发送…`,
              commandType: 'info',
              timestamp: Date.now(),
            });

            // Re-send: spawn a fresh process without resume_session_id
            // Use lifecycle module — ensures proper stdinTab registration,
            // listener setup, rollback on failure, and ownership tracking.
            (async () => {
              const retryId = `desk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              try {
                const cwd = useSettingsStore.getState().workingDirectory;
                if (!cwd) return;
                const selectedModel = useSettingsStore.getState().selectedModel;
                const sessionMode = useSettingsStore.getState().sessionMode;
                const model = resolveModelForProvider(selectedModel);
                const providerId = useProviderStore.getState().activeProviderId || '';
                const permissionMode = mapSessionModeToPermissionMode(sessionMode);

                setSessionStatus('running');
                setSessionMeta({
                  turnStartTime: undefined,
                  lastProgressAt: undefined,
                  apiRetry: undefined,
                  inputTokens: 0,
                  outputTokens: 0,
                  stdinReady: false,
                  pendingReadyMessage: undefined,
                });
                setActivityStatus({ phase: 'idle' });
                agentActions.clearAgents();
                agentActions.upsertAgent({
                  id: 'main', parentId: null,
                  description: retryText.slice(0, 100),
                  phase: 'spawning', startTime: Date.now(), isMain: true,
                });

                // Phase 2 §2.1: capture spawn-time values BEFORE async spawn
                // to avoid race with user config changes during the spawn window.
                const preEnvFingerprint = envFingerprint();
                const preSpawnConfigHash = spawnConfigHash();

                // NEW-F fix: use owning tabId (retryTabId), not selectedSessionId
                const spawnResult = await spawnSession({
                  tabId: retryTabId,
                  stdinId: retryId,
                  cwdSnapshot: cwd,
                  configSnapshot: {
                    model,
                    providerId,
                    thinkingLevel: useSettingsStore.getState().thinkingLevel,
                    permissionMode,
                  },
                  sessionModeSnapshot: sessionMode,
                  sessionParams: {
                    prompt: retryText,
                    cwd,
                    model,
                    session_id: retryId,
                    // No resume_session_id — fresh start to avoid thinking signature issue
                    thinking_level: useSettingsStore.getState().thinkingLevel,
                    session_mode: (sessionMode === 'ask' || sessionMode === 'plan') ? sessionMode : undefined,
                    provider_id: providerId || undefined,
                    permission_mode: permissionMode,
                  },
                  onStream: handleStreamMessage,
                  onStderr: (line: string) => handleStderrLineRef.current(line, retryId),
                });

                setSessionMeta({
                  sessionId: spawnResult.sessionInfo.cli_session_id ?? undefined,
                  envFingerprint: preEnvFingerprint,
                  spawnedModel: model,
                  spawnConfigHash: preSpawnConfigHash,
                  stdinReady: false,
                  pendingReadyMessage: undefined,
                });
              } catch (retryErr) {
                console.error('[TOKENICODE] Provider-switch auto-retry failed:', retryErr);
                // spawnSession handles its own rollback — no manual listener cleanup needed
                setSessionStatus('error');
                addMessage({
                  id: generateMessageId(),
                  role: 'system', type: 'text',
                  content: `重试失败: ${retryErr}`,
                  timestamp: Date.now(),
                });
              }
            })();
            break; // Exit the result case — retry flow takes over
          }
        }

        // Code mode: Auto-restart when ExitPlanMode caused CLI exit.
        // In stream-json mode, ExitPlanMode is treated as a permission denial,
        // causing the CLI to exit. Silently restart with --resume to continue.
        if (exitPlanModeSeenRef.current && getEffectiveMode(useChatStore.getState().getTab(tabId)?.sessionMeta) === 'code'
            && msg.subtype !== 'success') {
          exitPlanModeSeenRef.current = false;
          console.log('[TOKENICODE] Code mode ExitPlanMode exit detected — auto-restarting with --resume');
          const oldStdinId = useChatStore.getState().getTab(tabId)?.sessionMeta.stdinId;
          void (async () => {
            if (oldStdinId) {
              try {
                await teardownSession(oldStdinId, tabId, 'plan-approve');
                await waitForStdinCleared(tabId, oldStdinId);
              } catch (err) {
                console.warn('[TOKENICODE] ExitPlanMode auto-restart teardown failed:', err);
                return;
              }
            }
            // Silently restart — no user message bubble
            silentRestartRef.current = true;
            setInputSync('Continue.');
            useChatStore.getState().setActivityStatus(tabId, { phase: 'thinking' });
            requestAnimationFrame(() => handleSubmitRef.current());
          })();
          break;
        }
        exitPlanModeSeenRef.current = false;

        // Mark pending processing card (CLI slash command) as completed
        const pendingCmdMsgId = useChatStore.getState().getTab(tabId)?.sessionMeta.pendingCommandMsgId;
        if (pendingCmdMsgId) {
          const resultOutput = typeof msg.result === 'string' ? msg.result : '';
          useChatStore.getState().updateMessage(tabId, pendingCmdMsgId, {
            commandCompleted: true,
            commandData: {
              ...(useChatStore.getState().getTab(tabId)?.messages ?? []).find((m) => m.id === pendingCmdMsgId)?.commandData,
              output: resultOutput,
              completedAt: Date.now(),
            },
          });
          useChatStore.getState().setSessionMeta(tabId, { pendingCommandMsgId: undefined });
        }

        // Extract result text for display (e.g., slash command output)
        let resultDisplayText = '';
        if (typeof msg.result === 'string' && msg.result) {
          resultDisplayText = msg.result;
        } else if (typeof msg.content === 'string' && msg.content) {
          resultDisplayText = msg.content;
        }

        // If we have cost metadata AND a pending slash command (e.g., /compact, /cost),
        // inject cost summary into the processing card instead of creating a separate message.
        if (msg.total_cost_usd != null && pendingCmdMsgId) {
          const cost = msg.total_cost_usd?.toFixed(4) ?? '—';
          const duration = msg.duration_ms
            ? `${(msg.duration_ms / 1000).toFixed(1)}s`
            : '—';
          const turns = msg.num_turns ?? '—';
          const input = msg.usage?.input_tokens
            ? msg.usage.input_tokens.toLocaleString()
            : '';
          const output = msg.usage?.output_tokens
            ? msg.usage.output_tokens.toLocaleString()
            : '';
          const cmdMsg = (useChatStore.getState().getTab(tabId)?.messages ?? []).find((m) => m.id === pendingCmdMsgId);
          if (cmdMsg) {
            useChatStore.getState().updateMessage(tabId, pendingCmdMsgId, {
              commandData: {
                ...cmdMsg.commandData,
                costSummary: { cost, duration, turns, input, output },
              },
            });
          }
          // If there's also explicit result text, still add it as a message
          if (!resultDisplayText) resultDisplayText = '';
        }

        // Only add result text if it wasn't already delivered via an
        // 'assistant' event (which is the normal case for stream-json output)
        // AND there's no pending command card (which already displays the output).
        // S18: CLI-internal placeholders (e.g. "No response requested.") must
        // not surface to the user.
        if (resultDisplayText && !pendingCmdMsgId && !isCliPlaceholder(resultDisplayText)) {
          const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);
          const isDuplicate = currentMessages.some(
            (m) => m.role === 'assistant' && m.type === 'text'
              && m.content === resultDisplayText,
          );
          if (!isDuplicate) {
            addMessage({
              id: msg.uuid || generateMessageId(),
              role: 'assistant',
              type: 'text',
              content: resultDisplayText,
              subAgentDepth: agentDepth,
              timestamp: Date.now(),
            });
          }
        }

        setSessionStatus(
          msg.subtype === 'success' ? 'completed' : 'error'
        );

        // S11 (v3 §4.2): surface a visible error when the turn failed mid-way
        // (e.g. network drop, 500 from provider). Previously this was gated
        // behind `!hasAssistantReply`, so errors that arrived after partial
        // output were silently swallowed. Now we always annotate on failure,
        // with a de-dup guard so the retry/Stop paths don't double-post.
        if (msg.subtype !== 'success') {
          const errorText = fgErrorText;
          const isUserStop = /user[_ ]abort|interrupt|abort/i.test(errorText)
            || msg.subtype === 'user_abort'
            || fgWasStopping;
          const msgs = useChatStore.getState().getTab(tabId)?.messages ?? [];
          const lastMsg = msgs[msgs.length - 1];
          const duplicate = lastMsg?.role === 'system'
            && (lastMsg.content === errorText || lastMsg.commandType === 'error');
          if (!duplicate) {
            addMessage({
              id: generateMessageId(),
              role: 'system',
              type: 'text',
              content: isUserStop
                ? (t('error.userStopped') ?? '已手动停止')
                : formatErrorForUser(errorText || (t('error.turnFailed') ?? 'AI 响应异常中断')),
              commandType: 'error',
              timestamp: Date.now(),
            });
          }
        }

        {
          // Correct cumulative totals for any drift between streaming
          // accumulation and the authoritative result values.
          const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
          const resultInput = msg.usage?.input_tokens || 0;
          const resultOutput = msg.usage?.output_tokens || 0;
          const streamedInput = meta.inputTokens || 0;
          const streamedOutput = meta.outputTokens || 0;
          setSessionMeta({
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
            turns: msg.num_turns,
            inputTokens: resultInput,
            outputTokens: resultOutput,
            totalInputTokens: (meta.totalInputTokens || 0) + (resultInput - streamedInput),
            totalOutputTokens: (meta.totalOutputTokens || 0) + (resultOutput - streamedOutput),
            turnStartTime: undefined,
            lastProgressAt: undefined,
            apiRetry: undefined,
          });
        }
        agentActions.completeAll(
          msg.subtype === 'success' ? 'completed' : 'error'
        );
        useSessionStore.getState().fetchSessions();
        setTimeout(() => useSessionStore.getState().fetchSessions(), 1000);

        // --- AI Title Generation (TK-001): on 3rd successful turn, generate a title ---
        if (msg.subtype === 'success') {
          const fallbackSessionId = useChatStore.getState().getTab(tabId)?.sessionMeta.sessionId;
          const sessionId = useSessionStore.getState().sessions.find((s) => s.id === tabId)?.cliResumeId
            ?? (fallbackSessionId && !fallbackSessionId.startsWith('desk_') ? fallbackSessionId : undefined);
          if (sessionId) {
            const customPreviews = useSessionStore.getState().customPreviews;
            if (!customPreviews[sessionId]) {
              const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);
              const userTextMsgs = currentMessages.filter(
                (m) => m.role === 'user' && m.type === 'text' && m.content,
              );
              if (userTextMsgs.length >= 3) {
                const assistantTextMsgs = currentMessages.filter(
                  (m) => m.role === 'assistant' && m.type === 'text' && m.content,
                );
                if (assistantTextMsgs.length >= 3) {
                  const userMsg = userTextMsgs.map((m) => m.content).join('\n').slice(0, 500);
                  const assistantMsg = assistantTextMsgs.map((m) => m.content).join('\n').slice(0, 500);
                  bridge.generateSessionTitle(userMsg, assistantMsg, useProviderStore.getState().activeProviderId || undefined)
                    .then((title) => {
                      if (title) {
                        useSessionStore.getState().setCustomPreview(sessionId, title);
                      }
                    })
                    .catch((e) => {
                      if (!String(e).includes('SKIP:')) console.warn('Title gen failed:', e);
                    });
                }
              }
            }
          }
        }

        // --- Auto-compact: when input tokens exceed 80% of context window,
        // automatically send /compact to prevent context overflow on the next turn.
        // Fires at most once per session to avoid infinite loops.
        // Threshold is model-aware: 160K for 200K models, 800K for 1M models.
        const resultInputTokens = msg.usage?.input_tokens || 0;
        const compactStdinId = useChatStore.getState().getTab(tabId)?.sessionMeta.stdinId;
        const fgCompactThreshold = getAutoCompactThreshold(useChatStore.getState().getTab(tabId)?.sessionMeta.spawnedModel);
        if (resultInputTokens > fgCompactThreshold && !hasAutoCompactFired(tabId) && compactStdinId && msg.subtype === 'success') {
          markAutoCompactFired(tabId);
          console.log('[TOKENICODE] Auto-compact triggered: inputTokens =', resultInputTokens);
          const compactMsgId = generateMessageId();
          addMessage({
            id: compactMsgId,
            role: 'system',
            type: 'text',
            content: t('chat.autoCompacting'),
            commandType: 'processing',
            commandData: { command: '/compact' },
            commandStartTime: Date.now(),
            commandCompleted: false,
            timestamp: Date.now(),
          });
          // FI-4: Register pendingCommandMsgId so result handler can mark it completed
          setSessionMeta({ pendingCommandMsgId: compactMsgId });
          setSessionStatus('running');
          setActivityStatus({ phase: 'thinking' });
          bridge.sendStdin(compactStdinId, '/compact').catch((err) => {
            console.error('[TOKENICODE] Auto-compact failed:', err);
          });
          // FI-4: Timeout fallback — if compact doesn't complete within 90s, auto-complete
          setTimeout(() => {
            const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
            if (meta.pendingCommandMsgId === compactMsgId) {
              useChatStore.getState().updateMessage(tabId, compactMsgId, {
                commandCompleted: true,
                commandData: {
                  ...(useChatStore.getState().getTab(tabId)?.messages ?? []).find((m) => m.id === compactMsgId)?.commandData,
                  output: 'Compact timed out',
                  completedAt: Date.now(),
                },
              });
              useChatStore.getState().setSessionMeta(tabId, { pendingCommandMsgId: undefined });
              if (useChatStore.getState().getTab(tabId)?.sessionStatus === 'running') {
                useChatStore.getState().setSessionStatus(tabId, 'idle');
              }
            }
          }, 15_000); // Bug C fix (#27): reduced from 90s to 15s
          break; // Skip pending message flush — compact takes priority
        }

        // BATCH drain: combine ALL pending messages into a single user turn
        // and send at once. The user's mental model is "I'm adding more
        // context to the current task" — sending them one-by-one would
        // make the AI handle each separately, which is rarely what the
        // user wants. Combine them so the AI processes everything in one go.
        // Decision 5: stopping state blocks drain pending.
        // Use fgWasStopping (captured at result case entry) because setSessionStatus
        // on line ~1751 already changed the status to completed/error.
        {
          const drainTab = useChatStore.getState().getTab(tabId);
          const allPending = drainTab?.pendingUserMessages ?? [];
          const flushStdinId = drainTab?.sessionMeta.stdinId;
          if (allPending.length > 0 && flushStdinId && !fgWasStopping) {
            // Phase 2 §6: verify queued config hashes still match current before sending.
            const currentHash = spawnConfigHash();
            const hashMismatch = allPending.some(
              (p) => p.enqueueConfigHash !== undefined && p.enqueueConfigHash !== currentHash,
            );
            // Also detect stdinId drift: if the process was restarted since
            // enqueue, the stdinId will differ and the queued text should not
            // be sent to the new process.
            const stdinMismatch = allPending.some(
              (p) => p.enqueueStdinId !== undefined && p.enqueueStdinId !== flushStdinId,
            );
            if (hashMismatch || stdinMismatch) {
              const draftBeforeRestore = useChatStore.getState().getTab(tabId)?.inputDraft ?? '';
              const attachmentsBeforeRestore = useChatStore.getState().getTab(tabId)?.pendingAttachments ?? [];
              const prefixBeforeRestore = useCommandStore.getState().activePrefix;
              useChatStore.getState().restorePendingQueueToDraft(tabId);
              const restoredDraft = useChatStore.getState().getTab(tabId)?.inputDraft ?? '';
              if (useSessionStore.getState().selectedSessionId === tabId) {
                setInputSync(restoredDraft);
                if (
                  draftBeforeRestore.trim().length === 0
                  && attachmentsBeforeRestore.length === 0
                  && !prefixBeforeRestore
                  && restoredDraft.trim().length > 0
                ) {
                  requestAnimationFrame(() => handleSubmitRef.current());
                }
              }
              console.warn('[TC] Config changed mid-queue — pending messages retried under current config');
            } else {
              const nextMsg = allPending.map((p) => p.text).join('\n\n');
              useChatStore.getState().clearPendingMessages(tabId);
              const pendingTurnMessageId = generateMessageId();

              // Add as a single user message — InputBar deliberately did NOT
              // addMessage when enqueueing, because ChatPanel renders pending
              // messages after the streaming bubble. Now they merge into one turn.
              addMessage({
                id: pendingTurnMessageId,
                role: 'user',
                type: 'text',
                content: nextMsg,
                timestamp: Date.now(),
              });
              const nextTurnStartedAt = Date.now();
              setSessionStatus('running');
              setSessionMeta({
                turnStartTime: nextTurnStartedAt,
                lastProgressAt: nextTurnStartedAt,
                inputTokens: 0,
                outputTokens: 0,
                teardownReason: undefined,
                pendingTurnMessageId,
                pendingTurnInput: nextMsg,
                pendingTurnAttachments: undefined,
              });
              setActivityStatus({ phase: 'thinking' });
              agentActions.clearAgents();
              agentActions.upsertAgent({
                id: 'main',
                parentId: null,
                description: nextMsg.slice(0, 100),
                phase: 'spawning',
                startTime: Date.now(),
                isMain: true,
              });
              bridge.sendStdin(flushStdinId, nextMsg).catch((err) => {
                console.error('[TC] Failed to send pending messages:', err);
                const draft = useChatStore.getState().getTab(tabId)?.inputDraft ?? '';
                useChatStore.getState().setInputDraft(tabId, draft ? `${draft}\n\n${nextMsg}` : nextMsg);
                cleanupStdinRoute(flushStdinId);
                useChatStore.getState().setSessionMeta(tabId, {
                  stdinId: undefined,
                  stdinReady: false,
                  pendingReadyMessage: undefined,
                });
                setSessionStatus('error');
              });
            }
          }
        }

        break;
      }

      case 'rate_limit_event': {
        const rli = msg.rate_limit_info;
        if (rli && rli.rateLimitType) {
          const prev = useChatStore.getState().getTab(tabId)?.sessionMeta.rateLimits || {};
          setSessionMeta({
            rateLimits: {
              ...prev,
              [rli.rateLimitType]: {
                rateLimitType: rli.rateLimitType,
                resetsAt: rli.resetsAt,
                isUsingOverage: rli.isUsingOverage,
                overageStatus: rli.overageStatus,
                overageDisabledReason: rli.overageDisabledReason,
              },
            },
          });
        }
        break;
      }

      case 'process_exit': {
        const exitingStdinId = msg.__stdinId;
        console.log('[TOKENICODE:session] process_exit received', { stdinId: exitingStdinId });

        // Ownership guard: verify this exit belongs to the current tab
        if (exitingStdinId) {
          const ownership = checkOwnership(exitingStdinId);
          if (!ownership.valid) {
            // Stale exit from old process — drop any leftover route and listeners
            cleanupStdinRoute(exitingStdinId);
            break;
          }
        }

        // If the session was running and no assistant messages were received,
        // the process failed at startup. Show the last stderr error.
        const exitTabData = useChatStore.getState().getTab(tabId);
        const exitStatus = exitTabData?.sessionStatus;
        if (exitStatus === 'running') {
          const exitMsgs = exitTabData?.messages ?? [];
          const hasAssistantReply = exitMsgs.some(
            (m: ChatMessage) => m.role === 'assistant' && (m.type === 'text' || m.type === 'tool_use'),
          );
          if (!hasAssistantReply) {
            if (lastStderrRef.current) {
              const stderr = lastStderrRef.current;
              const isTccError = /unexpected|operation not permitted|permission denied/i.test(stderr);
              const cwd = useSettingsStore.getState().workingDirectory || '';
              const isProtectedDir = /\/(Desktop|Downloads|Documents)\//i.test(cwd);
              const hint = isTccError && isProtectedDir
                ? '\n\n此目录可能受 macOS 隐私保护限制。请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中授权，或选择其他目录。'
                : '';
              addMessage({
                id: generateMessageId(),
                role: 'system',
                type: 'text',
                content: formatErrorForUser(`CLI error: ${stderr}${hint}`),
                timestamp: Date.now(),
              });
            } else {
              addMessage({
                id: generateMessageId(),
                role: 'system',
                type: 'text',
                content: t('error.cliExitedSilently'),
                timestamp: Date.now(),
              });
            }
          }
        }

        // Delegate full finalization to the lifecycle module (idempotent)
        if (exitingStdinId) {
          setSessionMeta({
            stdinReady: false,
            pendingReadyMessage: undefined,
          });
          handleProcessExitFinalize(exitingStdinId);
        } else {
          // Fallback: no stdinId on message, clear manually
          clearPartial();
          setSessionStatus('idle');
          setSessionMeta({
            stdinId: undefined,
            stdinReady: false,
            pendingReadyMessage: undefined,
            lastProgressAt: undefined,
            apiRetry: undefined,
          });
        }

        // Desktop notification
        if (!document.hasFocus() && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('TOKENICODE', { body: t('notification.chatComplete') });
          } else if (Notification.permission === 'default') {
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') {
                new Notification('TOKENICODE', { body: t('notification.chatComplete') });
              }
            }).catch(() => {});
          }
        }

        agentActions.completeAll();
        break;
      }

      default:
        // Fallback: handle content_block_delta at top level (without stream_event wrapper)
        if (msg.type === 'content_block_delta') {
          if (msg.delta?.type === 'text_delta') {
            const text = msg.delta?.text || '';
            if (text && msgStdinId) {
              streamController.appendText(msgStdinId, text);
            }
          } else if (msg.delta?.type === 'thinking_delta') {
            const thinking = msg.delta?.thinking || '';
            if (thinking && msgStdinId && shouldRenderThinkingForTab(tabId)) {
              streamController.appendThinking(msgStdinId, thinking);
            } else if (thinking && msgStdinId) {
              streamController.clearThinking(msgStdinId);
            }
          }
        }
        break;
    }

    } catch (err) {
      // P1-4: catch-all for unexpected errors in stream message processing
      console.error('[TOKENICODE] handleStreamMessage error:', err, 'msg:', msg?.type, msg?.subtype);
      const errTabId = useSessionStore.getState().selectedSessionId;
      if (errTabId) {
        useChatStore.getState().addMessage(errTabId, {
          id: generateMessageId(),
          role: 'system',
          type: 'text',
          content: formatErrorForUser(`Internal error processing stream message: ${err}`),
          timestamp: Date.now(),
        });
      }
    }
  }, [handleBackgroundStreamMessage, exitPlanModeSeenRef, silentRestartRef, handleSubmitRef, handleStderrLineRef, setInputSync]);

  return { handleStreamMessage, handleBackgroundStreamMessage };
}
