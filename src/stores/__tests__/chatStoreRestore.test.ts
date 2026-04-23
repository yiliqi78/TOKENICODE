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

import { registerLiveComposerSnapshotProvider, useChatStore } from '../chatStore';
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
    registerLiveComposerSnapshotProvider(null);
    const mock = (useSessionStore as any).__mock;
    mock.selectedSessionId = null;
    mock.sessions = [];
    mock.setSessionRunning.mockClear();
    mock.getTabForStdin.mockReset();
    mock.getTabForStdin.mockReturnValue(undefined);
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

  it('stale-active early return still refreshes lastAccessedAt', () => {
    const store = useChatStore.getState();
    store.ensureTab('stale-lru');
    store.addMessage('stale-lru', msg('m1'));
    store.setSessionStatus('stale-lru', 'stopping');
    useChatStore.setState((state) => {
      const tabs = new Map(state.tabs);
      const tab = tabs.get('stale-lru');
      if (!tab) return {};
      tabs.set('stale-lru', { ...tab, lastAccessedAt: 1 });
      return { tabs, sessionCache: tabs };
    });

    const ok = useChatStore.getState().restoreFromCache('stale-lru');

    expect(ok).toBe(true);
    expect(useChatStore.getState().getTab('stale-lru')?.lastAccessedAt).toBeGreaterThan(1);
  });

  it('idle tab with a live stdin route is protected from LRU eviction', () => {
    const store = useChatStore.getState();
    const ids = ['prewarm', 'old-1', 'old-2', 'old-3', 'old-4', 'old-5', 'old-6', 'old-7'];
    for (const id of ids) {
      store.ensureTab(id);
      store.addMessage(id, msg(`m-${id}`));
    }
    store.setSessionMeta('prewarm', { stdinId: 'stdin-live' });
    (useSessionStore as any).__mock.getTabForStdin.mockImplementation((stdinId: string) =>
      stdinId === 'stdin-live' ? 'prewarm' : undefined,
    );
    useChatStore.setState((state) => {
      const tabs = new Map(state.tabs);
      ids.forEach((id, idx) => {
        const tab = tabs.get(id);
        if (!tab) return;
        tabs.set(id, { ...tab, lastAccessedAt: idx + 1 });
      });
      return { tabs, sessionCache: tabs };
    });

    store.ensureTab('incoming');

    expect(useChatStore.getState().getTab('prewarm')).toBeDefined();
    expect(useChatStore.getState().getTab('old-1')).toBeUndefined();
  });

  it('idle tab with a non-empty draft is protected from LRU eviction', () => {
    const store = useChatStore.getState();
    const ids = ['draft-keep', 'old-1', 'old-2', 'old-3', 'old-4', 'old-5', 'old-6', 'old-7'];
    for (const id of ids) {
      store.ensureTab(id);
      store.addMessage(id, msg(`m-${id}`));
    }
    store.setInputDraft('draft-keep', 'unsent draft');
    useChatStore.setState((state) => {
      const tabs = new Map(state.tabs);
      ids.forEach((id, idx) => {
        const tab = tabs.get(id);
        if (!tab) return;
        tabs.set(id, { ...tab, lastAccessedAt: idx + 1 });
      });
      return { tabs, sessionCache: tabs };
    });

    store.ensureTab('incoming');

    expect(useChatStore.getState().getTab('draft-keep')).toBeDefined();
    expect(useChatStore.getState().getTab('old-1')).toBeUndefined();
  });

  it('attachment-only tabs restore instead of being treated as empty cache misses', () => {
    const store = useChatStore.getState();
    store.ensureTab('attachments-only');
    store.setPendingAttachments('attachments-only', [
      { id: 'file-1', name: 'a.png', path: '/tmp/a.png', size: 1, type: 'image/png', isImage: true },
    ]);

    const ok = store.restoreFromCache('attachments-only');

    expect(ok).toBe(true);
    expect(useChatStore.getState().getTab('attachments-only')).toBeDefined();
  });

  it('thinking-only tabs survive restoreFromCache empty-tab checks', () => {
    const store = useChatStore.getState();
    store.ensureTab('thinking-only');
    useChatStore.setState((state) => {
      const tabs = new Map(state.tabs);
      const tab = tabs.get('thinking-only');
      if (!tab) return {};
      tabs.set('thinking-only', {
        ...tab,
        partialThinking: 'draft thinking',
        isStreaming: false,
      });
      return { tabs, sessionCache: tabs };
    });
    (useSessionStore as any).__mock.sessions = [{ id: 'thinking-only', path: '/tmp/thinking-only.jsonl' }];

    const ok = store.restoreFromCache('thinking-only');

    expect(ok).toBe(true);
    expect(useChatStore.getState().getTab('thinking-only')).toBeDefined();
  });

  it('late thinking deltas do not regress the activity phase after visible text starts', () => {
    const store = useChatStore.getState();
    store.ensureTab('phase-lock');

    store.updatePartialMessage('phase-lock', 'hello');
    expect(useChatStore.getState().getTab('phase-lock')?.activityStatus.phase).toBe('writing');

    store.updatePartialThinking('phase-lock', 'late reasoning');
    expect(useChatStore.getState().getTab('phase-lock')?.activityStatus.phase).toBe('writing');
  });

  it('late thinking deltas do not regress the activity phase after partial text is cleared', () => {
    const store = useChatStore.getState();
    store.ensureTab('phase-lock-cleared');
    store.updatePartialMessage('phase-lock-cleared', 'hello');

    useChatStore.setState((state) => {
      const tabs = new Map(state.tabs);
      const tab = tabs.get('phase-lock-cleared');
      if (!tab) return {};
      tabs.set('phase-lock-cleared', {
        ...tab,
        partialText: '',
        activityStatus: { phase: 'writing' },
      });
      return { tabs, sessionCache: tabs };
    });

    store.updatePartialThinking('phase-lock-cleared', 'late reasoning');
    expect(useChatStore.getState().getTab('phase-lock-cleared')?.activityStatus.phase).toBe('writing');
  });

  it('restorePendingQueueToDraft merges queued text into the current draft and clears the queue', () => {
    const store = useChatStore.getState();
    store.ensureTab('queue-restore');
    store.setInputDraft('queue-restore', 'existing draft');
    store.addPendingMessage('queue-restore', 'queued one');
    store.addPendingMessage('queue-restore', 'queued two');

    store.restorePendingQueueToDraft('queue-restore');

    const tab = useChatStore.getState().getTab('queue-restore');
    expect(tab?.inputDraft).toBe('existing draft\n\nqueued one\n\nqueued two');
    expect(tab?.pendingUserMessages).toEqual([]);
  });

  it('saveToCache flushes the live composer snapshot before tab switch', () => {
    const store = useChatStore.getState();
    store.ensureTab('tab-a');
    registerLiveComposerSnapshotProvider((tabId) => (
      tabId === 'tab-a'
        ? {
            inputDraft: 'live editor text',
            pendingAttachments: [
              { id: 'file-1', name: 'draft.png', path: '/tmp/draft.png', size: 1, type: 'image/png', isImage: true },
            ],
          }
        : null
    ));

    store.saveToCache('tab-a');

    const tab = useChatStore.getState().getTab('tab-a');
    expect(tab?.inputDraft).toBe('live editor text');
    expect(tab?.pendingAttachments).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/tmp/draft.png' })]),
    );
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
