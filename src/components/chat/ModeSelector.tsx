import type { ReactNode } from 'react';
import { useSettingsStore, type SessionMode } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';

const MODES: { id: SessionMode; labelKey: string; icon: ReactNode }[] = [
  {
    id: 'code',
    labelKey: 'mode.code',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M5 4L1 8l4 4M11 4l4 4-4 4" />
      </svg>
    ),
  },
  {
    id: 'ask',
    labelKey: 'mode.ask',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8" cy="8" r="5.5" />
        <path d="M6 6.5a2 2 0 013.5 1.5c0 1-1.5 1.5-1.5 1.5M8 12v.5" />
      </svg>
    ),
  },
  {
    id: 'plan',
    labelKey: 'mode.plan',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 4h8M4 8h6M4 12h4" />
      </svg>
    ),
  },
  {
    id: 'bypass',
    labelKey: 'mode.bypass',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2l1.5 4H14l-3.5 2.5L12 13 8 10l-4 3 1.5-4.5L2 6h4.5L8 2z" />
      </svg>
    ),
  },
];

export function ModeSelector({ disabled = false }: { disabled?: boolean }) {
  const t = useT();
  const sessionMode = useSettingsStore((s) => s.sessionMode);
  const setSessionMode = useSettingsStore((s) => s.setSessionMode);

  return (
    <div className={`inline-flex items-center rounded-lg border border-border-subtle
      overflow-hidden ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => setSessionMode(mode.id)}
          disabled={disabled}
          className={`inline-flex items-center gap-1 px-2.5 py-1 text-sm
            transition-smooth border-r border-border-subtle last:border-r-0
            ${mode.id === sessionMode
              ? mode.id === 'bypass'
                ? 'bg-warning/10 text-warning font-medium'
                : 'bg-accent/10 text-accent font-medium'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
            }`}
        >
          {mode.icon}
          {t(mode.labelKey)}
        </button>
      ))}
    </div>
  );
}
