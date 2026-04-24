/**
 * Tests for src/lib/sessionLifecycle.ts — unified spawn / teardown / ownership guard.
 *
 * These tests verify the core lifecycle module behaviors without requiring
 * a real Tauri runtime. We mock the bridge, stores, and stream controller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Provide window global for sessionLifecycle.ts (uses window.__claudeUnlisteners)
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

// --- Mocks ---

// Mock tauri-bridge
const mockStartSession = vi.fn();
const mockKillSession = vi.fn();
const mockTrackSession = vi.fn();
const mockOnClaudeStream = vi.fn();
const mockOnClaudeStderr = vi.fn();
const mockOnSessionExit = vi.fn();

vi.mock('../lib/tauri-bridge', () => ({
  bridge: {
    startSession: (...args: any[]) => mockStartSession(...args),
    killSession: (...args: any[]) => mockKillSession(...args),
    trackSession: (...args: any[]) => mockTrackSession(...args),
  },
  onClaudeStream: (...args: any[]) => mockOnClaudeStream(...args),
  onClaudeStderr: (...args: any[]) => mockOnClaudeStderr(...args),
  onSessionExit: (...args: any[]) => mockOnSessionExit(...args),
}));

// Mock sessionStore
const mockRegisterStdinTab = vi.fn();
const mockUnregisterStdinTab = vi.fn();
const mockSetCliResumeId = vi.fn();
const mockGetTabForStdin = vi.fn();
const mockFetchSessions = vi.fn();

vi.mock('../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      registerStdinTab: mockRegisterStdinTab,
      unregisterStdinTab: mockUnregisterStdinTab,
      setCliResumeId: mockSetCliResumeId,
      getTabForStdin: mockGetTabForStdin,
      fetchSessions: mockFetchSessions,
    }),
  },
}));

// Mock chatStore
const mockGetTab = vi.fn();
const mockSetSessionMeta = vi.fn();
const mockSetSessionStatus = vi.fn();
const mockAddMessage = vi.fn();
const mockUpdateMessage = vi.fn();
const mockSetInputDraft = vi.fn();
const mockClearPendingMessages = vi.fn();
const mockSetActivityStatus = vi.fn();
const mockRemoveMessage = vi.fn();
const mockSetPendingAttachments = vi.fn();

vi.mock('../stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      getTab: mockGetTab,
      setSessionMeta: mockSetSessionMeta,
      setSessionStatus: mockSetSessionStatus,
      addMessage: mockAddMessage,
      updateMessage: mockUpdateMessage,
      setInputDraft: mockSetInputDraft,
      clearPendingMessages: mockClearPendingMessages,
      setActivityStatus: mockSetActivityStatus,
      removeMessage: mockRemoveMessage,
      setPendingAttachments: mockSetPendingAttachments,
    }),
  },
  generateInterruptedId: (kind: string) => `interrupted_${kind}_${Date.now()}`,
}));

// Mock stream controller
const mockFlush = vi.fn();
const mockForgetCompletion = vi.fn();

vi.mock('../stream/instance', () => ({
  streamController: {
    flush: (...args: any[]) => mockFlush(...args),
    forgetCompletion: (...args: any[]) => mockForgetCompletion(...args),
  },
}));

// Import after mocks
import {
  spawnSession,
  teardownSession,
  checkOwnership,
  handleProcessExitFinalize,
  hasRecoverableFrontendSession,
  clearFinalized,
  getRecentlyFinalizedStdin,
  type SpawnParams,
} from '../lib/sessionLifecycle';

function makeSpawnParams(overrides?: Partial<SpawnParams>): SpawnParams {
  return {
    tabId: 'tab-1',
    stdinId: 'desk_123',
    cwdSnapshot: '/home/user/project',
    configSnapshot: {
      model: 'claude-opus-4-20250514',
      providerId: 'default',
      thinkingLevel: 'high',
      permissionMode: 'acceptEdits',
    },
    sessionModeSnapshot: 'code',
    sessionParams: {
      prompt: 'Hello',
      cwd: '/home/user/project',
      session_id: 'desk_123',
      model: 'claude-opus-4-20250514',
      permission_mode: 'acceptEdits',
    },
    onStream: vi.fn(),
    onStderr: vi.fn(),
    ...overrides,
  };
}

describe('spawnSession', () => {
  const unlistenStream = vi.fn();
  const unlistenStderr = vi.fn();
  const unlistenExit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock returns
    mockOnClaudeStream.mockResolvedValue(unlistenStream);
    mockOnClaudeStderr.mockResolvedValue(unlistenStderr);
    mockOnSessionExit.mockResolvedValue(unlistenExit);
    mockStartSession.mockResolvedValue({
      stdin_id: 'desk_123',
      cli_session_id: 'uuid-abc',
      pid: 42,
      cli_path: '/usr/bin/claude',
    });
    mockTrackSession.mockResolvedValue(undefined);
    // Provide a global for __claudeUnlisteners
    (window as any).__claudeUnlisteners = {};
  });

  afterEach(() => {
    delete (window as any).__claudeUnlisteners;
  });

  it('registers stdinTab mapping FIRST (step 1)', async () => {
    const params = makeSpawnParams();
    const callOrder: string[] = [];
    mockRegisterStdinTab.mockImplementation(() => callOrder.push('register'));
    mockOnClaudeStream.mockImplementation(async () => { callOrder.push('stream'); return unlistenStream; });

    await spawnSession(params);

    expect(callOrder[0]).toBe('register');
    expect(callOrder[1]).toBe('stream');
  });

  it('registers 3 listeners (stream, stderr, exit)', async () => {
    await spawnSession(makeSpawnParams());

    expect(mockOnClaudeStream).toHaveBeenCalledOnce();
    expect(mockOnClaudeStderr).toHaveBeenCalledOnce();
    expect(mockOnSessionExit).toHaveBeenCalledOnce();
  });

  it('tags __stdinId on stream messages', async () => {
    const onStream = vi.fn();
    await spawnSession(makeSpawnParams({ onStream }));

    // Get the stream handler that was registered
    const handler = mockOnClaudeStream.mock.calls[0][1];
    const msg = { type: 'text_delta' };
    handler(msg);

    expect(msg).toHaveProperty('__stdinId', 'desk_123');
    expect(onStream).toHaveBeenCalledWith(msg);
  });

  it('calls bridge.startSession (step 3)', async () => {
    await spawnSession(makeSpawnParams());
    expect(mockStartSession).toHaveBeenCalledOnce();
  });

  it('writes sessionMeta snapshot (step 4)', async () => {
    await spawnSession(makeSpawnParams());
    expect(mockSetSessionMeta).toHaveBeenCalledWith('tab-1', expect.objectContaining({
      stdinId: 'desk_123',
      cwdSnapshot: '/home/user/project',
      configSnapshot: expect.objectContaining({ model: 'claude-opus-4-20250514' }),
      snapshotMode: 'code',
      snapshotThinking: 'high',
      snapshotProviderId: 'default',
    }));
  });

  it('publishes stdin ownership before startSession resolves', async () => {
    let claimedBeforeStart = false;
    mockStartSession.mockImplementation(async () => {
      claimedBeforeStart = mockSetSessionMeta.mock.calls.some(
        ([tabId, meta]) =>
          tabId === 'tab-1'
          && Object.keys(meta).length === 1
          && meta.stdinId === 'desk_123',
      );
      return {
        stdin_id: 'desk_123',
        cli_session_id: 'uuid-abc',
        pid: 42,
        cli_path: '/usr/bin/claude',
      };
    });

    await spawnSession(makeSpawnParams());

    expect(claimedBeforeStart).toBe(true);
  });

  it('skips running status for pre-warm spawns', async () => {
    await spawnSession(makeSpawnParams({ setRunning: false }));
    expect(mockSetSessionStatus).not.toHaveBeenCalledWith('tab-1', 'running');
  });

  it('sets cliResumeId and tracks non-desk_ session (step 5)', async () => {
    await spawnSession(makeSpawnParams());
    expect(mockSetCliResumeId).toHaveBeenCalledWith('tab-1', 'uuid-abc');
    expect(mockTrackSession).toHaveBeenCalledWith('uuid-abc');
  });

  it('does NOT track desk_ IDs', async () => {
    mockStartSession.mockResolvedValue({
      stdin_id: 'desk_123',
      cli_session_id: 'desk_123',
      pid: 42,
      cli_path: '/usr/bin/claude',
    });
    await spawnSession(makeSpawnParams());
    expect(mockTrackSession).not.toHaveBeenCalled();
  });

  it('stores unlisten in __claudeUnlisteners', async () => {
    const result = await spawnSession(makeSpawnParams());
    expect((window as any).__claudeUnlisteners['desk_123']).toBeDefined();
    // The combined unlisten calls all three
    result.unlisten();
    expect(unlistenStream).toHaveBeenCalled();
    expect(unlistenStderr).toHaveBeenCalled();
    expect(unlistenExit).toHaveBeenCalled();
  });

  it('rolls back on bridge.startSession failure', async () => {
    mockStartSession.mockRejectedValue(new Error('spawn failed'));

    await expect(spawnSession(makeSpawnParams())).rejects.toThrow('spawn failed');

    // Should have unregistered stdinTab and called unlisten
    expect(mockUnregisterStdinTab).toHaveBeenCalledWith('desk_123');
    expect(unlistenStream).toHaveBeenCalled();
    expect(unlistenStderr).toHaveBeenCalled();
    expect(unlistenExit).toHaveBeenCalled();
  });
});

describe('teardownSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockKillSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets sessionStatus to stopping', async () => {
    await teardownSession('desk_123', 'tab-1', 'stop');
    expect(mockSetSessionStatus).toHaveBeenCalledWith('tab-1', 'stopping');
  });

  it('calls bridge.killSession', async () => {
    await teardownSession('desk_123', 'tab-1', 'stop');
    expect(mockKillSession).toHaveBeenCalledWith('desk_123');
  });

  it('does NOT unregister or clear listeners', async () => {
    await teardownSession('desk_123', 'tab-1', 'stop');
    expect(mockUnregisterStdinTab).not.toHaveBeenCalled();
  });

  it('all 5 reasons are accepted', async () => {
    const reasons = ['stop', 'rewind', 'plan-approve', 'delete', 'switch'] as const;
    for (const reason of reasons) {
      vi.clearAllMocks();
      mockKillSession.mockResolvedValue(undefined);
      await teardownSession('desk_x', 'tab-x', reason);
      expect(mockSetSessionStatus).toHaveBeenCalledWith('tab-x', 'stopping');
    }
  });
});

describe('checkOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns valid when stdinId matches tab', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: 'desk_123' },
    });

    const result = checkOwnership('desk_123');
    expect(result).toEqual({ valid: true, tabId: 'tab-1' });
  });

  it('returns no-mapping when stdinToTab has no entry', () => {
    mockGetTabForStdin.mockReturnValue(undefined);
    const result = checkOwnership('desk_unknown');
    expect(result).toEqual({ valid: false, reason: 'no-mapping' });
  });

  it('returns tab-deleted when tab is gone', () => {
    mockGetTabForStdin.mockReturnValue('tab-deleted');
    mockGetTab.mockReturnValue(undefined);
    const result = checkOwnership('desk_123');
    expect(result).toEqual({ valid: false, reason: 'tab-deleted' });
  });

  it('returns stale-stdinId when tab has a different stdinId', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: 'desk_NEW' },
    });
    const result = checkOwnership('desk_OLD');
    expect(result).toEqual({ valid: false, reason: 'stale-stdinId' });
  });
});

describe('hasRecoverableFrontendSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).__claudeUnlisteners = {};
  });

  afterEach(() => {
    delete (window as any).__claudeUnlisteners;
  });

  it('requires route mapping, matching owner meta, and a live listener', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: 'desk_live' },
    });

    expect(hasRecoverableFrontendSession('desk_live')).toBe(false);

    (window as any).__claudeUnlisteners.desk_live = vi.fn();
    expect(hasRecoverableFrontendSession('desk_live')).toBe(true);

    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: undefined },
    });
    expect(hasRecoverableFrontendSession('desk_live')).toBe(false);
  });
});

describe('handleProcessExitFinalize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFinalized('desk_OLD');
    clearFinalized('desk_123');
  });

  it('drops stale stdin routes when ownership is invalid', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: 'desk_NEW' },
    });

    handleProcessExitFinalize('desk_OLD');

    expect(mockUnregisterStdinTab).toHaveBeenCalledWith('desk_OLD');
  });

  it('flushes before reading partial text and thinking', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');

    let tab = {
      tabId: 'tab-1',
      messages: [],
      partialText: '',
      partialThinking: '',
      pendingUserMessages: [],
      inputDraft: '',
      sessionMeta: { stdinId: 'desk_123' },
      sessionStatus: 'stopping',
    };

    mockGetTab.mockImplementation(() => tab);
    mockFlush.mockImplementation(() => {
      tab = {
        ...tab,
        partialText: 'late text',
        partialThinking: 'late thinking',
      };
    });

    handleProcessExitFinalize('desk_123');

    expect(mockAddMessage).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ type: 'thinking', content: 'late thinking' }),
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ type: 'text', content: 'late text' }),
    );
  });

  it('resolves pending interactions so stale cards stop blocking input', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      messages: [
        { id: 'perm', type: 'permission', resolved: false },
        { id: 'question', type: 'question', resolved: false },
        { id: 'plan', type: 'plan_review', resolved: false },
      ],
      partialText: '',
      partialThinking: '',
      pendingUserMessages: [],
      inputDraft: '',
      sessionMeta: { stdinId: 'desk_123' },
      sessionStatus: 'running',
    });

    handleProcessExitFinalize('desk_123');

    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'tab-1',
      'perm',
      expect.objectContaining({
        resolved: true,
        interactionState: 'failed',
        interactionError: 'CLI process exited',
      }),
    );
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'tab-1',
      'question',
      expect.objectContaining({
        resolved: true,
        interactionState: 'failed',
      }),
    );
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'tab-1',
      'plan',
      expect.objectContaining({
        resolved: true,
        interactionState: 'failed',
      }),
    );
  });

  it('explicit stop retracts the unacknowledged turn back into the draft', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      messages: [
        { id: 'user-1', role: 'user', type: 'text', content: 'A' },
      ],
      partialText: 'partial assistant reply',
      partialThinking: '',
      pendingUserMessages: [{ text: 'queued follow-up' }],
      inputDraft: 'existing draft',
      pendingAttachments: [],
      sessionMeta: {
        stdinId: 'desk_123',
        teardownReason: 'stop',
        pendingTurnMessageId: 'user-1',
        pendingTurnInput: 'message A',
        pendingTurnAttachments: [{ id: 'file-1', name: 'a.png', path: '/tmp/a.png', size: 1, type: 'image/png', isImage: true }],
      },
      sessionStatus: 'stopping',
    });

    handleProcessExitFinalize('desk_123');

    expect(mockRemoveMessage).toHaveBeenCalledWith('tab-1', 'user-1');
    expect(mockSetPendingAttachments).toHaveBeenCalledWith(
      'tab-1',
      expect.arrayContaining([expect.objectContaining({ path: '/tmp/a.png' })]),
    );
    expect(mockSetInputDraft).toHaveBeenCalledWith(
      'tab-1',
      'message A\n\nexisting draft\n\nqueued follow-up',
    );
    expect(mockClearPendingMessages).toHaveBeenCalledWith('tab-1');
    expect(mockSetSessionMeta).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ interruptedAssistantText: 'partial assistant reply' }),
    );
    expect(getRecentlyFinalizedStdin('desk_123')).toEqual(
      expect.objectContaining({ tabId: 'tab-1', reason: 'stop' }),
    );
    clearFinalized('desk_123');
  });

  it('clears recently-finalized stop records with clearFinalized', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      messages: [],
      partialText: '',
      partialThinking: '',
      pendingUserMessages: [],
      inputDraft: '',
      pendingAttachments: [],
      sessionMeta: {
        stdinId: 'desk_123',
        teardownReason: 'stop',
      },
      sessionStatus: 'stopping',
    });

    handleProcessExitFinalize('desk_123');
    expect(getRecentlyFinalizedStdin('desk_123')?.reason).toBe('stop');

    clearFinalized('desk_123');
    expect(getRecentlyFinalizedStdin('desk_123')).toBeUndefined();
  });

  it('keeps explicit stop as stopped even when finalization is timeout-driven', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      messages: [],
      partialText: '',
      partialThinking: '',
      pendingUserMessages: [],
      inputDraft: '',
      pendingAttachments: [],
      sessionMeta: {
        stdinId: 'desk_123',
        teardownReason: 'stop',
      },
      sessionStatus: 'stopping',
    });

    handleProcessExitFinalize('desk_123', true);

    expect(mockSetSessionStatus).toHaveBeenCalledWith('tab-1', 'stopped');
    clearFinalized('desk_123');
  });
});
