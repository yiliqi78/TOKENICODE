/**
 * Tests for finalizeOnce — idempotent gate for process_exit finalization.
 *
 * Ensures that:
 * 1. The callback runs exactly once per stdinId
 * 2. Duplicate calls are silently ignored
 * 3. Auto-cleanup happens after 30 seconds
 * 4. Manual cleanup via clearFinalized works
 * 5. Different stdinIds don't interfere
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { finalizeOnce, clearFinalized } from '../lib/sessionLifecycle';

describe('finalizeOnce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up any stdinIds we registered
    clearFinalized('desk_a');
    clearFinalized('desk_b');
    clearFinalized('desk_c');
    vi.useRealTimers();
  });

  it('runs the callback exactly once', () => {
    const fn = vi.fn();
    const ran1 = finalizeOnce('desk_a', fn);
    const ran2 = finalizeOnce('desk_a', fn);
    const ran3 = finalizeOnce('desk_a', fn);

    expect(ran1).toBe(true);
    expect(ran2).toBe(false);
    expect(ran3).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('different stdinIds are independent', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    expect(finalizeOnce('desk_a', fn1)).toBe(true);
    expect(finalizeOnce('desk_b', fn2)).toBe(true);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('auto-cleans after 30 seconds, allowing re-finalize', () => {
    const fn = vi.fn();

    expect(finalizeOnce('desk_c', fn)).toBe(true);
    expect(finalizeOnce('desk_c', fn)).toBe(false);

    // Advance 30 seconds
    vi.advanceTimersByTime(30_000);

    // Now the entry is cleaned, so finalizeOnce should accept again
    expect(finalizeOnce('desk_c', fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clearFinalized allows immediate re-finalize', () => {
    const fn = vi.fn();

    expect(finalizeOnce('desk_a', fn)).toBe(true);
    clearFinalized('desk_a');
    expect(finalizeOnce('desk_a', fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('concurrent race: only one wins', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    // Simulate two process_exit events arriving at the same time
    const ran1 = finalizeOnce('desk_a', fn1);
    const ran2 = finalizeOnce('desk_a', fn2);

    expect(ran1).toBe(true);
    expect(ran2).toBe(false);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled();
  });
});
