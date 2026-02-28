import { useEffect, useMemo, useCallback, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore, generateMessageId } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { useAgentStore } from '../../stores/agentStore';
import { bridge, SessionListItem } from '../../lib/tauri-bridge';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { useT } from '../../lib/i18n';
import { parseSessionMessages } from '../../lib/session-loader';
import { SessionGroup } from './SessionGroup';
import { SessionContextMenu, ProjectContextMenu } from './SessionContextMenu';
import { ConfirmDialog } from '../shared/ConfirmDialog';

// --- Path utilities ---

let _cachedHomeDir: string | null = null;
bridge.getHomeDir().then((h) => { _cachedHomeDir = h; }).catch(() => {});

function isWindowsAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(p);
}

function resolveProjectPath(raw: string): string {
  if (raw.startsWith('/') || isWindowsAbsolutePath(raw)) return raw;
  if (raw.startsWith('~/') || raw === '~') {
    if (_cachedHomeDir) return raw.replace('~', _cachedHomeDir);
    return raw;
  }
  if (/^[A-Za-z]-/.test(raw)) {
    const drive = raw[0];
    const rest = raw.slice(2);
    return `${drive}:\\${rest.replace(/-/g, '\\')}`;
  }
  return raw.replace(/-/g, '/');
}

function normalizeProjectKey(raw: string): string {
  const unix = raw.match(/^\/(?:Users|home)\/[^/]+(\/.*)/);
  if (unix) return '~' + unix[1];
  const win = raw.match(/^[A-Za-z]:[/\\]Users[/\\][^/\\]+([/\\].*)/i);
  if (win) return '~' + win[1];
  return raw;
}

function projectLabel(project: string): string {
  const parts = project.replace(/^~[\\/]/, '').split(/[\\/]/);
  return parts[parts.length - 1] || project;
}

// --- Context menu types ---

interface ContextMenuState {
  x: number;
  y: number;
  session: SessionListItem;
}

interface ProjectMenuState {
  x: number;
  y: number;
  project: string;
}

// --- Main component ---

export function ConversationList() {
  const t = useT();

  // Store subscriptions
  const sessions = useSessionStore((s) => s.sessions);
  const isLoading = useSessionStore((s) => s.isLoading);
  const searchQuery = useSessionStore((s) => s.searchQuery);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery);
  const selectedId = useSessionStore((s) => s.selectedSessionId);
  const setSelected = useSessionStore((s) => s.setSelectedSession);
  const customPreviews = useSessionStore((s) => s.customPreviews);
  const setCustomPreview = useSessionStore((s) => s.setCustomPreview);
  const runningSessions = useSessionStore((s) => s.runningSessions);

  // Context menus
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);
  const [deleteAllTarget, setDeleteAllTarget] = useState<{
    projectKey: string;
    count: number;
  } | null>(null);

  // Shift+click multi-select: track last clicked index
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  // Smart collapse (Phase 2)
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  const [manualCollapsed, setManualCollapsed] = useState<Set<string>>(new Set());

  // Pinned & archived (Phase 3)
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(() => {
    try {
      const data = localStorage.getItem('tokenicode_pinned_sessions');
      return new Set(data ? JSON.parse(data) : []);
    } catch { return new Set(); }
  });
  const [archivedSessions, setArchivedSessions] = useState<Set<string>>(() => {
    try {
      const data = localStorage.getItem('tokenicode_archived_sessions');
      return new Set(data ? JSON.parse(data) : []);
    } catch { return new Set(); }
  });
  const [showArchived, setShowArchived] = useState(false);

  // Multi-select
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ESC to cancel multi-select
  useEffect(() => {
    if (!multiSelect) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMultiSelect(false);
        setSelectedIds(new Set());
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [multiSelect]);

  // Persist pinned/archived
  const persistPinned = useCallback((next: Set<string>) => {
    setPinnedSessions(next);
    localStorage.setItem('tokenicode_pinned_sessions', JSON.stringify([...next]));
    bridge.savePinnedSessions([...next]).catch(() => {});
  }, []);

  const persistArchived = useCallback((next: Set<string>) => {
    setArchivedSessions(next);
    localStorage.setItem('tokenicode_archived_sessions', JSON.stringify([...next]));
    bridge.saveArchivedSessions([...next]).catch(() => {});
  }, []);

  // Load pinned/archived from backend on init
  useEffect(() => {
    bridge.loadPinnedSessions?.()
      .then((data: string[]) => {
        if (data?.length) setPinnedSessions(new Set(data));
      })
      .catch(() => {});
    bridge.loadArchivedSessions?.()
      .then((data: string[]) => {
        if (data?.length) setArchivedSessions(new Set(data));
      })
      .catch(() => {});
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchSessions().then(() => {
      const currentSelected = useSessionStore.getState().selectedSessionId;
      if (!currentSelected) {
        const lastId = useSessionStore.getState().getLastSessionId();
        if (lastId) {
          const sessions = useSessionStore.getState().sessions;
          const match = sessions.find((s) => s.id === lastId);
          if (match) {
            handleLoadSession(match);
          }
        }
      }
    });
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, []);

  // Listen for sessions:changed event for instant refresh
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('sessions:changed', () => {
      fetchSessions();
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [fetchSessions]);

  // Display name resolver
  const displayName = useCallback((session: SessionListItem) => {
    return customPreviews[session.id] || session.preview || '';
  }, [customPreviews]);

  // Filtered sessions (search + archive)
  const filtered = useMemo(() => {
    let result = sessions;

    // Exclude archived unless toggle on
    if (!showArchived) {
      result = result.filter((s) => !archivedSessions.has(s.id));
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          displayName(s).toLowerCase().includes(q) ||
          s.preview.toLowerCase().includes(q) ||
          s.project.toLowerCase().includes(q)
      );
    }

    return result;
  }, [sessions, searchQuery, displayName, showArchived, archivedSessions]);

  // Group by project
  const projectGroups = useMemo(() => {
    const map = new Map<string, SessionListItem[]>();
    for (const s of filtered) {
      const raw = s.project || s.projectDir;
      const key = normalizeProjectKey(raw);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    for (const items of map.values()) {
      items.sort((a, b) => b.modifiedAt - a.modifiedAt);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      const ta = a[1][0]?.modifiedAt || 0;
      const tb = b[1][0]?.modifiedAt || 0;
      return tb - ta;
    });
    return entries;
  }, [filtered]);

  // Smart expand: expand if contains selected, or manually expanded
  const isExpanded = useCallback((key: string) => {
    if (manualCollapsed.has(key)) return false;
    if (manualExpanded.has(key)) return true;
    // Default: expand if contains selected session
    if (!selectedId) return true; // expand all if nothing selected
    const raw = sessions.find((s) => s.id === selectedId);
    if (!raw) return false;
    const selectedKey = normalizeProjectKey(raw.project || raw.projectDir);
    return selectedKey === key;
  }, [manualCollapsed, manualExpanded, selectedId, sessions]);

  const toggleCollapse = useCallback((project: string) => {
    const expanded = isExpanded(project);
    if (expanded) {
      // Collapse it
      setManualCollapsed((prev) => { const next = new Set(prev); next.add(project); return next; });
      setManualExpanded((prev) => { const next = new Set(prev); next.delete(project); return next; });
    } else {
      // Expand it
      setManualExpanded((prev) => { const next = new Set(prev); next.add(project); return next; });
      setManualCollapsed((prev) => { const next = new Set(prev); next.delete(project); return next; });
    }
  }, [isExpanded]);

  // --- Session loading (slim version using session-loader) ---
  const handleLoadSession = useCallback(async (session: SessionListItem) => {
    const { path: sessionPath, id: sessionId, project: projectOrDir } = session;
    const currentTabId = selectedId;
    if (currentTabId === sessionId) return;

    // Save current to cache
    if (currentTabId) {
      useChatStore.getState().saveToCache(currentTabId);
      useAgentStore.getState().saveToCache(currentTabId);
    }

    // Close file preview
    useFileStore.getState().closePreview();

    // Switch selection
    setSelected(sessionId);

    // Try cache first
    const restored = useChatStore.getState().restoreFromCache(sessionId);
    if (restored) {
      useAgentStore.getState().restoreFromCache(sessionId);
      if (projectOrDir) {
        useSettingsStore.getState().setWorkingDirectory(resolveProjectPath(projectOrDir));
      }
      return;
    }

    // Draft sessions
    if (!sessionPath) {
      useChatStore.getState().resetSession();
      useAgentStore.getState().clearAgents();
      return;
    }

    // Load from disk
    useSettingsStore.getState().setWorkingDirectory(resolveProjectPath(projectOrDir));
    const { clearMessages, addMessage, setSessionStatus, setSessionMeta } = useChatStore.getState();
    const agentActions = useAgentStore.getState();
    clearMessages();
    agentActions.clearAgents();
    setSessionStatus('running');
    setSessionMeta({ sessionId });

    try {
      const rawMessages = await bridge.loadSession(sessionPath);
      const { messages, agents } = parseSessionMessages(rawMessages);

      // Apply agents
      for (const agent of agents) {
        agentActions.upsertAgent(agent);
      }

      // Apply messages
      for (const msg of messages) {
        if (msg.toolResultContent) {
          // For messages that have tool results, add the base message first, then update
          const { toolResultContent, ...baseMsg } = msg;
          addMessage(baseMsg);
          useChatStore.getState().updateMessage(msg.id, { toolResultContent });
        } else {
          addMessage(msg);
        }
      }

      setSessionStatus('completed');
    } catch (err) {
      setSessionStatus('error');
      addMessage({
        id: generateMessageId(),
        role: 'system',
        type: 'text',
        content: `${t('conv.loadFailed')}: ${err}`,
        timestamp: Date.now(),
      });
    }
  }, [selectedId, setSelected, t]);

  // --- Delete handlers ---
  const executeDelete = useCallback(async (sessionId: string, sessionPath: string) => {
    try {
      if (sessionPath) {
        await bridge.deleteSession(sessionId, sessionPath);
      } else {
        useSessionStore.getState().removeDraft(sessionId);
      }
      if (selectedId === sessionId) {
        setSelected('');
        useChatStore.getState().resetSession();
        useSettingsStore.getState().setWorkingDirectory('');
      }
      useChatStore.getState().removeFromCache(sessionId);
      fetchSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [selectedId, setSelected, fetchSessions]);

  // Single delete → confirm dialog
  const handleDeleteSingle = useCallback((session: SessionListItem) => {
    setDeleteTarget(session);
  }, []);

  // Delete all in project → confirm dialog
  const handleDeleteAllInProject = useCallback((projectKey: string) => {
    const suffix = projectKey.replace(/^~/, '');
    const allSessions = useSessionStore.getState().sessions;
    const projectSessions = allSessions.filter((s) => {
      const raw = s.project || s.projectDir;
      return raw.endsWith(suffix);
    });
    if (projectSessions.length === 0) return;
    setDeleteAllTarget({ projectKey, count: projectSessions.length });
  }, []);

  const confirmDeleteAll = useCallback(async () => {
    if (!deleteAllTarget) return;
    const suffix = deleteAllTarget.projectKey.replace(/^~/, '');
    const allSessions = useSessionStore.getState().sessions;
    const projectSessions = allSessions.filter((s) => {
      const raw = s.project || s.projectDir;
      return raw.endsWith(suffix);
    });
    for (const session of projectSessions) {
      await executeDelete(session.id, session.path);
    }
    setDeleteAllTarget(null);
    fetchSessions();
  }, [deleteAllTarget, executeDelete, fetchSessions]);

  // --- Context menu handlers ---
  const handleContextMenu = useCallback((e: React.MouseEvent, session: SessionListItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  }, []);

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, project: string) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectMenu({ x: e.clientX, y: e.clientY, project });
  }, []);

  const handleRevealInFinder = useCallback((session: SessionListItem) => {
    if (session.path) bridge.revealInFinder(session.path).catch(() => {});
  }, []);

  const handleExportMarkdown = useCallback(async (session: SessionListItem) => {
    if (!session.path) return;
    const outputPath = await save({
      defaultPath: `${session.id}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (outputPath) {
      bridge.exportSessionMarkdown(session.path, outputPath).catch(() => {});
    }
  }, []);

  const handleNewSessionInProject = useCallback((projectKey: string) => {
    const suffix = projectKey.replace(/^~/, '');
    const allSessions = useSessionStore.getState().sessions;
    const match = allSessions.find((s) => {
      const raw = s.project || s.projectDir;
      return raw.endsWith(suffix);
    });
    const realPath = match ? (match.project || match.projectDir) : resolveProjectPath(projectKey);
    useSettingsStore.getState().setWorkingDirectory(realPath);
    useChatStore.getState().resetSession();
    const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    useSessionStore.getState().addDraftSession(draftId, realPath);
  }, []);

  // Pin / Archive handlers
  const handleTogglePin = useCallback((session: SessionListItem) => {
    const next = new Set(pinnedSessions);
    if (next.has(session.id)) next.delete(session.id);
    else next.add(session.id);
    persistPinned(next);
  }, [pinnedSessions, persistPinned]);

  const handleToggleArchive = useCallback((session: SessionListItem) => {
    const next = new Set(archivedSessions);
    if (next.has(session.id)) next.delete(session.id);
    else next.add(session.id);
    persistArchived(next);
  }, [archivedSessions, persistArchived]);

  // Build flat list of visible session IDs for shift+click range selection
  const flatSessionIds = useMemo(() => {
    const ids: string[] = [];
    for (const [project, items] of projectGroups) {
      if (isExpanded(project)) {
        for (const s of items) ids.push(s.id);
      }
    }
    return ids;
  }, [projectGroups, isExpanded]);

  // Multi-select handlers (with shift+click range support)
  const handleToggleCheck = useCallback((sessionId: string, shiftKey?: boolean) => {
    // Auto-enter multiSelect mode if not already in it
    if (!multiSelect) {
      setMultiSelect(true);
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);

      // Shift+click: range select
      if (shiftKey && lastClickedIndex !== null) {
        const currentIndex = flatSessionIds.indexOf(sessionId);
        if (currentIndex !== -1) {
          const start = Math.min(lastClickedIndex, currentIndex);
          const end = Math.max(lastClickedIndex, currentIndex);
          for (let i = start; i <= end; i++) {
            next.add(flatSessionIds[i]);
          }
          setLastClickedIndex(currentIndex);
          return next;
        }
      }

      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);

      setLastClickedIndex(flatSessionIds.indexOf(sessionId));
      return next;
    });
  }, [flatSessionIds, lastClickedIndex, multiSelect]);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setDeleteAllTarget({
      projectKey: '__batch__',
      count: selectedIds.size,
    });
  }, [selectedIds]);

  const confirmBatchDelete = useCallback(async () => {
    const allSessions = useSessionStore.getState().sessions;
    for (const id of selectedIds) {
      const session = allSessions.find((s) => s.id === id);
      if (session) await executeDelete(session.id, session.path);
    }
    setSelectedIds(new Set());
    setMultiSelect(false);
    setDeleteAllTarget(null);
    fetchSessions();
  }, [selectedIds, executeDelete, fetchSessions]);

  const handleBatchArchive = useCallback(() => {
    const next = new Set(archivedSessions);
    for (const id of selectedIds) next.add(id);
    persistArchived(next);
    setSelectedIds(new Set());
    setMultiSelect(false);
  }, [selectedIds, archivedSessions, persistArchived]);

  const handleRename = useCallback((sessionId: string, newName: string) => {
    setCustomPreview(sessionId, newName);
  }, [setCustomPreview]);

  // Rename from context menu (trigger double-click-like behavior)
  const handleRenameFromMenu = useCallback((session: SessionListItem) => {
    // The SessionItem handles its own rename state via double-click.
    // For context menu rename, we use setCustomPreview with a prompt-like pattern.
    // Since we moved rename to SessionItem, we just need to simulate.
    // Actually, let's keep rename in ConversationList for context menu trigger.
    const name = customPreviews[session.id] || session.preview || '';
    const newName = prompt(t('conv.renamePrompt'), name);
    if (newName && newName.trim()) {
      setCustomPreview(session.id, newName.trim());
    }
  }, [customPreviews, setCustomPreview, t]);

  const handleSelectMode = useCallback((_project: string) => {
    setMultiSelect(true);
    setSelectedIds(new Set());
  }, []);

  return (
    <div className="flex flex-col gap-1 px-3">
      {/* Search + Filters */}
      <div className="px-1 mb-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl
            bg-bg-secondary border border-border-subtle
            focus-within:border-border-focus transition-smooth">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5"
              className="text-text-tertiary flex-shrink-0">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('conv.search')}
              className="flex-1 bg-transparent text-xs text-text-primary
                placeholder:text-text-tertiary outline-none"
            />
          </div>

          {/* Archive toggle */}
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`flex-shrink-0 p-2 rounded-lg transition-smooth
              ${showArchived
                ? 'bg-accent/10 text-accent'
                : 'text-text-tertiary hover:bg-bg-secondary hover:text-text-primary'
              }`}
            title={t('conv.showArchived')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="2" width="14" height="3" rx="1" />
              <path d="M2 5v7a1 1 0 001 1h10a1 1 0 001-1V5" />
              <path d="M6 8h4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && sessions.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-accent/30
            border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {/* Project groups */}
      {projectGroups.map(([project, items]) => (
        <SessionGroup
          key={project}
          projectKey={project}
          projectLabel={projectLabel(project)}
          projectPath={project}
          sessions={items}
          isExpanded={isExpanded(project)}
          selectedId={selectedId}
          runningSessions={runningSessions}
          pinnedSessions={pinnedSessions}
          archivedSessions={archivedSessions}
          customPreviews={customPreviews}
          multiSelect={multiSelect}
          selectedIds={selectedIds}
          onToggleCollapse={toggleCollapse}
          onContextMenu={handleContextMenu}
          onProjectContextMenu={handleProjectContextMenu}
          onLoadSession={handleLoadSession}
          onRename={handleRename}
          onNewSession={handleNewSessionInProject}
          onToggleCheck={handleToggleCheck}
        />
      ))}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-8 px-4">
          <div className="text-text-tertiary text-xs">
            {searchQuery ? t('conv.noMatch') : t('conv.noConv')}
          </div>
        </div>
      )}

      {/* Refresh button */}
      <button
        onClick={fetchSessions}
        className="mx-2 mt-2 py-1.5 rounded-lg text-[12px]
          text-text-muted hover:text-text-primary
          hover:bg-bg-secondary transition-smooth"
      >
        {t('conv.refresh')}
      </button>

      {/* Multi-select floating toolbar — sticky at bottom of scroll container */}
      {multiSelect && (
        <div className="sticky bottom-0 mx-1 mt-2 p-2 rounded-xl
          bg-bg-card/95 backdrop-blur-sm border border-border-subtle shadow-lg
          flex items-center gap-2 animate-fade-in z-10">
          <span className="text-xs text-text-muted flex-1">
            {t('conv.selected').replace('{n}', String(selectedIds.size))}
          </span>
          <button
            onClick={handleBatchArchive}
            disabled={selectedIds.size === 0}
            className="px-2 py-1 text-xs rounded-lg bg-bg-tertiary text-text-primary
              hover:bg-accent/10 hover:text-accent transition-smooth
              disabled:opacity-30"
          >
            {t('conv.archive')}
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0}
            className="px-2 py-1 text-xs rounded-lg bg-error/10 text-error
              hover:bg-error/20 transition-smooth
              disabled:opacity-30"
          >
            {t('conv.delete')}
          </button>
          <button
            onClick={() => { setMultiSelect(false); setSelectedIds(new Set()); }}
            className="px-2 py-1 text-xs rounded-lg bg-bg-tertiary text-text-muted
              hover:text-text-primary transition-smooth"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* Session context menu */}
      {contextMenu && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          session={contextMenu.session}
          onRename={handleRenameFromMenu}
          onRevealInFinder={handleRevealInFinder}
          onExport={handleExportMarkdown}
          onDelete={handleDeleteSingle}
          onPin={handleTogglePin}
          onArchive={handleToggleArchive}
          isPinned={pinnedSessions.has(contextMenu.session.id)}
          isArchived={archivedSessions.has(contextMenu.session.id)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Project context menu */}
      {projectMenu && (
        <ProjectContextMenu
          x={projectMenu.x}
          y={projectMenu.y}
          project={projectMenu.project}
          onNewSession={handleNewSessionInProject}
          onDeleteAll={handleDeleteAllInProject}
          onSelectMode={handleSelectMode}
          onClose={() => setProjectMenu(null)}
        />
      )}

      {/* Delete single confirm dialog */}
      {deleteTarget && (
        <ConfirmDialog
          open={true}
          title={t('conv.delete')}
          message={t('conv.deleteConfirm')}
          detail={displayName(deleteTarget) || deleteTarget.preview}
          variant="danger"
          confirmLabel={t('conv.delete')}
          onConfirm={() => {
            executeDelete(deleteTarget.id, deleteTarget.path);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Delete all confirm dialog */}
      {deleteAllTarget && (
        <ConfirmDialog
          open={true}
          title={t('conv.deleteAll')}
          message={
            deleteAllTarget.projectKey === '__batch__'
              ? t('conv.deleteAllConfirm')
                  .replace('{count}', String(deleteAllTarget.count))
                  .replace('{project}', t('conv.selected').replace('{n}', String(deleteAllTarget.count)))
              : t('conv.deleteAllConfirm')
                  .replace('{count}', String(deleteAllTarget.count))
                  .replace('{project}', projectLabel(deleteAllTarget.projectKey))
          }
          detail={t('conv.deleteAllConfirmDetail')}
          variant="danger"
          confirmLabel={t('conv.delete')}
          onConfirm={deleteAllTarget.projectKey === '__batch__' ? confirmBatchDelete : confirmDeleteAll}
          onCancel={() => setDeleteAllTarget(null)}
        />
      )}
    </div>
  );
}
