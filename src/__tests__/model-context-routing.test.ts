import { describe, it, expect, beforeEach, vi } from 'vitest';
import { is1MModel, getAutoCompactThreshold, resolveModelForProvider } from '../lib/api-provider';
import { useProviderStore } from '../stores/providerStore';

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
    configurable: true,
  });
});

beforeEach(() => {
  useProviderStore.setState({
    providers: [],
    activeProviderId: null,
    loaded: true,
  });
});

describe('model context routing', () => {
  it('treats Opus 4.7 and explicit 1M markers as 1M models', () => {
    expect(is1MModel('claude-opus-4-7')).toBe(true);
    expect(is1MModel('claude-opus-4-6-1m')).toBe(true);
    expect(is1MModel('mimo-v2-pro[1m]')).toBe(true);
    expect(is1MModel('claude-opus-4-6')).toBe(false);
    expect(getAutoCompactThreshold('claude-opus-4-7')).toBe(800_000);
    expect(getAutoCompactThreshold('claude-opus-4-6-1m')).toBe(800_000);
    expect(getAutoCompactThreshold('claude-opus-4-6')).toBe(160_000);
  });

  it('keeps the 4.6 1M variant and normalizes legacy 4.7-1m to 4.7', () => {
    expect(resolveModelForProvider('claude-opus-4-6-1m')).toBe('claude-opus-4-6[1m]');
    expect(resolveModelForProvider('claude-opus-4-7-1m')).toBe('claude-opus-4-7');
  });
});
