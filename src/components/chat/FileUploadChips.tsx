import type { FileAttachment } from '../../hooks/useFileAttachments';
import { useT } from '../../lib/i18n';

interface FileUploadChipsProps {
  files: FileAttachment[];
  onRemove: (id: string) => void;
  isProcessing?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

export function FileUploadChips({ files, onRemove, isProcessing }: FileUploadChipsProps) {
  const t = useT();

  if (files.length === 0 && !isProcessing) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-2
      overflow-x-auto scrollbar-none bg-bg-secondary/30 rounded-xl">
      {/* Processing indicator */}
      {isProcessing && (
        <div className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5
          rounded-lg border border-accent/30 bg-accent/5
          text-xs text-accent flex-shrink-0 animate-pulse">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="2"
            className="flex-shrink-0 animate-spin">
            <path d="M8 2a6 6 0 105.3 3.2" />
          </svg>
          {t('input.processingFiles')}
        </div>
      )}
      {files.map((file) => (
        <div
          key={file.id}
          className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1.5
            rounded-lg border border-border-subtle bg-bg-secondary/50
            text-xs text-text-muted flex-shrink-0 group
            hover:border-border-focus transition-smooth"
        >
          {/* Thumbnail or file icon */}
          {file.isImage && file.preview ? (
            <img
              src={file.preview}
              alt={file.name}
              className="w-5 h-5 rounded object-cover flex-shrink-0"
            />
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5"
              className="flex-shrink-0 text-text-tertiary">
              <path d="M4 2h5l4 4v8H4V2z" />
              <path d="M9 2v4h4" />
            </svg>
          )}

          {/* Filename (truncated) */}
          <span className="max-w-[100px] truncate">{file.name}</span>

          {/* Size */}
          <span className="text-text-tertiary text-[10px]">
            {formatSize(file.size)}
          </span>

          {/* Remove button */}
          <button
            onClick={() => onRemove(file.id)}
            className="p-0.5 rounded hover:bg-bg-tertiary
              text-text-tertiary hover:text-text-primary
              transition-smooth opacity-0 group-hover:opacity-100"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
