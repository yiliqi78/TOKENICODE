import { type ReactNode, useState, useRef, useEffect } from 'react';
import { useSettingsStore, type SessionMode } from '../../stores/settingsStore';
import { useChatStore, generateMessageId } from '../../stores/chatStore';
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = MODES.find((m) => m.id === sessionMode) || MODES[0];
  const isBypass = sessionMode === 'bypass';

  const MODE_FEEDBACK: Record<SessionMode, { i18nKey: string; icon: string }> = {
    code: { i18nKey: 'cmd.switchedToCode', icon: '⚡' },
    ask: { i18nKey: 'cmd.switchedToAsk', icon: '💬' },
    plan: { i18nKey: 'cmd.switchedToPlan', icon: '📋' },
    bypass: { i18nKey: 'cmd.switchedToBypass', icon: '⭐' },
  };

  const switchMode = (mode: SessionMode) => {
    if (mode === sessionMode) return;
    setSessionMode(mode);
    const fb = MODE_FEEDBACK[mode];
    useChatStore.getState().addMessage({
      id: generateMessageId(),
      role: 'system',
      type: 'text',
      content: t(fb.i18nKey),
      commandType: 'mode',
      commandData: { mode, icon: fb.icon },
      timestamp: Date.now(),
    });
  };

  return (
    <div ref={ref} className={`relative ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {/* Trigger button — shows current mode */}
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs
          border transition-smooth cursor-pointer
          ${isBypass
            ? 'border-warning/30 bg-warning/10 text-warning'
            : 'border-border-subtle bg-bg-secondary/50 text-text-muted hover:text-text-primary hover:bg-bg-secondary'
          }`}
      >
        {current.icon}
        <span className="font-medium">{t(current.labelKey)}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>
          <path d="M1.5 3L4 5.5 6.5 3" />
        </svg>
      </button>

      {/* Dropdown menu — opens upward */}
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[140px]
          bg-bg-card border border-border-subtle rounded-lg shadow-lg
          py-1 z-50 animate-fade-in">
          {MODES.map((mode) => {
            const isActive = mode.id === sessionMode;
            return (
              <button
                key={mode.id}
                onClick={() => { switchMode(mode.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs
                  transition-smooth cursor-pointer
                  ${isActive
                    ? mode.id === 'bypass'
                      ? 'bg-warning/10 text-warning font-medium'
                      : 'bg-accent/10 text-accent font-medium'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
                  }`}
              >
                {mode.icon}
                {t(mode.labelKey)}
                {isActive && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                    stroke="currentColor" strokeWidth="1.5" className="ml-auto">
                    <path d="M2.5 6l2.5 2.5 4.5-4.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
