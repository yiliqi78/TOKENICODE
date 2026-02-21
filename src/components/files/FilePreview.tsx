import { useMemo, useCallback, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { go } from '@codemirror/legacy-modes/mode/go';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { useFileStore } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { bridge } from '../../lib/tauri-bridge';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { useT } from '../../lib/i18n';

/* ================================================================
   Helpers
   ================================================================ */

function getExt(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getFileIcon(ext: string): string {
  const map: Record<string, string> = {
    md: '\ud83d\udcdd', mdx: '\ud83d\udcdd',
    ts: '\ud83d\udfe6', tsx: '\u269b\ufe0f',
    js: '\ud83d\udfe8', jsx: '\u269b\ufe0f',
    rs: '\ud83e\udda0', py: '\ud83d\udc0d',
    go: '\ud83d\udc39', java: '\u2615',
    json: '\ud83d\udce6', yaml: '\u2699\ufe0f', yml: '\u2699\ufe0f', toml: '\u2699\ufe0f',
    css: '\ud83c\udfa8', scss: '\ud83c\udfa8', less: '\ud83c\udfa8',
    html: '\ud83c\udf10', svg: '\ud83d\uddbc\ufe0f',
    txt: '\ud83d\udcc4', log: '\ud83d\udcc4',
    sh: '\ud83d\udcbb', bash: '\ud83d\udcbb', zsh: '\ud83d\udcbb',
    png: '\ud83d\uddbc\ufe0f', jpg: '\ud83d\uddbc\ufe0f', jpeg: '\ud83d\uddbc\ufe0f', gif: '\ud83d\uddbc\ufe0f', webp: '\ud83d\uddbc\ufe0f',
  };
  return map[ext] || '\ud83d\udcc4';
}

/** Return CodeMirror language extension for the given file extension */
function getLanguageExtension(ext: string) {
  switch (ext) {
    case 'ts': case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'js': case 'jsx': return javascript({ jsx: true });
    case 'py': return python();
    case 'rs': return rust();
    case 'json': return json();
    case 'html': case 'htm': case 'xhtml': return html();
    case 'css': case 'scss': case 'less': return css();
    case 'md': case 'mdx': return markdown();
    case 'java': case 'kt': return java();
    case 'c': case 'cpp': case 'h': case 'hpp': return cpp();
    case 'sql': return sql();
    case 'xml': case 'svg': return xml();
    case 'yaml': case 'yml': return yaml();
    case 'go': return StreamLanguage.define(go);
    case 'sh': case 'bash': case 'zsh': return StreamLanguage.define(shell);
    case 'rb': return StreamLanguage.define(ruby);
    case 'swift': return StreamLanguage.define(swift);
    case 'lua': return StreamLanguage.define(lua);
    case 'toml': return StreamLanguage.define(toml);
    case 'dockerfile': return StreamLanguage.define(dockerFile);
    default: return [];
  }
}

/**
 * Inject a <base> tag into HTML content so relative paths (CSS, JS, images)
 * resolve relative to the file's directory on disk.
 */
function injectBaseTag(html: string, filePath: string): string {
  // Get directory of the file (handle both / and \ separators)
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const dir = lastSep >= 0 ? filePath.substring(0, lastSep + 1) : '';
  const baseTag = `<base href="file://${dir}">`;

  // Insert into <head> if present, otherwise prepend
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([\s>])/i, `<head$1${baseTag}`);
  }
  return baseTag + html;
}

const MARKDOWN_EXTS = new Set(['md', 'mdx']);
const HTML_EXTS = new Set(['html', 'htm', 'xhtml']);
const SVG_EXT = 'svg';
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'aac', 'm4a']);
const PDF_EXT = 'pdf';
const BINARY_EXTS = new Set(['zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dmg', 'pkg',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'db', 'sqlite']);

/* ================================================================
   FilePreview component
   ================================================================ */
export function FilePreview() {
  const t = useT();
  const selectedFile = useFileStore((s) => s.selectedFile);
  const fileContent = useFileStore((s) => s.fileContent);
  const isLoadingContent = useFileStore((s) => s.isLoadingContent);
  const previewMode = useFileStore((s) => s.previewMode);
  const setPreviewMode = useFileStore((s) => s.setPreviewMode);
  const closePreview = useFileStore((s) => s.closePreview);
  const editContent = useFileStore((s) => s.editContent);
  const setEditContent = useFileStore((s) => s.setEditContent);
  const saveFile = useFileStore((s) => s.saveFile);
  const discardEdits = useFileStore((s) => s.discardEdits);
  const isSaving = useFileStore((s) => s.isSaving);
  const changedFiles = useFileStore((s) => s.changedFiles);
  const reloadContent = useFileStore((s) => s.reloadContent);

  // Auto-refresh preview when the selected file is modified externally
  const reloadRef = useRef(reloadContent);
  reloadRef.current = reloadContent;
  useEffect(() => {
    if (!selectedFile) return;
    const change = changedFiles.get(selectedFile);
    if (change === 'modified') {
      reloadRef.current();
    }
  }, [selectedFile, changedFiles]);

  const appTheme = useSettingsStore((s) => s.theme);
  const isDark = useMemo(() => {
    if (appTheme === 'dark') return true;
    if (appTheme === 'light') return false;
    return typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  }, [appTheme]);

  const ext = useMemo(() => selectedFile ? getExt(selectedFile) : '', [selectedFile]);
  const fileName = useMemo(() => selectedFile ? getFileName(selectedFile) : '', [selectedFile]);
  const isMarkdown = MARKDOWN_EXTS.has(ext);
  const isHtml = HTML_EXTS.has(ext);
  const isSvg = ext === SVG_EXT;
  const isImage = IMAGE_EXTS.has(ext);
  const isVideo = VIDEO_EXTS.has(ext);
  const isAudio = AUDIO_EXTS.has(ext);
  const isPdf = ext === PDF_EXT;
  const isBinary = BINARY_EXTS.has(ext);
  const hasPreview = isMarkdown || isHtml || isSvg;
  const isEditing = previewMode === 'edit';
  const isDirty = editContent !== null && editContent !== fileContent;

  const lineCount = useMemo(() => {
    const content = isEditing ? editContent : fileContent;
    if (!content) return 0;
    return content.split('\n').length;
  }, [fileContent, editContent, isEditing]);

  const langExtension = useMemo(() => getLanguageExtension(ext), [ext]);

  /* Cmd+S to save */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (isDirty) saveFile();
    }
  }, [isDirty, saveFile]);

  /* Mode tabs for the header */
  const modeTabs = useMemo(() => {
    if (isMarkdown) {
      // Markdown — preview + edit only
      return [
        { id: 'preview' as const, label: t('files.preview') },
        { id: 'edit' as const, label: t('files.edit') },
      ];
    }
    if (hasPreview) {
      // HTML, SVG — preview + source + edit
      return [
        { id: 'preview' as const, label: t('files.preview') },
        { id: 'source' as const, label: t('files.source') },
        { id: 'edit' as const, label: t('files.edit') },
      ];
    }
    if (!isBinary && !isImage && !isPdf && !isVideo && !isAudio) {
      return [
        { id: 'source' as const, label: t('files.source') },
        { id: 'edit' as const, label: t('files.edit') },
      ];
    }
    return [];
  }, [hasPreview, isMarkdown, isBinary, isImage, t]);

  if (!selectedFile) return null;

  return (
    <div className="flex flex-col h-full bg-bg-chat" onKeyDown={handleKeyDown}>
      {/* Header bar — pt-6 for macOS traffic lights, z-10 above iframe content */}
      <div className="flex items-center justify-between px-3 pt-6 pb-2
        border-b border-border-subtle bg-bg-secondary/50 flex-shrink-0 relative z-10">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm flex-shrink-0">{getFileIcon(ext)}</span>
          <span className="text-xs font-medium text-text-primary truncate">
            {fileName}
          </span>
          {lineCount > 0 && (
            <span className="text-[10px] text-text-muted flex-shrink-0">
              {lineCount} {t('files.lineCount')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Save / Discard buttons — visible when editing with unsaved changes */}
          {isEditing && isDirty && (
            <div className="flex items-center gap-1 animate-fade-in">
              <button
                onClick={discardEdits}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium
                  text-text-muted hover:text-text-primary hover:bg-bg-tertiary
                  transition-smooth"
              >
                {t('files.discard')}
              </button>
              <button
                onClick={saveFile}
                disabled={isSaving}
                className="px-2.5 py-0.5 rounded-md text-[10px] font-medium
                  bg-accent text-text-inverse hover:bg-accent-hover
                  transition-smooth disabled:opacity-50"
              >
                {isSaving ? t('files.saving') : t('files.save')}
              </button>
            </div>
          )}

          {/* Mode toggle tabs */}
          {modeTabs.length > 0 && (
            <div className="flex gap-0.5 bg-bg-tertiary/50 rounded-xl p-1">
              {modeTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setPreviewMode(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium
                    transition-smooth cursor-pointer
                    ${previewMode === tab.id
                      ? 'bg-bg-card text-accent shadow-sm'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-card/50'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Refresh button */}
          <button
            onClick={reloadContent}
            className="p-2 rounded-lg hover:bg-bg-tertiary
              text-text-tertiary transition-smooth cursor-pointer"
            title={t('files.refresh')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2.5 8a5.5 5.5 0 019.3-4M13.5 8a5.5 5.5 0 01-9.3 4" />
              <path d="M12 1v3h-3M4 12v3h3" />
            </svg>
          </button>

          {/* Close button — larger hit area for easy clicking */}
          <button
            onClick={closePreview}
            className="p-2 rounded-lg hover:bg-bg-tertiary
              text-text-tertiary transition-smooth cursor-pointer"
            title={t('files.closePreview')}
          >
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none"
              stroke="currentColor" strokeWidth="2">
              <path d="M4 4l6 6M10 4l-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {isLoadingContent ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-text-muted text-xs">
              <svg className="animate-spin-slow" width="14" height="14"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              {t('files.loading')}
            </div>
          </div>
        ) : isImage && selectedFile && fileContent ? (
          /* Image preview: use base64 data URL from Rust backend */
          <div className="flex items-center justify-center h-full p-4 overflow-auto">
            <img
              src={fileContent}
              alt={fileName}
              className="max-w-full max-h-full object-contain rounded"
              draggable={false}
            />
          </div>
        ) : isPdf && selectedFile && fileContent ? (
          /* PDF preview: iframe with base64 data URL */
          <div className="flex flex-col h-full">
            <iframe
              src={fileContent}
              className="flex-1 w-full border-0 bg-white"
              title={fileName}
            />
            <div className="flex items-center justify-center py-2 border-t border-border-subtle">
              <button
                onClick={() => bridge.openWithDefaultApp(selectedFile)}
                className="px-3 py-1 rounded-lg text-[11px] font-medium
                  text-text-muted hover:text-text-primary hover:bg-bg-tertiary
                  transition-smooth"
              >
                {t('files.openExternal')}
              </button>
            </div>
          </div>
        ) : isVideo && selectedFile && fileContent ? (
          /* Video preview: native <video> with base64 data URL */
          <div className="flex items-center justify-center h-full p-4">
            <video
              src={fileContent}
              controls
              className="max-w-full max-h-full rounded"
            />
          </div>
        ) : isAudio && selectedFile && fileContent ? (
          /* Audio preview: icon + native <audio> with base64 data URL */
          <div className="flex flex-col items-center justify-center h-full gap-4 p-4">
            <div className="text-4xl">{getFileIcon(ext)}</div>
            <audio
              src={fileContent}
              controls
              className="w-full max-w-md"
            />
          </div>
        ) : isBinary ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <div className="text-3xl">{getFileIcon(ext)}</div>
              <div className="text-xs text-text-muted">{t('files.binaryFile')}</div>
              {selectedFile && (
                <button
                  onClick={() => bridge.openWithDefaultApp(selectedFile)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-bg-secondary
                    text-text-muted hover:bg-bg-tertiary hover:text-text-primary
                    transition-smooth cursor-pointer inline-flex items-center gap-1.5"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M10 6.5v3a1 1 0 01-1 1H2.5a1 1 0 01-1-1V3a1 1 0 011-1H6" />
                    <path d="M7.5 1.5h3v3M7 5.5l3.5-4" />
                  </svg>
                  {t('files.openDefault')}
                </button>
              )}
            </div>
          </div>
        ) : isEditing ? (
          /* Edit mode: CodeMirror 6 editor */
          <CodeMirror
            value={editContent ?? fileContent ?? ''}
            extensions={[...(Array.isArray(langExtension) ? langExtension : [langExtension]), EditorView.lineWrapping]}
            theme={isDark ? vscodeDark : vscodeLight}
            onChange={(value) => setEditContent(value)}
            height="100%"
            style={{ height: '100%', fontSize: '13px' }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              indentOnInput: true,
              searchKeymap: true,
              tabSize: 2,
            }}
          />
        ) : previewMode === 'preview' && isHtml && fileContent !== null && selectedFile ? (
          /* HTML preview: inject <base> tag so relative CSS/JS/images resolve correctly */
          <iframe
            srcDoc={injectBaseTag(fileContent, selectedFile)}
            sandbox="allow-same-origin allow-scripts"
            className="w-full h-full bg-white border-0"
            title={fileName}
          />
        ) : previewMode === 'preview' && isSvg && fileContent !== null ? (
          /* SVG preview: render inline */
          <div className="flex items-center justify-center h-full p-4 overflow-auto">
            <div
              className="max-w-full max-h-full selectable"
              dangerouslySetInnerHTML={{ __html: fileContent }}
            />
          </div>
        ) : previewMode === 'preview' && isMarkdown && fileContent !== null ? (
          /* Markdown preview: rendered */
          <div className="overflow-auto h-full p-4">
            <div className="text-sm leading-relaxed selectable max-w-3xl mx-auto">
              {(() => {
                // Extract YAML frontmatter if present
                const fmMatch = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
                const frontmatter = fmMatch ? fmMatch[1] : null;
                const body = fmMatch ? fileContent.slice(fmMatch[0].length) : fileContent;
                return (
                  <>
                    {frontmatter && (
                      <div className="mb-4 rounded-lg border border-border-subtle
                        bg-bg-secondary/50 overflow-hidden text-xs font-mono">
                        <div className="px-3 py-1 border-b border-border-subtle/50
                          bg-bg-tertiary/30 text-[10px] text-text-tertiary font-sans">
                          frontmatter
                        </div>
                        <div className="px-3 py-2 text-text-muted whitespace-pre-wrap">
                          {frontmatter}
                        </div>
                      </div>
                    )}
                    <MarkdownRenderer content={body} />
                  </>
                );
              })()}
            </div>
          </div>
        ) : fileContent !== null ? (
          /* Source view: read-only CodeMirror */
          <CodeMirror
            value={fileContent}
            extensions={[...(Array.isArray(langExtension) ? langExtension : [langExtension]), EditorView.lineWrapping]}
            theme={isDark ? vscodeDark : vscodeLight}
            editable={false}
            readOnly={true}
            height="100%"
            style={{ height: '100%', fontSize: '13px' }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: false,
              foldGutter: true,
              bracketMatching: true,
              tabSize: 2,
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-xs text-text-muted">{t('files.errorLoading')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
