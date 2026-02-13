import { useState, useRef, useEffect } from 'react';
import { useSettingsStore, MODEL_OPTIONS } from '../../stores/settingsStore';

export function ModelSelector({ disabled = false }: { disabled?: boolean }) {
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = MODEL_OPTIONS.find((m) => m.id === selectedModel) || MODEL_OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg
          text-xs text-text-muted hover:text-text-primary
          glass-hover-tint transition-smooth
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3l2 1.5" strokeLinecap="round" />
        </svg>
        {current.short}
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-48
          glass border border-border-subtle rounded-xl shadow-lg
          py-1 z-50 animate-in fade-in slide-in-from-bottom-1 duration-150">
          {MODEL_OPTIONS.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setSelectedModel(option.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs
                transition-smooth flex items-center justify-between
                ${option.id === selectedModel
                  ? 'text-accent bg-accent/5'
                  : 'text-text-muted hover:text-text-primary glass-hover-tint'
                }`}
            >
              <div>
                <div className="font-medium">{option.label}</div>
              </div>
              {option.id === selectedModel && (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 8l3.5 3.5L13 5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
