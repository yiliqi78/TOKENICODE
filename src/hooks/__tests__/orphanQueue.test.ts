/**
 * B3 · orphan queue regression guard.
 *
 * Guards three contracts (roadmap §5.4):
 *   - orphan_queue_expires_after_5s
 *   - orphan_queue_delivers_when_session_binds
 *   - orphan_queue_no_infinite_growth
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../lib/tauri-bridge', () => ({
  bridge: {
    listSessions: vi.fn(() => Promise.resolve([])),
    loadCustomPreviews: vi.fn(() => Promise.resolve({})),
    saveCustomPreviews: vi.fn(() => Promise.resolve()),
    trackSession: vi.fn(() => Promise.resolve()),
  },
  onClaudeStream: vi.fn(() => Promise.resolve(() => {})),
  onClaudeStderr: vi.fn(() => Promise.resolve(() => {})),
  onSessionExit: vi.fn(() => Promise.resolve(() => {})),
}));

import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import { __orphanTesting, drainOrphanBuffer } from '../useStreamProcessor';

function resetStores() {
  useSessionStore.setState({
    sessions: [],
    selectedSessionId: null,
    previousSessionId: null,
    runningSessions: new Set(),
    stdinToTab: {},
    customPreviews: {},
    isLoading: false,
    searchQuery: '',
  });
  useChatStore.setState({ tabs: new Map(), sessionCache: new Map() });
  __orphanTesting.clear();
}

describe('B3 · orphan queue', () => {
  beforeEach(() => {
    resetStores();
    vi.useRealTimers();
  });

  it('expires entries after the TTL window', () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    __orphanTesting.stash('stdin_a', 'hello', '');
    expect(__orphanTesting.has('stdin_a')).toBe(true);

    vi.setSystemTime(t0 + __orphanTesting.TTL_MS + 1);
    __orphanTesting.expire();
    expect(__orphanTesting.has('stdin_a')).toBe(false);
  });

  it('delivers stashed text when registerStdinTab fires for the stdinId', () => {
    useChatStore.getState().ensureTab('tab_001');

    __orphanTesting.stash('stdin_late', 'early tokens ', 'early thinking ');
    expect(__orphanTesting.has('stdin_late')).toBe(true);

    useSessionStore.getState().registerStdinTab('stdin_late', 'tab_001');

    const tab = useChatStore.getState().getTab('tab_001');
    expect(tab?.partialText).toBe('early tokens ');
    expect(tab?.partialThinking).toBe('early thinking ');
    expect(__orphanTesting.has('stdin_late')).toBe(false);
  });

  it('direct drainOrphanBuffer call also flushes into the given tab', () => {
    useChatStore.getState().ensureTab('tab_x');
    __orphanTesting.stash('stdin_x', 'direct-drain', '');
    drainOrphanBuffer('stdin_x', 'tab_x');
    expect(useChatStore.getState().getTab('tab_x')?.partialText).toBe('direct-drain');
    expect(__orphanTesting.has('stdin_x')).toBe(false);
  });

  it('enforces per-stdinId character cap (drops oversize entry)', () => {
    const oversize = 'x'.repeat(__orphanTesting.PER_STDIN_CAP + 1);
    __orphanTesting.stash('stdin_big', oversize, '');
    expect(__orphanTesting.has('stdin_big')).toBe(false);
  });

  it('enforces total-cap bound by evicting oldest entries', () => {
    const chunk = 'y'.repeat(128 * 1024);
    const n = Math.ceil(__orphanTesting.TOTAL_CAP / chunk.length) + 10;
    for (let i = 0; i < n; i++) {
      __orphanTesting.stash(`stdin_${i}`, chunk, '');
    }
    expect(__orphanTesting.totalChars()).toBeLessThanOrEqual(__orphanTesting.TOTAL_CAP);
  });

  it('has no unbounded growth under repeated late-arrival churn', () => {
    for (let i = 0; i < 5000; i++) {
      __orphanTesting.stash(`stdin_${i}`, 'k', '');
    }
    expect(__orphanTesting.totalChars()).toBeLessThanOrEqual(__orphanTesting.TOTAL_CAP);
    expect(__orphanTesting.size()).toBeLessThanOrEqual(5000);
  });
});
