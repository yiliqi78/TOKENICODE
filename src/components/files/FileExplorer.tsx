import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileNode } from '../../lib/tauri-bridge';
import { useFileStore, FileChangeKind } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { startTreeDrag, moveTreeDrag } from '../../lib/drag-state';
import { useChatStore } from '../../stores/chatStore';

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁';
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': return '🟦';
    case 'js': case 'jsx': return '🟨';
    case 'rs': return '🦀';
    case 'json': return '📋';
    case 'md': return '📝';
    case 'css': return '🎨';
    case 'html': return '🌐';
    case 'toml': case 'yaml': case 'yml': return '⚙️';
    case 'png': case 'jpg': case 'svg': return '🖼️';
    default: return '📄';
  }
}

function getChangeBadge(kind: FileChangeKind | undefined) {
  if (!kind) return null;
  const colors = {
    created: 'bg-success',
    modified: 'bg-accent',
    removed: 'bg-error',
  };
  const labels = { created: 'A', modified: 'M', removed: 'D' };
  return (
    <span className={`ml-auto flex-shrink-0 w-3.5 h-3.5 rounded text-[8px]
      font-bold text-text-inverse flex items-center justify-center ${colors[kind]}`}>
      {labels[kind]}
    </span>
  );
}

// --- Context Menu ---
interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

interface ContextMenuCallbacks {
  onCopyPath: (path: string) => void;
  onCopyFile: (path: string) => void;
  onPaste: (targetDir: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onInsertToChat: (path: string) => void;
  clipboardPath: string | null;
}

type MenuItem = { label: string; icon: React.ReactNode; action: () => void; danger?: boolean } | 'separator';

function ContextMenu({ menu, onClose, callbacks }: {
  menu: ContextMenuState;
  onClose: () => void;
  callbacks: ContextMenuCallbacks;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > vw - 8) x = vw - rect.width - 8;
    if (y + rect.height > vh - 8) y = vh - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    setPos({ x, y });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const items: MenuItem[] = [
    ...(!menu.isDir ? [{
      label: t('files.insertToChat'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 14l4-2 8-8-2-2-8 8-2 4z" /><path d="M10 4l2 2" /></svg>,
      action: () => { callbacks.onInsertToChat(menu.path); onClose(); },
    }] as MenuItem[] : []),
    {
      label: t('files.copyPath'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 2H2v12h8v-3" /><path d="M6 6h8v8H6V6z" /></svg>,
      action: () => { callbacks.onCopyPath(menu.path); onClose(); },
    },
    ...(!menu.isDir ? [{
      label: t('files.copyFile'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M5 11H3.5A1.5 1.5 0 012 9.5v-6A1.5 1.5 0 013.5 2h6A1.5 1.5 0 0111 3.5V5" /></svg>,
      action: () => { callbacks.onCopyFile(menu.path); onClose(); },
    }] as MenuItem[] : []),
    ...(menu.isDir && callbacks.clipboardPath ? [{
      label: t('files.paste'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 2H6a1 1 0 00-1 1v1H3a1 1 0 00-1 1v8a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1h-2V3a1 1 0 00-1-1z" /></svg>,
      action: () => { callbacks.onPaste(menu.path); onClose(); },
    }] as MenuItem[] : []),
    'separator',
    {
      label: t('files.rename'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M11 2l3 3-9 9H2v-3l9-9z" /></svg>,
      action: () => { callbacks.onRename(menu.path); onClose(); },
    },
    {
      label: t('files.delete'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M6 4V2h4v2M5 4v9h6V4" /></svg>,
      action: () => { callbacks.onDelete(menu.path, menu.isDir); onClose(); },
      danger: true,
    },
    'separator',
    {
      label: t('files.revealInFinder'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h4l2 2h6v7H2V4z" /></svg>,
      action: () => { bridge.revealInFinder(menu.path); onClose(); },
    },
    {
      label: t('files.openDefault'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 9v4H4V5h4" /><path d="M8 8l6-6M10 2h4v4" /></svg>,
      action: () => { bridge.openWithDefaultApp(menu.path); onClose(); },
    },
    {
      label: t('files.openVscodeShort'),
      icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 3l8 5-8 5V3z" /></svg>,
      action: () => { bridge.openInVscode(menu.path); onClose(); },
    },
  ];

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[200px] py-1 rounded-xl border border-border-subtle
        bg-bg-card shadow-lg animate-fade-in whitespace-nowrap"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-1 border-t border-border-subtle" />
        ) : (
          <button
            key={i}
            onClick={item.action}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs
              hover:bg-bg-secondary transition-smooth text-left cursor-pointer
              ${item.danger ? 'text-error hover:bg-error/10' : 'text-text-primary'}`}
          >
            <span className={`flex-shrink-0 ${item.danger ? 'text-error/60' : 'text-text-tertiary'}`}>
              {item.icon}
            </span>
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

// --- Tree Node ---
function hasMatchingDescendant(node: FileNode, query: string): boolean {
  if (node.name.toLowerCase().includes(query)) return true;
  if (node.children) {
    return node.children.some((child) => hasMatchingDescendant(child, query));
  }
  return false;
}

function TreeNode({
  node,
  depth,
  searchQuery,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: {
  node: FileNode;
  depth: number;
  searchQuery: string;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedFile = useFileStore((s) => s.selectedFile);
  const selectFile = useFileStore((s) => s.selectFile);
  const changedFiles = useFileStore((s) => s.changedFiles);
  const isSelected = selectedFile === node.path;
  const changeKind = changedFiles.get(node.path);

  const hasChildChanges = node.is_dir && Array.from(changedFiles.keys()).some(
    (p) => p.startsWith(node.path + '/')
  );

  // Search filtering
  const matchesSearch = useMemo(() => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    if (node.name.toLowerCase().includes(q)) return true;
    if (node.is_dir && node.children) {
      return hasMatchingDescendant(node, q);
    }
    return false;
  }, [node, searchQuery]);

  if (!matchesSearch) return null;

  // Auto-expand directories when searching
  const isExpanded = searchQuery ? true : expanded;

  const handleClick = () => {
    if (node.is_dir) {
      setExpanded(!expanded);
    } else {
      selectFile(node.path);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const startX = e.clientX;
          const startY = e.clientY;
          let started = false;

          const onMove = (me: MouseEvent) => {
            if (!started) {
              const dx = me.clientX - startX;
              const dy = me.clientY - startY;
              if (dx * dx + dy * dy < 25) return; // 5px threshold
              started = true;
              startTreeDrag(node.path, node.is_dir);
            }
            moveTreeDrag(me.clientX, me.clientY);
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (started) {
              // Prevent the click event from firing after drag
              const suppressClick = (ce: MouseEvent) => {
                ce.stopPropagation();
                ce.preventDefault();
              };
              // Capture phase to suppress before React sees it
              document.addEventListener('click', suppressClick, { capture: true, once: true });
              // Signal ChatPanel to consume the drag path
              window.dispatchEvent(new CustomEvent('tree-drag-drop'));
            }
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node.path, node.is_dir);
        }}
        className={`w-full flex items-center gap-1.5 py-1 px-2 rounded-lg
          text-left text-xs transition-smooth group
          ${isSelected
            ? 'bg-accent/10 text-accent'
            : changeKind
              ? 'text-accent'
              : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
          }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.is_dir && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className={`flex-shrink-0 transition-transform duration-150
              ${isExpanded ? 'rotate-90' : ''}`}>
            <path d="M3 2l4 3-4 3" />
          </svg>
        )}
        {!node.is_dir && <span className="w-2.5" />}
        <span className="text-xs leading-none">
          {getFileIcon(node.name, node.is_dir)}
        </span>
        {renamingPath === node.path ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-xs bg-bg-input border border-border-focus
              rounded px-1 py-0 outline-none text-text-primary"
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
        {getChangeBadge(changeKind)}
        {!changeKind && hasChildChanges && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent
            flex-shrink-0" />
        )}
      </button>
      {node.is_dir && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              searchQuery={searchQuery}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main Component ---
export function FileExplorer() {
  const t = useT();
  const tree = useFileStore((s) => s.tree);
  const isLoading = useFileStore((s) => s.isLoading);
  const rootPath = useFileStore((s) => s.rootPath);
  const changedFiles = useFileStore((s) => s.changedFiles);
  const clearChangedFiles = useFileStore((s) => s.clearChangedFiles);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);

  const refreshTree = useFileStore((s) => s.refreshTree);

  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Right-click menu state
  const [clipboardPath, setClipboardPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; isDir: boolean } | null>(null);

  const changedCount = changedFiles.size;

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // --- Right-click menu callbacks ---
  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
  }, []);

  const handleCopyFile = useCallback((path: string) => {
    setClipboardPath(path);
  }, []);

  const handlePaste = useCallback(async (targetDir: string) => {
    if (!clipboardPath) return;
    const fileName = clipboardPath.split(/[\\/]/).pop() || 'file';
    const dest = `${targetDir}/${fileName}`;
    try {
      await bridge.copyFile(clipboardPath, dest);
      setClipboardPath(null);
      refreshTree();
    } catch {
      // Silently fail
    }
  }, [clipboardPath, refreshTree]);

  const handleStartRename = useCallback((path: string) => {
    const name = path.split(/[\\/]/).pop() || '';
    setRenamingPath(path);
    setRenameValue(name);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    const dir = renamingPath.substring(0, Math.max(renamingPath.lastIndexOf('/'), renamingPath.lastIndexOf('\\')));
    const dest = `${dir}/${renameValue.trim()}`;
    if (dest === renamingPath) {
      setRenamingPath(null);
      return;
    }
    try {
      await bridge.renameFile(renamingPath, dest);
      setRenamingPath(null);
      refreshTree();
    } catch {
      setRenamingPath(null);
    }
  }, [renamingPath, renameValue, refreshTree]);

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const handleRequestDelete = useCallback((path: string, isDir: boolean) => {
    setDeleteTarget({ path, isDir });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await bridge.deleteFile(deleteTarget.path);
      setDeleteTarget(null);
      refreshTree();
    } catch {
      setDeleteTarget(null);
    }
  }, [deleteTarget, refreshTree]);

  const handleInsertToChat = useCallback((path: string) => {
    const currentDraft = useChatStore.getState().inputDraft;
    const prefix = currentDraft && !currentDraft.endsWith('\n') && !currentDraft.endsWith(' ') ? ' ' : '';
    useChatStore.getState().setInputDraft(currentDraft + prefix + path);
  }, []);

  const contextMenuCallbacks: ContextMenuCallbacks = useMemo(() => ({
    onCopyPath: handleCopyPath,
    onCopyFile: handleCopyFile,
    onPaste: handlePaste,
    onRename: handleStartRename,
    onDelete: handleRequestDelete,
    onInsertToChat: handleInsertToChat,
    clipboardPath,
  }), [handleCopyPath, handleCopyFile, handlePaste, handleStartRename, handleRequestDelete, handleInsertToChat, clipboardPath]);

  // No project selected
  if (!workingDirectory) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-3 py-2 border-b border-border-subtle">
          <span className="text-xs font-semibold text-text-tertiary
            uppercase tracking-wider">{t('files.title')}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center
          px-4 text-center">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"
            stroke="currentColor" strokeWidth="1.2"
            className="text-text-tertiary/40 mb-3">
            <path d="M4 8h8l4 4h12v14H4V8z" />
          </svg>
          <p className="text-xs text-text-tertiary leading-relaxed">
            {t('files.selectProject')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2
        border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0"
          title={workingDirectory}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="text-accent flex-shrink-0">
            <path d="M2 4h4l2 2h6v7H2V4z" />
          </svg>
          <div className="min-w-0">
            <span className="text-xs font-semibold text-text-primary
              truncate block">
              {workingDirectory.split(/[\\/]/).pop()}
            </span>
          </div>
          {changedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full
              bg-accent/15 text-accent
              font-medium flex-shrink-0">
              {changedCount} {t('files.changed')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {changedCount > 0 && (
            <button onClick={clearChangedFiles}
              className="p-1 rounded hover:bg-bg-secondary
                text-text-tertiary transition-smooth" title={t('files.clearMarkers')}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.5">
                <path d="M2 5h6" />
              </svg>
            </button>
          )}
          <button onClick={() => {
              const dir = workingDirectory || rootPath;
              if (dir) refreshTree(dir);
            }}
            className="p-1 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth" title={t('files.refresh')}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M1 6a5 5 0 019-2M11 6a5 5 0 01-9 2" />
              <path d="M10 1v3h-3M2 11V8h3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-2 py-1.5 border-b border-border-subtle">
        <div className="relative">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('files.search')}
            className="w-full pl-7 pr-7 py-1 text-xs bg-bg-secondary/50
              border border-border-subtle rounded-lg text-text-primary
              placeholder:text-text-tertiary outline-none
              focus:border-border-focus focus:bg-bg-input
              transition-smooth"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2
                p-0.5 rounded text-text-tertiary hover:text-text-primary
                transition-smooth"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2l6 6M8 2l-6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent/30
              border-t-accent rounded-full animate-spin" />
          </div>
        ) : tree.length > 0 ? (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              searchQuery={searchQuery}
              onContextMenu={handleContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
            />
          ))
        ) : (
          <div className="text-center py-8 text-xs text-text-tertiary">
            {t('files.noFiles')}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={closeContextMenu} callbacks={contextMenuCallbacks} />
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
          onClick={() => setDeleteTarget(null)}>
          <div className="bg-bg-card border border-border-subtle rounded-xl p-5
            shadow-lg max-w-sm w-full mx-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-text-primary mb-1">
              {(deleteTarget.isDir ? t('files.deleteConfirmDir') : t('files.deleteConfirm'))
                .replace('{name}', deleteTarget.path.split(/[\\/]/).pop() ?? '')}
            </p>
            <p className="text-xs text-text-muted mb-4 truncate">{deleteTarget.path}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-xs rounded-lg bg-bg-secondary
                  text-text-muted hover:bg-bg-tertiary transition-smooth cursor-pointer">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-xs rounded-lg bg-error/10
                  text-error hover:bg-error/20 transition-smooth cursor-pointer">
                {t('files.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
