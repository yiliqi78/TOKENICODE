import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// --- Types ---

export type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'black' | 'blue' | 'orange' | 'green';
export type SecondaryPanelTab = 'files' | 'skills';
export type ModelId = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
export type SessionMode = 'code' | 'ask' | 'plan' | 'bypass';
/** CLI permission mode for the SDK control protocol */
export type CliPermissionMode = 'acceptEdits' | 'default' | 'plan' | 'bypassPermissions';
export type Locale = 'zh' | 'en';

/** Map frontend session mode to CLI permission mode */
export function mapSessionModeToPermissionMode(mode: SessionMode): CliPermissionMode {
  switch (mode) {
    case 'code': return 'acceptEdits';
    case 'ask': return 'default';
    case 'plan': return 'plan';
    case 'bypass': return 'bypassPermissions';
  }
}
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

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
  /** Whether the update has been downloaded and is ready for restart (transient, not persisted) */
  updateDownloaded: boolean;
  /** Last app version the user has seen the changelog for */
  lastSeenVersion: string;

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
  setUpdateDownloaded: (downloaded: boolean) => void;
  setLastSeenVersion: (version: string) => void;
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
      selectedModel: 'claude-sonnet-4-6',
      sessionMode: 'bypass',
      locale: 'zh',
      fontSize: 18,
      sidebarWidth: 280,
      setupCompleted: false,
      thinkingLevel: 'medium' as ThinkingLevel,
      updateAvailable: false,
      updateVersion: '',
      updateDownloaded: false,
      lastSeenVersion: '',

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
          ...(!available ? { updateVersion: '', updateDownloaded: false } : {}),
        })),

      setUpdateDownloaded: (downloaded) =>
        set(() => ({ updateDownloaded: downloaded })),

      setLastSeenVersion: (version) =>
        set(() => ({ lastSeenVersion: version })),
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
      }),
    },
  ),
);

// --- Runtime mode switching via SDK control protocol ---
// When sessionMode changes and there's an active CLI session, send set_permission_mode.

let _skipNextModeSync = false;

/** Update frontend sessionMode WITHOUT sending set_permission_mode to CLI.
 *  Use when CLI already switched modes internally (e.g. after ExitPlanMode allow). */
export function setSessionModeLocal(mode: SessionMode): void {
  _skipNextModeSync = true;
  useSettingsStore.getState().setSessionMode(mode);
}

useSettingsStore.subscribe((state, prevState) => {
  if (state.sessionMode === prevState.sessionMode) return;

  if (_skipNextModeSync) {
    _skipNextModeSync = false;
    return;
  }

  const cliMode = mapSessionModeToPermissionMode(state.sessionMode);

  // bypass uses --dangerously-skip-permissions at startup; can't switch TO bypass at runtime
  if (cliMode === 'bypassPermissions') return;

  // Dynamically import to avoid circular deps
  Promise.all([
    import('../lib/tauri-bridge'),
    import('./chatStore'),
  ]).then(([{ bridge }, { useChatStore }]) => {
    const stdinId = useChatStore.getState().sessionMeta.stdinId;
    if (!stdinId) return; // No active session

    bridge.setPermissionMode(stdinId, cliMode).catch((err: unknown) => {
      console.error('[TOKENICODE] Failed to set permission mode:', err);
    });
  });
});
