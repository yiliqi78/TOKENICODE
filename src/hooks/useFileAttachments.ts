import { useState, useCallback, useEffect, useRef } from 'react';
import { bridge } from '../lib/tauri-bridge';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTreeDragActive } from '../lib/drag-state';
import { useSettingsStore } from '../stores/settingsStore';
import { useFileStore } from '../stores/fileStore';
import { useChatStore } from '../stores/chatStore';
import { useSessionStore } from '../stores/sessionStore';

// --- Types ---

export interface FileAttachment {
  id: string;
  name: string;
  path: string;       // Temp path after saving via Rust
  size: number;
  type: string;
  isImage: boolean;
  preview?: string;   // Base64 data URL for image thumbnails
}

// --- Helper ---

let fileCounter = 0;
function generateFileId(): string {
  fileCounter += 1;
  return `file_${Date.now()}_${fileCounter}`;
}

function isImageMime(type: string): boolean {
  return type.startsWith('image/');
}

/** Guess MIME type from file extension */
function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
    json: 'application/json', js: 'text/javascript', ts: 'text/typescript',
    html: 'text/html', css: 'text/css', csv: 'text/csv',
    zip: 'application/zip', gz: 'application/gzip',
  };
  return map[ext] || 'application/octet-stream';
}

/** Check if a file extension is an image type */
function isImageExt(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
}

/** Generate a small base64 thumbnail for an image file */
async function generateThumbnail(file: File): Promise<string | undefined> {
  if (!isImageMime(file.type)) return undefined;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 64;
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } else {
          resolve(undefined);
        }
      };
      img.onerror = () => resolve(undefined);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

/** Read a File as a Uint8Array */
async function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// --- Hook ---

export function useFileAttachments() {
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const setFilesForTab = useCallback((tabId: string | null, nextFiles: FileAttachment[]) => {
    if (tabId) {
      useChatStore.getState().ensureTab(tabId);
      useChatStore.getState().setPendingAttachments(tabId, nextFiles);
    }
    if (useSessionStore.getState().selectedSessionId === tabId) {
      setFiles(nextFiles);
    }
  }, []);

  const addFiles = useCallback(async (fileList: FileList | File[], ownerTabId?: string | null) => {
    const targetTabId = ownerTabId ?? useSessionStore.getState().selectedSessionId;
    setIsProcessing(true);
    try {
      const newFiles: FileAttachment[] = [];
      const fileArray = Array.from(fileList);

      for (const file of fileArray) {
        try {
          // Generate thumbnail for images
          const preview = await generateThumbnail(file);

          // Read file bytes and save via Rust (into working directory for CLI access)
          const bytes = await readFileAsBytes(file);
          const cwd = useSettingsStore.getState().workingDirectory;
          const tempPath = await bridge.saveTempFile(
            file.name,
            Array.from(bytes),
            cwd || undefined,
          );

          newFiles.push({
            id: generateFileId(),
            name: file.name,
            path: tempPath,
            size: file.size,
            type: file.type || 'application/octet-stream',
            isImage: isImageMime(file.type),
            preview,
          });
        } catch (err) {
          console.error('Failed to add file:', file.name, err);
        }
      }

      if (newFiles.length > 0) {
        const existing = targetTabId
          ? (useChatStore.getState().getTab(targetTabId)?.pendingAttachments ?? [])
          : files;
        setFilesForTab(targetTabId ?? null, [...existing, ...newFiles]);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [files, setFilesForTab]);

  /** Add files by their OS file paths (for Tauri native drag-drop) */
  const addFilePaths = useCallback(async (paths: string[], ownerTabId?: string | null) => {
    const targetTabId = ownerTabId ?? useSessionStore.getState().selectedSessionId;
    setIsProcessing(true);
    try {
      const newFiles: FileAttachment[] = [];
      for (const filePath of paths) {
        try {
          const name = filePath.split(/[\\/]/).pop() || filePath;
          const mime = guessMime(name);
          const isImg = isImageExt(name);

          // The file is already on disk — just use its path directly
          // Get file size from Rust backend
          let fileSize = 0;
          try {
            fileSize = await bridge.getFileSize(filePath);
          } catch {
            // Ignore — size will show as 0
          }

          // Generate thumbnail for image files (#70) so they display as
          // visual previews in FileUploadChips instead of bare paths.
          let preview: string | undefined;
          if (isImg) {
            try {
              const b64 = await bridge.readFileBase64(filePath);
              const dataUrl = `data:${mime};base64,${b64}`;
              preview = await new Promise<string | undefined>((resolve) => {
                const img = new Image();
                img.onload = () => {
                  const canvas = document.createElement('canvas');
                  const maxSize = 64;
                  const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                  canvas.width = img.width * scale;
                  canvas.height = img.height * scale;
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                  } else {
                    resolve(undefined);
                  }
                };
                img.onerror = () => resolve(undefined);
                img.src = dataUrl;
              });
            } catch {
              // Ignore — no thumbnail, still functional
            }
          }

          newFiles.push({
            id: generateFileId(),
            name,
            path: filePath,
            size: fileSize,
            type: mime,
            isImage: isImg,
            preview,
          });
        } catch (err) {
          console.error('Failed to add dropped file:', filePath, err);
        }
      }
      if (newFiles.length > 0) {
        const existing = targetTabId
          ? (useChatStore.getState().getTab(targetTabId)?.pendingAttachments ?? [])
          : files;
        setFilesForTab(targetTabId ?? null, [...existing, ...newFiles]);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [files, setFilesForTab]);

  // Listen for Tauri native drag-drop events (OS file drag into window)
  // Debounce guard: Tauri may fire onDragDropEvent multiple times per drop
  const lastDropRef = useRef<{ time: number; key: string }>({ time: 0, key: '' });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onDragDropEvent((event) => {
      const { type } = event.payload;

      if (type === 'over' || type === 'enter') {
        // Skip internal tree drags
        if (isTreeDragActive()) return;
        // Check if pointer is over the file tree area
        const pos = (event.payload as any).position;
        if (pos) {
          const el = document.elementFromPoint(pos.x, pos.y);
          const overTree = !!el?.closest('[data-file-tree]');
          useFileStore.getState().setDragOverTree(overTree);
        }
        return;
      }

      if (type === 'leave') {
        useFileStore.getState().setDragOverTree(false);
        return;
      }

      if (type === 'drop') {
        const wasOverTree = useFileStore.getState().isDragOverTree;
        useFileStore.getState().setDragOverTree(false);

        // Skip if this is an internal file tree drag
        if (isTreeDragActive()) return;
        const paths = (event.payload as any).paths as string[] | undefined;
        if (!paths || paths.length === 0) return;

        // Deduplicate: skip if same paths within 500ms
        const now = Date.now();
        const key = [...paths].sort().join('|');
        if (now - lastDropRef.current.time < 500 && key === lastDropRef.current.key) return;
        lastDropRef.current = { time: now, key };
        const ownerTabId = useSessionStore.getState().selectedSessionId;

        // Phase 3 §3.2: user dropped files in = user-initiated authorization.
        // Register each dropped path as a path grant for the active tab so
        // subsequent reads (thumbnail preview, size lookup) are allowed.
        // Grants MUST be awaited before any file operation that depends on them.
        (async () => {
          if (ownerTabId) {
            await Promise.all(paths.map((p) => bridge.addPathGrant(ownerTabId, p).catch(() => { /* best-effort */ })));
          }

          if (wasOverTree) {
            // Drop onto file tree → copy files into project
            const rootPath = useSettingsStore.getState().workingDirectory
              || useFileStore.getState().rootPath;
            if (rootPath) {
              for (const srcPath of paths) {
                const name = srcPath.split(/[\\/]/).pop() || srcPath;
                const dest = `${rootPath}/${name}`;
                try {
                  await bridge.copyFile(srcPath, dest);
                } catch (err) {
                  console.error('Failed to copy file to project:', name, err);
                }
              }
              useFileStore.getState().refreshTree(rootPath);
            }
          } else {
            // Split: images → file attachments (with preview), non-images → inline chips.
            // This ensures images show as visual thumbnails in FileUploadChips and
            // their paths are properly included in the message sent to CLI (#70).
            const imagePaths: string[] = [];
            const otherPaths: string[] = [];
            for (const p of paths) {
              const name = p.split(/[\\/]/).pop() || '';
              if (isImageExt(name)) {
                imagePaths.push(p);
              } else {
                otherPaths.push(p);
              }
            }

            // Images → attachment system (addFilePaths generates thumbnails)
            if (imagePaths.length > 0) {
              addFilePaths(imagePaths, ownerTabId);
            }

            // Non-images → inline file chips
            for (const p of otherPaths) {
              window.dispatchEvent(new CustomEvent('tokenicode:tree-file-inline', { detail: p }));
            }
          }
        })();
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const removeFile = useCallback((id: string) => {
    const tabId = useSessionStore.getState().selectedSessionId;
    const existing = tabId ? (useChatStore.getState().getTab(tabId)?.pendingAttachments ?? []) : files;
    setFilesForTab(tabId, existing.filter((f) => f.id !== id));
  }, [files, setFilesForTab]);

  const clearFiles = useCallback(() => {
    const tabId = useSessionStore.getState().selectedSessionId;
    setFilesForTab(tabId, []);
  }, [setFilesForTab]);

  return { files, setFiles, isProcessing, addFiles, addFilePaths, removeFile, clearFiles };
}
