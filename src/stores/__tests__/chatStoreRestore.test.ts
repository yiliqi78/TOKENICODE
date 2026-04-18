/**
 * B11 · restoreFromCache stale-running demotion.
 *
 * Regression guarded here:
 *   Cached tab.sessionStatus could persist as 'running' when the underlying
 *   process was gone (app restart, ProcessExit bypassed for background tab,
 *   etc.). restoreFromCache then re-asserted runningSessions=true, so the
 *   sidebar red dot never cleared. Fix: when there's no live process AND no
 *   stdinId, demote the cached status to 'idle' before syncing.
 *   Roadmap §4.3.7 / B11.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../sessionStore', () => {
  const store = {
    selectedSessionId: null as string | null,
    sessions: [] as any[],
    setSessionRunning: vi.fn(),
    getTabForStdin: vi.fn(() => undefined),
  };
  return {
    useSessionStore: {
      getState: () => store,
      __mock: store,
    },
  };
});

import { useChatStore } from '../chatStore';
import { useSessionStore } from '../sessionStore';

function msg(id: string, overrides: any = {}) {
  return {
    id,
    role: 'assistant' as const,
    type: 'text' as const,
    content: 'test',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('chatStore · B11 — stale-running demotion on restoreFromCache', () => {
  beforeEach(() => {
    useChatStore.setState({ tabs: new Map(), sessionCache: new Map() });
    const mock = (useSessionStore as any).__mock;
    mock.selectedSessionId = null;
    mock.sessions = [];
    mock.setSessionRunning.mockClear();
  });

  it('cached "running" with no live process → demotes to idle', () => {
    const store = useChatStore.getState();
    store.ensureTab('stale');
    store.addMessage('stale', msg('m1'));
    store.setSessionStatus('stale', 'running');
    (useSessionStore as any).__mock.sessions = [{ id: 'stale', process: null }];
    (useSessionStore as any).__mock.setSessionRunning.mockClear();

    const ok = useChatStore.getState().restoreFromCache('stale');
    expect(ok).toBe(true);

    const tab = useChatStore.getState().getTab('stale');
    expect(tab?.sessionStatus).toBe('idle');
    expect(tab?.isStreaming).toBe(false);
    expect(tab?.partialText).toBe('');

    const calls = (useSessionStore as any).__mock.setSessionRunning.mock.calls;
    expect(calls[calls.length - 1]).toEqual(['stale', false]);
  });

  it('cached "running" with live stdinId → keeps running state intact', () => {
    const store = useChatStore.getState();
    store.ensureTab('live');
    store.addMessage('live', msg('m1'));
    store.setSessionStatus('live', 'running');
    store.setSessionMeta('live', { stdinId: 'sid-1' });
    (useSessionStore as any).__mock.setSessionRunning.mockClear();

    useChatStore.getState().restoreFromCache('live');

    const tab = useChatStore.getState().getTab('live');
    expect(tab?.sessionStatus).toBe('running');
    const calls = (useSessionStore as any).__mock.setSessionRunning.mock.calls;
    expect(calls[calls.length - 1]).toEqual(['live', true]);
  });

  it('cached "reconnecting" with no process also gets demoted', () => {
    const store = useChatStore.getState();
    store.ensureTab('recon');
    store.addMessage('recon', msg('m1'));
    store.setSessionStatus('recon', 'reconnecting');
    (useSessionStore as any).__mock.sessions = [{ id: 'recon', process: null }];

    useChatStore.getState().restoreFromCache('recon');
    expect(useChatStore.getState().getTab('recon')?.sessionStatus).toBe('idle');
  });

  it('cached "idle" is never upgraded or touched', () => {
    const store = useChatStore.getState();
    store.ensureTab('done');
    store.addMessage('done', msg('m1'));
    store.setSessionStatus('done', 'idle');
    (useSessionStore as any).__mock.sessions = [{ id: 'done', process: null }];
    (useSessionStore as any).__mock.setSessionRunning.mockClear();

    useChatStore.getState().restoreFromCache('done');

    const tab = useChatStore.getState().getTab('done');
    expect(tab?.sessionStatus).toBe('idle');
    const calls = (useSessionStore as any).__mock.setSessionRunning.mock.calls;
    expect(calls[calls.length - 1]).toEqual(['done', false]);
  });
});
