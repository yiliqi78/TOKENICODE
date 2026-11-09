import { describe, it, expect } from 'vitest';
import { contextUsagePercent, formatTokenCount, promptSizeFromUsage } from '../context-usage';

describe('context usage (#102)', () => {
  it('sums uncached input with cache creation and cache read tokens', () => {
    expect(promptSizeFromUsage({ input_tokens: 300, cache_creation_input_tokens: 1200, cache_read_input_tokens: 84_000 })).toBe(85_500);
    expect(promptSizeFromUsage({ input_tokens: 300 })).toBe(300);
    expect(promptSizeFromUsage(undefined)).toBe(0);
  });

  it('computes a rounded, capped percentage', () => {
    expect(contextUsagePercent(85_500, 200_000)).toBe(43);
    expect(contextUsagePercent(0, 200_000)).toBe(0);
    expect(contextUsagePercent(250_000, 200_000)).toBe(100);
    expect(contextUsagePercent(1000, 0)).toBe(0);
  });

  it('formats token counts compactly', () => {
    expect(formatTokenCount(640)).toBe('640');
    expect(formatTokenCount(85_500)).toBe('86k');
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
  });
});
