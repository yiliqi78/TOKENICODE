/**
 * Tests for ownership guard — verifies that stale events from old processes
 * do not affect tabs that have been re-bound to new processes.
 *
 * Scenarios:
 * 1. Stale process_exit from old stdinId is ignored
 * 2. Tab deleted between kill and exit
 * 3. stdinToTab mapping missing (orphan event)
 * 4. Message from old process dropped after provider/model switch
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide window global for sessionLifecycle.ts (uses window.__claudeUnlisteners)
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

// --- Mocks ---

const mockGetTabForStdin = vi.fn();
const mockGetTab = vi.fn();
const mockUnregisterStdinTab = vi.fn();

vi.mock('../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      getTabForStdin: mockGetTabForStdin,
      unregisterStdinTab: mockUnregisterStdinTab,
      fetchSessions: vi.fn(),
    }),
  },
}));

vi.mock('../stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      getTab: mockGetTab,
      setSessionMeta: vi.fn(),
      setSessionStatus: vi.fn(),
      addMessage: vi.fn(),
      updateMessage: vi.fn(),
      setInputDraft: vi.fn(),
      clearPendingMessages: vi.fn(),
      setActivityStatus: vi.fn(),
    }),
  },
  generateInterruptedId: (kind: string) => `interrupted_${kind}_test`,
}));

vi.mock('../stream/instance', () => ({
  streamController: {
    flush: vi.fn(),
    forgetCompletion: vi.fn(),
  },
}));

vi.mock('../lib/tauri-bridge', () => ({
  bridge: {
    startSession: vi.fn(),
    killSession: vi.fn(),
    trackSession: vi.fn(),
  },
  onClaudeStream: vi.fn(),
  onClaudeStderr: vi.fn(),
  onSessionExit: vi.fn(),
}));

import { checkOwnership, handleProcessExitFinalize, clearFinalized } from '../lib/sessionLifecycle';

describe('ownership guard scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up any finalized entries from previous tests
    clearFinalized('desk_OLD');
    clearFinalized('desk_NEW');
    clearFinalized('desk_orphan');
  });

  it('stale exit from old process is ignored when tab has new stdinId', () => {
    // Tab was re-bound to desk_NEW, but desk_OLD exit arrives
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: 'desk_NEW' },
      sessionStatus: 'running',
    });

    const result = checkOwnership('desk_OLD');
    expect(result).toEqual({ valid: false, reason: 'stale-stdinId' });
  });

  it('exit from deleted tab is handled gracefully', () => {
    mockGetTabForStdin.mockReturnValue('tab-deleted');
    mockGetTab.mockReturnValue(undefined);

    const result = checkOwnership('desk_OLD');
    expect(result).toEqual({ valid: false, reason: 'tab-deleted' });
  });

  it('orphan event (no stdinToTab mapping) is rejected', () => {
    mockGetTabForStdin.mockReturnValue(undefined);

    const result = checkOwnership('desk_orphan');
    expect(result).toEqual({ valid: false, reason: 'no-mapping' });
  });

  it('handleProcessExitFinalize skips finalization for stale stdinId', () => {
    // Setup: tab has desk_NEW, but exit from desk_OLD arrives
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: 'desk_NEW' },
      sessionStatus: 'running',
    });

    // This should NOT call finalizeOnce because ownership check fails
    handleProcessExitFinalize('desk_OLD');

    expect(mockUnregisterStdinTab).toHaveBeenCalledWith('desk_OLD');
  });

  it('handleProcessExitFinalize skips finalization when no mapping exists', () => {
    mockGetTabForStdin.mockReturnValue(undefined);

    // Should not throw, just silently clean up
    handleProcessExitFinalize('desk_orphan');

    expect(mockUnregisterStdinTab).toHaveBeenCalledWith('desk_orphan');
  });

  it('valid ownership passes the guard', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: 'desk_123' },
      sessionStatus: 'running',
    });

    const result = checkOwnership('desk_123');
    expect(result).toEqual({ valid: true, tabId: 'tab-1' });
  });

  it('tab with undefined stdinId passes ownership (fresh tab, not yet bound)', () => {
    mockGetTabForStdin.mockReturnValue('tab-1');
    mockGetTab.mockReturnValue({
      tabId: 'tab-1',
      sessionMeta: { stdinId: undefined },
      sessionStatus: 'idle',
    });

    // When tab has no stdinId, any stdinId claiming ownership is valid
    // (this is the initial state before meta is written)
    const result = checkOwnership('desk_123');
    expect(result).toEqual({ valid: true, tabId: 'tab-1' });
  });
});
