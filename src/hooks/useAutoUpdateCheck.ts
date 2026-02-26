import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Module-level state — not serializable, kept outside Zustand.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _updateHandle: any = null;
let _downloading = false;

/** Get the cached update handle (from the latest successful check). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getUpdateHandle(): any {
  return _updateHandle;
}

/** Silently download and install the update in the background. */
async function backgroundDownload(): Promise<void> {
  if (_downloading || !_updateHandle) return;
  _downloading = true;

  try {
    await _updateHandle.downloadAndInstall(
      (event: { event: string; data: { contentLength?: number; chunkLength: number } }) => {
        // Progress tracked silently — no UI updates during background download
        if (event.event === 'Started') {
          console.log('[updater] background download started');
        }
      },
    );
    // Download & install staged — ready for restart
    useSettingsStore.getState().setUpdateDownloaded(true);
    console.log('[updater] background download complete, restart to apply');
  } catch {
    // Download failed silently — user can retry via UpdateButton
    _downloading = false;
  }
}

/** Perform a single update check, returning the update handle if available. */
async function doCheck(): Promise<void> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update) {
      _updateHandle = update;
      useSettingsStore.getState().setUpdateAvailable(true, update.version);

      // Start silent background download immediately
      backgroundDownload();
    } else {
      _updateHandle = null;
      useSettingsStore.getState().setUpdateAvailable(false);
    }
  } catch {
    // Silent failure — network offline, rate-limited, etc.
  }
}

/**
 * Checks for updates on startup (5s delay) and then every 10 minutes.
 * When an update is found, it is automatically downloaded in the background.
 * Once downloaded, `updateDownloaded` is set in the store and the UpdateButton
 * shows a "restart" prompt.
 */
export function useAutoUpdateCheck(): void {
  useEffect(() => {
    // Initial check after 5s
    const startupTimer = setTimeout(doCheck, 5000);

    // Periodic check every 10 minutes
    const intervalTimer = setInterval(doCheck, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    };
  }, []);
}
