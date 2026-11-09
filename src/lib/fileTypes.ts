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
 * 只对明确列出的二进制类型外开（压缩包 / Office / 可执行文件等）。
 * 无扩展名的文件（Makefile、LICENSE）、点文件（.env、.gitignore）和不在
 * 白名单里的文本扩展名（.plist、.bat、.tex …）都仍按文本进内置编辑器，
 * 与引入外开逻辑之前的行为一致。
 */
export function shouldOpenExternally(path: string): boolean {
  const ext = extOf(path);
  if (!ext) return false;
  if (INLINE_PREVIEW_EXTS.has(ext)) return false;
  return EXTERNAL_OPEN_EXTS.has(ext);
}
