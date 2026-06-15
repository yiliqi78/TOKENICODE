import React, { memo, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useLightboxStore } from './ImageLightbox';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { classifyPathToken, resolvePathToken, KNOWN_FILE_EXTENSIONS } from '../../stores/fileReveal';
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
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  // Phase 3 §3.3: external (non-project) paths need explicit user authorization
  // before we load their bytes. Unauthorized paths render a placeholder with
  // an "authorize" button that opens the native file dialog.
  const filePath = useMemo(() => (src.startsWith('file://') ? src.slice(7) : src), [src]);
  const inProject = useMemo(() => {
    if (!workingDirectory) return false;
    // Resolve '..' and '.' segments to prevent path traversal bypassing
    // the project-containment check (e.g. /project/../outside.png would
    // naively pass a startsWith('/project/') test).
    const segments: string[] = [];
    for (const seg of filePath.split('/')) {
      if (seg === '..') { segments.pop(); }
      else if (seg !== '.' && seg !== '') { segments.push(seg); }
    }
    const normalized = '/' + segments.join('/');
    const base = workingDirectory.endsWith('/') ? workingDirectory : workingDirectory + '/';
    return normalized === workingDirectory || normalized.startsWith(base);
  }, [filePath, workingDirectory]);
  const [authorized, setAuthorized] = useState(inProject);

  // Note: we pass no tab_id here — path_access.validate() with tab_id=None
  // falls back to checking fixed roots + any tab's grants, which is what we
  // want for Markdown images (the rendering context isn't strictly per-tab).
  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    bridge
      .readFileBase64(filePath)
      .then((d) => { if (!cancelled) setDataUrl(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [filePath, authorized]);

  const handleAuthorize = useCallback(async () => {
    const { useSessionStore } = await import('../../stores/sessionStore');
    const activeTabId = useSessionStore.getState().selectedSessionId;
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const selected = await openDialog({
        title: t('msg.authorizeImage') ?? 'Authorize external image',
        defaultPath: filePath,
        multiple: false,
      });
      const chosen = Array.isArray(selected) ? selected[0] : selected;
      if (!chosen || !activeTabId) return;
      // Grant the original filePath (the one we will actually read), not the
      // user-chosen path.  The file dialog serves as a user-intent confirmation
      // step; the displayed path is already known.  If chosen differs from
      // filePath we still grant filePath so the subsequent readFileBase64 works.
      await bridge.addPathGrant(activeTabId, filePath);
      if (chosen !== filePath) {
        // Also grant the chosen path in case the user picked something else
        await bridge.addPathGrant(activeTabId, chosen);
      }
      setAuthorized(true);
    } catch (e) {
      console.warn('[MarkdownRenderer] authorize failed:', e);
    }
  }, [filePath, t]);

  const handleClick = useCallback(() => {
    useLightboxStore.getState().openFile(filePath, alt);
  }, [filePath, alt]);

  if (!authorized) {
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    return (
      <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
        inline-block max-w-full bg-bg-secondary">
        <div className="flex items-center gap-3 px-4 py-3">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-text-muted">
            <rect x="2" y="3" width="16" height="14" rx="2" />
            <circle cx="6.5" cy="7.5" r="1.5" />
            <path d="M2 14l4-4 4 4 2-2 6 6" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-text-primary truncate">{fileName}</div>
            <div className="text-[11px] text-text-muted truncate">{filePath}</div>
          </div>
          <button
            onClick={handleAuthorize}
            className="px-2 py-1 rounded-md text-[11px] font-medium bg-accent/10
              text-accent border border-accent/25 hover:bg-accent/20
              transition-smooth cursor-pointer flex-shrink-0"
          >
            {t('msg.authorize') ?? '授权'}
          </button>
        </div>
        {alt && (
          <div className="px-3 py-1.5 text-xs text-text-muted bg-bg-secondary
            border-t border-border-subtle">{alt}</div>
        )}
      </div>
    );
  }

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
      className="flex-shrink-0 px-2 py-0.5 rounded-md text-[10px]
        font-medium text-text-tertiary hover:text-text-primary
        hover:bg-bg-tertiary transition-smooth"
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

/** Extract language label from a fenced block's <code className="language-xxx"> */
function extractLang(node: ReactNode): string {
  if (Array.isArray(node)) {
    for (const n of node) { const r = extractLang(n); if (r) return r; }
    return '';
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const cn = (node as any).props?.className || '';
    const m = /language-([\w-]+)/.exec(cn);
    if (m) return m[1].toUpperCase();
    return extractLang((node as any).props?.children);
  }
  return '';
}


/**
 * Pre-process markdown to wrap bare file paths in backticks so the existing
 * `code` component handler can make them clickable.
 *
 * Only processes text outside fenced code blocks and inline code.
 * Matches absolute paths (/..., C:\...), relative (./..., ../...), and
 * common project-relative paths (src/..., lib/..., etc.).
 */
const BARE_PATH_RE = /(^|[^`\w:@#/])((?:(?:\/|\.\.?\/)[\w.@/+-]+\.\w{1,10}|(?:\.[a-zA-Z][\w.-]*|src|lib|components|stores|hooks|utils|tests|__tests__|app|pages|public|assets|styles|config)\/[\w.@/+-]+(?:\.\w{1,10})?))(?![`\w])/g;

function wrapBareFilePaths(content: string): string {
  // Split by fenced code blocks (``` ... ```) — don't touch code blocks
  const fenced = content.split(/(```[\s\S]*?```)/g);
  return fenced.map((part, i) => {
    if (i % 2 === 1) return part; // inside fenced code block
    // Split by inline code (` ... `) — don't double-wrap
    const inlined = part.split(/(`[^`\n]+`)/g);
    return inlined.map((seg, j) => {
      if (j % 2 === 1) return seg; // inside inline code
      // Also skip markdown link targets: [text](url)
      return seg.replace(BARE_PATH_RE, (match, prefix, path, offset, str) => {
        const pathStart = offset + prefix.length;
        // Don't wrap if inside a markdown link target: ...](path)
        if (pathStart > 0 && str[pathStart - 1] === '(') return match;
        // Don't wrap if preceded by ]( (markdown link)
        const before = str.slice(Math.max(0, pathStart - 2), pathStart);
        if (before.endsWith('](')) return match;
        // TK-323: Only wrap if extension is a known file type, OR path starts
        // with a hidden dir (.claude/, .github/) where extension is optional
        const ext = path.split('.').pop()?.toLowerCase();
        const isHiddenDirPath = /^\.[a-zA-Z][\w.-]*\//.test(path);
        if (!isHiddenDirPath && (!ext || !KNOWN_FILE_EXTENSIONS.has(ext))) return match;
        return `${prefix}\`${path}\``;
      });
    }).join('');
  }).join('');
}

/* ================================================================
   MarkdownRenderer — shared markdown rendering with syntax highlighting
   ================================================================ */
interface Props {
  content: string;
  className?: string;
  /** Base path for resolving relative image paths (defaults to workingDirectory) */
  basePath?: string;
}

// Sanitize schema: GitHub defaults + className on all elements (needed for highlight.js)
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'data'],
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RemarkPlugin = any;

const EMPTY_REMARK_PLUGINS: RemarkPlugin[] = [];
let cachedRemarkPlugins: RemarkPlugin[] | null = null;
let remarkPluginsPromise: Promise<RemarkPlugin[]> | null = null;
let warnedAboutGfmFallback = false;

function supportsRemarkGfmRegex(): boolean {
  try {
    // remark-gfm's autolink-literal dependency uses this exact regex shape.
    // Older WebKit parses `(?<=` as an invalid group specifier and crashes
    // during module evaluation, so we gate the import on syntax support.
    void new RegExp(
      '(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)',
      'gu',
    );
    return true;
  } catch {
    return false;
  }
}

async function loadRemarkPlugins(): Promise<RemarkPlugin[]> {
  if (cachedRemarkPlugins) return cachedRemarkPlugins;

  if (!supportsRemarkGfmRegex()) {
    if (!warnedAboutGfmFallback) {
      warnedAboutGfmFallback = true;
      console.warn('[TOKENICODE] remark-gfm disabled: current JS runtime does not support its regex syntax');
    }
    cachedRemarkPlugins = EMPTY_REMARK_PLUGINS;
    return cachedRemarkPlugins;
  }

  if (!remarkPluginsPromise) {
    remarkPluginsPromise = Promise.all([
      import('remark-gfm'),
      import('remark-cjk-friendly'),
    ])
      .then(([gfmMod, cjkMod]) => {
        cachedRemarkPlugins = [gfmMod.default, cjkMod.default];
        return cachedRemarkPlugins;
      })
      .catch((error) => {
        console.warn('[TOKENICODE] failed to load remark plugins, falling back to basic markdown', error);
        cachedRemarkPlugins = EMPTY_REMARK_PLUGINS;
        return cachedRemarkPlugins;
      });
  }

  return remarkPluginsPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REHYPE_PLUGINS: any[] = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], rehypeHighlight];

/** Error boundary scoped to a single markdown block.
 *  A malformed message (e.g. truncated table from rate-limit) crashes only
 *  its own bubble, not the entire app. */
class MarkdownErrorBoundary extends React.Component<
  { children: ReactNode; fallback: string },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn('[MarkdownRenderer] render failed, falling back to plain text:', error.message);
  }
  render() {
    if (this.state.hasError) {
      return (
        <pre className="whitespace-pre-wrap break-words text-xs text-text-secondary">
          {this.props.fallback}
        </pre>
      );
    }
    return this.props.children;
  }
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className, basePath }: Props) {
  const t = useT();
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const resolveBase = basePath || workingDirectory || '';
  const [remarkPlugins, setRemarkPlugins] = useState<RemarkPlugin[]>(() => cachedRemarkPlugins ?? EMPTY_REMARK_PLUGINS);

  useEffect(() => {
    if (cachedRemarkPlugins !== null) return;

    let cancelled = false;
    loadRemarkPlugins().then((plugins) => {
      if (!cancelled) setRemarkPlugins(plugins);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-process: wrap bare file paths in backticks so `code` handler makes them clickable
  const processedContent = useMemo(() => wrapBareFilePaths(content), [content]);

  // Stable components object — only recreated if `t` or resolveBase changes
  const components = useMemo(() => ({
    table: ({ children }: { children?: ReactNode }) => (
      <div className="my-4 overflow-hidden rounded-xl border border-border-subtle">
        <table className="w-full border-collapse text-xs m-0">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: ReactNode }) => (
      <thead className="bg-bg-secondary">{children}</thead>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th className="px-4 py-2.5 text-center font-semibold text-text-secondary
        border-b border-border-subtle text-[11px] whitespace-nowrap">{children}</th>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td className="px-4 py-2.5 text-text-secondary border-b border-border-subtle
        text-xs">{children}</td>
    ),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      // Detect false-positive autolinks: remark-gfm treats file-like text
      // (e.g. AGENTS.md, config.rs) as URLs because some extensions are
      // valid TLDs (.md = Moldova, .rs = Serbia, .sh = St. Helena, etc.)
      const childText = typeof children === 'string' ? children : '';
      const FILE_EXT_RE = /\.(md|txt|json|ts|tsx|js|jsx|py|rs|go|toml|yaml|yml|html|css|sh|log|env|cfg|ini|xml|csv|sql|lock|swift|kt|java|c|h|cpp|hpp|rb|lua|zig|vue|svelte)$/i;
      if (
        href &&
        FILE_EXT_RE.test(childText) &&
        (href === `http://${childText}` || href === `https://${childText}`)
      ) {
        return <code className="rounded bg-black/[0.06] px-1 py-0.5 text-[0.9em] dark:bg-white/[0.08]">{children}</code>;
      }

      return (
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
      );
    },
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
      const lang = extractLang(children);
      return (
        <div className="my-5 rounded-xl border border-border-subtle overflow-hidden bg-white dark:bg-bg-secondary">
          <div className="flex items-center justify-between px-3 py-1.5
            bg-bg-primary border-b border-border-subtle">
            <span className="text-[11px] font-medium text-text-tertiary select-none">
              {lang || 'CODE'}
            </span>
            <CopyButton text={codeText} />
          </div>
          <pre className="bg-white dark:bg-bg-secondary px-4 py-3 overflow-x-auto
            text-[11px] leading-relaxed text-text-primary">
            {children}
          </pre>
        </div>
      );
    },
    code: ({ children, className }: { children?: ReactNode; className?: string }) => {
      // Fenced code blocks (language-xxx) — don't intercept, let <pre> handle them
      if (className) return <code className={className}>{children}</code>;

      const text = extractText(children).trim();
      const kind = classifyPathToken(text);
      if (kind) {
        const resolved = resolvePathToken(text, resolveBase);
        return (
          <button
            onClick={() => {
              // 纯定位：右侧文件区展开到该路径并高亮（不读内容、不预览）
              useSettingsStore.getState().setSecondaryTab('files');
              useFileStore.getState().revealPath(resolved);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5
              bg-bg-secondary border border-accent/50 rounded-full
              text-xs text-accent/70 font-medium cursor-pointer
              hover:bg-accent/10 hover:border-accent
              transition-all duration-150 select-none
              align-baseline leading-normal whitespace-nowrap"
            title={resolved}
          >
            <span className="text-[10px] leading-none">{kind === 'folder' ? '📁' : '📄'}</span>
            <span className="max-w-[240px] truncate">{text}</span>
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
      prose-p:leading-[1.85] prose-li:leading-[1.85]
      prose-h1:text-lg prose-h2:text-[15px] prose-h3:text-sm prose-h4:text-[13px]
      prose-headings:text-text-primary prose-headings:font-semibold
      prose-headings:mt-4 prose-headings:mb-2 prose-a:text-accent
      prose-strong:text-text-primary ${className || ''}`}>
      <MarkdownErrorBoundary fallback={content}>
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={REHYPE_PLUGINS}
          components={components}
        >
          {processedContent}
        </Markdown>
      </MarkdownErrorBoundary>
    </div>
  );
});
