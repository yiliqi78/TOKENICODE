import { create } from 'zustand';
import { bridge, FileNode, RecentProject } from '../lib/tauri-bridge';
import { computeRevealExpansions, findNodeByPath, findNodeBySuffix, reconcilePathToRoot } from './fileReveal';

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
  selectFile: (path: string) => Promise<void>;
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
  revealPath: (path: string) => Promise<void>;
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

  loadTree: async (path: string) => {
    if (!path) return;
    const prevRoot = get().rootPath;
    const isNewDir = path !== prevRoot;
    // Always show loading on first load or directory change
    set({
      rootPath: path,
      isLoading: true,
      // Clear stale tree immediately when switching directories
      ...(isNewDir ? { tree: [] } : {}),
    });
    try {
      const tree = await bridge.readFileTree(path, 8);
      // Guard: only apply if rootPath hasn't changed during async load
      if (get().rootPath === path) {
        set({ tree, isLoading: false, changedFiles: new Map(), directoryMissing: false });
      }
    } catch (err) {
      if (get().rootPath === path) {
        const missing = String(err).includes('does not exist');
        set({ isLoading: false, directoryMissing: missing });
      }
    }
  },

  refreshTree: async (overridePath?: string) => {
    const dir = overridePath || get().rootPath;
    if (!dir) return;
    try {
      const tree = await bridge.readFileTree(dir, 8);
      // Sync rootPath if override was used and differs
      if (overridePath && overridePath !== get().rootPath) {
        set({ tree, rootPath: overridePath });
      } else {
        set({ tree });
      }
    } catch (err) {
      if (String(err).includes('does not exist')) {
        set({ directoryMissing: true, tree: [] });
      }
    }
  },

  selectFile: async (path: string) => {
    const { selectedFile, editContent, fileContent } = get();
    const isDirty = editContent !== null && editContent !== fileContent;

    // If dirty and trying to navigate to a different file, show dialog
    if (isDirty && path !== selectedFile) {
      set({ pendingNavigation: path, showUnsavedDialog: true });
      return;
    }

    // Toggle selection: click again to deselect
    if (selectedFile === path) {
      set({ selectedFile: null, fileContent: null, isLoadingContent: false, editContent: null, revealTarget: null });
    } else {
      set({ selectedFile: path, fileContent: null, isLoadingContent: true, previewMode: 'preview', editContent: null, revealTarget: path });

      // Binary-preview files: skip text reading, render with file:// URL in FilePreview
      const ext = path.split('.').pop()?.toLowerCase() || '';
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

  clearSelection: () => set({ selectedFile: null, fileContent: null, isLoadingContent: false, editContent: null }),

  closePreview: () => set({ selectedFile: null, fileContent: null, isLoadingContent: false, editContent: null }),

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

  setRootPath: (path: string) => set({ rootPath: path }),

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
    const next = new Set(get().expandedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    set({ expandedFolders: next });
  },

  revealPath: async (path: string) => {
    const { rootPath } = get();
    // 容错：AI 给的绝对全路径前缀可能和真实文件系统不一致（iCloud 的
    // com~apple~CloudDocs 常被写成 com-apple-CloudDocs 或整段缺失）→ 按工作区名对齐回真实 rootPath。
    const reconciled = reconcilePathToRoot(path, rootPath);
    // 先精确匹配；匹配不到（裸文件名 / 半截相对路径——AI 给的多是这种）再按基名/后缀
    // 在已加载的树里兜底找回真实节点。这是修「过半点击不展开不高亮」的关键：
    // 展开 + 高亮都必须用「树里真实节点的 path」，而不是拼出来、很可能对不上的 reconciled。
    const locate = () => {
      const tree = get().tree;
      return findNodeByPath(tree, reconciled) ?? findNodeBySuffix(tree, reconciled);
    };
    let node = locate();
    // 时序竞态兜底：流式对话里 AI 刚写出的文件，大概率还没进树快照——
    // watcher / 工具完成触发的 refreshTree 是异步追赶的（大工作区全量扫描要数秒），
    // 而胶囊随流式文本即时出现，点击必然跑在刷新前面。
    // → 树里找不到时主动刷一次再定位，把「被动等树追上」变成「点击时对齐」。
    if (!node) {
      await get().refreshTree();
      node = locate();
    }
    // 用真实节点的 path 原值（不再 normalize）：TreeNode 的高亮判断是
    // revealTarget === node.path 原值精确相等，包一层规范化反而可能对不上。
    const target = node ? node.path : reconciled;
    const isDir = node ? node.is_dir : /\/$/.test(path);
    const toExpand = computeRevealExpansions(target, rootPath, isDir);
    const next = new Set(get().expandedFolders);
    for (const p of toExpand) next.add(p);
    set({ expandedFolders: next, revealTarget: target });
  },
}));
