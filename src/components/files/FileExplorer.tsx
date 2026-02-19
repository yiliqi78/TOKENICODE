import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileNode } from '../../lib/tauri-bridge';
import { useFileStore, FileChangeKind } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

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
    created: 'bg-green-500',
    modified: 'bg-yellow-500',
    removed: 'bg-red-500',
  };
  const labels = { created: 'A', modified: 'M', removed: 'D' };
  return (
    <span className={`ml-auto flex-shrink-0 w-3.5 h-3.5 rounded text-[8px]
      font-bold text-white flex items-center justify-center ${colors[kind]}`}>
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

function ContextMenu({ menu, onClose }: {
  menu: ContextMenuState;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  // Adjust position to keep menu within viewport
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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const items = [
    {
      label: t('files.revealInFinder'),
      icon: (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 4h4l2 2h6v7H2V4z" />
        </svg>
      ),
      action: () => {
        bridge.revealInFinder(menu.path);
        onClose();
      },
    },
    {
      label: t('files.openDefault'),
      icon: (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M12 9v4H4V5h4" />
          <path d="M8 8l6-6M10 2h4v4" />
        </svg>
      ),
      action: () => {
        bridge.openWithDefaultApp(menu.path);
        onClose();
      },
    },
    {
      label: t('files.openVscodeShort'),
      icon: (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M4 3l8 5-8 5V3z" />
        </svg>
      ),
      action: () => {
        bridge.openInVscode(menu.path);
        onClose();
      },
    },
  ];

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[200px] py-1 rounded-xl border border-border-subtle
        bg-bg-card shadow-lg animate-fade-in whitespace-nowrap"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary
            hover:bg-bg-secondary transition-smooth text-left"
        >
          <span className="text-text-tertiary flex-shrink-0">{item.icon}</span>
          {item.label}
        </button>
      ))}
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
}: {
  node: FileNode;
  depth: number;
  searchQuery: string;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
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
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node.path, node.is_dir);
        }}
        className={`w-full flex items-center gap-1.5 py-1 px-2 rounded-lg
          text-left text-[13px] transition-smooth group
          ${isSelected
            ? 'bg-accent/10 text-accent'
            : changeKind
              ? 'text-yellow-600 dark:text-yellow-400'
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
        <span className="truncate">{node.name}</span>
        {getChangeBadge(changeKind)}
        {!changeKind && hasChildChanges && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-yellow-500
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
  const loadTree = useFileStore((s) => s.loadTree);
  const changedFiles = useFileStore((s) => s.changedFiles);
  const clearChangedFiles = useFileStore((s) => s.clearChangedFiles);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);

  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const changedCount = changedFiles.size;

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

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
              {workingDirectory.split('/').pop()}
            </span>
          </div>
          {changedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full
              bg-yellow-500/15 text-yellow-600 dark:text-yellow-400
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
          <button onClick={() => rootPath && loadTree(rootPath)}
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
        {isLoading ? (
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
        <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
      )}
    </div>
  );
}
