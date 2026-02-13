/**
 * useRewind — orchestration hook for the Rewind feature.
 * Manages turn parsing, kill-process, message truncation, code restore,
 * and summarization. Matches Claude Code CLI rewind behavior.
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
import { useSnapshotStore } from '../stores/snapshotStore';
import { bridge } from '../lib/tauri-bridge';
import { parseTurns, type Turn } from '../lib/turns';
import { t } from '../lib/i18n';

export type RewindAction = 'restore_all' | 'restore_conversation' | 'restore_code' | 'summarize';

/**
 * Build a retroactive code restore from message history when no snapshot exists.
 * Scans messages from `startIdx` to end for Write/Edit tool_use blocks,
 * then uses git checkout to restore edited files and deletes created files.
 */
async function restoreFromMessages(
  messages: { type: string; toolName?: string; toolInput?: any }[],
  startIdx: number,
  cwd: string,
): Promise<void> {
  const writtenFiles: string[] = [];
  const editedFiles: string[] = [];

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type !== 'tool_use' || !msg.toolName) continue;

    const fp = msg.toolInput?.file_path as string | undefined;
    if (!fp) continue;

    if (msg.toolName === 'Write') {
      writtenFiles.push(fp);
    } else if (msg.toolName === 'Edit') {
      editedFiles.push(fp);
    }
  }

  const writtenSet = new Set(writtenFiles);
  const allModified = new Set([...writtenFiles, ...editedFiles]);

  // Check which files are tracked by git (existed before Claude touched them).
  // Tracked files should be restored via git checkout, NOT deleted.
  const trackedFiles = new Set<string>();
  try {
    const lsOutput = await bridge.runGitCommand(cwd, ['ls-files']);
    for (const line of lsOutput.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        const abs = cwd.endsWith('/') ? `${cwd}${trimmed}` : `${cwd}/${trimmed}`;
        trackedFiles.add(abs);
        trackedFiles.add(trimmed); // also keep relative path for matching
      }
    }
  } catch {
    // Not a git repo — treat all written files as edits (don't delete anything)
    for (const fp of allModified) {
      try {
        await bridge.runGitCommand(cwd, ['checkout', 'HEAD', '--', fp]);
      } catch { /* skip */ }
    }
    return;
  }

  // Separate truly new files (created by Claude, not in git) from existing ones
  const newFiles: string[] = [];
  const existingFiles: string[] = [];

  for (const fp of allModified) {
    if (trackedFiles.has(fp)) {
      existingFiles.push(fp);
    } else if (writtenSet.has(fp)) {
      // Only delete files that were written (not just edited) AND not tracked
      newFiles.push(fp);
    } else {
      existingFiles.push(fp);
    }
  }

  // 1. Restore existing files via git checkout
  for (const fp of existingFiles) {
    try {
      await bridge.runGitCommand(cwd, ['checkout', 'HEAD', '--', fp]);
    } catch {
      // File may have been staged differently — skip
    }
  }

  // 2. Delete only truly new files (created by Claude, never existed in git)
  if (newFiles.length > 0) {
    await bridge.restoreSnapshot({}, newFiles).catch(() => {});
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

    // 1. Kill current CLI process
    try {
      await killProcess();
    } catch (err) {
      console.warn('[useRewind] Failed to kill process:', err);
    }

    // 2. Grab original text before truncating
    const originalUserText = state.messages[turn.startMsgIdx]?.content || '';

    try {
      switch (action) {
        case 'restore_all': {
          // Restore both code and conversation
          const hasSnapshot = useSnapshotStore.getState().getSnapshot(turn.userMessageId);
          if (hasSnapshot) {
            try {
              await useSnapshotStore.getState().restoreToSnapshot(turn.userMessageId);
            } catch {
              // Snapshot restore failed — try message-based fallback
              const cwd = useSettingsStore.getState().workingDirectory;
              if (cwd) await restoreFromMessages(state.messages, turn.startMsgIdx, cwd).catch(() => {});
            }
          } else {
            // No snapshot (history conversation) — restore from message history
            const cwd = useSettingsStore.getState().workingDirectory;
            if (cwd) await restoreFromMessages(state.messages, turn.startMsgIdx, cwd).catch(() => {});
          }
          useChatStore.getState().rewindToTurn(turn.startMsgIdx);
          resetSession();
          useChatStore.getState().setInputDraft(originalUserText);

          useChatStore.getState().addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: t('rewind.successAll').replace('{n}', String(turn.index)),
            commandType: 'action',
            commandData: { action: 'rewind', turnIndex: turn.index, mode: 'restore_all' },
            timestamp: Date.now(),
          });
          break;
        }

        case 'restore_conversation': {
          // Only restore conversation (keep code as-is)
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
          // Only restore code (keep conversation intact)
          const hasCodeSnapshot = useSnapshotStore.getState().getSnapshot(turn.userMessageId);
          if (hasCodeSnapshot) {
            try {
              await useSnapshotStore.getState().restoreToSnapshot(turn.userMessageId);
            } catch {
              const cwd = useSettingsStore.getState().workingDirectory;
              if (cwd) await restoreFromMessages(state.messages, turn.startMsgIdx, cwd).catch(() => {});
            }
          } else {
            const cwd = useSettingsStore.getState().workingDirectory;
            if (cwd) await restoreFromMessages(state.messages, turn.startMsgIdx, cwd).catch(() => {});
          }
          // Don't truncate messages — keep full conversation
          resetSession();
          useChatStore.getState().setInputDraft(originalUserText);

          useChatStore.getState().addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: t('rewind.successCode').replace('{n}', String(turn.index)),
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
