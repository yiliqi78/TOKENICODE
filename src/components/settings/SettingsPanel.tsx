import { useEffect, useState, useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';
import { ChangelogModal } from '../shared/ChangelogModal';
import { isPermissionError, isNetworkError } from './settingsUtils';
import { GeneralTab } from './GeneralTab';
import { ProviderTab } from './ProviderTab';
import { CliTab } from './CliTab';
import { McpTab } from './McpTab';

type SettingsTab = 'general' | 'provider' | 'cli' | 'mcp';

const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  general: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  ),
  provider: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V5a3 3 0 016 0v2" />
      <circle cx="8" cy="11" r="1" fill="currentColor" />
    </svg>
  ),
  cli: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="12" rx="2" />
      <path d="M4 6l3 2.5L4 11M9 11h3" />
    </svg>
  ),
  mcp: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="1" y="3" width="14" height="4" rx="1.5" />
      <rect x="1" y="9" width="14" height="4" rx="1.5" />
      <circle cx="4" cy="5" r="0.75" fill="currentColor" />
      <circle cx="4" cy="11" r="0.75" fill="currentColor" />
    </svg>
  ),
};

const TAB_ITEMS: { id: SettingsTab; labelKey: string }[] = [
  { id: 'general', labelKey: 'settings.tab.general' },
  { id: 'provider', labelKey: 'settings.tab.provider' },
  { id: 'cli', labelKey: 'settings.tab.cli' },
  { id: 'mcp', labelKey: 'settings.tab.mcp' },
];

export function SettingsPanel() {
  const t = useT();
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleSettings();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSettings]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) toggleSettings(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-[min(90vw,960px)] max-h-[85vh] min-h-[500px]
        rounded-2xl bg-bg-card border border-border-subtle shadow-2xl
        overflow-hidden animate-fade-in flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4
          border-b border-border-subtle flex-shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">
            {t('settings.title')}
          </h2>
          <button onClick={toggleSettings}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary
              text-text-tertiary transition-smooth">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Tab sidebar */}
          <nav className="w-[160px] border-r border-border-subtle px-2 py-4 space-y-1 flex-shrink-0">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[13px]
                  font-medium transition-smooth text-left whitespace-nowrap
                  ${activeTab === tab.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
                  }`}
              >
                <span className="flex-shrink-0 opacity-70">{TAB_ICONS[tab.id]}</span>
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {activeTab === 'general' && <GeneralTab />}
            {activeTab === 'provider' && <ProviderTab />}
            {activeTab === 'cli' && <CliTab />}
            {activeTab === 'mcp' && <McpTab />}
          </div>
        </div>

        {/* Footer: version + update */}
        <SettingsFooter />
      </div>
    </div>
  );
}

/* ================================================================
   Footer with version + update controls
   ================================================================ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpdateHandle = any;
type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error';

function SettingsFooter() {
  const t = useT();
  const [appVersion, setAppVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateHandle>(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [showChangelog, setShowChangelog] = useState(false);
  const storeUpdateVersion = useSettingsStore((s) => s.updateVersion);

  useEffect(() => {
    import('@tauri-apps/api/app').then(({ getVersion }) =>
      getVersion().then(setAppVersion).catch(() => {})
    );
  }, []);

  // Bridge auto-check result: if store has an update version, pre-fill
  useEffect(() => {
    if (storeUpdateVersion && status === 'idle') {
      import('@tauri-apps/plugin-updater').then(({ check }) =>
        check().then((update) => {
          if (update) {
            setUpdateInfo(update);
            setStatus('available');
          }
        }).catch(() => {})
      );
    }
  }, [storeUpdateVersion]);

  const handleCheck = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        setUpdateInfo(update);
        setStatus('available');
      } else {
        setStatus('latest');
        setTimeout(() => setStatus('idle'), 3000);
      }
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!updateInfo) return;
    setStatus('downloading');
    setProgress(0);
    try {
      let totalLen = 0;
      let downloaded = 0;
      await updateInfo.downloadAndInstall((event: { event: string; data: { contentLength?: number; chunkLength: number } }) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalLen = event.data.contentLength;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (totalLen > 0) setProgress(Math.round((downloaded / totalLen) * 100));
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });
      setStatus('ready');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }, [updateInfo]);

  const handleRestart = useCallback(async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }, []);

  return (
    <>
      <div className="flex items-center justify-between px-6 h-10
        border-t border-border-subtle bg-bg-secondary/30 flex-shrink-0">
        {/* Left: version */}
        <span className="text-xs text-text-tertiary flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 171 171" fill="none" className="flex-shrink-0 opacity-60">
            <path d="M66.79 58.73L40.33 85.19L66.79 111.66L57.53 120.92L21.8 85.19L57.53 49.47Z" fill="currentColor" />
            <path d="M111.5 49.47L147.22 85.19L111.5 120.92L102.24 111.66L128.7 85.19L102.24 58.73Z" fill="currentColor" />
            <path d="M90.01 39.92L102.01 39.92L79.24 129.92L67.24 129.92L79.24 81.92Z" className="fill-accent" />
          </svg>
          TOKENICODE {appVersion ? `v${appVersion}` : '...'}
        </span>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2">
          {/* Changelog */}
          <button
            onClick={() => setShowChangelog(true)}
            className="px-2.5 py-1 text-xs font-medium rounded-md
              text-text-muted hover:bg-bg-secondary hover:text-text-primary transition-smooth"
          >
            {t('settings.footer.changelog')}
          </button>

          {/* Update controls — inline in footer */}
          {status === 'idle' && (
            <button
              onClick={handleCheck}
              className="px-2.5 py-1 text-xs font-medium rounded-md
                border border-border-subtle text-text-muted
                hover:bg-bg-secondary hover:text-text-primary transition-smooth"
            >
              {t('settings.footer.checkUpdate')}
            </button>
          )}

          {status === 'checking' && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-3 h-3 border-[1.5px] border-accent/30
                border-t-accent rounded-full animate-spin" />
              {t('update.checking')}
            </span>
          )}

          {status === 'latest' && (
            <span className="text-xs text-green-500 font-medium">
              {t('settings.footer.upToDate')}
            </span>
          )}

          {status === 'available' && updateInfo && (
            <button
              onClick={handleDownload}
              className="px-2.5 py-1 text-xs font-medium rounded-md
                bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
            >
              {t('update.install')} v{updateInfo.version}
            </button>
          )}

          {status === 'downloading' && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-3 h-3 border-[1.5px] border-accent/30
                border-t-accent rounded-full animate-spin" />
              {t('update.downloading')} {progress}%
            </span>
          )}

          {status === 'ready' && (
            <button
              onClick={handleRestart}
              className="px-2.5 py-1 text-xs font-medium rounded-md
                bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
            >
              {t('update.restart')}
            </button>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-500" title={errorMsg}>
                {t('update.error')}
              </span>
              {isPermissionError(errorMsg) && (
                <span className="text-[10px] text-amber-500">
                  {t('error.permissionHint')}
                </span>
              )}
              {isNetworkError(errorMsg) && (
                <span className="text-[10px] text-amber-500">
                  {t('network.firewallHint')}
                </span>
              )}
              <button
                onClick={handleCheck}
                className="px-2 py-0.5 text-xs text-text-muted hover:text-text-primary transition-smooth"
              >
                {t('cli.retry')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Changelog modal */}
      {showChangelog && appVersion && (
        <ChangelogModal
          version={appVersion}
          onClose={() => setShowChangelog(false)}
        />
      )}
    </>
  );
}
