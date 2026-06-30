import { useActiveTab } from '../stores/chatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getContextWindowMax } from '../lib/model-context-windows';

export type ContextLevel = 'safe' | 'warning' | 'danger';

export interface ContextUsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  contextMax: number;
  contextUsed: number;
  percentage: number;
  level: ContextLevel;
}

/** Hook that computes context window usage for the active tab. */
export function useContextUsage(): ContextUsageInfo {
  const sessionMeta = useActiveTab((s) => s.sessionMeta);
  const selectedModel = useSettingsStore((s) => s.selectedModel);

  const totalInput = sessionMeta?.totalInputTokens ?? 0;
  const totalOutput = sessionMeta?.totalOutputTokens ?? 0;
  const totalCacheRead = sessionMeta?.totalCacheReadTokens ?? 0;
  const totalCacheCreation = sessionMeta?.totalCacheCreationTokens ?? 0;

  const model = sessionMeta?.spawnedModel || selectedModel;
  const contextMax = sessionMeta?.contextWindowMax || getContextWindowMax(model);
  const contextUsed = totalInput + totalOutput;
  const percentage = contextMax > 0 ? Math.min(100, (contextUsed / contextMax) * 100) : 0;
  const cacheHitRate = totalInput > 0 ? Math.round((totalCacheRead / totalInput) * 100) : 0;

  const level: ContextLevel =
    percentage > 80 ? 'danger' : percentage > 60 ? 'warning' : 'safe';

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    cacheHitRate,
    contextMax,
    contextUsed,
    percentage,
    level,
  };
}
