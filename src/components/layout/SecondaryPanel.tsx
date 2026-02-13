import { useCallback } from 'react';
import { useSettingsStore, SecondaryPanelTab } from '../../stores/settingsStore';
import { FileExplorer } from '../files/FileExplorer';
import { AgentPanel } from '../agents/AgentPanel';
import { SkillsPanel } from '../skills/SkillsPanel';
import { McpPanel } from '../mcp/McpPanel';
import { useT } from '../../lib/i18n';
import { getCurrentWindow } from '@tauri-apps/api/window';

const tabs: { id: SecondaryPanelTab; labelKey: string; icon: string }[] = [
  { id: 'files', labelKey: 'panel.files', icon: 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3z' },
  { id: 'agents', labelKey: 'panel.agents', icon: 'M8 2a3 3 0 100 6 3 3 0 000-6zM4 12a4 4 0 018 0' },
  { id: 'skills', labelKey: 'panel.skills', icon: 'M8 1L1 4.5l7 3.5 7-3.5L8 1zM1 11.5l7 3.5 7-3.5M1 8l7 3.5L15 8' },
  { id: 'mcp', labelKey: 'panel.mcp', icon: 'M2 4a2 2 0 012-2h8a2 2 0 012 2v1H2V4zM2 7h12v5a2 2 0 01-2 2H4a2 2 0 01-2-2V7z' },
];

export function SecondaryPanel() {
  const t = useT();
  const activeTab = useSettingsStore((s) => s.secondaryPanelTab);
  const setTab = useSettingsStore((s) => s.setSecondaryTab);
  const togglePanel = useSettingsStore((s) => s.toggleSecondaryPanel);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, [role="button"]')) return;
    if (e.buttons === 1) {
      getCurrentWindow().startDragging();
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — extra top padding for macOS traffic lights, draggable */}
      <div onMouseDown={handleDragStart}
        className="flex items-center justify-between px-2 pt-6 pb-2
        border-b border-border-subtle cursor-default">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium
                transition-smooth flex items-center gap-1.5
                ${activeTab === tab.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
                }`}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5">
                <path d={tab.icon} />
              </svg>
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        <button onClick={togglePanel}
          className="p-1 rounded-lg hover:bg-bg-tertiary
            text-text-tertiary transition-smooth" title={t('panel.close')}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l6 6M10 4l-6 6" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'files' && <FileExplorer />}
        {activeTab === 'agents' && <AgentPanel />}
        {activeTab === 'skills' && <SkillsPanel />}
        {activeTab === 'mcp' && <McpPanel />}
      </div>
    </div>
  );
}
