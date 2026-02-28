import { useSettingsStore, MODEL_OPTIONS, ColorTheme } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';

const COLOR_THEMES: { id: ColorTheme; labelKey: string; preview: string; previewDark: string }[] = [
  {
    id: 'black',
    labelKey: 'settings.black',
    preview: '#333333',
    previewDark: '#D0D0D0',
  },
  {
    id: 'blue',
    labelKey: 'settings.blue',
    preview: '#4E80F7',
    previewDark: '#6B9AFF',
  },
  {
    id: 'orange',
    labelKey: 'settings.orange',
    preview: '#C47252',
    previewDark: '#D4856A',
  },
  {
    id: 'green',
    labelKey: 'settings.green',
    preview: '#57A64B',
    previewDark: '#6DBF62',
  },
];

/* Mini app preview — simplified chat interface thumbnail */
function ThemePreview({ color }: { color: string }) {
  return (
    <div className="w-full aspect-[5/3] rounded-lg overflow-hidden border border-black/[0.06] bg-[#f5f5f5] dark:bg-[#1a1a1a] dark:border-white/[0.06] flex">
      {/* Sidebar */}
      <div className="w-[22%] border-r border-black/[0.06] dark:border-white/[0.06] p-2 flex flex-col gap-1.5">
        <div className="w-full h-2 rounded-full bg-black/[0.07] dark:bg-white/[0.08]" />
        <div className="w-[80%] h-2 rounded-full" style={{ background: color, opacity: 0.3 }} />
        <div className="w-[60%] h-2 rounded-full bg-black/[0.05] dark:bg-white/[0.06]" />
      </div>
      {/* Main content */}
      <div className="flex-1 flex flex-col p-2.5 gap-2">
        {/* Messages */}
        <div className="flex-1 flex flex-col gap-1.5 justify-center">
          <div className="w-[65%] h-2.5 rounded bg-black/[0.06] dark:bg-white/[0.07]" />
          <div className="w-[45%] h-2.5 rounded bg-black/[0.06] dark:bg-white/[0.07]" />
          <div className="w-[75%] h-2.5 rounded bg-black/[0.04] dark:bg-white/[0.05] self-end" />
        </div>
        {/* Input bar */}
        <div className="flex items-center gap-1">
          <div className="flex-1 h-3.5 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08]" />
          <div className="w-3.5 h-3.5 rounded flex-shrink-0" style={{ background: color }} />
        </div>
      </div>
    </div>
  );
}

export function GeneralTab() {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme);
  const colorTheme = useSettingsStore((s) => s.colorTheme);
  const locale = useSettingsStore((s) => s.locale);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setColorTheme = useSettingsStore((s) => s.setColorTheme);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const setFontSize = useSettingsStore((s) => s.setFontSize);

  return (
    <div className="space-y-6">
      {/* Theme Color — single row of 4 */}
      <div>
        <h3 className="text-[13px] font-medium text-text-primary mb-3">{t('settings.colorTheme')}</h3>
        <div className="grid grid-cols-4 gap-3">
          {COLOR_THEMES.map((ct) => (
            <button
              key={ct.id}
              onClick={() => setColorTheme(ct.id)}
              title={t(ct.labelKey)}
              className={`group relative rounded-xl p-2 transition-smooth text-left
                ${colorTheme === ct.id
                  ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-card bg-accent/[0.03]'
                  : 'hover:scale-[1.02] border border-border-subtle hover:border-black/10 dark:hover:border-white/10'
                }`}
            >
              <ThemePreview color={ct.preview} />
            </button>
          ))}
        </div>
      </div>

      {/* Settings row */}
      <div className="flex items-start gap-8 flex-wrap">
        {/* Appearance */}
        <div>
          <h3 className="text-[13px] font-medium text-text-primary mb-2">{t('settings.appearance')}</h3>
          <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
            {(['light', 'dark', 'system'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTheme(m)}
                className={`py-1.5 px-3 text-[13px] font-medium transition-smooth
                  border-r border-border-subtle last:border-r-0 whitespace-nowrap
                  ${theme === m
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:bg-bg-secondary'
                  }`}
              >
                {t(`settings.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <h3 className="text-[13px] font-medium text-text-primary mb-2">{t('settings.language')}</h3>
          <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
            {(['zh', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`py-1.5 px-3 text-[13px] font-medium transition-smooth
                  border-r border-border-subtle last:border-r-0
                  ${locale === l
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:bg-bg-secondary'
                  }`}
              >
                {l === 'zh' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div>
          <h3 className="text-[13px] font-medium text-text-primary mb-2">{t('settings.fontSize')}</h3>
          <div className="inline-flex items-center rounded-lg border border-border-subtle
            overflow-hidden">
            <button
              onClick={() => setFontSize(fontSize - 1)}
              disabled={fontSize <= 10}
              className="w-8 h-8 text-[13px] font-bold text-text-primary
                hover:bg-bg-secondary transition-smooth
                disabled:opacity-30 disabled:cursor-not-allowed
                flex items-center justify-center border-r border-border-subtle"
            >-</button>
            <span className="w-12 text-center text-[13px] font-semibold text-text-primary">
              {fontSize}px
            </span>
            <button
              onClick={() => setFontSize(fontSize + 1)}
              disabled={fontSize >= 24}
              className="w-8 h-8 text-[13px] font-bold text-text-primary
                hover:bg-bg-secondary transition-smooth
                disabled:opacity-30 disabled:cursor-not-allowed
                flex items-center justify-center border-l border-border-subtle"
            >+</button>
          </div>
        </div>

        {/* Default Model */}
        <div>
          <h3 className="text-[13px] font-medium text-text-primary mb-2">{t('settings.defaultModel')}</h3>
          <div className="flex flex-wrap gap-2">
            {MODEL_OPTIONS.map((model) => (
              <button
                key={model.id}
                onClick={() => setSelectedModel(model.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2
                  rounded-lg text-[13px] font-medium transition-smooth
                  ${selectedModel === model.id
                    ? 'bg-accent/10 text-accent border border-accent/30'
                    : 'text-text-muted hover:bg-bg-secondary border border-border-subtle'
                  }`}
              >
                {selectedModel === model.id && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M3 8l4 4 6-7" />
                  </svg>
                )}
                {model.short}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
