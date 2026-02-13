import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// --- Types ---

export type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'purple' | 'orange' | 'green' | 'liquidglass';
export type SecondaryPanelTab = 'files' | 'agents' | 'skills' | 'mcp';
export type ModelId = 'claude-opus-4-0' | 'claude-sonnet-4-0' | 'claude-haiku-3-5';
export type SessionMode = 'code' | 'ask' | 'plan' | 'bypass';
export type Locale = 'zh' | 'en';

// --- Model options (display mapping) ---

export const MODEL_OPTIONS: { id: ModelId; label: string; short: string }[] = [
  { id: 'claude-opus-4-0', label: 'Claude Opus 4.6', short: 'Opus 4.6' },
  { id: 'claude-sonnet-4-0', label: 'Claude Sonnet 4.6', short: 'Sonnet 4.6' },
  { id: 'claude-haiku-3-5', label: 'Claude Haiku 4.5', short: 'Haiku 4.5' },
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
  /** Global UI font size in px (default 14) */
  fontSize: number;
  /** Sidebar width in px (default 260) */
  sidebarWidth: number;

  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  toggleSidebar: () => void;
  toggleSecondaryPanel: () => void;
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
      colorTheme: 'purple',
      sidebarOpen: true,
      secondaryPanelOpen: false,
      secondaryPanelTab: 'files',
      secondaryPanelWidth: 300,
      settingsOpen: false,
      workingDirectory: '',
      selectedModel: 'claude-opus-4-0',
      sessionMode: 'code',
      locale: 'zh',
      fontSize: 14,
      sidebarWidth: 260,

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

      setSecondaryTab: (tab) =>
        set(() => ({
          secondaryPanelTab: tab,
          secondaryPanelOpen: true,
        })),

      setSecondaryPanelWidth: (width) =>
        set(() => ({ secondaryPanelWidth: width })),

      toggleSettings: () =>
        set((state) => ({ settingsOpen: !state.settingsOpen })),

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
    }),
    {
      name: 'tokenicode-settings',
      partialize: (state) => ({
        theme: state.theme,
        colorTheme: state.colorTheme,
        sidebarOpen: state.sidebarOpen,
        secondaryPanelWidth: state.secondaryPanelWidth,
        workingDirectory: state.workingDirectory,
        selectedModel: state.selectedModel,
        sessionMode: state.sessionMode,
        locale: state.locale,
        fontSize: state.fontSize,
        sidebarWidth: state.sidebarWidth,
      }),
    },
  ),
);
