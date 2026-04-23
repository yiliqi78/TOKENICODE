/**
 * Tests for spawnConfigHash — the stable fingerprint used to detect config
 * drift between a CLI process's spawn time and subsequent user submissions.
 *
 * Phase 2 §2.1 + appendix E.2 H2:
 * - hash MUST react to: providerId, selectedModel, thinkingLevel, and the
 *   active provider's `updatedAt` (captures base URL / key / mapping edits)
 * - hash MUST NOT react to sessionMode — mode changes go through the
 *   runtime `set_permission_mode` control protocol, not kill + respawn.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnConfigHash } from '../lib/api-provider';
import { useSettingsStore } from '../stores/settingsStore';
import { useProviderStore } from '../stores/providerStore';
import type { ApiProvider } from '../stores/providerStore';

function makeProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  const now = Date.now();
  return {
    id: 'p1',
    name: 'Test Provider',
    baseUrl: 'https://api.example.com',
    apiFormat: 'anthropic',
    apiKey: 'sk-test',
    modelMappings: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  // Reset provider store — no active provider, no providers.
  useProviderStore.setState({
    providers: [],
    activeProviderId: null,
    loaded: true,
  });
  // Reset settings relevant to the hash.
  useSettingsStore.setState({
    selectedModel: 'claude-sonnet-4-6',
    thinkingLevel: 'medium',
    sessionMode: 'code',
  });
});

describe('spawnConfigHash', () => {
  it('returns a stable string under unchanged config', () => {
    const a = spawnConfigHash();
    const b = spawnConfigHash();
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('changes when selectedModel changes', () => {
    const before = spawnConfigHash();
    useSettingsStore.setState({ selectedModel: 'claude-opus-4-7' });
    const after = spawnConfigHash();
    expect(after).not.toBe(before);
  });

  it('changes when thinkingLevel changes', () => {
    const before = spawnConfigHash();
    useSettingsStore.setState({ thinkingLevel: 'max' });
    const after = spawnConfigHash();
    expect(after).not.toBe(before);
  });

  it('changes when activeProviderId changes', () => {
    const p1 = makeProvider({ id: 'p1' });
    const p2 = makeProvider({ id: 'p2', name: 'Other', updatedAt: p1.updatedAt });
    useProviderStore.setState({ providers: [p1, p2], activeProviderId: 'p1' });
    const before = spawnConfigHash();
    useProviderStore.setState({ activeProviderId: 'p2' });
    const after = spawnConfigHash();
    expect(after).not.toBe(before);
  });

  it('changes when the active provider\'s updatedAt changes', () => {
    const p = makeProvider({ id: 'p1', updatedAt: 1000 });
    useProviderStore.setState({ providers: [p], activeProviderId: 'p1' });
    const before = spawnConfigHash();
    useProviderStore.setState({
      providers: [{ ...p, updatedAt: 2000 }],
      activeProviderId: 'p1',
    });
    const after = spawnConfigHash();
    expect(after).not.toBe(before);
  });

  it('DOES NOT change when sessionMode changes (E.2 H2)', () => {
    const before = spawnConfigHash();
    useSettingsStore.setState({ sessionMode: 'plan' });
    const mid = spawnConfigHash();
    useSettingsStore.setState({ sessionMode: 'ask' });
    const after = spawnConfigHash();
    expect(mid).toBe(before);
    expect(after).toBe(before);
  });

  it('handles no active provider (null) without throwing', () => {
    useProviderStore.setState({ providers: [], activeProviderId: null });
    expect(() => spawnConfigHash()).not.toThrow();
    const hash = spawnConfigHash();
    expect(typeof hash).toBe('string');
  });
});
