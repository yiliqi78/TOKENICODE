import { create } from 'zustand';
import { bridge, type ProvidersFile } from '../lib/tauri-bridge';

export interface ModelMapping {
  tier: 'opus' | 'sonnet' | 'haiku';
  providerModel: string;
}

export interface ApiProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: 'anthropic' | 'openai';
  apiKey?: string;
  modelMappings: ModelMapping[];
  extra_env?: Record<string, string>;
  preset?: string;
  createdAt: number;
  updatedAt: number;
}

interface ProviderState {
  providers: ApiProvider[];
  activeProviderId: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  save: () => Promise<void>;
  addProvider: (p: Omit<ApiProvider, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateProvider: (id: string, patch: Partial<ApiProvider>) => void;
  deleteProvider: (id: string) => void;
  setActive: (id: string | null) => void;
  getActive: () => ApiProvider | null;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

let _saveTimer: ReturnType<typeof setTimeout> | undefined;

function debouncedSave(state: ProviderState) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    state.save().catch((e) => console.error('[providerStore] save failed:', e));
  }, 500);
}

export const useProviderStore = create<ProviderState>()((set, get) => ({
  providers: [],
  activeProviderId: null,
  loaded: false,

  load: async () => {
    try {
      const data = await bridge.loadProviders();

      // If providers.json is empty, try migrating from old settingsStore data
      if (data.providers.length === 0) {
        const migrated = migrateFromSettingsStore();
        if (migrated) {
          data.providers = [migrated];
          data.activeProviderId = migrated.id;
          // Save migrated data
          await bridge.saveProviders(data);
          console.log('[providerStore] Migrated old API settings to provider:', migrated.name);
        }
      }

      set({
        providers: data.providers as ApiProvider[],
        activeProviderId: data.activeProviderId,
        loaded: true,
      });
    } catch (e) {
      console.error('[providerStore] load failed:', e);
      set({ loaded: true });
    }
  },

  save: async () => {
    const { providers, activeProviderId } = get();
    const data: ProvidersFile = {
      version: 1,
      activeProviderId,
      providers,
    };
    await bridge.saveProviders(data);
  },

  addProvider: (p) => {
    const now = Date.now();
    const newProvider: ApiProvider = {
      ...p,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ providers: [...s.providers, newProvider] }));
    debouncedSave(get());
  },

  updateProvider: (id, patch) => {
    set((s) => ({
      providers: s.providers.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
      ),
    }));
    debouncedSave(get());
  },

  deleteProvider: (id) => {
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      activeProviderId: s.activeProviderId === id ? null : s.activeProviderId,
    }));
    debouncedSave(get());
  },

  setActive: (id) => {
    set({ activeProviderId: id });
    debouncedSave(get());
  },

  getActive: () => {
    const { providers, activeProviderId } = get();
    if (!activeProviderId) return null;
    return providers.find((p) => p.id === activeProviderId) ?? null;
  },
}));

/**
 * Migrate from old settingsStore API fields to a new ApiProvider.
 * Returns null if no old config exists or mode is 'inherit'.
 */
function migrateFromSettingsStore(): ApiProvider | null {
  try {
    // Read old settings from localStorage (settingsStore persists there)
    const raw = localStorage.getItem('tokenicode-settings');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = parsed?.state;
    if (!state) return null;

    const mode = state.apiProviderMode;
    if (!mode || mode === 'inherit') return null;

    const now = Date.now();
    const provider: ApiProvider = {
      id: generateId(),
      name: state.customProviderName || (mode === 'official' ? 'Anthropic (官方)' : 'Custom'),
      baseUrl: mode === 'official' ? 'https://api.anthropic.com' : (state.customProviderBaseUrl || ''),
      apiFormat: (state.customProviderApiFormat || 'anthropic') as 'anthropic' | 'openai',
      modelMappings: Array.isArray(state.customProviderModelMappings)
        ? state.customProviderModelMappings.map((m: { tier: string; providerModel: string }) => ({
            tier: m.tier as 'opus' | 'sonnet' | 'haiku',
            providerModel: m.providerModel,
          }))
        : [],
      createdAt: now,
      updatedAt: now,
    };

    return provider;
  } catch {
    return null;
  }
}
