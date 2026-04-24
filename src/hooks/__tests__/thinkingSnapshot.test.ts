import { beforeEach, describe, it, expect } from 'vitest';
import { __streamThinkingTesting } from '../useStreamProcessor';
import { useChatStore } from '../../stores/chatStore';

describe('thinking snapshot coalescing', () => {
  beforeEach(() => {
    useChatStore.setState({ tabs: new Map(), sessionCache: new Map() });
  });

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

  it('uses a dedicated id namespace for committed historical thinking', () => {
    expect(__streamThinkingTesting.buildCommittedThinkingId('msg-123')).toBe(
      'msg-123__thinking_committed',
    );
  });

  it('skips empty thinking-only payloads', () => {
    const snapshot = __streamThinkingTesting.buildThinkingSnapshot('msg-456', [
      { type: 'thinking', thinking: '' },
    ] as any[]);

    expect(snapshot).toBeNull();
  });

  it('keeps pure thinking-only assistant payloads live until a boundary arrives', () => {
    const content = [
      { type: 'thinking', thinking: 'draft thought' },
    ] as any[];
    const shouldMaterialize = __streamThinkingTesting.shouldMaterializeThinkingSnapshot(
      content,
      false,
    );

    expect(__streamThinkingTesting.isPureThinkingOnlySnapshot(content)).toBe(true);
    expect(shouldMaterialize).toBe(false);
  });

  it('does not create a generic tool placeholder for AskUserQuestion', () => {
    expect(__streamThinkingTesting.shouldCreateStreamingToolPlaceholder('AskUserQuestion')).toBe(false);
    expect(__streamThinkingTesting.shouldCreateStreamingToolPlaceholder('Bash')).toBe(true);
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
      'streamed thinking that should persist direct',
      'directly',
    );

    expect(snapshot).toEqual({
      id: 'msg-789_thinking',
      content: 'streamed thinking that should persist directly',
    });
  });

  it('dedupes final thinking against live partial and buffered tails', () => {
    const snapshot = __streamThinkingTesting.resolveThinkingPersistence(
      'msg-dupe',
      [{ type: 'thinking', thinking: 'The user asked. Answer directly.' }] as any[],
      'The user asked. Answer directly.',
      'directly.',
    );

    expect(snapshot).toEqual({
      id: 'msg-dupe_thinking',
      content: 'The user asked. Answer directly.',
    });
  });

  it('commits thinking once and clears live partial thinking', () => {
    const store = useChatStore.getState();
    store.ensureTab('tab-1');
    store.updatePartialThinking('tab-1', 'The user asked. Answer directly.');

    const thinkingPersistence = __streamThinkingTesting.resolveThinkingPersistence(
      'msg-final',
      [{ type: 'thinking', thinking: 'The user asked. Answer directly.' }] as any[],
      useChatStore.getState().getTab('tab-1')?.partialThinking,
      'directly.',
    );

    const firstCommit = __streamThinkingTesting.commitThinkingBeforeAssistantText({
      tabId: 'tab-1',
      msgUuid: 'msg-final',
      thinkingPersistence,
      timestamp: 100,
    });
    const secondCommit = __streamThinkingTesting.commitThinkingBeforeAssistantText({
      tabId: 'tab-1',
      msgUuid: 'msg-final',
      thinkingPersistence,
      timestamp: 101,
    });

    const tab = useChatStore.getState().getTab('tab-1');
    expect(firstCommit).toBe(true);
    expect(secondCommit).toBe(true);
    expect(tab?.messages.filter((message) => message.type === 'thinking')).toEqual([
      expect.objectContaining({
        id: 'msg-final__thinking_committed',
        content: 'The user asked. Answer directly.',
      }),
    ]);
    expect(tab?.partialThinking).toBe('');
  });

  it('suppresses provider thinking display when the effective thinking level is off', () => {
    const store = useChatStore.getState();
    store.ensureTab('tab-thinking-off');
    store.setSessionMeta('tab-thinking-off', { snapshotThinking: 'off' });

    __streamThinkingTesting.appendLiveThinkingDelta('tab-thinking-off', 'hidden thought');
    const thinkingPersistence = __streamThinkingTesting.resolveThinkingPersistence(
      'msg-hidden',
      [{ type: 'thinking', thinking: 'hidden thought' }] as any[],
      useChatStore.getState().getTab('tab-thinking-off')?.partialThinking,
    );
    const committed = __streamThinkingTesting.commitThinkingBeforeAssistantText({
      tabId: 'tab-thinking-off',
      msgUuid: 'msg-hidden',
      thinkingPersistence,
      timestamp: 150,
    });

    const tab = useChatStore.getState().getTab('tab-thinking-off');
    expect(committed).toBe(false);
    expect(tab?.partialThinking).toBe('');
    expect(tab?.messages.filter((message) => message.type === 'thinking')).toHaveLength(0);
  });

  it('clears stale streaming text for AskUserQuestion without dropping thinking', () => {
    const store = useChatStore.getState();
    store.ensureTab('tab-question');
    store.updatePartialMessage('tab-question', 'raw question wording');
    store.updatePartialThinking('tab-question', 'thinking before question');

    __streamThinkingTesting.clearLivePartialText('tab-question');

    const tab = useChatStore.getState().getTab('tab-question');
    expect(tab?.partialText).toBe('');
    expect(tab?.partialThinking).toBe('thinking before question');
    expect(tab?.isStreaming).toBe(true);
  });

  it('preserves pure thinking-only assistant snapshots as live thinking without duplicating later tail deltas', () => {
    const store = useChatStore.getState();
    store.ensureTab('tab-live-thinking');
    store.updatePartialThinking('tab-live-thinking', 'The user asked ');

    const preserved = __streamThinkingTesting.preserveLiveThinkingSnapshot({
      tabId: 'tab-live-thinking',
      thinkingPersistence: {
        id: 'msg-thinking',
        content: 'The user asked directly.',
      },
    });
    __streamThinkingTesting.appendLiveThinkingDelta('tab-live-thinking', 'directly.');

    const tab = useChatStore.getState().getTab('tab-live-thinking');
    expect(preserved).toBe(true);
    expect(tab?.messages.filter((message) => message.type === 'thinking')).toHaveLength(0);
    expect(tab?.partialThinking).toBe('The user asked directly.');
    expect(tab?.isStreaming).toBe(true);
  });

  it('keeps raw thinking appends exact for normal adjacent deltas', () => {
    const store = useChatStore.getState();
    store.ensureTab('tab-overlap');

    store.updatePartialThinking('tab-overlap', 're');
    store.updatePartialThinking('tab-overlap', 'enter');
    store.updatePartialThinking('tab-overlap', 'r');

    expect(useChatStore.getState().getTab('tab-overlap')?.partialThinking).toBe('reenterr');
  });

  it('commits streamed thinking at a result-only turn boundary before partials clear', () => {
    const store = useChatStore.getState();
    store.ensureTab('tab-result');
    store.updatePartialThinking('tab-result', 'result-only thinking');

    const committed = __streamThinkingTesting.commitThinkingAtTurnBoundary({
      tabId: 'tab-result',
      msgUuid: 'result-msg',
      timestamp: 200,
    });

    const tab = useChatStore.getState().getTab('tab-result');
    expect(committed).toBe(true);
    expect(tab?.messages.filter((message) => message.type === 'thinking')).toEqual([
      expect.objectContaining({
        id: 'result-msg__thinking_committed',
        content: 'result-only thinking',
      }),
    ]);
    expect(tab?.partialThinking).toBe('');
  });
});
