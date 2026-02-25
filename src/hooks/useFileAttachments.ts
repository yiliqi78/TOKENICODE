import { useState, useCallback, useEffect, useRef } from 'react';
import { bridge } from '../lib/tauri-bridge';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTreeDragActive } from '../lib/drag-state';
import { useSettingsStore } from '../stores/settingsStore';

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

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
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
        setFiles((prev) => [...prev, ...newFiles]);
      }
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /** Add files by their OS file paths (for Tauri native drag-drop) */
  const addFilePaths = useCallback(async (paths: string[]) => {
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
          newFiles.push({
            id: generateFileId(),
            name,
            path: filePath,
            size: fileSize,
            type: mime,
            isImage: isImg,
            preview: undefined,  // Could read + thumbnail, but skip for speed
          });
        } catch (err) {
          console.error('Failed to add dropped file:', filePath, err);
        }
      }
      if (newFiles.length > 0) {
        setFiles((prev) => [...prev, ...newFiles]);
      }
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Listen for Tauri native drag-drop events (OS file drag into window)
  // Debounce guard: Tauri may fire onDragDropEvent multiple times per drop
  const lastDropRef = useRef<{ time: number; key: string }>({ time: 0, key: '' });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        // Skip if this is an internal file tree drag
        if (isTreeDragActive()) return;
        const paths = event.payload.paths;
        if (!paths || paths.length === 0) return;
        // Deduplicate: skip if same paths within 500ms
        const now = Date.now();
        const key = paths.sort().join('|');
        if (now - lastDropRef.current.time < 500 && key === lastDropRef.current.key) return;
        lastDropRef.current = { time: now, key };
        // Insert as inline file chips (same as internal tree drag)
        for (const p of paths) {
          window.dispatchEvent(new CustomEvent('tokenicode:tree-file-inline', { detail: p }));
        }
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
  }, []);

  return { files, setFiles, isProcessing, addFiles, addFilePaths, removeFile, clearFiles };
}
