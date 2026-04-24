import { beforeEach, describe, expect, it } from 'vitest';
import { __streamRetryTesting } from '../useStreamProcessor';
import { useChatStore } from '../../stores/chatStore';

describe('api_retry stream UI state', () => {
  beforeEach(() => {
    useChatStore.setState({ tabs: new Map(), sessionCache: new Map() });
    useChatStore.getState().ensureTab('tab-retry');
  });

  it('stores api_retry metadata on the owning tab', () => {
    __streamRetryTesting.recordApiRetry('tab-retry', {
      type: 'system',
      subtype: 'api_retry',
      attempt: 1,
      max_retries: 10,
      retry_delay_ms: 2500,
      error_status: 429,
      error: 'rate_limit',
    });

    expect(useChatStore.getState().getTab('tab-retry')?.sessionMeta.apiRetry).toEqual(
      expect.objectContaining({
        attempt: 1,
        maxRetries: 10,
        retryDelayMs: 2500,
        errorStatus: 429,
        error: 'rate_limit',
      }),
    );
  });

  it('coalesces repeated api_retry events into one metadata slot', () => {
    __streamRetryTesting.recordApiRetry('tab-retry', {
      type: 'system',
      subtype: 'api_retry',
      attempt: 1,
      max_retries: 10,
    });
    __streamRetryTesting.recordApiRetry('tab-retry', {
      type: 'system',
      subtype: 'api_retry',
      attempt: 2,
      max_retries: 10,
    });

    const tab = useChatStore.getState().getTab('tab-retry');
    expect(tab?.messages).toHaveLength(0);
    expect(tab?.sessionMeta.apiRetry).toEqual(expect.objectContaining({
      attempt: 2,
      maxRetries: 10,
    }));
  });

  it('defines normal stream progress and terminal events as retry clear boundaries', () => {
    expect(__streamRetryTesting.shouldClearApiRetryForEvent({
      type: 'stream_event',
      event: { type: 'content_block_delta' },
    })).toBe(true);
    expect(__streamRetryTesting.shouldClearApiRetryForEvent({
      type: 'assistant',
    })).toBe(true);
    expect(__streamRetryTesting.shouldClearApiRetryForEvent({
      type: 'result',
    })).toBe(true);
    expect(__streamRetryTesting.shouldClearApiRetryForEvent({
      type: 'system',
      subtype: 'api_retry',
    })).toBe(false);
    expect(__streamRetryTesting.shouldClearApiRetryForEvent({
      type: 'system',
      subtype: 'status',
    })).toBe(false);
  });
});
