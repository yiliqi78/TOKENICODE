import { describe, expect, it } from 'vitest';
import { elapsedSeconds, formatElapsedCompact } from '../elapsed-time';

describe('elapsed time formatting', () => {
  it('clamps negative elapsed durations to zero seconds', () => {
    expect(elapsedSeconds(-1000)).toBe(0);
    expect(formatElapsedCompact(-1000)).toBe('0s');
  });

  it('formats normal elapsed durations compactly', () => {
    expect(formatElapsedCompact(0)).toBe('0s');
    expect(formatElapsedCompact(2300)).toBe('2s');
    expect(formatElapsedCompact(65_000)).toBe('1m 5s');
  });

  it('treats non-finite durations as zero', () => {
    expect(elapsedSeconds(Number.NaN)).toBe(0);
    expect(formatElapsedCompact(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});
