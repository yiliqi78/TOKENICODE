import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Module-level state — not serializable, kept outside Zustand.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _updateHandle: any = null;

/** Get the cached update handle (from the latest successful check). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getUpdateHandle(): any {
  return _updateHandle;
}

/** Perform a single update check, returning the update handle if available. */
async function doCheck(): Promise<void> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update) {
      _updateHandle = update;
      useSettingsStore.getState().setUpdateAvailable(true, update.version);
      // Don't auto-download — wait for user to click the UpdateButton
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
 * When an update is found, the UpdateButton shows the new version.
 * User must click to start download, then click again to restart.
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
