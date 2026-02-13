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
  const createdFiles: string[] = [];
  const editedFiles: string[] = [];

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type !== 'tool_use' || !msg.toolName) continue;

    const fp = msg.toolInput?.file_path as string | undefined;
    if (!fp) continue;

    if (msg.toolName === 'Write') {
      createdFiles.push(fp);
    } else if (msg.toolName === 'Edit') {
      editedFiles.push(fp);
    }
  }

  // De-duplicate: if a file was both created and edited, treat it as created (delete it)
  const createdSet = new Set(createdFiles);
  const uniqueEdited = [...new Set(editedFiles)].filter((f) => !createdSet.has(f));

  // 1. Delete files that were created during these turns
  if (createdSet.size > 0) {
    await bridge.restoreSnapshot({}, Array.from(createdSet)).catch(() => {});
  }

  // 2. Restore edited files via git checkout (revert to HEAD version)
  for (const fp of uniqueEdited) {
    try {
      await bridge.runGitCommand(cwd, ['checkout', 'HEAD', '--', fp]);
    } catch {
      // File may not be in git — skip
    }
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

    // 1. Kill current CLI process
    await killProcess();

    // 2. Grab original text before truncating
    const originalUserText = state.messages[turn.startMsgIdx]?.content || '';

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
        state.rewindToTurn(turn.startMsgIdx);
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
        state.rewindToTurn(turn.startMsgIdx);
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
        state.rewindToTurn(turn.startMsgIdx);
        resetSession();

        // Add summary as a system message (preserves context without full messages)
        const totalTurns = turns.length;
        const summaryHeader = t('rewind.summaryTitle')
          .replace('{from}', String(turn.index))
          .replace('{to}', String(totalTurns));
        const summaryContent = `📋 **${summaryHeader}**\n\n${summaryParts.join('\n\n')}`;

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

    // Save to cache
    saveToTab();
  }, [killProcess, resetSession, saveToTab, turns.length]);

  return { turns, showRewind, canRewind, executeRewind };
}
