/**
 * Phase B — B1 + B2: clearPartial scoping & flush-before-clear atomicity.
 *
 * Regression:
 *   Before the fix, the clearPartial() closure inside handleStreamMessage
 *   called flushStreamBuffer() with NO stdinId argument, which flushed AND
 *   deleted every active rAF buffer across every session. When tab A's turn
 *   completed while tab B was mid-stream, tab B's buffered delta was wiped.
 *   The per-tab zero that followed only touched tab A's partialText — but
 *   the damage to B was already done.
 *
 *   The B2 side of the same fix guarantees atomicity: since flushStreamBuffer
 *   also removes the entry from _streamBuffers, no late rAF callback can
 *   repopulate the buffer between our flush and our partial zero.
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

import { useChatStore } from '../../stores/chatStore';
import { flushStreamBuffer } from '../useStreamProcessor';

function resetChatStore() {
  useChatStore.setState({ tabs: new Map(), sessionCache: new Map() });
}

describe('flushStreamBuffer — B1/B2 scoped contract', () => {
  beforeEach(resetChatStore);

  it('scoped flush does not throw and leaves chatStore partials for other tabs untouched', () => {
    useChatStore.getState().ensureTab('desk_A');
    useChatStore.getState().ensureTab('desk_B');
    useChatStore.getState().updatePartialMessage('desk_A', 'from A');
    useChatStore.getState().updatePartialMessage('desk_B', 'from B');

    expect(() => flushStreamBuffer('stdin_unrelated')).not.toThrow();
    expect(useChatStore.getState().getTab('desk_A')?.partialText).toBe('from A');
    expect(useChatStore.getState().getTab('desk_B')?.partialText).toBe('from B');
  });

  it('unscoped flush (no arg) is still available for shutdown paths (B8)', () => {
    // B8: App.tsx close handler relies on the unscoped form to drain
    // everything before exit. Keep this contract working.
    expect(() => flushStreamBuffer()).not.toThrow();
  });
});
