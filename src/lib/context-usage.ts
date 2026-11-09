import { is1MModel, resolveModelForProvider } from './api-provider';

export const CONTEXT_WINDOW_1M = 1_000_000;
export const CONTEXT_WINDOW_DEFAULT = 200_000;

/** Anthropic usage 结构里和「prompt 大小」有关的几个字段。 */
export interface PromptUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * 一次 API 请求的完整 prompt 大小 = 未命中缓存的 input + 新写缓存 + 命中缓存。
 *
 * Claude Code 开着 prompt cache，`input_tokens` 往往只有几百，上下文的大头都在
 * `cache_read_input_tokens` 里。要看「当前上下文占了多少」必须三项相加（#102）。
 */
export function promptSizeFromUsage(usage: PromptUsage | null | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
}

/** 上下文预警阈值：占用超过窗口的 60% 时在状态条提示 /compact。 */
export const CONTEXT_WARN_RATIO = 0.6;

/**
 * 自动 /compact 与预警实际使用的上下文大小。
 *
 * 优先用 message_start 记下的 `contextTokens`（最近一次主代理请求的完整 prompt）。
 * 没有流式事件（缺 --include-partial-messages）时退回 result 的 `input_tokens`，
 * 即旧口径，至少不比以前差。
 */
export function effectiveContextTokens(
  contextTokens: number | undefined,
  resultUsage: PromptUsage | null | undefined,
): number {
  if (contextTokens && contextTokens > 0) return contextTokens;
  return resultUsage?.input_tokens || 0;
}

/** 当前所选模型的上下文窗口大小（与 ChatPanel 状态条的预警阈值同一口径）。 */
export function contextWindowFor(selectedModel: string): number {
  return is1MModel(resolveModelForProvider(selectedModel)) ? CONTEXT_WINDOW_1M : CONTEXT_WINDOW_DEFAULT;
}

/** 上下文占用百分比：0-100 的整数，封顶 100。 */
export function contextUsagePercent(contextTokens: number, contextWindow: number): number {
  if (!contextWindow || contextTokens <= 0) return 0;
  return Math.min(100, Math.round((contextTokens / contextWindow) * 100));
}

/** 紧凑 token 数：1.2M / 85k / 640 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
