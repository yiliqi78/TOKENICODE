import { useProviderStore, type ApiProvider, type ModelMapping } from '../stores/providerStore';
import { MODEL_OPTIONS, useSettingsStore, type ModelId } from '../stores/settingsStore';

/**
 * Canonical tier mapping from official ModelId to provider tier key.
 * Defined once here and imported by ModelSelector, GeneralTab, etc.
 */
export const TIER_MAP: Record<string, 'opus' | 'sonnet' | 'haiku'> = {
  'claude-opus-4-7-1m': 'opus',
  'claude-opus-4-7': 'opus',
  'claude-opus-4-6-1m': 'opus',
  'claude-opus-4-6[1m]': 'opus',
  'claude-opus-4-6': 'opus',
  'claude-sonnet-4-6': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
};

const FIXED_MODEL_TIERS = new Set(['opus', 'sonnet', 'haiku']);
const MODEL_TIER_ORDER = ['opus', 'sonnet', 'haiku'];
const DEFAULT_MODEL_FOR_TIER: Record<string, ModelId> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

export interface ModelDisplayOption {
  id: string;
  label: string;
  short: string;
  mapped: boolean;
  isExtra: boolean;
  providerModel?: string;
  sourceTier?: string;
}

function officialModelDisplayOptions(): ModelDisplayOption[] {
  return MODEL_OPTIONS.map((model) => ({
    id: model.id,
    label: model.label,
    short: model.short,
    mapped: false,
    isExtra: false,
  }));
}

function isClaudeProviderModel(model: string): boolean {
  return model.toLowerCase().includes('claude');
}

function getFilledMappings(provider: ApiProvider): ModelMapping[] {
  return provider.modelMappings.filter((mapping) => mapping.providerModel.trim().length > 0);
}

function mappingOrder(mapping: ModelMapping): number {
  const fixedIndex = MODEL_TIER_ORDER.indexOf(mapping.tier);
  return fixedIndex === -1 ? MODEL_TIER_ORDER.length : fixedIndex;
}

function providerModelShortName(providerModel: string): string {
  const parts = providerModel.split('/');
  return parts[parts.length - 1] || providerModel;
}

export function shouldUseProviderModelOptions(provider: ApiProvider | null): boolean {
  if (!provider) return false;
  const filled = getFilledMappings(provider);
  if (filled.length === 0) return false;
  return filled.some((mapping) => !isClaudeProviderModel(mapping.providerModel));
}

export function getModelDisplayOptions(provider: ApiProvider | null): ModelDisplayOption[] {
  if (!provider || !shouldUseProviderModelOptions(provider)) {
    return officialModelDisplayOptions();
  }

  const seenProviderModels = new Set<string>();
  const options = getFilledMappings(provider)
    .slice()
    .sort((a, b) => mappingOrder(a) - mappingOrder(b))
    .flatMap((mapping): ModelDisplayOption[] => {
      const providerModel = mapping.providerModel.trim();
      const dedupeKey = providerModel.toLowerCase();
      if (seenProviderModels.has(dedupeKey)) return [];
      seenProviderModels.add(dedupeKey);

      const isExtra = !FIXED_MODEL_TIERS.has(mapping.tier);
      const id = isExtra
        ? (mapping.tier.trim() || providerModel)
        : DEFAULT_MODEL_FOR_TIER[mapping.tier];
      if (!id) return [];

      return [{
        id,
        label: providerModel,
        short: providerModelShortName(providerModel),
        mapped: true,
        isExtra,
        providerModel,
        sourceTier: mapping.tier,
      }];
    });

  return options.length > 0 ? options : officialModelDisplayOptions();
}

export function getSelectedModelOptionId(
  selectedModel: string,
  options: readonly ModelDisplayOption[],
): string {
  if (options.some((option) => option.id === selectedModel)) return selectedModel;

  const selectedTier = TIER_MAP[selectedModel];
  if (selectedTier) {
    const tierOption = options.find((option) => option.sourceTier === selectedTier);
    if (tierOption) return tierOption.id;
  }

  const providerModelOption = options.find((option) => option.providerModel === selectedModel);
  return providerModelOption?.id ?? selectedModel;
}

/**
 * Check whether the given model ID (or the currently selected model) uses
 * the 1M context window variant.
 *
 * Canonical Opus 4.7 is 1M by default. Explicit variants can advertise 1M
 * either via a `-1m` suffix (legacy UI ids) or a `[1m]` marker (provider ids).
 */
export function is1MModel(modelId?: string): boolean {
  const id = modelId ?? useSettingsStore.getState().selectedModel;
  const lower = id.toLowerCase();
  return lower === 'claude-opus-4-7'
    || lower.endsWith('-1m')
    || lower.includes('[1m]');
}

/**
 * Return the auto-compact token threshold for the given model.
 * 80% of context window: 160K for 200K models, 800K for 1M models.
 */
export function getAutoCompactThreshold(modelId?: string): number {
  return is1MModel(modelId) ? 800_000 : 160_000;
}

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

  // 2. Fall back to tier mapping (uses canonical TIER_MAP)
  const tier = TIER_MAP[selectedModel];
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
 * Map internal model IDs to CLI-expected format.
 *
 * Canonical 4.7 stays plain because it ships with 1M context by default.
 * Legacy 4.7-1m selections normalize to the canonical 4.7 id, while explicit
 * 4.6 1M variants stay intact so the CLI can request the larger window.
 */
const CLI_MODEL_MAP: Partial<Record<ModelId, string>> = {
  'claude-opus-4-7-1m': 'claude-opus-4-7',
  'claude-opus-4-6-1m': 'claude-opus-4-6[1m]',
};

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
