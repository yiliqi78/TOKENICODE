import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const chatPanelSource = readFileSync(
  resolve(__dirname, '../components/chat/ChatPanel.tsx'),
  'utf-8',
);

const inputBarSource = readFileSync(
  resolve(__dirname, '../components/chat/InputBar.tsx'),
  'utf-8',
);

const permissionCardSource = readFileSync(
  resolve(__dirname, '../components/chat/PermissionCard.tsx'),
  'utf-8',
);

const streamProcessorSource = readFileSync(
  resolve(__dirname, '../hooks/useStreamProcessor.ts'),
  'utf-8',
);

const rewindSource = readFileSync(
  resolve(__dirname, '../hooks/useRewind.ts'),
  'utf-8',
);

const conversationListSource = readFileSync(
  resolve(__dirname, '../components/conversations/ConversationList.tsx'),
  'utf-8',
);

const planReviewCardSource = readFileSync(
  resolve(__dirname, '../components/chat/PlanReviewCard.tsx'),
  'utf-8',
);

describe('stdin route regressions', () => {
  it('pre-warm spawn keeps the tab out of running state', () => {
    expect(chatPanelSource).toContain('setRunning: false');
    expect(chatPanelSource).toContain('sessionModeSnapshot: settings.sessionMode');
  });

  it('sessionMeta.sessionId only stores the real CLI session id', () => {
    expect(chatPanelSource).toContain('sessionId: spawnResult.sessionInfo.cli_session_id ?? undefined');
    expect(inputBarSource).toContain('const nextSessionId = spawnResult.sessionInfo.cli_session_id');
    expect(inputBarSource).toContain('sessionId: nextSessionId');
  });

  it('broken-pipe fallback drops the stale stdin route', () => {
    expect(inputBarSource).toContain('cleanupStdinRoute(stdinId);');
  });

  it('tab switches snapshot the current draft before restoring the next tab', () => {
    expect(inputBarSource).toContain('previousSessionIdRef');
    expect(inputBarSource).toContain('textareaRef.current?.getText()');
    expect(inputBarSource).toContain('setPendingAttachments(previousSessionId, latestFilesRef.current)');
  });

  it('permission responses resolve ownership from the message instead of the active tab', () => {
    expect(permissionCardSource).toContain('const resolveOwner');
    expect(permissionCardSource).toContain('message.owner?.tabId');
    expect(permissionCardSource).not.toContain('getActiveTabState().sessionMeta.stdinId');
  });

  it('invalid ownership process_exit branches drop stale stdin routes', () => {
    expect(streamProcessorSource).toContain('cleanupStdinRoute(bgStdinId);');
    expect(streamProcessorSource).toContain('cleanupStdinRoute(exitingStdinId);');
  });

  it('rewind waits for stdin ownership to clear before resetting the tab', () => {
    expect(rewindSource).toContain("await waitForStdinCleared(tid, stdinId);");
  });

  it('ExitPlanMode auto-restart waits for finalize before silent resume', () => {
    expect(streamProcessorSource).toContain("await teardownSession(oldStdinId, tabId, 'plan-approve');");
    expect(streamProcessorSource).toContain('await waitForStdinCleared(tabId, oldStdinId);');
  });

  it('delete flow falls back to persisted stdin routes when the tab is not loaded', () => {
    expect(conversationListSource).toContain('Object.entries(useSessionStore.getState().stdinToTab)');
  });

  it('stale plan review cards do not execute after the live session is gone', () => {
    expect(planReviewCardSource).toContain("if (!liveStdinId || liveState.sessionStatus !== 'running') {");
    expect(planReviewCardSource).toContain("interactionError: 'CLI process exited'");
    expect(inputBarSource).toContain('const hasLivePlanSession = Boolean(stdinId && tabState.sessionStatus === \'running\');');
  });

  it('hidden provider thinking records resume evidence without deleting real sessions', () => {
    expect(streamProcessorSource).toContain('turnAcceptedForResume: true');
    expect(inputBarSource).toContain('resumeTab?.sessionMeta.turnAcceptedForResume === true');
    expect(streamProcessorSource).toContain('if (tabId.startsWith(\'draft_\')) {');
    expect(streamProcessorSource).toContain('tabId = cliSessionId;');
    expect(streamProcessorSource).not.toContain('bridge.deleteSession(tabId, oldSession.path)');
  });

  it('post-spawn metadata follows draft promotion to the current stdin owner', () => {
    expect(inputBarSource).toContain('const spawnOwnerTabId = useSessionStore.getState().getTabForStdin(preGeneratedId) ?? tabId;');
    expect(inputBarSource).toContain('const existingOwnerSessionId = useChatStore.getState().getTab(spawnOwnerTabId)?.sessionMeta.sessionId;');
    expect(inputBarSource).toContain('?? (spawnOwnerTabId !== tabId ? existingOwnerSessionId : undefined)');
    expect(inputBarSource).toContain('setSessionMeta(spawnOwnerTabId, {');
  });

  it('background auto-compact keeps the tab busy until compact settles', () => {
    expect(streamProcessorSource).toContain("store.setSessionStatus(tabId, 'running');");
    expect(streamProcessorSource).toContain("completePendingCommand(tabId, { output: 'Compact timed out' });");
  });
});
