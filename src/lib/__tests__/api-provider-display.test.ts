import { describe, it, expect } from 'vitest';
import {
  getModelDisplayOptions,
  getSelectedModelOptionId,
  shouldUseProviderModelOptions,
} from '../api-provider';
import type { ApiProvider } from '../../stores/providerStore';

function provider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'p1',
    name: 'Provider',
    baseUrl: 'https://api.example.com',
    apiFormat: 'anthropic',
    modelMappings: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('provider model display options', () => {
  it('uses official model options when no provider is active', () => {
    const options = getModelDisplayOptions(null);
    expect(options.map((option) => option.short)).toEqual([
      'Opus 4.7',
      'Opus 4.6',
      'Opus 4.6 (1M)',
      'Sonnet 4.6',
      'Haiku 4.5',
    ]);
  });

  it('uses only configured non-Claude provider models without Claude suffixes', () => {
    const p = provider({
      modelMappings: [
        { tier: 'opus', providerModel: 'glm-5' },
        { tier: 'sonnet', providerModel: 'glm-5-turbo' },
        { tier: 'haiku', providerModel: 'glm-4.7' },
      ],
    });

    expect(shouldUseProviderModelOptions(p)).toBe(true);
    expect(getModelDisplayOptions(p).map((option) => option.short)).toEqual([
      'glm-5',
      'glm-5-turbo',
      'glm-4.7',
    ]);
  });

  it('deduplicates provider models mapped from multiple tiers', () => {
    const p = provider({
      modelMappings: [
        { tier: 'opus', providerModel: 'kimi-for-coding' },
        { tier: 'sonnet', providerModel: 'kimi-for-coding' },
        { tier: 'haiku', providerModel: 'kimi-for-coding' },
      ],
    });

    expect(getModelDisplayOptions(p).map((option) => option.short)).toEqual([
      'kimi-for-coding',
    ]);
  });

  it('keeps official options for Claude-only mappings', () => {
    const p = provider({
      modelMappings: [
        { tier: 'opus', providerModel: 'claude-opus-4-7' },
        { tier: 'sonnet', providerModel: 'claude-sonnet-4-6' },
        { tier: 'haiku', providerModel: 'claude-haiku-4-5-20251001' },
      ],
    });

    expect(shouldUseProviderModelOptions(p)).toBe(false);
    expect(getModelDisplayOptions(p)).toHaveLength(5);
  });

  it('selects the configured provider option for any Claude model in the same tier', () => {
    const options = getModelDisplayOptions(provider({
      modelMappings: [
        { tier: 'opus', providerModel: 'glm-5' },
        { tier: 'sonnet', providerModel: 'glm-5-turbo' },
      ],
    }));

    expect(getSelectedModelOptionId('claude-opus-4-6', options)).toBe('claude-opus-4-7');
    expect(getSelectedModelOptionId('claude-sonnet-4-6', options)).toBe('claude-sonnet-4-6');
  });
});
