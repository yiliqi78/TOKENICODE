import { useSettingsStore, type ModelId } from '../stores/settingsStore';

/**
 * Resolve the UI-selected model ID to the provider's actual model name.
 * In custom mode, looks up the model mapping for the selected tier.
 * Returns the original model ID if no mapping is configured.
 */
export function resolveModelForProvider(selectedModel: ModelId): string {
  const state = useSettingsStore.getState();
  if (state.apiProviderMode !== 'custom') return selectedModel;

  // Map UI model ID to tier
  const tierMap: Record<ModelId, 'opus' | 'sonnet' | 'haiku'> = {
    'claude-opus-4-6': 'opus',
    'claude-sonnet-4-6': 'sonnet',
    'claude-haiku-4-5': 'haiku',
  };
  const tier = tierMap[selectedModel];
  if (!tier) return selectedModel;

  const mapping = state.customProviderModelMappings.find(
    (m) => m.tier === tier && m.providerModel,
  );
  return mapping?.providerModel || selectedModel;
}

/**
 * Stable fingerprint of the current API provider config.
 * Includes env vars AND model mappings so that any provider config change
 * invalidates the pre-warmed session.
 */
export function envFingerprint(): string {
  const state = useSettingsStore.getState();
  return JSON.stringify({
    env: buildCustomEnvVars() ?? null,
    mappings: state.apiProviderMode === 'custom' ? state.customProviderModelMappings : null,
  });
}

/**
 * Build custom environment variables for the Claude CLI process based on
 * the current API provider settings.
 *
 * - inherit: returns undefined (no env injection, use system config as-is)
 * - official: forces the official Anthropic endpoint
 * - custom: injects user-configured endpoint and API key sentinel
 *
 * Note: model name mapping is handled by resolveModelForProvider() which
 * translates the --model CLI argument directly, since Claude Code CLI
 * does not support ANTHROPIC_DEFAULT_*_MODEL env vars.
 */
export function buildCustomEnvVars(): Record<string, string> | undefined {
  const state = useSettingsStore.getState();

  switch (state.apiProviderMode) {
    case 'inherit':
      return undefined;

    case 'official':
      return {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      };

    case 'custom': {
      const env: Record<string, string> = {};

      if (state.customProviderBaseUrl) {
        env.ANTHROPIC_BASE_URL = state.customProviderBaseUrl;
      }

      // Sentinel value: Rust backend will substitute the real key from encrypted storage
      env.ANTHROPIC_API_KEY = 'USE_STORED_KEY';

      return env;
    }
  }
}
