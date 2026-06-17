import { useSettingsStore, SecondaryPanelTab } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { FileExplorer } from '../files/FileExplorer';
import { SkillsPanel } from '../skills/SkillsPanel';
import { useT } from '../../lib/i18n';

const tabs: { id: SecondaryPanelTab; labelKey: string; vb: string; d: string[] }[] = [
  {
    id: 'files', labelKey: 'panel.files', vb: '0 0 1024 1024', d: [
      'M921.6 450.133333c-6.4-8.533333-14.933333-12.8-25.6-12.8h-10.666667V341.333333c0-40.533333-34.133333-74.666667-74.666666-74.666666H514.133333c-4.266667 0-6.4-2.133333-8.533333-4.266667l-38.4-66.133333c-12.8-21.333333-38.4-36.266667-64-36.266667H170.666667c-40.533333 0-74.666667 34.133333-74.666667 74.666667v597.333333c0 6.4 2.133333 12.8 6.4 19.2 6.4 8.533333 14.933333 12.8 25.6 12.8h640c12.8 0 25.6-8.533333 29.866667-21.333333l128-362.666667c4.266667-10.666667 2.133333-21.333333-4.266667-29.866667zM170.666667 224h232.533333c4.266667 0 6.4 2.133333 8.533333 4.266667l38.4 66.133333c12.8 21.333333 38.4 36.266667 64 36.266667H810.666667c6.4 0 10.666667 4.266667 10.666666 10.666666v96H256c-12.8 0-25.6 8.533333-29.866667 21.333334l-66.133333 185.6V234.666667c0-6.4 4.266667-10.666667 10.666667-10.666667z m573.866666 576H172.8l104.533333-298.666667h571.733334l-104.533334 298.666667z',
    ],
  },
  {
    id: 'skills', labelKey: 'panel.skills', vb: '0 0 1024 1024', d: [
      'M298.816 479.104a32.768 32.768 0 0 0 35.136-30.208c14.336-185.6 92.48-330.496 178.048-330.496s163.712 145.152 178.048 330.496a32.768 32.768 0 0 0 32.576 30.336 17.344 17.344 0 0 0 2.56 0 32.704 32.704 0 0 0 30.144-35.2C737.92 217.344 635.52 52.928 512.128 52.928s-225.984 164.416-243.2 391.104a32.704 32.704 0 0 0 29.888 35.072z',
      'M586.88 867.584a92.928 92.928 0 0 1-149.696 0 32.832 32.832 0 1 0-47.424 45.312 157.312 157.312 0 0 0 244.48 0 32.832 32.832 0 1 0-47.424-45.312z',
      'M391.744 785.856a33.024 33.024 0 0 0-36.864-28.224c-90.24 12.096-159.04-6.4-183.616-48.832a105.792 105.792 0 0 1-4.096-85.184 32.832 32.832 0 0 0-62.784-19.2 169.92 169.92 0 0 0 10.048 136.96 204.8 204.8 0 0 0 188.544 85.184 468.352 468.352 0 0 0 60.416-4.096 32.896 32.896 0 0 0 28.352-36.608z',
      'M766.848 266.24a118.592 118.592 0 0 1 85.76 48.96c46.144 79.936-55.424 231.68-226.24 338.368a32.768 32.768 0 0 0 34.752 55.616c207.296-129.344 314.112-312.832 248.256-426.816a177.728 177.728 0 0 0-131.776-80.896 32.832 32.832 0 0 0-10.752 64.768z',
      'M927.36 638.592a32.832 32.832 0 1 0-64.96 9.152 92.8 92.8 0 0 1-9.472 60.992c-43.712 75.52-227.264 76.8-431.104-40.512S127.424 390.656 171.2 315.136a89.6 89.6 0 0 1 41.472-35.904 32.768 32.768 0 0 0-27.712-59.456 153.6 153.6 0 0 0-70.4 62.528c-68.992 119.488 51.584 313.6 274.624 442.624a691.2 691.2 0 0 0 331.52 101.568 205.504 205.504 0 0 0 189.12-84.992 157.056 157.056 0 0 0 17.536-102.912z',
      'M512 512m-65.6 0a65.6 65.6 0 1 0 131.2 0 65.6 65.6 0 1 0-131.2 0Z',
    ],
  },
];

export function SecondaryPanel() {
  const t = useT();
  const activeTab = useSettingsStore((s) => s.secondaryPanelTab);
  const setTab = useSettingsStore((s) => s.setSecondaryTab);
  const togglePanel = useSettingsStore((s) => s.toggleSecondaryPanel);
  const refreshTree = useFileStore((s) => s.refreshTree);
  const clearChangedFiles = useFileStore((s) => s.clearChangedFiles);

  // Window dragging handled via CSS -webkit-app-region: drag on the top strip

  return (
    <div className="secondary-panel flex flex-col h-full">
      {/* Tab bar — extra top padding for macOS traffic lights */}
      <div
        className="flex items-center justify-between px-4 pt-4 pb-2
        cursor-default">
        <div className="flex gap-1 min-w-0 overflow-hidden">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              onDoubleClick={() => {
                if (tab.id !== 'files') return;
                refreshTree();
                clearChangedFiles();
              }}
              className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium
                transition-smooth flex items-center gap-1.5 whitespace-nowrap flex-shrink-0
                ${activeTab === tab.id
                  ? 'bg-bg-card text-text-primary shadow-sm'
                  : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
                }`}
            >
              <svg width="13" height="13" viewBox={tab.vb} fill="currentColor"
                className="flex-shrink-0">
                {tab.d.map((d, i) => <path key={i} d={d} />)}
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
        <div className={activeTab === 'files' ? 'h-full' : 'hidden h-full'}>
          <FileExplorer />
        </div>
        <div className={activeTab === 'skills' ? 'h-full' : 'hidden h-full'}>
          <SkillsPanel />
        </div>
      </div>
    </div>
  );
}
