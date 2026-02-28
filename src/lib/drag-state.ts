/**
 * Shared drag state for internal file tree drag.
 *
 * Supports two drop targets:
 *   1. A folder in the file tree → move file into that folder
 *   2. Anywhere else → insert file path as chat inline chip
 *
 * Uses mousedown/mousemove/mouseup instead of HTML5 drag-and-drop because
 * Tauri's built-in drag handler (dragDropEnabled: true by default) intercepts
 * all HTML5 drag events in WKWebView, preventing internal drag-and-drop.
 *
 * Also tracks whether an internal tree drag is active, so the Tauri native
 * onDragDropEvent listener can skip internal drags.
 */
let _pendingTreeDragPath: string | null = null;
let _treeDragActive = false;
let _lastDragX = 0;
let _lastDragY = 0;

/** Ghost element shown during drag */
let _ghostEl: HTMLDivElement | null = null;
/** Safety timeout to auto-remove ghost if endTreeDrag is never called */
let _ghostTimeout: ReturnType<typeof setTimeout> | null = null;
/** Currently highlighted drop-target folder button */
let _highlightedDir: HTMLElement | null = null;

const DRAG_HIGHLIGHT = 'ring-2 ring-accent/50 bg-accent/8';

/** Clear folder drop-target highlight */
function clearDirHighlight() {
  if (_highlightedDir) {
    DRAG_HIGHLIGHT.split(' ').forEach((c) => _highlightedDir!.classList.remove(c));
    _highlightedDir = null;
  }
}

/** Remove ghost element from DOM (idempotent) */
function removeGhost() {
  if (_ghostTimeout) {
    clearTimeout(_ghostTimeout);
    _ghostTimeout = null;
  }
  clearDirHighlight();
  if (_ghostEl) {
    _ghostEl.remove();
    _ghostEl = null;
  }
  // Also clean up any orphaned ghosts (defensive)
  document.querySelectorAll('#tree-drag-ghost').forEach((el) => el.remove());
}

export function startTreeDrag(path: string, _isDir = false) {
  // Clean up any lingering ghost from a previous drag
  removeGhost();

  _pendingTreeDragPath = path;
  _treeDragActive = true;

  // Create ghost element
  _ghostEl = document.createElement('div');
  _ghostEl.id = 'tree-drag-ghost';
  const name = path.split(/[\\/]/).pop() || path;
  _ghostEl.textContent = name;
  Object.assign(_ghostEl.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '9999',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    background: 'rgba(99,102,241,0.9)',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    opacity: '0',
    transform: 'translate(-50%, -50%)',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(_ghostEl);

  // Safety net: auto-remove ghost after 5 seconds even if mouseup never fires
  _ghostTimeout = setTimeout(() => {
    removeGhost();
    _pendingTreeDragPath = null;
    _treeDragActive = false;
  }, 5000);
}

export function moveTreeDrag(x: number, y: number) {
  _lastDragX = x;
  _lastDragY = y;
  if (_ghostEl) {
    _ghostEl.style.left = `${x}px`;
    _ghostEl.style.top = `${y}px`;
    _ghostEl.style.opacity = '1';
  }

  // Highlight folder under cursor as drop target
  const el = document.elementFromPoint(x, y);
  const dirBtn = el?.closest('[data-dir-path]') as HTMLElement | null;
  if (dirBtn && dirBtn.getAttribute('data-dir-path') !== _pendingTreeDragPath) {
    if (dirBtn !== _highlightedDir) {
      clearDirHighlight();
      _highlightedDir = dirBtn;
      DRAG_HIGHLIGHT.split(' ').forEach((c) => dirBtn.classList.add(c));
    }
  } else {
    clearDirHighlight();
  }
}

export interface TreeDragResult {
  sourcePath: string;
  /** If dropped on a folder in the tree, the folder path */
  targetFolder: string | null;
  /** Whether the drop point is inside the file tree area */
  droppedInTree: boolean;
}

export function endTreeDrag(): TreeDragResult | null {
  const path = _pendingTreeDragPath;
  _pendingTreeDragPath = null;

  // ALWAYS remove ghost first — this is the #1 priority
  removeGhost();

  // Detect drop target
  let targetFolder: string | null = null;
  let droppedInTree = false;
  try {
    const el = document.elementFromPoint(_lastDragX, _lastDragY);
    if (el) {
      // Check if drop point is inside the file tree area
      droppedInTree = !!el.closest('[data-file-tree]');
      // Check if over a folder node
      const dirBtn = el.closest('[data-dir-path]') as HTMLElement | null;
      if (dirBtn) {
        const dirPath = dirBtn.getAttribute('data-dir-path');
        if (dirPath && dirPath !== path) {
          targetFolder = dirPath;
        }
      }
    }
  } catch {
    // Detection failed — treat as non-folder drop
  }

  // Keep _treeDragActive true briefly so onDragDropEvent can check it
  if (path) {
    setTimeout(() => { _treeDragActive = false; }, 200);
  } else {
    _treeDragActive = false;
  }

  return path ? { sourcePath: path, targetFolder, droppedInTree } : null;
}

export function isTreeDragActive(): boolean {
  return _treeDragActive;
}

export function getLastDragPosition(): { x: number; y: number } {
  return { x: _lastDragX, y: _lastDragY };
}
