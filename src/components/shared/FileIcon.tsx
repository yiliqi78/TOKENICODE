interface FileIconProps {
  name: string;
  isDir?: boolean;
  size?: number;
  className?: string;
}

function getIconType(name: string, isDir?: boolean): string {
  if (isDir) return 'folder';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx':
    case 'py': case 'rb': case 'swift': case 'kt':
    case 'c': case 'cpp': case 'h': case 'hpp':
    case 'java': case 'go': case 'lua': case 'ex':
    case 'exs': case 'erl':
      return 'code';
    case 'rs':
      return 'gear';
    case 'json': case 'toml': case 'yaml': case 'yml':
    case 'ini': case 'cfg': case 'conf': case 'env':
      return 'config';
    case 'md': case 'mdx': case 'txt': case 'log':
      return 'doc-text';
    case 'css': case 'scss': case 'sass': case 'less':
      return 'palette';
    case 'html': case 'htm': case 'xhtml':
      return 'globe';
    case 'png': case 'jpg': case 'jpeg': case 'gif':
    case 'webp': case 'svg': case 'bmp': case 'ico':
      return 'image';
    case 'mp4': case 'webm': case 'mov': case 'avi':
    case 'mp3': case 'wav': case 'ogg': case 'aac':
    case 'm4a':
      return 'play';
    case 'sh': case 'bash': case 'zsh': case 'fish':
      return 'terminal';
    default:
      return 'document';
  }
}

const icons: Record<string, string> = {
  folder:
    'M2 4.5h4.5l2 2H12.5v6h-11v-8z',
  code:
    'M5 3L1.5 7L5 11 M9 3l3.5 4L9 11',
  gear:
    'M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1 1M10.2 10.2l1 1M2.8 11.2l1-1M10.2 3.8l1-1 M7 4.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  config:
    'M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1 1M10.2 10.2l1 1M2.8 11.2l1-1M10.2 3.8l1-1 M7 5a2 2 0 100 4 2 2 0 000-4z',
  'doc-text':
    'M3.5 1.5h5l3 3v8h-8v-11z M6.5 1.5v3h3 M5 7h4M5 9h4',
  palette:
    'M7 1A6 6 0 007 13a1.5 1.5 0 001.5-1.5c0-.4-.15-.74-.4-1a1.5 1.5 0 011.1-2.5H11A2 2 0 0013 6 6 6 0 007 1z M4.5 7a.75.75 0 100-1.5.75.75 0 000 1.5z M6 4.5a.75.75 0 100-1.5.75.75 0 000 1.5z M9 4.5a.75.75 0 100-1.5.75.75 0 000 1.5z',
  globe:
    'M7 1a6 6 0 100 12A6 6 0 007 1zM1 7h12M7 1c-2 2-2 10 0 12M7 1c2 2 2 10 0 12',
  image:
    'M2 3h10v8H2V3zM2 9l3-3 2 2 3-3 2 2M9 5.5a.5.5 0 100 1 .5.5 0 000-1z',
  play:
    'M3.5 2v10l8.5-5z',
  terminal:
    'M2 2.5h10v9H2v-9zM4.5 5.5l2 1.5-2 1.5M7.5 9H10',
  document:
    'M3.5 1.5h5l3 3v8h-8v-11z M6.5 1.5v3h3',
};

export function FileIcon({ name, isDir, size = 14, className = '' }: FileIconProps) {
  const type = getIconType(name, isDir);
  const d = icons[type] || icons.document;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}
