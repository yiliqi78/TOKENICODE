import { useState, useCallback, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { getUpdateHandle } from '../../hooks/useAutoUpdateCheck';
import { useT } from '../../lib/i18n';

type Phase = 'idle' | 'downloading' | 'ready';

/**
 * Compact update button for the top bar.
 * - Background download is handled by useAutoUpdateCheck.
 * - When download completes (`updateDownloaded`), shows "restart" directly.
 * - If background download failed, user can click to retry manually.
 */
export function UpdateButton() {
  const updateAvailable = useSettingsStore((s) => s.updateAvailable);
  const updateVersion = useSettingsStore((s) => s.updateVersion);
  const updateDownloaded = useSettingsStore((s) => s.updateDownloaded);
  const t = useT();

  const [phase, setPhase] = useState<Phase>(updateDownloaded ? 'ready' : 'idle');
  const [progress, setProgress] = useState(0);

  // Sync phase when background download completes
  useEffect(() => {
    if (updateDownloaded) setPhase('ready');
  }, [updateDownloaded]);

  const handleClick = useCallback(async () => {
    if (phase === 'ready') {
      // Restart to apply update
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
      return;
    }

    if (phase === 'downloading') return; // Already in progress

    // Manual download fallback — background download may have failed
    let handle = getUpdateHandle();
    if (!handle) {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        handle = await check();
      } catch {
        return;
      }
    }
    if (!handle) return;

    setPhase('downloading');
    setProgress(0);

    try {
      let totalLen = 0;
      let downloaded = 0;
      await handle.downloadAndInstall((event: { event: string; data: { contentLength?: number; chunkLength: number } }) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalLen = event.data.contentLength;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (totalLen > 0) setProgress(Math.round((downloaded / totalLen) * 100));
        }
      });
      setPhase('ready');
      useSettingsStore.getState().setUpdateDownloaded(true);
    } catch {
      setPhase('idle');
    }
  }, [phase]);

  if (!updateAvailable && phase === 'idle') return null;

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium
        transition-smooth mr-1
        ${phase === 'ready'
          ? 'bg-success/15 text-success border border-success/30 hover:bg-success/25'
          : phase === 'downloading'
            ? 'bg-accent/10 text-accent cursor-wait'
            : 'bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20'
        }`}
      title={phase === 'ready'
        ? t('update.restart')
        : phase === 'downloading'
          ? `${t('update.downloading')} ${progress}%`
          : `${t('update.available')} v${updateVersion}`}
    >
      {phase === 'downloading' ? (
        <>
          <div className="w-3 h-3 border-[1.5px] border-accent/30
            border-t-accent rounded-full animate-spin" />
          <span>{progress}%</span>
        </>
      ) : phase === 'ready' ? (
        <>
          {/* Checkmark icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6l2.5 2.5 4.5-4.5" />
          </svg>
          <span>{t('update.restart')}</span>
        </>
      ) : (
        <>
          {/* Download/arrow-up icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2v6M3.5 5.5L6 8l2.5-2.5M2 10h8" />
          </svg>
          <span>v{updateVersion}</span>
        </>
      )}
    </button>
  );
}
