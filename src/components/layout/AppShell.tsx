import { useCallback, useRef, useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { FilePreview } from '../files/FilePreview';

interface AppShellProps {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  secondary?: React.ReactNode;
}

const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 600;
const COLLAPSE_THRESHOLD = 120;

/* Sidebar width constants */
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 450;
const SIDEBAR_COLLAPSE_THRESHOLD = 100;

/* Preview panel width constants */
const MIN_PREVIEW_WIDTH = 300;
const MAX_PREVIEW_WIDTH = 1200;

export function AppShell({ sidebar, main, secondary }: AppShellProps) {
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const secondaryPanelOpen = useSettingsStore((s) => s.secondaryPanelOpen);
  const secondaryPanelWidth = useSettingsStore((s) => s.secondaryPanelWidth);
  const setSecondaryPanelWidth = useSettingsStore((s) => s.setSecondaryPanelWidth);
  const toggleSecondaryPanel = useSettingsStore((s) => s.toggleSecondaryPanel);

  /* File preview state — when a file is selected, we enter "preview mode" */
  const selectedFile = useFileStore((s) => s.selectedFile);
  const isFilePreviewMode = !!selectedFile;

  // --- Right-side panel dragging (secondary + preview) ---
  const isRightDragging = useRef(false);
  const rightStartX = useRef(0);
  const rightStartWidth = useRef(0);

  /* Preview panel resizable width — default to 50% of window */
  const [previewWidth, setPreviewWidth] = useState(() =>
    Math.round(window.innerWidth * 0.5)
  );

  /* Remember panel states before entering preview mode so we can restore them on exit */
  const panelStateBeforePreview = useRef<{ sidebar: boolean; secondary: boolean } | null>(null);

  /* Re-calculate default when entering preview mode */
  const prevPreviewMode = useRef(false);
  useEffect(() => {
    if (isFilePreviewMode && !prevPreviewMode.current) {
      // Entering preview mode — save current panel state and collapse them
      setPreviewWidth(Math.round(window.innerWidth * 0.5));
      panelStateBeforePreview.current = {
        sidebar: sidebarOpen,
        secondary: secondaryPanelOpen,
      };
      if (sidebarOpen) toggleSidebar();
      if (secondaryPanelOpen) toggleSecondaryPanel();
    } else if (!isFilePreviewMode && prevPreviewMode.current) {
      // Exiting preview mode — restore panels to their previous state
      const saved = panelStateBeforePreview.current;
      if (saved) {
        if (saved.sidebar && !sidebarOpen) toggleSidebar();
        if (saved.secondary && !secondaryPanelOpen) toggleSecondaryPanel();
        panelStateBeforePreview.current = null;
      }
    }
    prevPreviewMode.current = isFilePreviewMode;
  }, [isFilePreviewMode, sidebarOpen, toggleSidebar, secondaryPanelOpen, toggleSecondaryPanel]);

  const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isRightDragging.current = true;
    rightStartX.current = e.clientX;
    rightStartWidth.current = isFilePreviewMode
      ? previewWidth
      : secondaryPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [secondaryPanelWidth, isFilePreviewMode, previewWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isRightDragging.current) return;
      const delta = rightStartX.current - e.clientX;
      const newWidth = rightStartWidth.current + delta;

      if (isFilePreviewMode) {
        if (newWidth < COLLAPSE_THRESHOLD) {
          isRightDragging.current = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          useFileStore.getState().closePreview();
          return;
        }
        setPreviewWidth(
          Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, newWidth))
        );
      } else {
        if (newWidth < COLLAPSE_THRESHOLD) {
          isRightDragging.current = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          if (secondaryPanelOpen) toggleSecondaryPanel();
          return;
        }
        setSecondaryPanelWidth(
          Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, newWidth))
        );
      }
    };

    const handleMouseUp = () => {
      if (!isRightDragging.current) return;
      isRightDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isFilePreviewMode, secondaryPanelOpen, toggleSecondaryPanel, setSecondaryPanelWidth]);

  // --- Sidebar dragging ---
  const isSidebarDragging = useRef(false);
  const sidebarStartX = useRef(0);
  const sidebarStartW = useRef(0);

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isSidebarDragging.current = true;
    sidebarStartX.current = e.clientX;
    sidebarStartW.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isSidebarDragging.current) return;
      // Dragging right increases sidebar width
      const delta = e.clientX - sidebarStartX.current;
      const newW = sidebarStartW.current + delta;
      if (newW < SIDEBAR_COLLAPSE_THRESHOLD) {
        isSidebarDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (sidebarOpen) toggleSidebar();
        return;
      }
      setSidebarWidth(
        Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newW))
      );
    };
    const handleUp = () => {
      if (!isSidebarDragging.current) return;
      isSidebarDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [sidebarOpen, toggleSidebar, setSidebarWidth]);

  /* Compute sidebar visibility: hidden when file preview is active (reclaim space) */
  const showSidebar = sidebarOpen && !isFilePreviewMode;
  const showFloatingSidebar = sidebarOpen && isFilePreviewMode;
  /* Secondary panel: normal mode when no preview, floating overlay when preview is active */
  const showSecondary = secondaryPanelOpen && !isFilePreviewMode;
  const showFloatingSecondary = secondaryPanelOpen && isFilePreviewMode;

  return (
    <div className="flex h-full w-full overflow-hidden gradient-bg">
      {/* Drag region — data-tauri-drag-region handles both drag and double-click-to-maximize natively */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 h-[28px] z-50"
      />

      {/* Sidebar — animates to w-0 when hidden or preview mode */}
      <div
        className="flex-shrink-0 transition-all duration-300 ease-out overflow-hidden"
        style={{ width: showSidebar ? `${sidebarWidth}px` : '0px' }}
      >
        <div
          className="h-full overflow-y-auto bg-bg-sidebar"
          style={{ width: `${sidebarWidth}px` }}
        >
          {sidebar}
        </div>
      </div>
      {/* Sidebar resize handle — outside overflow-hidden so hit area isn't clipped */}
      {showSidebar && (
        <div
          onMouseDown={handleSidebarMouseDown}
          className="w-[9px] -ml-1 -mr-1 h-full flex-shrink-0 relative cursor-col-resize z-10
            flex items-center justify-center group"
        >
          <div className="w-px h-full bg-border-subtle group-hover:bg-accent/40 transition-colors" />
        </div>
      )}

      {/* Main Panel — full-height, separated by vertical border lines */}
      <div className="flex-1 min-w-0 flex flex-col bg-bg-chat overflow-hidden">
        {main}
      </div>

      {/* File Preview resize handle — outside overflow-hidden */}
      {isFilePreviewMode && (
        <div
          onMouseDown={handleRightMouseDown}
          className="w-[9px] -ml-1 -mr-1 h-full flex-shrink-0 relative cursor-col-resize z-10
            flex items-center justify-center group"
        >
          <div className="w-px h-full bg-border-subtle group-hover:bg-accent/40 transition-colors" />
        </div>
      )}
      {/* File Preview Panel — animates in/out */}
      <div
        className="flex-shrink-0 overflow-hidden transition-all duration-300 ease-out"
        style={{ width: isFilePreviewMode ? `${previewWidth}px` : '0px' }}
      >
        <div className="h-full overflow-hidden flex flex-col bg-bg-chat"
          style={{ width: `${previewWidth}px` }}>
          <FilePreview />
        </div>
      </div>

      {/* Secondary Panel resize handle — outside overflow-hidden */}
      {secondary && showSecondary && (
        <div
          onMouseDown={handleRightMouseDown}
          className="w-[9px] -ml-1 -mr-1 h-full flex-shrink-0 relative cursor-col-resize z-10
            flex items-center justify-center group"
        >
          <div className="w-px h-full bg-border-subtle group-hover:bg-accent/40 transition-colors" />
        </div>
      )}
      {/* Secondary Panel — animates to w-0 when hidden or preview mode */}
      {secondary && (
        <div
          className="flex-shrink-0 transition-all duration-300 ease-out overflow-hidden"
          style={{ width: showSecondary ? `${secondaryPanelWidth}px` : '0px' }}
        >
          <div
            className="h-full overflow-y-auto overflow-x-hidden bg-bg-sidebar"
            style={{ width: `${secondaryPanelWidth}px` }}
          >
            {secondary}
          </div>
        </div>
      )}

      {/* Floating Sidebar — overlay when file preview is active */}
      {showFloatingSidebar && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/10"
            onClick={toggleSidebar}
          />
          <div
            className="fixed top-0 left-0 h-full z-50 flex animate-in slide-in-from-left duration-200"
            style={{ width: `${sidebarWidth}px` }}
          >
            <div className="flex-1 h-full overflow-y-auto bg-bg-sidebar
              border-r border-border-subtle shadow-lg">
              {sidebar}
            </div>
          </div>
        </>
      )}

      {/* Floating Secondary Panel — overlay when file preview is active */}
      {secondary && showFloatingSecondary && (
        <>
          {/* Backdrop — click to dismiss */}
          <div
            className="fixed inset-0 z-40 bg-black/10"
            onClick={toggleSecondaryPanel}
          />
          {/* Floating panel — anchored to right edge */}
          <div
            className="fixed top-0 right-0 h-full z-50 flex animate-in slide-in-from-right duration-200"
            style={{ width: `${secondaryPanelWidth}px` }}
          >
            <div className="flex-1 h-full overflow-y-auto overflow-x-hidden bg-bg-sidebar
              border-l border-border-subtle shadow-lg">
              {secondary}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
