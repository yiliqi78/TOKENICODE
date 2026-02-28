/**
 * useRewind — orchestration hook for the Rewind feature.
 * Manages turn parsing, kill-process, message truncation, code restore,
 * and summarization. Uses CLI native checkpoint system for file restoration.
 *
 * 5 actions after selecting a turn:
 *   1. Restore code and conversation — revert both
 *   2. Restore conversation only — keep code, rewind messages
 *   3. Restore code only — keep conversation, revert files
 *   4. Summarize from here — compress messages after selected point
 *   5. Cancel
 */
import { useMemo, useCallback } from 'react';
import { useChatStore, generateMessageId } from '../stores/chatStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { bridge } from '../lib/tauri-bridge';
import { parseTurns, type Turn } from '../lib/turns';
import { t } from '../lib/i18n';

export type RewindAction = 'restore_all' | 'restore_conversation' | 'restore_code' | 'summarize';

/**
 * Restore files to a CLI checkpoint via bridge.rewindFiles().
 * Returns true if files were restored, false if no checkpoint available.
 */
async function restoreFilesViaCheckpoint(turn: Turn): Promise<boolean> {
  if (!turn.checkpointUuid) return false;

  const { sessionMeta } = useChatStore.getState();
  const stdinId = sessionMeta.stdinId;
  const sessionId = sessionMeta.sessionId;
  const cwd = useSettingsStore.getState().workingDirectory;
  if (!sessionId || !cwd) return false;

  try {
    // Primary: SDK control protocol via stdin (fast, in-process)
    // Fallback: spawn new CLI process (slow, full initialization)
    await bridge.rewindFiles(stdinId || '', turn.checkpointUuid, sessionId, cwd);
    return true;
  } catch (err) {
    console.error('[rewind] rewindFiles failed:', err);
    return false;
  }
}

export function useRewind() {
  const messages = useChatStore((s) => s.messages);
  const sessionStatus = useChatStore((s) => s.sessionStatus);

  const turns = useMemo(() => parseTurns(messages), [messages]);

  /** Button visible as long as there are user messages */
  const showRewind = turns.length >= 1;
  /** Button enabled when there is at least 1 turn and not running */
  const canRewind = turns.length >= 1 && sessionStatus !== 'running';

  /** Kill the current CLI process and clean up listeners */
  const killProcess = useCallback(async () => {
    const state = useChatStore.getState();
    const stdinId = state.sessionMeta.stdinId;
    if (stdinId) {
      await bridge.killSession(stdinId).catch(() => {});
      if ((window as any).__claudeUnlisteners?.[stdinId]) {
        (window as any).__claudeUnlisteners[stdinId]();
        delete (window as any).__claudeUnlisteners[stdinId];
      }
      if ((window as any).__claudeUnlisten) {
        (window as any).__claudeUnlisten = null;
      }
    }
  }, []);

  /** Reset session state after rewind */
  const resetSession = useCallback(() => {
    useChatStore.getState().setSessionStatus('idle');
    useChatStore.getState().setSessionMeta({ stdinId: undefined });
  }, []);

  /** Save rewound state to tab cache */
  const saveToTab = useCallback(() => {
    const tabId = useSessionStore.getState().selectedSessionId;
    if (tabId) {
      useChatStore.getState().saveToCache(tabId);
    }
  }, []);

  /**
   * Execute rewind with a specific action.
   * All actions restore the user's original input text to the input box.
   */
  const executeRewind = useCallback(async (turn: Turn, action: RewindAction = 'restore_conversation') => {
    const state = useChatStore.getState();

    // Guard: validate turn index
    if (turn.startMsgIdx < 0 || turn.startMsgIdx > state.messages.length) {
      console.error('[useRewind] Invalid turn startMsgIdx:', turn.startMsgIdx);
      return;
    }

    // For file-restore actions, send rewind via stdin BEFORE killing the process
    // (SDK control protocol is fast and needs the process alive)
    const needsFileRestore = action === 'restore_all' || action === 'restore_code';
    let fileRestoreOk = false;
    if (needsFileRestore && turn.checkpointUuid) {
      try {
        fileRestoreOk = await restoreFilesViaCheckpoint(turn);
      } catch { /* handled below */ }
    }

    // Kill CLI process after file restore (or immediately for non-file actions)
    try {
      await killProcess();
    } catch (err) {
      console.warn('[useRewind] Failed to kill process:', err);
    }

    // Grab original text before truncating
    const originalUserText = state.messages[turn.startMsgIdx]?.content || '';

    try {
      switch (action) {
        case 'restore_all': {
          useChatStore.getState().rewindToTurn(turn.startMsgIdx);
          resetSession();
          useChatStore.getState().setInputDraft(originalUserText);

          const successMsg = fileRestoreOk
            ? t('rewind.successAll').replace('{n}', String(turn.index))
            : t('rewind.successAllNoFiles').replace('{n}', String(turn.index));
          useChatStore.getState().addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: successMsg,
            commandType: 'action',
            commandData: { action: 'rewind', turnIndex: turn.index, mode: 'restore_all' },
            timestamp: Date.now(),
          });
          break;
        }

        case 'restore_conversation': {
          // Only restore conversation (keep code as-is) — instant, no CLI call
          useChatStore.getState().rewindToTurn(turn.startMsgIdx);
          resetSession();
          useChatStore.getState().setInputDraft(originalUserText);

          useChatStore.getState().addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: t('rewind.success').replace('{n}', String(turn.index)),
            commandType: 'action',
            commandData: { action: 'rewind', turnIndex: turn.index, mode: 'restore_conversation' },
            timestamp: Date.now(),
          });
          break;
        }

        case 'restore_code': {
          // Don't truncate messages — keep full conversation
          resetSession();
          useChatStore.getState().setInputDraft(originalUserText);

          const codeMsg = fileRestoreOk
            ? t('rewind.successCode').replace('{n}', String(turn.index))
            : t('rewind.codeRestoreFailed');
          useChatStore.getState().addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: codeMsg,
            commandType: 'action',
            commandData: { action: 'rewind', turnIndex: turn.index, mode: 'restore_code' },
            timestamp: Date.now(),
          });
          break;
        }

        case 'summarize': {
          // Compress messages from this turn onwards into a summary.
          // Messages before the selected turn stay intact (full detail).
          const msgsToSummarize = state.messages.slice(turn.startMsgIdx);
          const summaryParts: string[] = [];

          for (const m of msgsToSummarize) {
            if (m.role === 'user' && m.content) {
              summaryParts.push(`**User:** ${m.content.slice(0, 200)}${m.content.length > 200 ? '…' : ''}`);
            } else if (m.role === 'assistant' && m.type === 'text' && m.content) {
              summaryParts.push(`**Claude:** ${m.content.slice(0, 300)}${m.content.length > 300 ? '…' : ''}`);
            } else if (m.type === 'tool_use' && m.toolName) {
              const fp = m.toolInput?.file_path || m.toolInput?.command || '';
              summaryParts.push(`**${m.toolName}:** ${String(fp).slice(0, 100)}`);
            }
          }

          // Truncate to selected point
          useChatStore.getState().rewindToTurn(turn.startMsgIdx);
          resetSession();

          // Add summary as a system message (preserves context without full messages)
          const totalTurns = turns.length;
          const summaryHeader = t('rewind.summaryTitle')
            .replace('{from}', String(turn.index))
            .replace('{to}', String(totalTurns));
          const summaryContent = `**${summaryHeader}**\n\n${summaryParts.join('\n\n')}`;

          useChatStore.getState().addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: summaryContent,
            commandType: 'action',
            commandData: { action: 'rewind', turnIndex: turn.index, mode: 'summarize' },
            timestamp: Date.now(),
          });
          break;
        }
      }
    } catch (err) {
      console.error('[useRewind] executeRewind failed:', err);
      // Ensure we're in a recoverable state even if rewind failed
      resetSession();
    }

    // Save to cache
    saveToTab();
  }, [killProcess, resetSession, saveToTab, turns.length]);

  return { turns, showRewind, canRewind, executeRewind };
}
