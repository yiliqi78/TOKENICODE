/**
 * Shared drag state for internal file tree → chat drop.
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

/** Ghost element shown during drag */
let _ghostEl: HTMLDivElement | null = null;

export function startTreeDrag(path: string, isDir = false) {
  _pendingTreeDragPath = path;
  _treeDragActive = true;

  // Create ghost element
  _ghostEl = document.createElement('div');
  _ghostEl.id = 'tree-drag-ghost';
  const name = path.split(/[\\/]/).pop() || path;
  _ghostEl.textContent = `${isDir ? '📁' : '📄'} ${name}`;
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
}

export function moveTreeDrag(x: number, y: number) {
  if (_ghostEl) {
    _ghostEl.style.left = `${x}px`;
    _ghostEl.style.top = `${y}px`;
    _ghostEl.style.opacity = '1';
  }
}

export function endTreeDrag(): string | null {
  const path = _pendingTreeDragPath;
  _pendingTreeDragPath = null;

  // Remove ghost
  if (_ghostEl) {
    _ghostEl.remove();
    _ghostEl = null;
  }

  // Keep _treeDragActive true briefly so onDragDropEvent can check it
  if (path) {
    setTimeout(() => { _treeDragActive = false; }, 200);
  } else {
    _treeDragActive = false;
  }

  return path;
}

export function isTreeDragActive(): boolean {
  return _treeDragActive;
}
