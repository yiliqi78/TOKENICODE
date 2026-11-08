import { create } from 'zustand';
import { bridge, FileNode, RecentProject } from '../lib/tauri-bridge';
import { computeRevealExpansions, findNodeByPath, normalizePath, normalizeTreePaths, reconcilePathToRoot } from './fileReveal';
import { shouldOpenExternally } from '../lib/fileTypes';

export type FileChangeKind = 'created' | 'modified' | 'removed';
export type PreviewMode = 'preview' | 'source' | 'edit';

// Batch buffer for markFileChanged — collect changes within a single frame, flush once via rAF
const _pendingChanges = new Map<string, FileChangeKind>();
let _changeFlushRaf = 0;

interface FileState {
  tree: FileNode[];
  isLoading: boolean;
  selectedFile: string | null;
  fileContent: string | null;
  isLoadingContent: boolean;
  previewMode: PreviewMode;
  rootPath: string;

  // 文件树展开状态（提到全局：让「聊天点击路径 → 定位」能驱动文件树展开）
  expandedFolders: Set<string>;
  // 当前被定位高亮的路径（文件或文件夹，与「预览选中」解耦）
  revealTarget: string | null;
  // 需要在预览里滚动并高亮的行号（1-based，来自聊天里的 路径:行号）
  revealLine: number | null;
  // 正文里点过路径、但用户还没在文件树里点开的行号；树里点开时消费一次
  pendingRevealLine: { path: string; line: number } | null;

  // Editing state
  editContent: string | null;     // buffer for edits (null = not dirty)
  isSaving: boolean;

  // Unsaved changes navigation guard
  pendingNavigation: string | null;
  showUnsavedDialog: boolean;

  // Project management
  recentProjects: RecentProject[];
  isLoadingProjects: boolean;

  // File change tracking
  changedFiles: Map<string, FileChangeKind>;

  // Directory missing detection
  directoryMissing: boolean;

  // External drag-drop state
  isDragOverTree: boolean;

  loadTree: (path: string) => Promise<void>;
  /** Refresh the tree without clearing change markers. Optional path overrides rootPath. */
  refreshTree: (overridePath?: string) => Promise<void>;
  /** 选中并预览文件。opts.line（1-based）会在预览里滚动到该行并高亮。 */
  selectFile: (path: string, opts?: { line?: number | null }) => Promise<void>;
  clearSelection: () => void;
  closePreview: () => void;
  setPreviewMode: (mode: PreviewMode) => void;
  setEditContent: (content: string) => void;
  saveFile: () => Promise<void>;
  discardEdits: () => void;
  setRootPath: (path: string) => void;
  fetchRecentProjects: () => Promise<void>;
  /** Reload the currently previewed file content without toggling selection */
  reloadContent: () => Promise<void>;
  markFileChanged: (path: string, kind: FileChangeKind) => void;
  clearChangedFiles: () => void;
  // Unsaved changes actions
  confirmDiscard: () => void;
  confirmSaveAndSwitch: () => Promise<void>;
  cancelNavigation: () => void;
  // New file/folder actions
  createFile: (parentDir: string, name: string) => Promise<void>;
  createFolder: (parentDir: string, name: string) => Promise<void>;
  // External drag state
  setDragOverTree: (v: boolean) => void;
  // 展开/折叠单个文件夹
  toggleFolder: (path: string) => void;
  // 定位到某路径：展开其所有父目录（文件夹则连自身）并高亮
  revealPath: (path: string) => void;
  /**
   * 正文里点路径的行为：在右侧文件树里展开定位并高亮，但不预览。
   * 目标不在当前工作区树里（`~/.claude.json`、超出扫描深度）时树里没有落点，
   * 交给系统文件资源管理器定位选中该文件。
   */
  revealOrOpen: (path: string, line?: number | null) => void;
}

export const useFileStore = create<FileState>()((set, get) => ({
  tree: [],
  isLoading: false,
  selectedFile: null,
  fileContent: null,
  isLoadingContent: false,
  previewMode: 'preview' as PreviewMode,
  rootPath: '',
  editContent: null,
  isSaving: false,
  pendingNavigation: null,
  showUnsavedDialog: false,
  recentProjects: [],
  isLoadingProjects: false,
  changedFiles: new Map(),
  directoryMissing: false,
  isDragOverTree: false,
  expandedFolders: new Set<string>(),
  revealTarget: null,
  revealLine: null,
  pendingRevealLine: null,

  loadTree: async (path: string) => {
    if (!path) return;
    // 统一成正斜杠：树节点、rootPath、聊天里解析出的路径三者必须同一套分隔符，
    // 否则 findNodeByPath 永远匹配不上，工作区内的路径也会被送去资源管理器。
    const root = normalizePath(path);
    const prevRoot = get().rootPath;
    const isNewDir = root !== prevRoot;
    // Always show loading on first load or directory change
    set({
      rootPath: root,
      isLoading: true,
      // Clear stale tree immediately when switching directories
      ...(isNewDir ? { tree: [] } : {}),
    });
    try {
      const tree = normalizeTreePaths(await bridge.readFileTree(root, 8));
      // Guard: only apply if rootPath hasn't changed during async load
      if (get().rootPath === root) {
        set({ tree, isLoading: false, changedFiles: new Map(), directoryMissing: false });
      }
    } catch (err) {
      if (get().rootPath === root) {
        const missing = String(err).includes('does not exist');
        set({ isLoading: false, directoryMissing: missing });
      }
    }
  },

  refreshTree: async (overridePath?: string) => {
    const dir = normalizePath(overridePath || get().rootPath);
    if (!dir) return;
    try {
      const tree = normalizeTreePaths(await bridge.readFileTree(dir, 8));
      // Sync rootPath if override was used and differs
      if (overridePath && dir !== get().rootPath) {
        set({ tree, rootPath: dir });
      } else {
        set({ tree });
      }
    } catch (err) {
      if (String(err).includes('does not exist')) {
        set({ directoryMissing: true, tree: [] });
      }
    }
  },

  selectFile: async (path: string, opts?: { line?: number | null }) => {
    // 归一：树节点、正文路径、工具卡路径可能来自不同分隔符
    path = normalizePath(path);
    // 正文里定位过这个文件时记下的行号，用户从文件树点开时消费一次
    const pending = get().pendingRevealLine;
    const fromTree = pending && pending.path === path ? pending.line : null;
    if (fromTree !== null) set({ pendingRevealLine: null });
    const line = opts?.line && opts.line > 0 ? opts.line : fromTree;

    // 内置编辑器打不开的类型（压缩包、Office、exe 等）直接交给系统默认程序
    if (shouldOpenExternally(path)) {
      try {
        await bridge.openWithDefaultApp(path);
      } catch (err) {
        console.error('[fileStore] openWithDefaultApp failed', path, err);
      }
      return;
    }

    const { selectedFile, editContent, fileContent } = get();
    const isDirty = editContent !== null && editContent !== fileContent;

    // If dirty and trying to navigate to a different file, show dialog
    if (isDirty && path !== selectedFile) {
      set({ pendingNavigation: path, showUnsavedDialog: true });
      return;
    }

    // Toggle selection: click again to deselect。带行号的定位不触发取消选中。
    if (selectedFile === path && line === null) {
      set({ selectedFile: null, fileContent: null, isLoadingContent: false, editContent: null, revealTarget: null, revealLine: null });
    } else {
      const ext = path.split('.').pop()?.toLowerCase() || '';
      // 带行号时切到源码视图；markdown/html 的渲染视图没有行概念
      const renderedExts = new Set(['md', 'mdx', 'html', 'htm', 'svg']);
      const mode: PreviewMode = line !== null && renderedExts.has(ext) ? 'source' : 'preview';
      set({
        selectedFile: path,
        fileContent: null,
        isLoadingContent: true,
        previewMode: mode,
        editContent: null,
        revealTarget: path,
        revealLine: line,
      });

      // Binary-preview files: skip text reading, render with file:// URL in FilePreview
      const BINARY_PREVIEW = new Set([
        'png','jpg','jpeg','gif','webp','bmp','ico',
        'pdf','mp4','webm','mov','avi',
        'mp3','wav','ogg','aac','m4a',
      ]);

      if (BINARY_PREVIEW.has(ext)) {
        // Load binary files as base64 data URL for rendering in webview
        try {
          const dataUrl = await bridge.readFileBase64(path);
          if (get().selectedFile === path) {
            set({ fileContent: dataUrl, isLoadingContent: false });
          }
        } catch {
          if (get().selectedFile === path) {
            set({ fileContent: null, isLoadingContent: false });
          }
        }
      } else {
        try {
          const content = await bridge.readFileContent(path);
          // Only update if selectedFile hasn't changed during the async call
          if (get().selectedFile === path) {
            set({ fileContent: content, isLoadingContent: false });
          }
        } catch {
          // File read failed — might be a directory. Try common index files.
          const dirPath = path.replace(/\/$/, '');
          const candidates = ['SKILL.md', 'README.md', 'index.md', 'index.html', 'index.ts', 'index.tsx', 'index.js'];
          let found = false;
          for (const file of candidates) {
            if (get().selectedFile !== path) break; // user navigated away
            try {
              const indexPath = `${dirPath}/${file}`;
              const content = await bridge.readFileContent(indexPath);
              if (get().selectedFile === path) {
                set({ selectedFile: indexPath, fileContent: content, isLoadingContent: false });
              }
              found = true;
              break;
            } catch {
              // try next candidate
            }
          }
          if (!found && get().selectedFile === path) {
            set({ fileContent: '// Error loading file', isLoadingContent: false });
          }
        }
      }
    }
  },

  clearSelection: () => set({ selectedFile: null, fileContent: null, isLoadingContent: false, editContent: null, revealLine: null, pendingRevealLine: null }),

  closePreview: () => set({ selectedFile: null, fileContent: null, isLoadingContent: false, editContent: null, revealLine: null }),

  setPreviewMode: (mode: PreviewMode) => {
    const state = get();
    if (mode === 'edit') {
      // Entering edit mode: initialize editContent from fileContent
      set({ previewMode: mode, editContent: state.fileContent });
    } else {
      set({ previewMode: mode });
    }
  },

  setEditContent: (content: string) => set({ editContent: content }),

  saveFile: async () => {
    const { selectedFile, editContent } = get();
    if (!selectedFile || editContent === null) return;
    set({ isSaving: true });
    try {
      await bridge.writeFileContent(selectedFile, editContent);
      // Update fileContent to match saved content
      set({ fileContent: editContent, editContent: null, isSaving: false, previewMode: 'preview' });
    } catch {
      set({ isSaving: false });
    }
  },

  discardEdits: () => {
    set({ editContent: null, previewMode: 'preview' });
  },

  setRootPath: (path: string) => set({ rootPath: normalizePath(path) }),

  fetchRecentProjects: async () => {
    set({ isLoadingProjects: true });
    try {
      const projects = await bridge.listRecentProjects();
      set({ recentProjects: projects, isLoadingProjects: false });
    } catch {
      set({ isLoadingProjects: false });
    }
  },

  reloadContent: async () => {
    const path = get().selectedFile;
    if (!path) return;
    // Don't reload while user is editing
    if (get().editContent !== null) return;
    try {
      const ext = path.split('.').pop()?.toLowerCase() || '';
      const BINARY_PREVIEW = new Set([
        'png','jpg','jpeg','gif','webp','bmp','ico',
        'pdf','mp4','webm','mov','avi',
        'mp3','wav','ogg','aac','m4a',
      ]);
      if (BINARY_PREVIEW.has(ext)) {
        const dataUrl = await bridge.readFileBase64(path);
        if (get().selectedFile === path) set({ fileContent: dataUrl });
      } else {
        const content = await bridge.readFileContent(path);
        if (get().selectedFile === path) set({ fileContent: content });
      }
    } catch {
      // Silently fail — keep existing content
    }
  },

  markFileChanged: (path: string, kind: FileChangeKind) => {
    _pendingChanges.set(path, kind);
    if (!_changeFlushRaf) {
      _changeFlushRaf = requestAnimationFrame(() => {
        _changeFlushRaf = 0;
        if (_pendingChanges.size === 0) return;
        const next = new Map(get().changedFiles);
        for (const [p, k] of _pendingChanges) {
          next.set(p, k);
        }
        _pendingChanges.clear();
        set({ changedFiles: next });
      });
    }
  },

  clearChangedFiles: () => set({ changedFiles: new Map() }),

  // --- Unsaved changes dialog actions ---

  confirmDiscard: () => {
    const pending = get().pendingNavigation;
    set({ editContent: null, showUnsavedDialog: false, pendingNavigation: null });
    if (pending) get().selectFile(pending);
  },

  confirmSaveAndSwitch: async () => {
    const pending = get().pendingNavigation;
    await get().saveFile();
    set({ showUnsavedDialog: false, pendingNavigation: null });
    if (pending) get().selectFile(pending);
  },

  cancelNavigation: () => {
    set({ pendingNavigation: null, showUnsavedDialog: false });
  },

  // --- New file/folder actions ---

  createFile: async (parentDir: string, name: string) => {
    const path = `${parentDir}/${name}`;
    try {
      await bridge.writeFileContent(path, '');
      await get().refreshTree();
      get().selectFile(path);
    } catch {
      // Silently fail
    }
  },

  createFolder: async (parentDir: string, name: string) => {
    const path = `${parentDir}/${name}`;
    try {
      await bridge.createDirectory(path);
      await get().refreshTree();
    } catch {
      // Silently fail
    }
  },

  // --- External drag state ---

  setDragOverTree: (v: boolean) => set({ isDragOverTree: v }),

  // --- 文件树展开 / 定位 ---

  toggleFolder: (path: string) => {
    const p = normalizePath(path);
    const next = new Set(get().expandedFolders);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    set({ expandedFolders: next });
  },

  revealPath: (path: string) => {
    const { tree, rootPath, expandedFolders } = get();
    // 容错：AI 给的绝对全路径前缀可能和真实文件系统不一致（iCloud 的
    // com~apple~CloudDocs 常被写成 com-apple-CloudDocs 或整段缺失）→ 按工作区名对齐回真实 rootPath。
    const target = reconcilePathToRoot(path, rootPath);
    // 判断目标是文件还是文件夹：先在已加载的树里查，查不到回退到「末尾斜杠」
    const node = findNodeByPath(tree, target);
    const isRootItself = !!rootPath && normalizePath(target) === normalizePath(rootPath);
    // 树里没有落点（工作区外、或超出扫描深度）：交给系统文件资源管理器定位
    if (!node && rootPath && !isRootItself) {
      void bridge.revealInFinder(target).catch((err) => {
        console.error('[fileStore] revealInFinder failed', target, err);
      });
      return;
    }
    const isDir = node ? node.is_dir : /[\\/]$/.test(path);
    const toExpand = computeRevealExpansions(target, rootPath, isDir);
    const next = new Set(expandedFolders);
    for (const p of toExpand) next.add(p);
    set({ expandedFolders: next, revealTarget: target, revealLine: null });
  },

  revealOrOpen: (path: string, line?: number | null) => {
    const target = reconcilePathToRoot(path, get().rootPath);
    const l = line && line > 0 ? line : null;
    const node = findNodeByPath(get().tree, target);
    if (!node) {
      // 不在当前工作区树里，右侧栏没有落点：交给系统文件资源管理器选中该文件
      void bridge.revealInFinder(target).catch((err) => {
        console.error('[fileStore] revealInFinder failed', target, err);
      });
      return;
    }
    // 树里有：只展开定位高亮，预览留给用户点右侧栏里那一行
    set({ pendingRevealLine: l ? { path: target, line: l } : null });
    get().revealPath(target);
  },
}));
