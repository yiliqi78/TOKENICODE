/**
 * Diagnosis regression tests — validates structural bugs found in diagnosis-2026-04-21.md
 *
 * Tests the actual code paths that handle:
 * 1. stdinId race (old process exit polluting new session)
 * 2. StreamController completion idempotency
 * 3. LRU eviction protection gaps
 */
import { describe, it, expect } from 'vitest';
import {
  StreamController,
  type StreamRouter,
  type StreamSink,
  type Scheduler,
  type StreamEvent,
} from '../StreamController';

// --- Mock Scheduler (deterministic timing) ---
class MockScheduler implements Scheduler {
  time = 0;
  private rafQueue: Array<{ id: number; cb: () => void }> = [];
  private intervals: Array<{ id: number; cb: () => void; ms: number; last: number }> = [];
  private nextId = 1;

  raf(cb: () => void): number {
    const id = this.nextId++;
    this.rafQueue.push({ id, cb });
    return id;
  }
  cancelRaf(id: number): void {
    this.rafQueue = this.rafQueue.filter((e) => e.id !== id);
  }
  setInterval(cb: () => void, ms: number): ReturnType<typeof setInterval> {
    const id = this.nextId++;
    this.intervals.push({ id, cb, ms, last: this.time });
    return id as unknown as ReturnType<typeof setInterval>;
  }
  clearInterval(h: ReturnType<typeof setInterval>): void {
    this.intervals = this.intervals.filter((e) => e.id !== (h as unknown as number));
  }
  now(): number { return this.time; }

  flushRaf(): void {
    const pending = this.rafQueue;
    this.rafQueue = [];
    for (const e of pending) e.cb();
  }
  advance(ms: number): void {
    this.time += ms;
    for (const iv of this.intervals) {
      while (this.time - iv.last >= iv.ms) {
        iv.last += iv.ms;
        iv.cb();
      }
    }
  }
}

// --- Mutable router (simulates stdinToTab changes mid-stream) ---
class MutableRouter implements StreamRouter {
  routes: Record<string, string | null> = {};
  getTabIdForStdin(stdinId: string): string | null {
    return this.routes[stdinId] ?? null;
  }
}

function makeHarness() {
  const router = new MutableRouter();
  const textCalls: Array<[string, string]> = [];
  const thinkingCalls: Array<[string, string]> = [];
  const sink: StreamSink = {
    updatePartialText: (tabId, text) => textCalls.push([tabId, text]),
    updatePartialThinking: (tabId, text) => thinkingCalls.push([tabId, text]),
  };
  const scheduler = new MockScheduler();
  const ctrl = new StreamController(router, sink, scheduler);
  const events: StreamEvent[] = [];
  ctrl.on((e) => events.push(e));
  return { ctrl, router, scheduler, textCalls, thinkingCalls, events, sink };
}

// ============================================================
// Root Cause 1: stdinId race — old process exit polluting new session
// ============================================================
describe('Root Cause 1: stdinId race condition', () => {
  it('text arriving on unmapped stdinId goes to orphan queue, NOT to active tab', () => {
    const { ctrl, router, scheduler, textCalls } = makeHarness();

    // Tab A has stdinId "old_001"
    router.routes['old_001'] = 'tabA';

    // Stream arrives on old_001 → should route to tabA
    ctrl.appendText('old_001', 'hello from old');
    scheduler.flushRaf();
    expect(textCalls).toEqual([['tabA', 'hello from old']]);

    // User switches Provider → old process killed → mapping removed
    delete router.routes['old_001'];

    // New process spawned with "new_002"
    router.routes['new_002'] = 'tabA';

    // OLD process sends one more text before dying → no mapping → must go to orphan, NOT tabA
    textCalls.length = 0;
    ctrl.appendText('old_001', 'stale text from dead process');
    scheduler.flushRaf();

    // Key assertion: stale text must NOT appear in tabA's sink
    expect(textCalls).toEqual([]);
    // It should be in the orphan queue
    expect(ctrl.__testing.hasOrphan('old_001')).toBe(true);
  });

  it('completeStream on already-completed stdinId is a no-op', () => {
    const { ctrl, router, scheduler, events } = makeHarness();
    router.routes['s1'] = 'tab1';

    ctrl.appendText('s1', 'some text');
    scheduler.flushRaf();

    // First complete
    ctrl.completeStream('s1');
    const completeCount1 = events.filter(e => e.type === 'completed').length;
    expect(completeCount1).toBe(1);

    // Second complete (should be no-op)
    ctrl.completeStream('s1');
    const completeCount2 = events.filter(e => e.type === 'completed').length;
    expect(completeCount2).toBe(1); // still 1, not 2
  });

  it('text appended after completeStream is silently dropped', () => {
    const { ctrl, router, scheduler, textCalls } = makeHarness();
    router.routes['s1'] = 'tab1';

    ctrl.completeStream('s1');
    textCalls.length = 0;

    ctrl.appendText('s1', 'late text after exit');
    scheduler.flushRaf();

    expect(textCalls).toEqual([]);
    expect(ctrl.__testing.hasBuffer('s1')).toBe(false);
  });

  it('race: old stdinId text arrives between unmap and new stdinId register', () => {
    const { ctrl, router, scheduler, textCalls } = makeHarness();

    // Initial state: old process mapped
    router.routes['old'] = 'tabA';

    // Step 1: InputBar kills old process → unmaps
    delete router.routes['old'];

    // Step 2: old process sends final text (process hasn't actually died yet)
    ctrl.appendText('old', 'dying gasp');
    scheduler.flushRaf();

    // Must go to orphan, not be lost
    expect(textCalls).toEqual([]);
    expect(ctrl.__testing.hasOrphan('old')).toBe(true);

    // Step 3: new process registered → drain should NOT send old data to new session
    // (orphan is keyed by stdinId, drain only triggers for matching stdinId)
    router.routes['new'] = 'tabA';
    ctrl.drainOrphan('new', 'tabA'); // drain for 'new' stdinId → nothing
    expect(textCalls).toEqual([]); // old data NOT drained to new session

    // Old orphan still exists
    expect(ctrl.__testing.hasOrphan('old')).toBe(true);
  });
});

// ============================================================
// Root Cause 10 (P2): LRU eviction protection gaps
// ============================================================
describe('Root Cause 10: LRU eviction gaps', () => {
  it('documents that StreamController has no concept of tab lifecycle', () => {
    // StreamController correctly doesn't care about tab eviction —
    // it only routes by stdinId. But this means if chatStore evicts a tab
    // while StreamController still has buffered text for it, the text
    // will be flushed to a sink that writes to a non-existent tab.
    //
    // This is a chatStore issue, not StreamController.
    // Test here just to document the boundary.
    const { ctrl, router, scheduler, textCalls } = makeHarness();
    router.routes['s1'] = 'evicted_tab';

    ctrl.appendText('s1', 'text for evicted tab');
    scheduler.flushRaf();

    // Text IS flushed (StreamController doesn't know the tab was evicted)
    expect(textCalls).toEqual([['evicted_tab', 'text for evicted tab']]);
    // chatStore.updatePartialMessage would silently fail if tab doesn't exist
  });
});

// ============================================================
// Orphan queue boundary tests
// ============================================================
describe('Orphan queue: TTL expiry timing', () => {
  it('orphan expires after TTL and is NOT drained on late register', () => {
    const { ctrl, router, scheduler, textCalls } = makeHarness();

    // No mapping → text goes to orphan
    ctrl.appendText('s1', 'orphan text');
    scheduler.flushRaf();
    expect(ctrl.__testing.hasOrphan('s1')).toBe(true);

    // Advance past TTL (5 seconds)
    scheduler.advance(6000);
    ctrl.expireOrphans();
    expect(ctrl.__testing.hasOrphan('s1')).toBe(false);

    // Late register → nothing to drain
    router.routes['s1'] = 'tabA';
    ctrl.drainOrphan('s1', 'tabA');
    expect(textCalls).toEqual([]); // text is lost
  });
});
