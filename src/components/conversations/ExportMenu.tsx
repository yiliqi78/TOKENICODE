import { useState, useRef, useEffect, useCallback } from 'react';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

interface Props {
  sessionPath?: string;
}

export function ExportMenu({ sessionPath }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  const updateMenuPos = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPos();
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)
          && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, updateMenuPos]);

  const handleExport = async (format: 'markdown' | 'json') => {
    if (!sessionPath) return;
    const ext = format === 'markdown' ? 'md' : 'json';
    const timestamp = new Date().toISOString().slice(0, 10);
    const outputPath = `${sessionPath.replace('.jsonl', '')}_export_${timestamp}.${ext}`;

    try {
      if (format === 'markdown') {
        await bridge.exportSessionMarkdown(sessionPath, outputPath);
      } else {
        await bridge.exportSessionJson(sessionPath, outputPath);
      }
      setStatus(`${t('export.success')} ${outputPath.split('/').pop()}`);
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      setStatus(`Error: ${err}`);
      setTimeout(() => setStatus(null), 3000);
    }
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        disabled={!sessionPath}
        className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-tertiary
          transition-smooth disabled:opacity-30 disabled:cursor-not-allowed"
        title={t('export.title')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5">
          <path d="M8 2v8M5 7l3 3 3-3M3 12h10" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div ref={menuRef}
          className="fixed w-48 py-1
          bg-bg-primary border border-border-subtle rounded-xl shadow-lg
          z-[9999] animate-fade-in"
          style={{ top: menuPos.top, right: menuPos.right }}>
          <button
            onClick={() => handleExport('markdown')}
            className="w-full flex items-center gap-2.5 px-3 py-2
              text-sm text-text-primary hover:bg-bg-secondary
              transition-smooth text-left"
          >
            <span className="text-[13px]">📝</span>
            {t('export.markdown')}
          </button>
          <button
            onClick={() => handleExport('json')}
            className="w-full flex items-center gap-2.5 px-3 py-2
              text-sm text-text-primary hover:bg-bg-secondary
              transition-smooth text-left"
          >
            <span className="text-[13px]">📋</span>
            {t('export.json')}
          </button>
        </div>
      )}

      {status && (
        <div className="fixed px-3 py-2
          bg-bg-primary border border-border-subtle rounded-xl shadow-lg
          text-xs text-text-muted whitespace-nowrap z-[9999]"
          style={{ top: menuPos.top, right: menuPos.right }}>
          {status}
        </div>
      )}
    </div>
  );
}
