import { describe, it, expect } from 'vitest';
import { generateInterruptedId } from '../chatStore';

describe('generateInterruptedId (#B5)', () => {
  it('carries the kind prefix', () => {
    expect(generateInterruptedId('thinking')).toMatch(/^interrupted_thinking_/);
    expect(generateInterruptedId('text')).toMatch(/^interrupted_text_/);
  });

  it('is unique under tight-loop generation in same tick', () => {
    const n = 1000;
    const ids = new Set<string>();
    for (let i = 0; i < n; i++) {
      ids.add(generateInterruptedId('thinking'));
    }
    expect(ids.size).toBe(n);
  });

  it('mixes kinds without collision', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      ids.add(generateInterruptedId(i % 2 === 0 ? 'thinking' : 'text'));
    }
    expect(ids.size).toBe(500);
  });
});
