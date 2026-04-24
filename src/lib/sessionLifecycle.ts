/**
 * Session Lifecycle Module — unified spawn / teardown / ownership guard.
 *
 * Pure functions (no React hooks). Can be called from component event
 * handlers, top-level functions (ChatPanel pre-warm), or any non-React
 * context.
 *
 * All Tauri IPC goes through `./tauri-bridge.ts` per project conventions.
 */

import {
  bridge,
  onClaudeStream,
  onClaudeStderr,
  onSessionExit,
  type StartSessionParams,
  type SessionInfo,
} from './tauri-bridge';
import { useChatStore, generateInterruptedId } from '../stores/chatStore';
import type { SessionStatus } from '../stores/chatStore';
import { useSessionStore } from '../stores/sessionStore';
import { streamController } from '../stream/instance';
import type { CliPermissionMode, SessionMode, ThinkingLevel } from '../stores/settingsStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeardownReason = 'stop' | 'rewind' | 'plan-approve' | 'delete' | 'switch';

export interface SpawnParams {
  tabId: string;
  stdinId: string;
  cwdSnapshot: string;
  configSnapshot: {
    model: string;
    providerId: string;
    thinkingLevel: ThinkingLevel;
    permissionMode: CliPermissionMode;
  };
  sessionModeSnapshot: SessionMode;
  sessionParams: StartSessionParams;
  /** Stream message handler — receives messages tagged with __stdinId */
  onStream: (msg: any) => void;
  /** Stderr line handler */
  onStderr: (line: string) => void;
  /** Whether to set sessionStatus to 'running' after spawn. Default true.
   *  Set to false for pre-warm spawns where no user message is sent yet. */
  setRunning?: boolean;
}

export interface SpawnResult {
  stdinId: string;
  sessionInfo: SessionInfo;
  /** Call to remove all Tauri event listeners registered by this spawn */
  unlisten: () => void;
}

// ---------------------------------------------------------------------------
// finalizeOnce — idempotent gate for process_exit finalization
// ---------------------------------------------------------------------------

const finalizedSet = new Set<string>();
const finalizedTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface RecentlyFinalizedStdin {
  tabId: string;
  reason?: TeardownReason;
  finalizedAt: number;
}

const recentlyFinalizedStdin = new Map<string, RecentlyFinalizedStdin>();
const recentlyFinalizedTimers = new Map<string, ReturnType<typeof setTimeout>>();
const RECENTLY_FINALIZED_TTL_MS = 30_000;

function rememberRecentlyFinalizedStdin(stdinId: string, entry: RecentlyFinalizedStdin): void {
  const existingTimer = recentlyFinalizedTimers.get(stdinId);
  if (existingTimer) clearTimeout(existingTimer);
  recentlyFinalizedStdin.set(stdinId, entry);
  recentlyFinalizedTimers.set(
    stdinId,
    setTimeout(() => {
      recentlyFinalizedStdin.delete(stdinId);
      recentlyFinalizedTimers.delete(stdinId);
    }, RECENTLY_FINALIZED_TTL_MS),
  );
}

export function getRecentlyFinalizedStdin(stdinId: string): RecentlyFinalizedStdin | undefined {
  return recentlyFinalizedStdin.get(stdinId);
}

export function clearRecentlyFinalizedStdin(stdinId: string): void {
  const timer = recentlyFinalizedTimers.get(stdinId);
  if (timer) clearTimeout(timer);
  recentlyFinalizedTimers.delete(stdinId);
  recentlyFinalizedStdin.delete(stdinId);
}

/**
 * Run `fn` exactly once for a given stdinId. Returns true if `fn` ran,
 * false if it was already finalized. Auto-cleans after 30 seconds.
 */
export function finalizeOnce(stdinId: string, fn: () => void): boolean {
  if (finalizedSet.has(stdinId)) return false;
  finalizedSet.add(stdinId);
  finalizedTimers.set(
    stdinId,
    setTimeout(() => {
      finalizedSet.delete(stdinId);
      finalizedTimers.delete(stdinId);
    }, 30_000),
  );
  fn();
  return true;
}

/** Manual cleanup (e.g. test teardown). */
export function clearFinalized(stdinId: string): void {
  const timer = finalizedTimers.get(stdinId);
  if (timer) clearTimeout(timer);
  finalizedTimers.delete(stdinId);
  finalizedSet.delete(stdinId);
  clearRecentlyFinalizedStdin(stdinId);
}

// ---------------------------------------------------------------------------
// checkOwnership — validate that a stdinId still owns its tab
// ---------------------------------------------------------------------------

export type OwnershipResult =
  | { valid: true; tabId: string }
  | { valid: false; reason: 'no-mapping' | 'tab-deleted' | 'stale-stdinId' };

export function checkOwnership(stdinId: string): OwnershipResult {
  const tabId = useSessionStore.getState().getTabForStdin(stdinId);
  if (!tabId) return { valid: false, reason: 'no-mapping' };
  const tab = useChatStore.getState().getTab(tabId);
  if (!tab) return { valid: false, reason: 'tab-deleted' };
  if (tab.sessionMeta.stdinId && tab.sessionMeta.stdinId !== stdinId) {
    return { valid: false, reason: 'stale-stdinId' };
  }
  return { valid: true, tabId };
}

// ---------------------------------------------------------------------------
// cleanupListeners — remove Tauri event listeners for a stdinId
// ---------------------------------------------------------------------------

export function cleanupListeners(stdinId: string): void {
  const unlisteners = (window as any).__claudeUnlisteners;
  if (unlisteners && unlisteners[stdinId]) {
    const unlisten = unlisteners[stdinId];
    delete unlisteners[stdinId];
    try {
      unlisten();
    } catch {
      /* ignore */
    }
  }
}

/** Drop the stdinId route and its listeners when a process is no longer valid. */
export function cleanupStdinRoute(stdinId: string): void {
  useSessionStore.getState().unregisterStdinTab(stdinId);
  cleanupListeners(stdinId);
}

/** A backend process is only recoverable if the frontend still has all three:
 *  route mapping, owning tab metadata, and a live listener bundle. */
export function hasRecoverableFrontendSession(stdinId: string): boolean {
  const tabId = useSessionStore.getState().getTabForStdin(stdinId);
  if (!tabId) return false;
  const tab = useChatStore.getState().getTab(tabId);
  if (!tab || tab.sessionMeta.stdinId !== stdinId) return false;
  return Boolean((window as any).__claudeUnlisteners?.[stdinId]);
}

// ---------------------------------------------------------------------------
// spawnSession — unified entry point for starting a CLI process
// ---------------------------------------------------------------------------

/**
 * Start a CLI session with all necessary bookkeeping:
 * 1. Register stdinTab mapping (must be first — triggers orphan drain)
 * 2. Publish stdin ownership to the tab immediately
 * 3. Register 4 listeners: stream / stderr / tokenicode_permission_request / exit
 * 4. Start CLI process via bridge
 * 5. Write sessionMeta snapshot
 * 5. Store unlisten in __claudeUnlisteners
 * 6. On failure: rollback all steps
 */
export async function spawnSession(params: SpawnParams): Promise<SpawnResult> {
  const {
    tabId,
    stdinId,
    cwdSnapshot,
    configSnapshot,
    sessionModeSnapshot,
    sessionParams,
    onStream,
    onStderr,
    setRunning = true,
  } = params;
  const rollbacks: (() => void)[] = [];

  try {
    // STEP 1: Register stdinTab mapping FIRST (triggers orphan drain)
    useSessionStore.getState().registerStdinTab(stdinId, tabId);
    rollbacks.push(() => useSessionStore.getState().unregisterStdinTab(stdinId));

    // STEP 2: Publish stdin ownership immediately so the first permission/exit
    // event can see the new owner even before bridge.startSession resolves.
    const previousStdinId = useChatStore.getState().getTab(tabId)?.sessionMeta.stdinId;
    useChatStore.getState().setSessionMeta(tabId, { stdinId });
    rollbacks.push(() => useChatStore.getState().setSessionMeta(tabId, { stdinId: previousStdinId }));

    // STEP 3: Register listeners
    // 3a. Stream listener — tag __stdinId on every message
    const unlistenStream = await onClaudeStream(stdinId, (msg: any) => {
      msg.__stdinId = stdinId;
      onStream(msg);
    });
    rollbacks.push(unlistenStream);

    // 3b. Stderr listener
    const unlistenStderr = await onClaudeStderr(stdinId, (line: string) => {
      onStderr(line);
    });
    rollbacks.push(unlistenStderr);

    // 3c. Permission request via stream channel (tokenicode_permission_request)
    // NOTE: This is NOT the dead `claude:permission_request:*` channel.
    // Permission requests arrive through the main stream channel as messages
    // with type 'tokenicode_permission_request'. They are handled by onStream
    // in handleStreamMessage. No separate listener needed here — the stream
    // listener above already captures them.

    // 3d. Backup exit listener (dedicated channel, fires if stream process_exit is missed)
    const unlistenExit = await onSessionExit(stdinId, () => {
      const ownership = checkOwnership(stdinId);
      if (!ownership.valid) {
        cleanupStdinRoute(stdinId);
        return;
      }
      const exitTab = useChatStore.getState().getTab(ownership.tabId);
      if (exitTab?.sessionMeta.stdinId === stdinId) {
        // Only act if this is still the active stdinId
        handleProcessExitFinalize(stdinId);
      }
    });
    rollbacks.push(unlistenExit);

    // Store unlisten functions in global map
    if (!(window as any).__claudeUnlisteners) {
      (window as any).__claudeUnlisteners = {};
    }
    let didUnlisten = false;
    const combinedUnlisten = () => {
      if (didUnlisten) return;
      didUnlisten = true;
      unlistenStream();
      unlistenStderr();
      unlistenExit();
    };
    (window as any).__claudeUnlisteners[stdinId] = combinedUnlisten;

    // STEP 4: Start CLI process
    const session = await bridge.startSession(sessionParams);

    // STEP 4b: Set sessionStatus to running. This is critical for switch/plan-approve
    // paths where teardownSession set 'stopped' before we got here. Without this, the
    // tab would appear stopped while the new process is actively running.
    // Skip for pre-warm spawns (setRunning=false) where no user message is sent yet —
    // otherwise InputBar treats stdinId + running as in-flight turn and queues the
    // first real user message into pendingUserMessages.
    if (setRunning) {
      useChatStore.getState().setSessionStatus(tabId, 'running');
    }

    // STEP 5: Write sessionMeta snapshot (both new configSnapshot and legacy fields)
    useChatStore.getState().setSessionMeta(tabId, {
      stdinId,
      cwdSnapshot,
      configSnapshot,
      // Legacy per-session snapshot fields — read by getEffectiveMode/Model/Thinking
      // in settingsStore.ts. Writing them here resolves C1 (fields defined but never written).
      snapshotMode: sessionModeSnapshot,
      snapshotModel: configSnapshot.model,
      snapshotThinking: configSnapshot.thinkingLevel,
      snapshotProviderId: configSnapshot.providerId,
      envFingerprint: undefined, // Will be set by caller if needed
    });

    // STEP 5: Track session if CLI returned a real UUID
    if (session.cli_session_id) {
      useSessionStore.getState().setCliResumeId(tabId, session.cli_session_id);
      if (!session.cli_session_id.startsWith('desk_')) {
        bridge.trackSession(session.cli_session_id).catch(() => {});
      }
    }

    return {
      stdinId,
      sessionInfo: session,
      unlisten: combinedUnlisten,
    };
  } catch (err) {
    // Rollback all completed steps in reverse order
    for (let i = rollbacks.length - 1; i >= 0; i--) {
      try {
        rollbacks[i]();
      } catch {
        /* ignore rollback errors */
      }
    }
    // Clean from global map if it was set
    if ((window as any).__claudeUnlisteners?.[stdinId]) {
      delete (window as any).__claudeUnlisteners[stdinId];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// teardownSession — unified entry point for stopping a CLI process
// ---------------------------------------------------------------------------

/** Active teardown timeouts by stdinId — cleared when process_exit arrives */
const teardownTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Initiate a graceful CLI process shutdown:
 * 1. Set sessionStatus to 'stopping'
 * 2. Call bridge.killSession
 * 3. Do NOT unregister or clear listeners — process_exit handler does that
 * 4. 5-second timeout: force-finalize if process_exit never arrives
 */
export async function teardownSession(
  stdinId: string,
  tabId: string,
  reason: TeardownReason,
): Promise<void> {
  useChatStore.getState().setSessionMeta(tabId, { teardownReason: reason });
  // Set stopping state
  useChatStore.getState().setSessionStatus(tabId, 'stopping');

  // Start 5-second timeout BEFORE the bridge call. Rust's kill_session already
  // waits up to 5s internally, so starting the timer after await would make the
  // effective timeout ~10s. Using Promise.race keeps it at a true 5s.
  const timeoutId = setTimeout(() => {
    teardownTimeouts.delete(stdinId);
    if (finalizedSet.has(stdinId)) return;
    console.warn(`[sessionLifecycle] teardown timeout for ${stdinId} (reason: ${reason}) — force-finalizing`);
    handleProcessExitFinalize(stdinId, true);
  }, 5_000);
  teardownTimeouts.set(stdinId, timeoutId);

  // Race the kill against the timeout — whichever finishes first unblocks the caller.
  const killPromise = bridge.killSession(stdinId).catch(() => { /* already dead */ });
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
  await Promise.race([killPromise, timeoutPromise]);
}

/** Cancel any pending teardown timeout (called when process_exit arrives normally). */
export function cancelTeardownTimeout(stdinId: string): void {
  const timer = teardownTimeouts.get(stdinId);
  if (timer) {
    clearTimeout(timer);
    teardownTimeouts.delete(stdinId);
  }
}

export function waitForStdinCleared(
  tabId: string,
  expectedStdinId?: string,
  timeoutMs = 5_500,
): Promise<void> {
  const isCleared = (): boolean => {
    const currentStdinId = useChatStore.getState().getTab(tabId)?.sessionMeta.stdinId;
    if (!currentStdinId) return true;
    return expectedStdinId !== undefined ? currentStdinId !== expectedStdinId : false;
  };

  if (isCleared()) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = (unsubscribe: () => void, timer: ReturnType<typeof setTimeout>) => {
      unsubscribe();
      clearTimeout(timer);
    };

    const unsubscribe = useChatStore.subscribe((state) => {
      const currentStdinId = state.getTab(tabId)?.sessionMeta.stdinId;
      if (!currentStdinId || (expectedStdinId !== undefined && currentStdinId !== expectedStdinId)) {
        cleanup(unsubscribe, timer);
        resolve();
      }
    });

    const timer = setTimeout(() => {
      cleanup(unsubscribe, timer);
      reject(new Error(`[sessionLifecycle] waitForStdinCleared timed out for ${tabId}`));
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// handleProcessExitFinalize — unified finalization on process exit
// ---------------------------------------------------------------------------

/**
 * Called from process_exit handlers (foreground, background, and backup exit).
 * Uses finalizeOnce to ensure exactly one execution per stdinId.
 *
 * @param stdinId The desk-generated process key
 * @param isTimeout If true, this was triggered by the 5-second timeout
 */
export function handleProcessExitFinalize(stdinId: string, isTimeout = false): void {
  cancelTeardownTimeout(stdinId);

  const ownership = checkOwnership(stdinId);
  if (!ownership.valid) {
    // Stale or orphaned — drop any leftover route and listeners
    cleanupStdinRoute(stdinId);
    clearFinalized(stdinId);
    return;
  }

  const tabId = ownership.tabId;

  finalizeOnce(stdinId, () => {
    const store = useChatStore.getState();
    streamController.flush(stdinId);

    const tab = store.getTab(tabId);
    if (!tab) return;
    const teardownReason = tab.sessionMeta.teardownReason;
    rememberRecentlyFinalizedStdin(stdinId, {
      tabId,
      reason: teardownReason,
      finalizedAt: Date.now(),
    });

    // 2. Save partial text/thinking as interrupted messages
    const pThinking = tab.partialThinking ?? '';
    const pText = tab.partialText ?? '';
    if (pThinking.trim().length > 0) {
      store.addMessage(tabId, {
        id: generateInterruptedId('thinking'),
        role: 'assistant',
        type: 'thinking',
        content: pThinking,
        timestamp: Date.now(),
      });
    }
    if (pText.trim().length > 0) {
      store.addMessage(tabId, {
        id: generateInterruptedId('text'),
        role: 'assistant',
        type: 'text',
        content: pText,
        timestamp: Date.now(),
      });
    }

    // 3. Mark unanswered questions/permissions as cancelled
    for (const m of tab.messages) {
      if (['permission', 'question', 'plan_review'].includes(m.type) && !m.resolved) {
        store.updateMessage(tabId, m.id, {
          resolved: true,
          interactionState: 'failed',
          interactionError: 'CLI process exited',
        });
      }
    }

    // 4. Backfill pending messages to inputDraft
    const pending = tab.pendingUserMessages ?? [];
    const pendingTurnInput = tab.sessionMeta.pendingTurnInput?.trim();
    const pendingTurnAttachments = tab.sessionMeta.pendingTurnAttachments ?? [];
    const isExplicitStop = teardownReason === 'stop';
    const interruptedAssistantText = isExplicitStop && pText.trim().length > 0 ? pText : undefined;
    const combinedDraftParts = [
      isExplicitStop ? pendingTurnInput : '',
      tab.inputDraft ?? '',
      pending.length > 0 ? pending.map((p) => p.text).join('\n\n') : '',
    ].filter((part) => typeof part === 'string' && part.trim().length > 0);
    if (combinedDraftParts.length > 0) {
      store.setInputDraft(tabId, combinedDraftParts.join('\n\n'));
    }
    if (isExplicitStop && pendingTurnInput) {
      if (tab.sessionMeta.pendingTurnMessageId) {
        store.removeMessage(tabId, tab.sessionMeta.pendingTurnMessageId);
      }
      if (pendingTurnAttachments.length > 0) {
        store.setPendingAttachments(tabId, pendingTurnAttachments);
      }
    }
    if (pending.length > 0) {
      store.clearPendingMessages(tabId);
    }

    // 5. Clear stuck pendingCommandMsgId
    const pendingCmdMsgId = tab.sessionMeta.pendingCommandMsgId;
    if (pendingCmdMsgId) {
      store.updateMessage(tabId, pendingCmdMsgId, { commandCompleted: true });
      store.setSessionMeta(tabId, { pendingCommandMsgId: undefined });
    }

    // 5b. Clear per-tab autoCompact tracking (NEW-B fix)
    clearAutoCompact(tabId);

    // 6. Clear sessionMeta: clear stdinId, KEEP cliResumeId and cwdSnapshot
    store.setSessionMeta(tabId, {
      stdinId: undefined,
      lastProgressAt: undefined,
      apiRetry: undefined,
      teardownReason: undefined,
      pendingTurnMessageId: undefined,
      pendingTurnInput: undefined,
      pendingTurnAttachments: undefined,
      interruptedAssistantText,
    });

    // 7-8. Drop stdinTab mapping and listeners
    cleanupStdinRoute(stdinId);

    // 9. StreamController cleanup
    streamController.forgetCompletion(stdinId);

    // 10. Set final sessionStatus
    const currentStatus = store.getTab(tabId)?.sessionStatus;
    let finalStatus: SessionStatus;
    if (teardownReason === 'stop') {
      finalStatus = 'stopped';
    } else if (isTimeout) {
      finalStatus = 'error';
    } else if (currentStatus === 'stopping') {
      finalStatus = 'stopped';
    } else {
      finalStatus = 'idle';
    }
    store.setSessionStatus(tabId, finalStatus);

    // Refresh session list
    useSessionStore.getState().fetchSessions();
  });
}

// ---------------------------------------------------------------------------
// autoCompactFiredMap — per-tab tracking (replaces global ref)
// ---------------------------------------------------------------------------

/** Per-tab auto-compact tracking. Replaces the module-level `autoCompactFiredRef`
 *  in InputBar.tsx to avoid cross-tab pollution. */
export const autoCompactFiredMap = new Map<string, boolean>();

/** Mark auto-compact as fired for a tab. */
export function markAutoCompactFired(tabId: string): void {
  autoCompactFiredMap.set(tabId, true);
}

/** Check if auto-compact has fired for a tab. */
export function hasAutoCompactFired(tabId: string): boolean {
  return autoCompactFiredMap.get(tabId) ?? false;
}

/** Clear auto-compact tracking for a tab (called on teardown). */
export function clearAutoCompact(tabId: string): void {
  autoCompactFiredMap.delete(tabId);
}
