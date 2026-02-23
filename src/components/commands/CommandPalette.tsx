import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useT } from '../../lib/i18n';

interface CommandItem {
  id: string;
  labelKey: string;
  descKey: string;
  categoryKey: string;
  icon: string;
  action: () => void;
}

export function CommandPalette() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const toggleSecondaryPanel = useSettingsStore((s) => s.toggleSecondaryPanel);
  const setSecondaryTab = useSettingsStore((s) => s.setSecondaryTab);
  const toggleAgentPanel = useSettingsStore((s) => s.toggleAgentPanel);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);

  const commands: CommandItem[] = useMemo(() => [
    {
      id: 'new-chat', labelKey: 'cmd.newChat',
      descKey: 'cmd.newChatDesc',
      categoryKey: 'cmd.chat', icon: 'M8 3v10M3 8h10',
      action: () => {
        useChatStore.getState().resetSession();
      },
    },
    {
      id: 'toggle-sidebar', labelKey: 'cmd.toggleSidebar',
      descKey: 'cmd.toggleSidebarDesc',
      categoryKey: 'cmd.view', icon: 'M3 3h4v10H3zM9 3h4v10H9z',
      action: toggleSidebar,
    },
    {
      id: 'toggle-files', labelKey: 'cmd.toggleFiles',
      descKey: 'cmd.toggleFilesDesc',
      categoryKey: 'cmd.view', icon: 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3z',
      action: toggleSecondaryPanel,
    },
    {
      id: 'show-files', labelKey: 'cmd.showFiles',
      descKey: 'cmd.showFilesDesc',
      categoryKey: 'cmd.view', icon: 'M2 4h12v8H2z',
      action: () => setSecondaryTab('files'),
    },
    {
      id: 'show-agents', labelKey: 'cmd.showAgents',
      descKey: 'cmd.showAgentsDesc',
      categoryKey: 'cmd.view', icon: 'M8 2a3 3 0 100 6 3 3 0 000-6z',
      action: toggleAgentPanel,
    },
    {
      id: 'toggle-theme', labelKey: 'cmd.toggleTheme',
      descKey: 'cmd.toggleThemeDesc',
      categoryKey: 'cmd.settings', icon: 'M8 1v2M8 13v2M1 8h2M13 8h2',
      action: toggleTheme,
    },
  ], [toggleSidebar, toggleSecondaryPanel, setSecondaryTab, toggleAgentPanel, toggleTheme]);

  // Fuzzy filter
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) =>
        t(c.labelKey).toLowerCase().includes(q) ||
        t(c.descKey).toLowerCase().includes(q) ||
        t(c.categoryKey).toLowerCase().includes(q)
    );
  }, [commands, query, t]);

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
      setOpen(false);
    }
  }, [filtered, selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Palette */}
      <div className="relative w-full max-w-lg mx-4 rounded-2xl
        bg-bg-primary border border-border-subtle shadow-2xl
        overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3
          border-b border-border-subtle">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="text-text-tertiary flex-shrink-0">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('cmd.placeholder')}
            className="flex-1 bg-transparent text-sm text-text-primary
              placeholder:text-text-tertiary outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border
            border-border-subtle text-text-tertiary bg-bg-secondary">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-text-tertiary">
              {t('cmd.noMatch')}
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => { cmd.action(); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5
                  text-left transition-smooth
                  ${i === selectedIndex
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-primary hover:bg-bg-secondary'
                  }`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="1.5"
                  className="flex-shrink-0 opacity-60">
                  <path d={cmd.icon} />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t(cmd.labelKey)}</div>
                  <div className="text-[11px] text-text-muted truncate">
                    {t(cmd.descKey)}
                  </div>
                </div>
                <span className="text-[10px] text-text-tertiary
                  flex-shrink-0">{t(cmd.categoryKey)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
