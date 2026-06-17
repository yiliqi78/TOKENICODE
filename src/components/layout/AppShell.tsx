import { useCallback, useRef, useEffect } from 'react';
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
const MIN_CHAT_WIDTH = 360;
const MIN_PREVIEW_WIDTH = 420;
const MAX_PREVIEW_WIDTH = 1040;

export function AppShell({ sidebar, main, secondary }: AppShellProps) {
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const secondaryPanelOpen = useSettingsStore((s) => s.secondaryPanelOpen);
  const secondaryPanelWidth = useSettingsStore((s) => s.secondaryPanelWidth);
  const toggleSecondaryPanel = useSettingsStore((s) => s.toggleSecondaryPanel);
  const previewLayout = useSettingsStore((s) => s.previewLayout);
  const previewPanelWidth = useSettingsStore((s) => s.previewPanelWidth);

  /* File preview state — selected files open as a floating overlay over chat */
  const selectedFile = useFileStore((s) => s.selectedFile);
  const closePreview = useFileStore((s) => s.closePreview);
  const isFilePreviewMode = !!selectedFile;

  // --- Right-side panel dragging (secondary) ---
  const isRightDragging = useRef(false);
  const rightStartX = useRef(0);
  const rightStartWidth = useRef(0);

  // Refs to avoid re-registering global listeners when these values change
  const secondaryPanelWidthRef = useRef(secondaryPanelWidth);
  secondaryPanelWidthRef.current = secondaryPanelWidth;
  const previewWasOpenRef = useRef(false);
  const previewLayoutRef = useRef(previewLayout);
  const mainPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const enteredPreview = isFilePreviewMode && !previewWasOpenRef.current;
    const switchedToKeepList = isFilePreviewMode
      && previewLayout === 'keep-list'
      && previewLayoutRef.current !== 'keep-list';

    if ((enteredPreview || switchedToKeepList)
      && previewLayout === 'keep-list'
      && !secondaryPanelOpen) {
      toggleSecondaryPanel();
    }

    previewWasOpenRef.current = isFilePreviewMode;
    previewLayoutRef.current = previewLayout;
  }, [isFilePreviewMode, previewLayout, secondaryPanelOpen, toggleSecondaryPanel]);

  const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isRightDragging.current = true;
    rightStartX.current = e.clientX;
    rightStartWidth.current = secondaryPanelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isRightDragging.current) return;
      const delta = rightStartX.current - e.clientX;
      const newWidth = rightStartWidth.current + delta;

      if (newWidth < COLLAPSE_THRESHOLD) {
        isRightDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const settings = useSettingsStore.getState();
        if (settings.secondaryPanelOpen) settings.toggleSecondaryPanel();
        return;
      }
      useSettingsStore.getState().setSecondaryPanelWidth(
        Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, newWidth))
      );
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
      // Safety: reset body styles if component unmounts mid-drag
      if (isRightDragging.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, []);

  // --- Sidebar dragging ---
  const isSidebarDragging = useRef(false);
  const sidebarStartX = useRef(0);
  const sidebarStartW = useRef(0);

  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isSidebarDragging.current = true;
    sidebarStartX.current = e.clientX;
    sidebarStartW.current = sidebarWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

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
        const settings = useSettingsStore.getState();
        if (settings.sidebarOpen) settings.toggleSidebar();
        return;
      }
      useSettingsStore.getState().setSidebarWidth(
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
      if (isSidebarDragging.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, []);

  // --- File preview dragging ---
  const isPreviewDragging = useRef(false);
  const previewStartX = useRef(0);
  const previewStartWidth = useRef(0);

  const previewPanelWidthRef = useRef(previewPanelWidth);
  previewPanelWidthRef.current = previewPanelWidth;

  const getMaxPreviewWidth = useCallback(() => {
    const mainWidth = mainPanelRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    return Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, mainWidth - MIN_CHAT_WIDTH));
  }, []);

  const handlePreviewMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isPreviewDragging.current = true;
    previewStartX.current = e.clientX;
    previewStartWidth.current = previewPanelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isPreviewDragging.current) return;
      const delta = previewStartX.current - e.clientX;
      const maxWidth = getMaxPreviewWidth();
      useSettingsStore.getState().setPreviewPanelWidth(
        Math.max(MIN_PREVIEW_WIDTH, Math.min(maxWidth, previewStartWidth.current + delta))
      );
    };

    const handleUp = () => {
      if (!isPreviewDragging.current) return;
      isPreviewDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (isPreviewDragging.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, [getMaxPreviewWidth]);

  const keepFileList = previewLayout === 'keep-list';
  const showSidebar = sidebarOpen && !(isFilePreviewMode && keepFileList);
  const showSecondary = !!secondary
    && (isFilePreviewMode ? keepFileList && secondaryPanelOpen : secondaryPanelOpen);
  const previewWidth = Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, previewPanelWidth));

  const handlePreviewOutsideMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isFilePreviewMode) return;
    const target = e.target as HTMLElement;
    if (target.closest('.file-preview-resize-handle')) return;
    if (target.closest('.file-preview')) return;
    if (target.closest('button, input, textarea, select, a, [contenteditable="true"], .ProseMirror')) return;
    closePreview();
  }, [isFilePreviewMode, closePreview]);

  return (
    <div className="flex h-full w-full overflow-hidden gradient-bg">
      {/* Drag region — data-tauri-drag-region handles both drag and double-click-to-maximize natively */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 h-[28px] z-50"
      />

      {/* Sidebar — animates to w-0 when hidden or previewing */}
      <div
        className="flex-shrink-0 transition-all duration-300 ease-out overflow-hidden"
        style={{ width: showSidebar ? `${sidebarWidth}px` : '0px' }}
      >
        <div
          className="h-full overflow-hidden bg-bg-sidebar"
          style={{ width: `${sidebarWidth}px` }}
        >
          {sidebar}
        </div>
      </div>
      {/* Sidebar resize handle — outside overflow-hidden so hit area isn't clipped */}
      {showSidebar && (
        <div
          onMouseDown={handleSidebarMouseDown}
          className="w-px h-full flex-shrink-0 relative cursor-col-resize z-20
            bg-bg-chat hover:bg-accent/40 transition-colors group"
        >
          {/* 拖拽热区：向两侧各扩 4px，绝对定位不占布局宽度 → 侧栏紧贴聊天区，只留 1px 分隔线 */}
          <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
        </div>
      )}

      {/* Main Panel — full-height, separated by vertical border lines */}
      <div
        ref={mainPanelRef}
        className="flex-1 min-w-0 flex bg-bg-chat overflow-hidden"
        onMouseDownCapture={handlePreviewOutsideMouseDown}
      >
        <div className="flex-1 min-w-[360px] flex flex-col overflow-hidden">
          {main}
        </div>
        {isFilePreviewMode && (
          <div
            className="relative flex-shrink-0 min-w-[420px] p-4 pl-3 animate-fade-in"
            style={{ width: `${previewWidth}px`, maxWidth: `calc(100% - ${MIN_CHAT_WIDTH}px)` }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closePreview();
            }}
          >
            <div
              onMouseDown={handlePreviewMouseDown}
              className="file-preview-resize-handle absolute inset-y-4 left-3 w-0
                cursor-col-resize z-40 group"
            >
              <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize rounded-l-lg
                after:absolute after:inset-y-2 after:left-1/2 after:w-px
                after:-translate-x-1/2 after:bg-transparent
                group-hover:after:bg-accent/25 after:transition-colors" />
            </div>
            <FilePreview />
          </div>
        )}
      </div>

      {/* Secondary Panel resize handle — 同上：w-px 分隔线本体 + 悬浮热区，三处分隔线统一 */}
      {showSecondary && (
        <div
          onMouseDown={handleRightMouseDown}
          className="w-px h-full flex-shrink-0 relative cursor-col-resize z-10
            bg-bg-chat hover:bg-accent/40 transition-colors group"
        >
          {/* 拖拽热区：向两侧各扩 4px，绝对定位不占布局宽度 */}
          <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
        </div>
      )}
      {/* Secondary Panel — animates to w-0 when hidden */}
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

    </div>
  );
}
