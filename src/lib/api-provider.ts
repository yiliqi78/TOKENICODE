import { useProviderStore } from '../stores/providerStore';
import { useSettingsStore, type ModelId } from '../stores/settingsStore';

/**
 * Result of model resolution — either a mapped model name or an error.
 */
export type ModelResolution =
  | { ok: true; model: string }
  | { ok: false; reason: 'no_mapping'; tier: string; providerName: string };

/**
 * Resolve the UI-selected model ID to the provider's actual model name,
 * returning an error if the provider has no mapping for the selected tier.
 */
export function resolveModelOrError(selectedModel: string): ModelResolution {
  const provider = useProviderStore.getState().getActive();
  if (!provider) return { ok: true, model: selectedModel };

  // 1. Check direct model ID mapping first (e.g. 'claude-opus-4-7' → 'glm-5')
  const directMapping = provider.modelMappings.find(
    (m) => m.tier === selectedModel && m.providerModel,
  );
  if (directMapping?.providerModel) {
    return { ok: true, model: directMapping.providerModel };
  }

  // 2. Fall back to tier mapping
  const tierMap: Record<string, 'opus' | 'sonnet' | 'haiku'> = {
    'claude-opus-4-7-1m': 'opus',
    'claude-opus-4-7': 'opus',
    'claude-opus-4-6-1m': 'opus',
    'claude-opus-4-6': 'opus',
    'claude-sonnet-4-6': 'sonnet',
    'claude-haiku-4-5-20251001': 'haiku',
  };
  const tier = tierMap[selectedModel];
  if (!tier) return { ok: true, model: selectedModel };

  const mapping = provider.modelMappings.find(
    (m) => m.tier === tier && m.providerModel,
  );
  if (!mapping?.providerModel) {
    return { ok: false, reason: 'no_mapping', tier, providerName: provider.name };
  }
  return { ok: true, model: mapping.providerModel };
}

/**
 * Resolve the UI-selected model ID to the provider's actual model name.
 * When a provider is active, looks up the model mapping for the selected tier.
 * Returns the original model ID if no mapping is configured (silent fallback).
 */
/** Map internal model IDs to CLI-expected format.
 *  Opus 4.7 ships with 1M context by default, so no [1m] suffix is needed. */
const CLI_MODEL_MAP: Partial<Record<ModelId, string>> = {};

export function resolveModelForProvider(selectedModel: string): string {
  const r = resolveModelOrError(selectedModel);
  const model = r.ok ? r.model : selectedModel;
  return CLI_MODEL_MAP[model as ModelId] ?? model;
}

/**
 * Stable fingerprint of the current API provider config.
 * Any provider config change invalidates the pre-warmed session.
 */
export function envFingerprint(): string {
  const { activeProviderId, providers } = useProviderStore.getState();
  const provider = providers.find((p) => p.id === activeProviderId);
  return JSON.stringify({
    activeProviderId,
    updatedAt: provider?.updatedAt ?? 0,
  });
}

/**
 * Stable hash of the spawn-time CLI configuration.
 *
 * Captures the 4 dimensions whose change requires kill + respawn of the CLI
 * process: active provider, selected model, thinking level, and the provider's
 * own config `updatedAt` (base URL / API key / mappings).
 *
 * Deliberately EXCLUDES `sessionMode` — mode switches go through the runtime
 * `set_permission_mode` SDK control protocol (see settingsStore.ts:364-389)
 * and must NOT trigger a respawn. See v3 plan appendix E.2 H2.
 */
export function spawnConfigHash(): string {
  const providerState = useProviderStore.getState();
  const settings = useSettingsStore.getState();
  const activeProvider = providerState.getActive();
  return [
    providerState.activeProviderId ?? '',
    settings.selectedModel,
    settings.thinkingLevel,
    activeProvider?.updatedAt ?? 0,
  ].join('|');
}
