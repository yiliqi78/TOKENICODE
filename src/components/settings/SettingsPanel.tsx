import { useSettingsStore, MODEL_OPTIONS, ColorTheme } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';

const COLOR_THEMES: { id: ColorTheme; labelKey: string; preview: string; previewDark: string }[] = [
  {
    id: 'purple',
    labelKey: 'settings.purple',
    preview: '#7c3aed',
    previewDark: '#8b5cf6',
  },
  {
    id: 'orange',
    labelKey: 'settings.orange',
    preview: '#D97757',
    previewDark: '#E08A6D',
  },
  {
    id: 'green',
    labelKey: 'settings.green',
    preview: '#0d7d5f',
    previewDark: '#0a6a50',
  },
  {
    id: 'liquidglass',
    labelKey: 'settings.liquidglass',
    preview: '#0A84FF',
    previewDark: '#409CFF',
  },
];

export function SettingsPanel() {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme);
  const colorTheme = useSettingsStore((s) => s.colorTheme);
  const locale = useSettingsStore((s) => s.locale);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setColorTheme = useSettingsStore((s) => s.setColorTheme);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const setFontSize = useSettingsStore((s) => s.setFontSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) toggleSettings(); }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-[380px] max-h-[80vh] rounded-2xl bg-bg-card
        border border-border-subtle shadow-lg overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4
          border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">
            {t('settings.title')}
          </h2>
          <button onClick={toggleSettings}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary
              text-text-tertiary transition-smooth">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[calc(80vh-64px)]">

          {/* Row 1: Color Theme + Appearance */}
          <div className="flex gap-4">
            {/* Color Theme — compact circles */}
            <div className="flex-1">
              <h3 className="text-[11px] font-semibold text-text-muted uppercase
                tracking-wider mb-2">{t('settings.colorTheme')}</h3>
              <div className="flex gap-2">
                {COLOR_THEMES.map((ct) => (
                  <button
                    key={ct.id}
                    onClick={() => setColorTheme(ct.id)}
                    className="group relative"
                    title={t(ct.labelKey)}
                  >
                    <div
                      className={`w-7 h-7 rounded-full shadow-sm transition-smooth
                        ${colorTheme === ct.id
                          ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-card scale-110'
                          : 'hover:scale-110 opacity-75 hover:opacity-100'
                        }`}
                      style={{ background: ct.preview }}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Appearance — compact toggle */}
            <div className="flex-1">
              <h3 className="text-[11px] font-semibold text-text-muted uppercase
                tracking-wider mb-2">{t('settings.appearance')}</h3>
              <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
                {(['light', 'dark', 'system'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setTheme(m)}
                    className={`py-1.5 px-2.5 text-[11px] font-medium transition-smooth
                      border-r border-border-subtle last:border-r-0
                      ${theme === m
                        ? 'glass-tint bg-accent/10 text-accent'
                        : 'text-text-muted glass-hover-tint'
                      }`}
                  >
                    {t(`settings.${m}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Language + Font Size */}
          <div className="flex gap-4 items-end">
            {/* Language — compact toggle */}
            <div>
              <h3 className="text-[11px] font-semibold text-text-muted uppercase
                tracking-wider mb-2">{t('settings.language')}</h3>
              <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
                {(['zh', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className={`py-1.5 px-3 text-[11px] font-medium transition-smooth
                      border-r border-border-subtle last:border-r-0
                      ${locale === l
                        ? 'glass-tint bg-accent/10 text-accent'
                        : 'text-text-muted glass-hover-tint'
                      }`}
                  >
                    {l === 'zh' ? '中文' : 'EN'}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size — inline compact */}
            <div>
              <h3 className="text-[11px] font-semibold text-text-muted uppercase
                tracking-wider mb-2">{t('settings.fontSize')}</h3>
              <div className="inline-flex items-center rounded-lg border border-border-subtle
                overflow-hidden">
                <button
                  onClick={() => setFontSize(fontSize - 1)}
                  disabled={fontSize <= 10}
                  className="w-7 h-7 text-xs font-bold text-text-primary
                    glass-hover-tint transition-smooth
                    disabled:opacity-30 disabled:cursor-not-allowed
                    flex items-center justify-center border-r border-border-subtle"
                >-</button>
                <span className="w-10 text-center text-xs font-semibold text-text-primary">
                  {fontSize}px
                </span>
                <button
                  onClick={() => setFontSize(fontSize + 1)}
                  disabled={fontSize >= 24}
                  className="w-7 h-7 text-xs font-bold text-text-primary
                    glass-hover-tint transition-smooth
                    disabled:opacity-30 disabled:cursor-not-allowed
                    flex items-center justify-center border-l border-border-subtle"
                >+</button>
              </div>
            </div>
          </div>

          {/* Row 3: Default Model — compact grid */}
          <div>
            <h3 className="text-[11px] font-semibold text-text-muted uppercase
              tracking-wider mb-2">{t('settings.defaultModel')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {MODEL_OPTIONS.map((model) => (
                <button
                  key={model.id}
                  onClick={() => setSelectedModel(model.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5
                    rounded-lg text-[11px] font-medium transition-smooth
                    ${selectedModel === model.id
                      ? 'glass-tint bg-accent/10 text-accent border border-accent/30'
                      : 'text-text-muted glass-hover-tint border border-border-subtle'
                    }`}
                >
                  {selectedModel === model.id && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M3 8l4 4 6-7" />
                    </svg>
                  )}
                  {model.short}
                </button>
              ))}
            </div>
          </div>

          {/* About */}
          <div className="pt-2 border-t border-border-subtle">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-muted">TOKENICODE</span>
              <span className="text-[11px] text-text-tertiary">v0.1.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
