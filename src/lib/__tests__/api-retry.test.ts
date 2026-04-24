import { describe, expect, it } from 'vitest';
import {
  buildApiRetryStatus,
  formatRetryDelaySeconds,
  isRateLimitRetry,
} from '../api-retry';

describe('api retry status parsing', () => {
  it('parses direct api_retry fields from CLI stream events', () => {
    expect(buildApiRetryStatus({
      type: 'system',
      subtype: 'api_retry',
      attempt: 3,
      max_retries: 10,
      retry_delay_ms: 5200,
      error_status: 429,
      error: 'rate_limit',
    }, 123)).toEqual({
      attempt: 3,
      maxRetries: 10,
      retryDelayMs: 5200,
      errorStatus: 429,
      error: 'rate_limit',
      updatedAt: 123,
    });
  });

  it('parses nested retry payload variants defensively', () => {
    expect(buildApiRetryStatus({
      retry_info: {
        retryAttempt: '2',
        maxRetries: '8',
        delayMs: '1500',
        statusCode: '503',
        message: 'overloaded',
      },
    }, 456)).toEqual({
      attempt: 2,
      maxRetries: 8,
      retryDelayMs: 1500,
      errorStatus: 503,
      error: 'overloaded',
      updatedAt: 456,
    });
  });

  it('classifies 429 and rate-limit text as rate-limit retries', () => {
    expect(isRateLimitRetry(buildApiRetryStatus({ error_status: 429 }))).toBe(true);
    expect(isRateLimitRetry(buildApiRetryStatus({ error: 'rate_limit_exceeded' }))).toBe(true);
    expect(isRateLimitRetry(buildApiRetryStatus({ error_status: 503 }))).toBe(false);
  });

  it('formats retry delay without returning negative values', () => {
    expect(formatRetryDelaySeconds(5200)).toBe('5.2');
    expect(formatRetryDelaySeconds(12_000)).toBe('12');
    expect(formatRetryDelaySeconds(-500)).toBe('0.0');
  });
});
