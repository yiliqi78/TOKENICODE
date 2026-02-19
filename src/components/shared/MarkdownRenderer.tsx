import { memo, useState, useCallback, useMemo, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useLightboxStore } from './ImageLightbox';
import { useT } from '../../lib/i18n';

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

/* ================================================================
   MarkdownRenderer — shared markdown rendering with syntax highlighting
   ================================================================ */
interface Props {
  content: string;
  className?: string;
}

// Stable plugin arrays — created once, never cause re-renders
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeRaw, rehypeHighlight];

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className }: Props) {
  const t = useT();

  // Stable components object — only recreated if `t` changes (language switch)
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
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
        shadow-sm inline-block max-w-full">
        <img
          src={src}
          alt={alt || ''}
          className="max-w-full max-h-96 object-contain cursor-zoom-in"
          onClick={() => {
            if (!src) return;
            if (src.startsWith('file://') || src.startsWith('/')) {
              const path = src.startsWith('file://') ? src.slice(7) : src;
              useLightboxStore.getState().openFile(path, alt);
            } else if (src.startsWith('data:')) {
              useLightboxStore.getState().open(src, undefined, alt);
            } else {
              openUrl(src);
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
    ),
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
  }), [t]);

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
