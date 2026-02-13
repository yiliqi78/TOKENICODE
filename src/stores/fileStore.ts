import { create } from 'zustand';
import { bridge, FileNode, RecentProject } from '../lib/tauri-bridge';

export type FileChangeKind = 'created' | 'modified' | 'removed';
export type PreviewMode = 'preview' | 'source' | 'edit';

interface FileState {
  tree: FileNode[];
  isLoading: boolean;
  selectedFile: string | null;
  fileContent: string | null;
  isLoadingContent: boolean;
  previewMode: PreviewMode;
  rootPath: string;

  // Editing state
  editContent: string | null;     // buffer for edits (null = not dirty)
  isSaving: boolean;

  // Project management
  recentProjects: RecentProject[];
  isLoadingProjects: boolean;

  // File change tracking
  changedFiles: Map<string, FileChangeKind>;

  loadTree: (path: string) => Promise<void>;
  /** Refresh the tree without clearing change markers */
  refreshTree: () => Promise<void>;
  selectFile: (path: string) => Promise<void>;
  clearSelection: () => void;
  closePreview: () => void;
  setPreviewMode: (mode: PreviewMode) => void;
  setEditContent: (content: string) => void;
  saveFile: () => Promise<void>;
  discardEdits: () => void;
  setRootPath: (path: string) => void;
  fetchRecentProjects: () => Promise<void>;
  markFileChanged: (path: string, kind: FileChangeKind) => void;
  clearChangedFiles: () => void;
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
  recentProjects: [],
  isLoadingProjects: false,
  changedFiles: new Map(),

  loadTree: async (path: string) => {
    set({ isLoading: true, rootPath: path });
    try {
      const tree = await bridge.readFileTree(path, 3);
      set({ tree, isLoading: false, changedFiles: new Map() });
    } catch {
      set({ isLoading: false });
    }
  },

  refreshTree: async () => {
    const { rootPath } = get();
    if (!rootPath) return;
    try {
      const tree = await bridge.readFileTree(rootPath, 3);
      // Preserve changedFiles — only update tree structure
      set({ tree });
    } catch {
      // Silently fail — tree stays as-is
    }
  },

  selectFile: async (path: string) => {
    // Toggle selection: click again to deselect
    const current = get().selectedFile;
    if (current === path) {
      set({ selectedFile: null, fileContent: null, isLoadingContent: false, editContent: null });
    } else {
      set({ selectedFile: path, fileContent: null, isLoadingContent: true, previewMode: 'preview', editContent: null });

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
          if (get().selectedFile === path) {
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

  markFileChanged: (path: string, kind: FileChangeKind) => {
    const next = new Map(get().changedFiles);
    if (kind === 'removed') {
      next.set(path, 'removed');
    } else {
      next.set(path, kind);
    }
    set({ changedFiles: next });
  },

  clearChangedFiles: () => set({ changedFiles: new Map() }),
}));
