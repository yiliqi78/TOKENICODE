import { memo, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useLightboxStore } from './ImageLightbox';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

/* ================================================================
   AsyncImage — loads local files via Rust base64 bridge
   ================================================================ */
function isLocalPath(src: string): boolean {
  return (
    src.startsWith('file://') ||
    src.startsWith('/') ||
    /^[A-Za-z]:[/\\]/.test(src)
  );
}

function AsyncImage({ src, alt }: { src: string; alt?: string }) {
  const t = useT();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const filePath = src.startsWith('file://') ? src.slice(7) : src;
    bridge.readFileBase64(filePath).then(setDataUrl).catch(() => setError(true));
  }, [src]);

  const handleClick = useCallback(() => {
    const filePath = src.startsWith('file://') ? src.slice(7) : src;
    useLightboxStore.getState().openFile(filePath, alt);
  }, [src, alt]);

  if (error) {
    return (
      <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
        inline-block max-w-full">
        <div className="flex items-center justify-center gap-2 py-6 px-4
          text-xs text-text-muted bg-bg-secondary">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <circle cx="5" cy="6" r="1.5" />
            <path d="M1 11l4-4 3 3 2-2 5 5" />
          </svg>
          {t('msg.imgError')}
        </div>
        {alt && (
          <div className="px-3 py-1.5 text-xs text-text-muted bg-bg-secondary
            border-t border-border-subtle">{alt}</div>
        )}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
        inline-block bg-bg-secondary px-6 py-4">
        <span className="w-4 h-4 border-2 border-accent/30 border-t-accent
          rounded-full animate-spin inline-block" />
      </div>
    );
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
      shadow-sm inline-block max-w-full">
      <img
        src={dataUrl}
        alt={alt || ''}
        className="max-w-full max-h-96 object-contain cursor-zoom-in"
        onClick={handleClick}
      />
      {alt && (
        <div className="px-3 py-1.5 text-xs text-text-muted bg-bg-secondary
          border-t border-border-subtle">{alt}</div>
      )}
    </div>
  );
}

/* ================================================================
   CopyButton — hover-reveal copy for code blocks
   ================================================================ */
export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 rounded-md text-[10px]
        font-medium opacity-0 group-hover:opacity-100 transition-smooth
        bg-bg-tertiary/80 text-text-muted hover:text-text-primary
        hover:bg-bg-tertiary border border-border-subtle"
    >
      {copied ? t('msg.copied') : t('msg.copyCode')}
    </button>
  );
}

/** Extract plain text from nested React nodes (for copy button) */
function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as any).props.children);
  }
  return '';
}

/** Detect file paths in inline code — conservative regex to avoid false positives */
const FILE_PATH_RE = /^(?:\/|\.\/|\.\.\/|[a-zA-Z]:[/\\]|src\/|lib\/|components\/|stores\/|hooks\/|utils\/|tests\/|__tests__\/)[\w.@/-]+\.\w{1,10}$/;

/* ================================================================
   MarkdownRenderer — shared markdown rendering with syntax highlighting
   ================================================================ */
interface Props {
  content: string;
  className?: string;
  /** Base path for resolving relative image paths (defaults to workingDirectory) */
  basePath?: string;
}

// Stable plugin arrays — created once, never cause re-renders
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeRaw, rehypeHighlight];

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className, basePath }: Props) {
  const t = useT();
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const resolveBase = basePath || workingDirectory || '';

  // Stable components object — only recreated if `t` or resolveBase changes
  const components = useMemo(() => ({
    table: ({ children }: { children?: ReactNode }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: ReactNode }) => (
      <thead className="bg-bg-secondary">{children}</thead>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th className="px-3 py-2 text-left font-medium text-text-muted
        border-b border-border-subtle text-[11px]">{children}</th>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td className="px-3 py-2 text-text-primary border-b border-border-subtle
        text-xs">{children}</td>
    ),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) openUrl(href);
        }}
        className="text-accent hover:underline inline-flex items-center
          gap-0.5 cursor-pointer"
        title={href}
      >
        {children}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          className="flex-shrink-0 opacity-60">
          <path d="M4.5 1.5h6v6M10.5 1.5L4 8" />
        </svg>
      </a>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      // Resolve relative paths against the working directory
      let resolvedSrc = src || '';
      if (
        resolvedSrc &&
        !resolvedSrc.startsWith('file://') &&
        !resolvedSrc.startsWith('/') &&
        !resolvedSrc.startsWith('data:') &&
        !resolvedSrc.startsWith('http://') &&
        !resolvedSrc.startsWith('https://') &&
        !/^[A-Za-z]:[/\\]/.test(resolvedSrc) &&
        resolveBase
      ) {
        const base = resolveBase.endsWith('/') ? resolveBase : resolveBase + '/';
        resolvedSrc = `${base}${resolvedSrc}`;
      }

      // Local files: load via Rust base64 bridge (file:// URLs don't work in Tauri webview)
      if (isLocalPath(resolvedSrc)) {
        return <AsyncImage src={resolvedSrc} alt={alt || undefined} />;
      }

      // Remote URLs & data URIs: render directly
      return (
      <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
        shadow-sm inline-block max-w-full">
        <img
          src={resolvedSrc}
          alt={alt || ''}
          className="max-w-full max-h-96 object-contain cursor-zoom-in"
          onClick={() => {
            if (!resolvedSrc) return;
            if (resolvedSrc.startsWith('data:')) {
              useLightboxStore.getState().open(resolvedSrc, undefined, alt);
            } else {
              openUrl(resolvedSrc);
            }
          }}
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = 'none';
            const placeholder = el.nextElementSibling;
            if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
          }}
        />
        <div className="hidden items-center justify-center gap-2 py-6 px-4
          text-xs text-text-muted bg-bg-secondary">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <circle cx="5" cy="6" r="1.5" />
            <path d="M1 11l4-4 3 3 2-2 5 5" />
          </svg>
          {t('msg.imgError')}
        </div>
        {alt && (
          <div className="px-3 py-1.5 text-xs text-text-muted bg-bg-secondary
            border-t border-border-subtle">
            {alt}
          </div>
        )}
      </div>
      );
    },
    pre: ({ children }: { children?: ReactNode }) => {
      const codeText = extractText(children);
      return (
        <div className="relative group my-3">
          <CopyButton text={codeText} />
          <pre className="bg-bg-secondary rounded-xl p-4
            border border-border-subtle overflow-x-auto">
            {children}
          </pre>
        </div>
      );
    },
    code: ({ children, className }: { children?: ReactNode; className?: string }) => {
      // Fenced code blocks (language-xxx) — don't intercept, let <pre> handle them
      if (className) return <code className={className}>{children}</code>;

      const text = extractText(children).trim();
      if (FILE_PATH_RE.test(text)) {
        const resolved = text.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(text)
          ? text
          : resolveBase ? `${resolveBase.replace(/\/$/, '')}/${text}` : text;
        return (
          <button
            onClick={() => useFileStore.getState().selectFile(resolved)}
            className="inline-flex items-center gap-0.5 bg-bg-secondary px-1.5 py-0.5
              rounded-md text-sm text-accent hover:bg-accent/15
              cursor-pointer transition-smooth font-mono"
            title={resolved}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.2" className="flex-shrink-0 opacity-60">
              <path d="M7 1H3a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1V4L7 1z" />
              <path d="M7 1v3h3" />
            </svg>
            {text}
          </button>
        );
      }
      return <code>{children}</code>;
    },
  }), [t, resolveBase]);

  return (
    <div className={`prose prose-sm max-w-none
      prose-code:bg-bg-secondary prose-code:px-1.5 prose-code:py-0.5
      prose-code:rounded-md prose-code:text-sm prose-code:text-accent
      prose-pre:bg-bg-secondary prose-pre:rounded-xl prose-pre:p-4
      prose-pre:border prose-pre:border-border-subtle
      prose-headings:text-text-primary prose-a:text-accent
      prose-strong:text-text-primary ${className || ''}`}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
});
