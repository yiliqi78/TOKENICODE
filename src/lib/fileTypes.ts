import { KNOWN_FILE_EXTENSIONS } from '../stores/fileReveal';

/** 能在右侧面板里内嵌渲染的二进制类型（图片 / PDF / 音视频）。 */
export const INLINE_PREVIEW_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg',
  'pdf', 'mp4', 'webm', 'mov', 'avi',
  'mp3', 'wav', 'ogg', 'aac', 'm4a',
]);

/** 内置编辑器打不开、只能交给系统默认程序的文件类型。 */
export const EXTERNAL_OPEN_EXTS = new Set([
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'iso',
  'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'jar',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'db', 'sqlite', 'sqlite3', 'psd', 'bin', 'dat',
]);

function extOf(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * 点击文件时是否直接交给系统默认程序打开。
 *
 * 已知扩展名里只有明确列出的二进制才外开；未知扩展名也外开，避免把 psd / bin
 * 这类内容当文本读进 CodeMirror 变成乱码。没有扩展名的文件（Makefile、LICENSE）
 * 仍按文本处理。
 */
export function shouldOpenExternally(path: string): boolean {
  const name = path.replace(/\\/g, '/').split('/').pop() || '';
  if (!name.includes('.')) return false;
  const ext = extOf(path);
  if (INLINE_PREVIEW_EXTS.has(ext)) return false;
  if (EXTERNAL_OPEN_EXTS.has(ext)) return true;
  if (KNOWN_FILE_EXTENSIONS.has(ext)) return false;
  return true;
}
