export interface ApiRetryStatus {
  attempt?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  errorStatus?: number;
  error?: string;
  updatedAt: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function buildApiRetryStatus(message: unknown, now = Date.now()): ApiRetryStatus {
  const root = asRecord(message) ?? {};
  const nested = asRecord(root.retry)
    ?? asRecord(root.retry_info)
    ?? asRecord(root.retryInfo)
    ?? asRecord(root.api_retry)
    ?? {};

  const pick = (...keys: string[]) => {
    for (const key of keys) {
      if (nested[key] !== undefined) return nested[key];
      if (root[key] !== undefined) return root[key];
    }
    return undefined;
  };

  return {
    attempt: finiteNumber(pick('attempt', 'retry_attempt', 'retryAttempt')),
    maxRetries: finiteNumber(pick('max_retries', 'maxRetries')),
    retryDelayMs: finiteNumber(pick('retry_delay_ms', 'retryDelayMs', 'delay_ms', 'delayMs')),
    errorStatus: finiteNumber(pick('error_status', 'errorStatus', 'status', 'status_code', 'statusCode')),
    error: stringValue(pick('error', 'error_message', 'errorMessage', 'message', 'code')),
    updatedAt: Math.max(0, now),
  };
}

export function isRateLimitRetry(status: ApiRetryStatus | undefined): boolean {
  if (!status) return false;
  if (status.errorStatus === 429) return true;
  return /429|rate.?limit|too.?many.?requests/i.test(status.error ?? '');
}

export function formatRetryDelaySeconds(ms: number | undefined): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  const seconds = Math.max(0, ms / 1000);
  return seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds));
}
