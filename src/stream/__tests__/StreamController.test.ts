/**
 * StreamController regression guard — roadmap §4.5.1.
 *
 * Covers the 10 Vitest unit contracts the roadmap calls out for §4.3.1.
 * All cases inject a MockScheduler so the rAF / interval coroutines are
 * deterministic under jsdom without racing the real event loop.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StreamController,
  type StreamRouter,
  type StreamSink,
  type Scheduler,
  type StreamEvent,
  DEFAULT_CONFIG,
} from '../StreamController';

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
  now(): number {
    return this.time;
  }

  /** Drain all pending rAF callbacks (FIFO). */
  flushRaf(): void {
    const pending = this.rafQueue;
    this.rafQueue = [];
    for (const e of pending) e.cb();
  }
  /** Advance time and fire any intervals whose deadline passed. */
  advance(ms: number): void {
    this.time += ms;
    for (const iv of this.intervals) {
      while (this.time - iv.last >= iv.ms) {
        iv.last += iv.ms;
        iv.cb();
      }
    }
  }
  /** Number of rAF callbacks still pending (for asserting raF-starvation path). */
  pendingRaf(): number {
    return this.rafQueue.length;
  }
}

function makeHarness(routes: Record<string, string | null> = {}) {
  const router: StreamRouter = {
    getTabIdForStdin: (stdinId) => (stdinId in routes ? routes[stdinId] : null),
  };
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
  return { ctrl, scheduler, textCalls, thinkingCalls, events };
}

describe('StreamController · §4.3.1', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('clearPartial', () => {
    it('clearPartial_with_stdinId_only_clears_target', () => {
      const { ctrl, scheduler } = makeHarness({ s1: 't1' });
      ctrl.appendText('s1', 'hello');
      expect(ctrl.__testing.hasBuffer('s1')).toBe(true);
      ctrl.clearPartial('s1');
      expect(ctrl.__testing.hasBuffer('s1')).toBe(false);
      // No residual raF should fire into sink after clear.
      scheduler.flushRaf();
    });

    it('clearPartial_does_not_touch_other_sessions', () => {
      const { ctrl } = makeHarness({ s1: 't1', s2: 't2' });
      ctrl.appendText('s1', 'alpha');
      ctrl.appendText('s2', 'beta');
      ctrl.clearPartial('s1');
      expect(ctrl.__testing.hasBuffer('s1')).toBe(false);
      expect(ctrl.__testing.hasBuffer('s2')).toBe(true);
      expect(ctrl.__testing.getBuffer('s2')?.text).toBe('beta');
    });
  });

  describe('completeStream', () => {
    it('completeStream_flushes_before_clear', () => {
      const { ctrl, textCalls, thinkingCalls } = makeHarness({ s1: 't1' });
      ctrl.appendText('s1', 'trailing text');
      ctrl.appendThinking('s1', 'trailing thinking');
      // rAF has not been drained; buffer holds content.
      expect(ctrl.__testing.getBuffer('s1')?.text).toBe('trailing text');
      ctrl.completeStream('s1');
      // Sink received the flush.
      expect(textCalls).toEqual([['t1', 'trailing text']]);
      expect(thinkingCalls).toEqual([['t1', 'trailing thinking']]);
      // Buffer is gone.
      expect(ctrl.__testing.hasBuffer('s1')).toBe(false);
    });

    it('completeStream_is_atomic_under_raF_delay', () => {
      // Simulate the background-tab scenario: rAF never fires, interval never
      // fires, yet completeStream must still flush the last chunk deterministically.
      const { ctrl, scheduler, textCalls } = makeHarness({ s1: 't1' });
      ctrl.appendText('s1', 'last-bytes');
      expect(scheduler.pendingRaf()).toBe(1);
      // Do NOT drain rAF / advance interval.
      ctrl.completeStream('s1');
      expect(textCalls).toEqual([['t1', 'last-bytes']]);
      // After complete, the pending rAF is cancelled (no double-flush).
      scheduler.flushRaf();
      expect(textCalls.length).toBe(1);
    });

    it('completeStream_emits_exactly_once_under_duplicate_process_exit', () => {
      const { ctrl, events } = makeHarness({ s1: 't1' });
      ctrl.appendText('s1', 'hi');
      ctrl.completeStream('s1');
      ctrl.completeStream('s1'); // duplicate from second Rust path
      ctrl.completeStream('s1'); // extra just to be safe
      const completed = events.filter((e) => e.type === 'completed');
      expect(completed).toHaveLength(1);
    });

    it('completeStream_ignores_appends_after_completion', () => {
      // Late stragglers after process_exit must not reopen a tab stream.
      const { ctrl, textCalls } = makeHarness({ s1: 't1' });
      ctrl.completeStream('s1');
      ctrl.appendText('s1', 'too late');
      expect(ctrl.__testing.hasBuffer('s1')).toBe(false);
      expect(textCalls).toEqual([]);
    });
  });

  describe('orphan queue', () => {
    it('orphan_queue_expires_after_5s', () => {
      const { ctrl, scheduler, events } = makeHarness();
      ctrl.stashOrphan('s1', 'hello', '');
      expect(ctrl.__testing.hasOrphan('s1')).toBe(true);
      scheduler.time += DEFAULT_CONFIG.ttlMs + 1;
      ctrl.expireOrphans();
      expect(ctrl.__testing.hasOrphan('s1')).toBe(false);
      const dropped = events.find(
        (e) => e.type === 'orphan-dropped' && e.reason === 'ttl',
      );
      expect(dropped).toBeTruthy();
    });

    it('orphan_queue_delivers_when_session_binds', () => {
      const { ctrl, textCalls, thinkingCalls, events } = makeHarness();
      ctrl.stashOrphan('s1', 'early tokens ', 'early thinking ');
      ctrl.drainOrphan('s1', 'tab-001');
      expect(textCalls).toEqual([['tab-001', 'early tokens ']]);
      expect(thinkingCalls).toEqual([['tab-001', 'early thinking ']]);
      expect(ctrl.__testing.hasOrphan('s1')).toBe(false);
      expect(events.some((e) => e.type === 'orphan-drained')).toBe(true);
    });

    it('orphan_queue_no_infinite_growth', () => {
      const { ctrl } = makeHarness();
      const chunk = 'y'.repeat(128 * 1024);
      const n = Math.ceil(DEFAULT_CONFIG.totalCapChars / chunk.length) + 10;
      for (let i = 0; i < n; i++) ctrl.stashOrphan(`s_${i}`, chunk, '');
      expect(ctrl.__testing.orphanTotalChars()).toBeLessThanOrEqual(
        DEFAULT_CONFIG.totalCapChars,
      );
    });

    it('orphan_queue_enforces_per_stdin_cap', () => {
      const { ctrl } = makeHarness();
      const oversize = 'x'.repeat(DEFAULT_CONFIG.perStdinCapChars + 1);
      ctrl.stashOrphan('s_big', oversize, '');
      expect(ctrl.__testing.hasOrphan('s_big')).toBe(false);
    });

    it('orphan_routes_to_queue_when_router_returns_null', () => {
      // doFlush with no tabId → stash into orphan queue, buffer cleared.
      const { ctrl, scheduler } = makeHarness();
      ctrl.appendText('unknown', 'flow into orphan');
      scheduler.flushRaf();
      expect(ctrl.__testing.hasOrphan('unknown')).toBe(true);
      expect(ctrl.__testing.getOrphan('unknown')?.text).toBe('flow into orphan');
    });
  });

  describe('scheduling', () => {
    it('rAF_coalesces_rapid_appends_into_single_flush', () => {
      const { ctrl, scheduler, textCalls } = makeHarness({ s1: 't1' });
      ctrl.appendText('s1', 'a');
      ctrl.appendText('s1', 'b');
      ctrl.appendText('s1', 'c');
      expect(scheduler.pendingRaf()).toBe(1);
      scheduler.flushRaf();
      expect(textCalls).toEqual([['t1', 'abc']]);
    });

    it('interval_fallback_flushes_when_rAF_starved', () => {
      // rAF never drained, but interval tick arrives → buffer still flushes.
      const { ctrl, scheduler, textCalls } = makeHarness({ s1: 't1' });
      ctrl.appendText('s1', 'background');
      expect(textCalls.length).toBe(0);
      scheduler.advance(DEFAULT_CONFIG.intervalMs);
      expect(textCalls).toEqual([['t1', 'background']]);
    });
  });
});
