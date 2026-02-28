import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../lib/i18n';
import { PROVIDER_PRESETS, type PresetProvider } from '../../lib/provider-presets';
import type { ApiProvider } from '../../stores/providerStore';

interface AddProviderMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  providers: ApiProvider[];
  onAddFromPreset: (preset: PresetProvider) => void;
  onAddCustom: () => void;
  onImport: () => void;
}

export function AddProviderMenu({
  open,
  onClose,
  anchorRef,
  providers,
  onAddFromPreset,
  onAddCustom,
  onImport,
}: AddProviderMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const rect = anchorRef.current?.getBoundingClientRect();
  if (!rect) return null;

  const existingPresets = new Set(providers.map((p) => p.preset).filter(Boolean));

  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 6,
    left: rect.left,
    zIndex: 9999,
  };

  return createPortal(
    <div ref={menuRef} style={style}
      className="w-[300px] rounded-xl border border-border-subtle bg-bg-primary shadow-lg p-3 space-y-2">
      {/* Preset grid */}
      <div>
        <span className="text-xs text-text-tertiary font-medium mb-1.5 block">
          {t('provider.fromPresetTitle')}
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDER_PRESETS.map((preset) => {
            const alreadyAdded = existingPresets.has(preset.id);
            return (
              <button
                key={preset.id}
                disabled={alreadyAdded}
                onClick={() => {
                  onAddFromPreset(preset);
                  onClose();
                }}
                className={`text-left px-2.5 py-2 rounded-lg text-[13px] transition-smooth
                  ${alreadyAdded
                    ? 'text-text-tertiary cursor-default opacity-50'
                    : 'text-text-muted hover:bg-bg-secondary border border-transparent hover:border-border-subtle'
                  }`}
              >
                {preset.name}
                {alreadyAdded && (
                  <span className="text-[11px] text-text-tertiary ml-1">
                    {t('provider.alreadyAdded')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border-subtle" />

      {/* Custom + Import */}
      <div className="space-y-0.5">
        <button
          onClick={() => { onAddCustom(); onClose(); }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px]
            text-text-muted hover:bg-bg-secondary transition-smooth"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
          {t('provider.customConfig')}
        </button>
        <button
          onClick={() => { onImport(); onClose(); }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px]
            text-text-muted hover:bg-bg-secondary transition-smooth"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3M8 2v8M5 7l3 3 3-3" />
          </svg>
          {t('provider.importFile')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
