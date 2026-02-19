/**
 * Platform detection utilities for cross-platform UI adaptation.
 *
 * Uses navigator.platform (widely supported) to detect the current OS.
 * Results are cached — safe to call frequently.
 */

export type Platform = 'mac' | 'windows' | 'linux';

let _cached: Platform | null = null;

export function getPlatform(): Platform {
  if (_cached) return _cached;
  const p = navigator.platform?.toLowerCase() ?? '';
  if (p.includes('mac')) _cached = 'mac';
  else if (p.includes('win')) _cached = 'windows';
  else _cached = 'linux';
  return _cached;
}

export function isMac(): boolean {
  return getPlatform() === 'mac';
}

export function isWindows(): boolean {
  return getPlatform() === 'windows';
}

/** Returns the platform-appropriate modifier key symbol/label */
export function modKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/** Returns the platform-appropriate file manager name */
export function fileManagerName(): string {
  switch (getPlatform()) {
    case 'mac': return 'Finder';
    case 'windows': return '资源管理器';
    default: return '文件管理器';
  }
}

/** Returns the English file manager name */
export function fileManagerNameEn(): string {
  switch (getPlatform()) {
    case 'mac': return 'Finder';
    case 'windows': return 'Explorer';
    default: return 'Files';
  }
}
