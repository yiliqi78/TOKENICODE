import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// --- Types ---

export type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'black' | 'blue' | 'orange' | 'green';
export type SecondaryPanelTab = 'files' | 'skills';
export type ModelId = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
export type SessionMode = 'code' | 'ask' | 'plan' | 'bypass';
export type Locale = 'zh' | 'en';
export type ApiProviderMode = 'inherit' | 'official' | 'custom';
export type ApiFormat = 'anthropic' | 'openai';
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export interface ModelMapping {
  tier: 'opus' | 'sonnet' | 'haiku';
  providerModel: string;
}

// --- Model options (display mapping) ---

export const MODEL_OPTIONS: { id: ModelId; label: string; short: string }[] = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', short: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', short: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', short: 'Haiku 4.5' },
];

// --- Store State & Actions ---

interface SettingsState {
  theme: Theme;
  colorTheme: ColorTheme;
  sidebarOpen: boolean;
  secondaryPanelOpen: boolean;
  secondaryPanelTab: SecondaryPanelTab;
  secondaryPanelWidth: number;
  settingsOpen: boolean;
  workingDirectory: string;
  selectedModel: ModelId;
  sessionMode: SessionMode;
  locale: Locale;
  /** Global UI font size in px (default 18) */
  fontSize: number;
  /** Sidebar width in px (default 280) */
  sidebarWidth: number;
  /** Whether the CLI setup wizard has been completed or skipped */
  setupCompleted: boolean;
  /** Thinking effort level: off disables, low/medium/high/max set effort */
  thinkingLevel: ThinkingLevel;
  /** Whether a newer version is available (set by auto-check on startup) */
  updateAvailable: boolean;
  /** Version string of the available update */
  updateVersion: string;
  /** Last app version the user has seen the changelog for */
  lastSeenVersion: string;

  // --- API Provider (TK-303) ---
  /** API provider mode: inherit system config / force official / custom third-party */
  apiProviderMode: ApiProviderMode;
  /** Custom provider display name (e.g. "OpenRouter") */
  customProviderName: string;
  /** Custom provider API endpoint URL */
  customProviderBaseUrl: string;
  /** Model name mappings for custom provider */
  customProviderModelMappings: ModelMapping[];
  /** API format used by the custom provider */
  customProviderApiFormat: ApiFormat;

  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  /** Whether the floating agent panel is open */
  agentPanelOpen: boolean;

  toggleSidebar: () => void;
  toggleSecondaryPanel: () => void;
  toggleAgentPanel: () => void;
  setSecondaryTab: (tab: SecondaryPanelTab) => void;
  setSecondaryPanelWidth: (width: number) => void;
  toggleSettings: () => void;
  setWorkingDirectory: (dir: string) => void;
  setSelectedModel: (model: ModelId) => void;
  setSessionMode: (mode: SessionMode) => void;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  setFontSize: (size: number) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  setSidebarWidth: (width: number) => void;
  setSetupCompleted: (completed: boolean) => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
  setUpdateAvailable: (available: boolean, version?: string) => void;
  setLastSeenVersion: (version: string) => void;

  // --- API Provider actions ---
  setApiProviderMode: (mode: ApiProviderMode) => void;
  setCustomProviderName: (name: string) => void;
  setCustomProviderBaseUrl: (url: string) => void;
  setCustomProviderModelMappings: (mappings: ModelMapping[]) => void;
  setCustomProviderApiFormat: (format: ApiFormat) => void;
}

// --- Theme cycle order ---

const themeCycle: Theme[] = ['light', 'dark', 'system'];

function nextTheme(current: Theme): Theme {
  const idx = themeCycle.indexOf(current);
  return themeCycle[(idx + 1) % themeCycle.length];
}

// --- Store ---

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      colorTheme: 'black',
      sidebarOpen: true,
      secondaryPanelOpen: false,
      secondaryPanelTab: 'files',
      secondaryPanelWidth: 300,
      settingsOpen: false,
      agentPanelOpen: false,
      workingDirectory: '',
      selectedModel: 'claude-opus-4-6',
      sessionMode: 'code',
      locale: 'zh',
      fontSize: 18,
      sidebarWidth: 280,
      setupCompleted: false,
      thinkingLevel: 'high' as ThinkingLevel,
      updateAvailable: false,
      updateVersion: '',
      lastSeenVersion: '',

      // API Provider defaults
      apiProviderMode: 'inherit',
      customProviderName: '',
      customProviderBaseUrl: '',
      customProviderModelMappings: [],
      customProviderApiFormat: 'anthropic',

      toggleTheme: () =>
        set((state) => ({ theme: nextTheme(state.theme) })),

      setTheme: (theme) => set(() => ({ theme })),

      setColorTheme: (colorTheme) => set(() => ({ colorTheme })),

      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      toggleSecondaryPanel: () =>
        set((state) => ({
          secondaryPanelOpen: !state.secondaryPanelOpen,
        })),

      toggleAgentPanel: () =>
        set((state) => ({ agentPanelOpen: !state.agentPanelOpen })),

      setSecondaryTab: (tab) =>
        set(() => ({
          secondaryPanelTab: tab,
          secondaryPanelOpen: true,
        })),

      setSecondaryPanelWidth: (width) =>
        set(() => ({ secondaryPanelWidth: width })),

      toggleSettings: () =>
        set((state) => ({
          settingsOpen: !state.settingsOpen,
          // Clear update badge when opening settings
          ...(!state.settingsOpen && state.updateAvailable ? { updateAvailable: false } : {}),
        })),

      setWorkingDirectory: (dir) =>
        set(() => ({ workingDirectory: dir })),

      setSelectedModel: (model) =>
        set(() => ({ selectedModel: model })),

      setSessionMode: (mode) =>
        set(() => ({ sessionMode: mode })),

      setLocale: (locale) =>
        set(() => ({ locale })),

      toggleLocale: () =>
        set((state) => ({ locale: state.locale === 'zh' ? 'en' : 'zh' })),

      setFontSize: (size) =>
        set(() => ({ fontSize: Math.max(10, Math.min(24, size)) })),

      increaseFontSize: () =>
        set((state) => ({ fontSize: Math.min(24, state.fontSize + 1) })),

      decreaseFontSize: () =>
        set((state) => ({ fontSize: Math.max(10, state.fontSize - 1) })),

      setSidebarWidth: (width) =>
        set(() => ({ sidebarWidth: Math.max(180, Math.min(450, width)) })),

      setSetupCompleted: (completed) =>
        set(() => ({ setupCompleted: completed })),

      setThinkingLevel: (level) =>
        set(() => ({ thinkingLevel: level })),

      setUpdateAvailable: (available, version) =>
        set(() => ({
          updateAvailable: available,
          ...(version !== undefined ? { updateVersion: version } : {}),
          ...(!available ? { updateVersion: '' } : {}),
        })),

      setLastSeenVersion: (version) =>
        set(() => ({ lastSeenVersion: version })),

      // API Provider setters
      setApiProviderMode: (mode) =>
        set(() => ({ apiProviderMode: mode })),

      setCustomProviderName: (name) =>
        set(() => ({ customProviderName: name })),

      setCustomProviderBaseUrl: (url) =>
        set(() => ({ customProviderBaseUrl: url })),

      setCustomProviderModelMappings: (mappings) =>
        set(() => ({ customProviderModelMappings: mappings })),

      setCustomProviderApiFormat: (format) =>
        set(() => ({ customProviderApiFormat: format })),
    }),
    {
      name: 'tokenicode-settings',
      version: 4,
      migrate: (persistedState: unknown, version: number) => {
        const persisted = persistedState as Record<string, unknown>;
        if (version === 0) {
          // Migrate legacy model IDs to current ones
          const legacyMap: Record<string, ModelId> = {
            'claude-opus-4-0': 'claude-opus-4-6',
            'claude-sonnet-4-0': 'claude-sonnet-4-6',
            'claude-haiku-3-5': 'claude-haiku-4-5',
          };
          const old = persisted.selectedModel as string;
          if (old && legacyMap[old]) {
            persisted.selectedModel = legacyMap[old];
          }
        }
        if (version < 2) {
          persisted.updateAvailable = false;
          persisted.updateVersion = '';
          persisted.lastSeenVersion = '';
        }
        if (version < 3) {
          persisted.apiProviderMode = 'inherit';
          persisted.customProviderName = '';
          persisted.customProviderBaseUrl = '';
          persisted.customProviderModelMappings = [];
          persisted.customProviderApiFormat = 'anthropic';
        }
        if (version < 4) {
          // Migrate boolean thinkingEnabled → ThinkingLevel
          const oldThinking = persisted.thinkingEnabled;
          persisted.thinkingLevel = oldThinking === false ? 'off' : 'high';
          delete persisted.thinkingEnabled;
        }
        return persisted;
      },
      partialize: (state) => ({
        theme: state.theme,
        colorTheme: state.colorTheme,
        sidebarOpen: state.sidebarOpen,
        secondaryPanelWidth: state.secondaryPanelWidth,
        // workingDirectory intentionally NOT persisted — app starts at WelcomeScreen
        selectedModel: state.selectedModel,
        sessionMode: state.sessionMode,
        locale: state.locale,
        fontSize: state.fontSize,
        sidebarWidth: state.sidebarWidth,
        setupCompleted: state.setupCompleted,
        thinkingLevel: state.thinkingLevel,
        updateAvailable: state.updateAvailable,
        updateVersion: state.updateVersion,
        lastSeenVersion: state.lastSeenVersion,
        apiProviderMode: state.apiProviderMode,
        customProviderName: state.customProviderName,
        customProviderBaseUrl: state.customProviderBaseUrl,
        customProviderModelMappings: state.customProviderModelMappings,
        customProviderApiFormat: state.customProviderApiFormat,
      }),
    },
  ),
);
