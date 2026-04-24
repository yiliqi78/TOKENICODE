import { beforeEach, describe, expect, it } from 'vitest';
import { parseSessionMessages } from '../session-loader';
import { useChatStore } from '../../stores/chatStore';
import { __streamThinkingTesting } from '../../hooks/useStreamProcessor';

describe('session-loader tool result recovery', () => {
  it('marks top-level tool_result records as completed even when output is empty', () => {
    const loaded = parseSessionMessages([
      {
        type: 'assistant',
        timestamp: 1,
        message: {
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo hi' } },
          ],
        },
      },
      {
        type: 'tool_result',
        timestamp: 2,
        tool_use_id: 'tool-1',
        tool_name: 'Bash',
        content: '',
      },
    ]);

    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0]).toMatchObject({
      id: 'tool-1',
      type: 'tool_use',
      toolName: 'Bash',
      toolCompleted: true,
    });
    expect(loaded.messages[0].toolResultContent).toBeUndefined();
  });

  it('binds top-level tool_use_result payloads to referenced tool cards', () => {
    const loaded = parseSessionMessages([
      {
        type: 'assistant',
        timestamp: 1,
        message: {
          content: [
            { type: 'tool_use', id: 'tool-2', name: 'Read', input: { path: '/tmp/a.txt' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: 2,
        tool_use_result: {
          stdout: 'file contents',
        },
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-2', content: '' },
          ],
        },
      },
    ]);

    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0]).toMatchObject({
      id: 'tool-2',
      type: 'tool_use',
      toolName: 'Read',
      toolCompleted: true,
      toolResultContent: 'file contents',
    });
  });

  it('treats empty top-level tool_use_result payloads as completed tool runs', () => {
    const loaded = parseSessionMessages([
      {
        type: 'assistant',
        timestamp: 1,
        message: {
          content: [
            { type: 'tool_use', id: 'tool-3', name: 'Grep', input: { pattern: 'todo' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: 2,
        tool_use_result: '',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-3', content: '' },
          ],
        },
      },
    ]);

    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0]).toMatchObject({
      id: 'tool-3',
      type: 'tool_use',
      toolName: 'Grep',
      toolCompleted: true,
    });
    expect(loaded.messages[0].toolResultContent).toBeUndefined();
  });

  it('binds top-level tool_result envelopes to the referenced tool card', () => {
    const loaded = parseSessionMessages([
      {
        type: 'assistant',
        timestamp: 1,
        message: {
          content: [
            { type: 'tool_use', id: 'tool-4', name: 'Glob', input: { path: 'src/**/*.ts' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: 2,
        tool_use_id: 'tool-4',
        tool_result: {
          output: 'src/lib/session-loader.ts',
        },
      },
    ]);

    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0]).toMatchObject({
      id: 'tool-4',
      type: 'tool_use',
      toolName: 'Glob',
      toolCompleted: true,
      toolResultContent: 'src/lib/session-loader.ts',
    });
  });
});

describe('background assistant finalization', () => {
  beforeEach(() => {
    useChatStore.setState({ tabs: new Map(), sessionCache: new Map() });
  });

  it('keeps committed thinking messages when background partials are cleared', () => {
    const store = useChatStore.getState();
    store.ensureTab('bg-tab');
    store.updatePartialMessage('bg-tab', 'draft answer');
    store.updatePartialThinking('bg-tab', 'draft thought');

    const thinkingPersistence = __streamThinkingTesting.resolveThinkingPersistence(
      'msg-bg',
      [{ type: 'text', text: 'final answer' }] as any[],
      'draft thought',
    );

    __streamThinkingTesting.commitThinkingBeforeAssistantText({
      tabId: 'bg-tab',
      msgUuid: 'msg-bg',
      thinkingPersistence,
      timestamp: 123,
    });

    __streamThinkingTesting.finalizeBackgroundAssistantStreamingState({
      tabId: 'bg-tab',
      hasTextBlock: true,
      hasAskUserQuestion: false,
      shouldMaterializeThinking: true,
      thinkingPersistence,
    });

    const tab = useChatStore.getState().getTab('bg-tab');
    expect(tab?.messages).toEqual([
      expect.objectContaining({
        id: 'msg-bg__thinking_committed',
        type: 'thinking',
        content: 'draft thought',
      }),
    ]);
    expect(tab?.partialText).toBe('');
    expect(tab?.partialThinking).toBe('');
    expect(tab?.isStreaming).toBe(false);
  });
});
