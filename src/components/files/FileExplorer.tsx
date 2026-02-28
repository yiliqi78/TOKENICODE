import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileNode } from '../../lib/tauri-bridge';
import { useFileStore, FileChangeKind } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { startTreeDrag, moveTreeDrag, endTreeDrag } from '../../lib/drag-state';
import { useChatStore } from '../../stores/chatStore';
import { FileIcon } from '../shared/FileIcon';
import { ConfirmDialog } from '../shared/ConfirmDialog';

function getChangeBadge(kind: FileChangeKind | undefined) {
  if (!kind) return null;
  const colors = {
    created: 'bg-success',
    modified: 'bg-success',
    removed: 'bg-error',
  };
  const labels = { created: 'A', modified: 'M', removed: 'D' };
  return (
    <span className={`ml-auto flex-shrink-0 w-4 h-4 rounded text-[9px]
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
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
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
    ...(menu.isDir ? [
      {
        label: t('files.newFile'),
        icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 2H4v12h8V5l-3-3z" /><path d="M8 7v4M6 9h4" /></svg>,
        action: () => { callbacks.onNewFile(menu.path); onClose(); },
      },
      {
        label: t('files.newFolder'),
        icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h4l2 2h6v7H2V4z" /><path d="M7 8v3M5.5 9.5h3" /></svg>,
        action: () => { callbacks.onNewFolder(menu.path); onClose(); },
      },
      'separator' as const,
    ] as MenuItem[] : []),
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
            className={`w-full flex items-center gap-2 px-3 py-2 text-[13px]
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

// --- Search Result Item (flat list) ---
interface FlatMatch {
  node: FileNode;
  /** Relative directory path for context, e.g. "src/components" */
  relDir: string;
}

function collectMatches(nodes: FileNode[], query: string, rootPrefix: string): FlatMatch[] {
  const results: FlatMatch[] = [];
  function walk(node: FileNode) {
    if (node.name.toLowerCase().includes(query)) {
      // Compute relative directory (parent path minus root prefix)
      const lastSep = node.path.lastIndexOf('/');
      const parentPath = lastSep > 0 ? node.path.slice(0, lastSep) : '';
      const relDir = parentPath.startsWith(rootPrefix)
        ? parentPath.slice(rootPrefix.length).replace(/^\//, '')
        : parentPath;
      results.push({ node, relDir });
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  for (const n of nodes) walk(n);
  return results;
}

function SearchResultItem({
  match,
  onContextMenu,
}: {
  match: FlatMatch;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
}) {
  const { node, relDir } = match;
  const selectedFile = useFileStore((s) => s.selectedFile);
  const selectFile = useFileStore((s) => s.selectFile);
  const changeKind = useFileStore((s) => s.changedFiles.get(node.path));
  const isSelected = selectedFile === node.path;
  return (
    <button
      onClick={() => { if (!node.is_dir) selectFile(node.path); }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, node.path, node.is_dir); }}
      className={`w-full flex items-center gap-2 py-1.5 px-3 rounded-lg
        text-left text-[13px] transition-smooth group
        ${isSelected
          ? 'bg-accent/10 text-accent'
          : changeKind
            ? 'text-success'
            : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary'
        }`}
    >
      <FileIcon name={node.name} isDir={node.is_dir} size={14} className="flex-shrink-0" />
      <span className="truncate">{node.name}</span>
      {relDir && (
        <span className="ml-auto text-xs text-text-tertiary truncate max-w-[40%] flex-shrink-0">
          {relDir}
        </span>
      )}
      {getChangeBadge(changeKind)}
    </button>
  );
}

// --- Tree Node ---

function TreeNode({
  node,
  depth,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  creatingIn,
  createName,
  onCreateNameChange,
  onCreateSubmit,
  onCreateCancel,
}: {
  node: FileNode;
  depth: number;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  creatingIn: { dir: string; type: 'file' | 'folder' } | null;
  createName: string;
  onCreateNameChange: (v: string) => void;
  onCreateSubmit: () => void;
  onCreateCancel: () => void;
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

  const isExpanded = expanded;

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
              document.addEventListener('click', suppressClick, { capture: true, once: true });
              // End drag (cleans up ghost + detects drop target)
              const result = endTreeDrag();
              if (result) {
                if (result.targetFolder) {
                  // Drop on folder → move file
                  const fileName = result.sourcePath.split(/[\\/]/).pop() || '';
                  const dest = `${result.targetFolder}/${fileName}`;
                  bridge.renameFile(result.sourcePath, dest)
                    .then(() => {
                      const dir = useSettingsStore.getState().workingDirectory
                        || useFileStore.getState().rootPath;
                      if (dir) useFileStore.getState().refreshTree(dir);
                    })
                    .catch((err: unknown) => console.error('Failed to move file:', err));
                } else if (!result.droppedInTree) {
                  // Drop outside file tree → insert file chip in chat
                  window.dispatchEvent(
                    new CustomEvent('tokenicode:tree-file-inline', { detail: result.sourcePath }),
                  );
                }
              }
            }
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node.path, node.is_dir);
        }}
        {...(node.is_dir ? { 'data-dir-path': node.path } : {})}
        className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-lg
          text-left text-[13px] transition-smooth group
          ${isSelected
            ? 'bg-accent/10 text-accent'
            : changeKind
              ? 'text-success'
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
        <FileIcon name={node.name} isDir={node.is_dir} size={14}
          className="flex-shrink-0" />
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
            className="flex-1 min-w-0 text-[13px] bg-bg-input border border-border-focus
              rounded-lg px-1.5 py-0.5 outline-none text-text-primary"
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
        {getChangeBadge(changeKind)}
        {!changeKind && hasChildChanges && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-success
            flex-shrink-0" />
        )}
      </button>
      {node.is_dir && isExpanded && node.children && (
        <div>
          {creatingIn?.dir === node.path && (
            <div className="flex items-center gap-2 py-1 px-2"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              <FileIcon name={creatingIn.type === 'folder' ? '' : createName}
                isDir={creatingIn.type === 'folder'} size={14}
                className="flex-shrink-0 text-text-tertiary" />
              <input
                autoFocus
                value={createName}
                onChange={(e) => onCreateNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && createName.trim()) onCreateSubmit();
                  if (e.key === 'Escape') onCreateCancel();
                }}
                onBlur={onCreateCancel}
                placeholder={creatingIn.type === 'folder' ? 'folder name' : 'file name'}
                className="flex-1 min-w-0 text-[13px] bg-bg-input border border-border-focus
                  rounded-lg px-1.5 py-0.5 outline-none text-text-primary"
              />
            </div>
          )}
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              creatingIn={creatingIn}
              createName={createName}
              onCreateNameChange={onCreateNameChange}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
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
  const createFile = useFileStore((s) => s.createFile);
  const createFolder = useFileStore((s) => s.createFolder);
  const isDragOverTree = useFileStore((s) => s.isDragOverTree);

  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Right-click menu state
  const [clipboardPath, setClipboardPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; isDir: boolean } | null>(null);

  // New file/folder inline creation state
  const [creatingIn, setCreatingIn] = useState<{ dir: string; type: 'file' | 'folder' } | null>(null);
  const [createName, setCreateName] = useState('');

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

  const handleNewFile = useCallback((dir: string) => {
    setCreatingIn({ dir, type: 'file' });
    setCreateName('');
  }, []);

  const handleNewFolder = useCallback((dir: string) => {
    setCreatingIn({ dir, type: 'folder' });
    setCreateName('');
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    if (!creatingIn || !createName.trim()) {
      setCreatingIn(null);
      return;
    }
    if (creatingIn.type === 'file') {
      await createFile(creatingIn.dir, createName.trim());
    } else {
      await createFolder(creatingIn.dir, createName.trim());
    }
    setCreatingIn(null);
    setCreateName('');
  }, [creatingIn, createName, createFile, createFolder]);

  const handleCreateCancel = useCallback(() => {
    setCreatingIn(null);
    setCreateName('');
  }, []);

  const contextMenuCallbacks: ContextMenuCallbacks = useMemo(() => ({
    onCopyPath: handleCopyPath,
    onCopyFile: handleCopyFile,
    onPaste: handlePaste,
    onRename: handleStartRename,
    onDelete: handleRequestDelete,
    onInsertToChat: handleInsertToChat,
    onNewFile: handleNewFile,
    onNewFolder: handleNewFolder,
    clipboardPath,
  }), [handleCopyPath, handleCopyFile, handlePaste, handleStartRename, handleRequestDelete, handleInsertToChat, handleNewFile, handleNewFolder, clipboardPath]);

  // No project selected
  if (!workingDirectory) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-3 py-2 border-b border-border-subtle">
          <span className="text-[13px] font-medium text-text-tertiary
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
            <span className="text-[13px] font-medium text-text-primary
              truncate block">
              {workingDirectory.split(/[\\/]/).pop()}
            </span>
          </div>
          {changedCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full
              bg-success/15 text-success
              font-medium flex-shrink-0">
              {changedCount} {t('files.changed')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => handleNewFile(workingDirectory || rootPath)}
            className="p-1.5 rounded-lg hover:bg-bg-secondary active:bg-bg-tertiary
              text-text-tertiary hover:text-text-secondary transition-smooth"
            title={t('files.newFile')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M9 2H4v12h8V5l-3-3z" />
              <path d="M8 7v4M6 9h4" />
            </svg>
          </button>
          <button onClick={() => handleNewFolder(workingDirectory || rootPath)}
            className="p-1.5 rounded-lg hover:bg-bg-secondary active:bg-bg-tertiary
              text-text-tertiary hover:text-text-secondary transition-smooth"
            title={t('files.newFolder')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h4l2 2h6v7H2V4z" />
              <path d="M7 8v3M5.5 9.5h3" />
            </svg>
          </button>
          <button onClick={() => {
              clearChangedFiles();
              const dir = workingDirectory || rootPath;
              if (dir) refreshTree(dir);
            }}
            className="p-1.5 rounded-lg hover:bg-bg-secondary active:bg-bg-tertiary
              text-text-tertiary hover:text-text-secondary transition-smooth"
            title={t('files.refresh')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1.5 7a5.5 5.5 0 0110-3M12.5 7a5.5 5.5 0 01-10 3" />
              <path d="M11.5 1v3h-3M2.5 13v-3h3" />
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
            className="w-full pl-7 pr-7 py-1 text-[13px] bg-bg-secondary/50
              border border-border-subtle rounded-lg text-text-primary
              placeholder:text-text-tertiary outline-none
              focus:border-border-focus focus:bg-bg-input
              transition-smooth"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2
                p-0.5 rounded-lg text-text-tertiary hover:text-text-primary
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
      <div className="flex-1 min-h-0 relative" data-file-tree>
        {isDragOverTree && (
          <div className="absolute inset-0 z-10 border-2 border-dashed border-accent
            bg-accent/5 rounded-lg flex items-center justify-center pointer-events-none">
            <span className="text-xs text-accent font-medium">
              {t('files.dropHere')}
            </span>
          </div>
        )}
        <div className="h-full overflow-y-auto py-1">
        {isLoading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent/30
              border-t-accent rounded-full animate-spin" />
          </div>
        ) : tree.length > 0 ? (
          searchQuery ? (
            // --- Flat search results ---
            (() => {
              const matches = collectMatches(tree, searchQuery.toLowerCase(), rootPath || '');
              return matches.length > 0 ? (
                <div className="py-1">
                  {matches.map((m) => (
                    <SearchResultItem
                      key={m.node.path}
                      match={m}
                      onContextMenu={handleContextMenu}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-xs text-text-tertiary">
                  {t('files.noFiles')}
                </div>
              );
            })()
          ) : (
            // --- Normal tree view ---
            <>
              {/* Inline creation input at root level */}
              {creatingIn && creatingIn.dir === (workingDirectory || rootPath) && (
                <div className="flex items-center gap-2 py-1.5 px-2"
                  style={{ paddingLeft: '8px' }}>
                  <FileIcon name={creatingIn.type === 'folder' ? '__dir__' : 'untitled'}
                    isDir={creatingIn.type === 'folder'} size={14}
                    className="flex-shrink-0 text-text-tertiary" />
                  <input
                    autoFocus
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateSubmit();
                      if (e.key === 'Escape') handleCreateCancel();
                    }}
                    onBlur={handleCreateCancel}
                    placeholder={creatingIn.type === 'file' ? t('files.newFile') : t('files.newFolder')}
                    className="flex-1 min-w-0 text-[13px] bg-bg-input border border-border-focus
                      rounded-lg px-1.5 py-0.5 outline-none text-text-primary
                      placeholder:text-text-tertiary"
                  />
                </div>
              )}
              {tree.map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  onContextMenu={handleContextMenu}
                  renamingPath={renamingPath}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={handleRenameCancel}
                  creatingIn={creatingIn}
                  createName={createName}
                  onCreateNameChange={setCreateName}
                  onCreateSubmit={handleCreateSubmit}
                  onCreateCancel={handleCreateCancel}
                />
              ))}
            </>
          )
        ) : (
          <div className="text-center py-8 text-xs text-text-tertiary">
            {t('files.noFiles')}
          </div>
        )}
        </div>{/* end scroll container */}
      </div>{/* end data-file-tree wrapper */}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={closeContextMenu} callbacks={contextMenuCallbacks} />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('files.delete')}
        message={
          deleteTarget
            ? (deleteTarget.isDir ? t('files.deleteConfirmDir') : t('files.deleteConfirm'))
                .replace('{name}', deleteTarget.path.split(/[\\/]/).pop() ?? '')
            : ''
        }
        detail={deleteTarget?.path}
        variant="danger"
        confirmLabel={t('files.delete')}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
