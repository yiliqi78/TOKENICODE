import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';
import { getChangelog } from '../../lib/changelog';

interface Props {
  version: string;
  onClose: () => void;
}

export function ChangelogModal({ version, onClose }: Props) {
  const t = useT();
  const locale = useSettingsStore((s) => s.locale);
  const entry = getChangelog(version);

  if (!entry) return null;

  const items = entry.highlights[locale] || entry.highlights.en;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-[380px] max-h-[70vh] rounded-2xl bg-bg-card
        border border-border-subtle shadow-lg overflow-hidden
        animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center">
          <h2 className="text-base font-semibold text-text-primary">
            {t('changelog.title')}
          </h2>
          <p className="text-[11px] text-text-tertiary mt-1">
            v{entry.version} · {entry.date}
          </p>
        </div>

        {/* Content */}
        <div className="px-6 pb-4 overflow-y-auto max-h-[calc(70vh-160px)]">
          <ul className="space-y-2.5">
            {items.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] text-text-secondary leading-relaxed">
                <span className="text-accent mt-0.5 flex-shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="px-6 pt-2 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-medium
              bg-accent hover:bg-accent-hover text-text-inverse
              transition-smooth"
          >
            {t('changelog.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
