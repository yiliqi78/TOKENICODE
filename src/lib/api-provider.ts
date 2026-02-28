import { useProviderStore } from '../stores/providerStore';
import type { ModelId } from '../stores/settingsStore';

/**
 * Resolve the UI-selected model ID to the provider's actual model name.
 * When a provider is active, looks up the model mapping for the selected tier.
 * Returns the original model ID if no mapping is configured.
 */
export function resolveModelForProvider(selectedModel: ModelId): string {
  const provider = useProviderStore.getState().getActive();
  if (!provider) return selectedModel;

  // Map UI model ID to tier
  const tierMap: Record<ModelId, 'opus' | 'sonnet' | 'haiku'> = {
    'claude-opus-4-6': 'opus',
    'claude-sonnet-4-6': 'sonnet',
    'claude-haiku-4-5': 'haiku',
  };
  const tier = tierMap[selectedModel];
  if (!tier) return selectedModel;

  const mapping = provider.modelMappings.find(
    (m) => m.tier === tier && m.providerModel,
  );
  return mapping?.providerModel || selectedModel;
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
