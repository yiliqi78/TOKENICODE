import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * Silently checks for updates once on app startup (after 5s delay).
 * Sets updateAvailable + updateVersion in the store if found.
 */
export function useAutoUpdateCheck(): void {
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update) {
          useSettingsStore.getState().setUpdateAvailable(true, update.version);
        } else {
          useSettingsStore.getState().setUpdateAvailable(false);
        }
      } catch {
        // Silent failure — network offline, rate-limited, etc.
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);
}
