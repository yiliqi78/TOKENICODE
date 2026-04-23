import { describe, it, expect } from 'vitest';
import { __streamThinkingTesting } from '../useStreamProcessor';

describe('thinking snapshot coalescing', () => {
  it('merges repeated thinking blocks into one stable snapshot', () => {
    const snapshot = __streamThinkingTesting.buildThinkingSnapshot('msg-123', [
      { type: 'thinking', thinking: 'part 1 ' },
      { type: 'text', text: 'ignore me' },
      { type: 'thinking', thinking: 'part 2' },
      { type: 'thinking', thinking: '' },
    ] as any[]);

    expect(snapshot).toEqual({
      id: 'msg-123_thinking',
      content: 'part 1 part 2',
    });
  });

  it('skips empty thinking-only payloads', () => {
    const snapshot = __streamThinkingTesting.buildThinkingSnapshot('msg-456', [
      { type: 'thinking', thinking: '' },
    ] as any[]);

    expect(snapshot).toBeNull();
  });

  it('keeps live thinking in partial state when the assistant payload is still thinking-only', () => {
    const shouldMaterialize = __streamThinkingTesting.shouldMaterializeThinkingSnapshot([
      { type: 'thinking', thinking: 'draft thought' },
    ] as any[], false);

    expect(shouldMaterialize).toBe(false);
  });

  it('materializes thinking once the assistant payload also contains text', () => {
    const shouldMaterialize = __streamThinkingTesting.shouldMaterializeThinkingSnapshot([
      { type: 'thinking', thinking: 'done thinking' },
      { type: 'text', text: 'final answer' },
    ] as any[], true);

    expect(shouldMaterialize).toBe(true);
  });

  it('falls back to streamed partial thinking when the final assistant payload has text but no thinking block', () => {
    const snapshot = __streamThinkingTesting.resolveThinkingPersistence(
      'msg-789',
      [{ type: 'text', text: 'final answer' }] as any[],
      'streamed thinking that should persist',
    );

    expect(snapshot).toEqual({
      id: 'msg-789_thinking',
      content: 'streamed thinking that should persist',
    });
  });
});
