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
import { SessionItem } from './SessionItem';
import { SessionContextMenu, ProjectContextMenu } from './SessionContextMenu';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { teardownSession, waitForStdinCleared } from '../../lib/sessionLifecycle';

// --- Path utilities ---

let _cachedHomeDir: string | null = null;
bridge.getHomeDir().then((h) => { _cachedHomeDir = h; }).catch(() => {});

function isWindowsAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(p);
}

// S16 (v3 §4.3): prefer the already-decoded `project` field from the backend
// (decode_project_name in Rust). We only fall through to heuristic decoding
// when the caller passes the raw projectDir token. For the encoded case we
// cache backend decoder results — the synchronous API shape prevents us from
// awaiting per call site, so decoding is fire-and-forget and the cached
// answer is returned the next time the path is queried.
const _decodedCache = new Map<string, string>();
function resolveProjectPath(raw: string): string {
  if (raw.startsWith('/') || isWindowsAbsolutePath(raw)) return raw;
  if (raw.startsWith('~/') || raw === '~') {
    if (_cachedHomeDir) return raw.replace('~', _cachedHomeDir);
    return raw;
  }
  const cached = _decodedCache.get(raw);
  if (cached) return cached;
  // Kick off an async decode so the next render picks up the authoritative
  // value; keep a naive fallback to avoid blocking the current render.
  bridge.decodeProjectDir(raw)
    .then((decoded) => { _decodedCache.set(raw, decoded); })
    .catch(() => {});
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

/** Extract display label from a project key.
 *  When `parentHint` is true (duplicate names), appends parent folder:
 *  "A (Desktop)" vs "A (坚果云)" */
function projectLabel(project: string, parentHint?: boolean): string {
  const parts = project.replace(/^~[\\/]/, '').split(/[\\/]/);
  const name = parts[parts.length - 1] || project;
  if (parentHint && parts.length >= 2) {
    return `${name} (${parts[parts.length - 2]})`;
  }
  return name;
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
  const contentSearchResults = useSessionStore((s) => s.contentSearchResults);
  const isContentSearching = useSessionStore((s) => s.isContentSearching);
  const searchSessionContent = useSessionStore((s) => s.searchSessionContent);
  const clearContentSearch = useSessionStore((s) => s.clearContentSearch);

  // Context menus
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);

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

  // Debounce content search: 300ms after searchQuery changes, ≥2 chars
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      clearContentSearch();
      return;
    }
    const timer = setTimeout(() => {
      searchSessionContent(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchSessionContent, clearContentSearch]);

  // Display name resolver
  const displayName = useCallback((session: SessionListItem) => {
    return customPreviews[session.id] || session.preview || '';
  }, [customPreviews]);

  // Filtered sessions (search + archive)
  const filtered = useMemo(() => {
    let result = sessions;

    // Archive filter: OFF = hide archived, ON = show ONLY archived
    if (showArchived) {
      result = result.filter((s) => archivedSessions.has(s.id));
    } else {
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

  // Content-only matches: sessions hit by content search but NOT by metadata filter
  const contentOnlyMatches = useMemo(() => {
    if (!searchQuery.trim() || contentSearchResults.size === 0) return [];
    const metadataIds = new Set(filtered.map((s) => s.id));
    return sessions.filter((s) => {
      if (metadataIds.has(s.id)) return false;
      if (!contentSearchResults.has(s.id)) return false;
      // Respect archive filter
      if (showArchived) return archivedSessions.has(s.id);
      return !archivedSessions.has(s.id);
    });
  }, [sessions, filtered, contentSearchResults, searchQuery, showArchived, archivedSessions]);

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
      useChatStore.getState().ensureTab(sessionId);
      useChatStore.getState().resetTab(sessionId);
      useAgentStore.getState().clearAgents();
      return;
    }

    // Load from disk
    useChatStore.getState().ensureTab(sessionId);
    useSettingsStore.getState().setWorkingDirectory(resolveProjectPath(projectOrDir));
    const { clearMessages, addMessage, setSessionStatus, setSessionMeta } = useChatStore.getState();
    const agentActions = useAgentStore.getState();
    clearMessages(sessionId);
    agentActions.clearAgents();
    setSessionStatus(sessionId, 'running');
    // TK-329: explicitly clear stdinId when loading from disk — no live process exists yet.
    // Only set the CLI UUID (for resume). Prevents inheriting a stale stdinId
    // from a previous session that might still be alive in the backend.
    setSessionMeta(sessionId, { sessionId, stdinId: undefined });
    // PRD §9: Write cliResumeId in sessionStore — InputBar reads this for resume
    useSessionStore.getState().setCliResumeId(sessionId, sessionId);

    try {
      const rawMessages = await bridge.loadSession(sessionPath);
      if (useSessionStore.getState().selectedSessionId !== sessionId) {
        return;
      }
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
          addMessage(sessionId, baseMsg);
          useChatStore.getState().updateMessage(sessionId, msg.id, { toolResultContent });
        } else {
          addMessage(sessionId, msg);
        }
      }

      setSessionStatus(sessionId, 'completed');
    } catch (err) {
      if (useSessionStore.getState().selectedSessionId !== sessionId) return;
      setSessionStatus(sessionId, 'error');
      addMessage(sessionId, {
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
      // Kill running process before deleting (S8 fix — prevent residual processes)
      const tab = useChatStore.getState().getTab(sessionId);
      const routedStdinIds = Object.entries(useSessionStore.getState().stdinToTab)
        .filter(([, tabId]) => tabId === sessionId)
        .map(([stdinId]) => stdinId);
      const stdinIds = Array.from(new Set([
        ...(tab?.sessionMeta.stdinId ? [tab.sessionMeta.stdinId] : []),
        ...routedStdinIds,
      ]));
      for (const stdinId of stdinIds) {
        await teardownSession(stdinId, sessionId, 'delete');
        if (tab?.sessionMeta.stdinId === stdinId) {
          await waitForStdinCleared(sessionId, stdinId).catch(() => {});
        }
      }

      if (sessionPath) {
        await bridge.deleteSession(sessionId, sessionPath);
      } else {
        useSessionStore.getState().removeDraft(sessionId);
      }
      if (selectedId === sessionId) {
        setSelected('');
        useChatStore.getState().resetTab(sessionId);
        useSettingsStore.getState().setWorkingDirectory('');
      }
      useChatStore.getState().removeFromCache(sessionId);
      // Drop the per-tab agent cache — otherwise creating a new session
      // that reuses this ID shows the ghost agents of the old one (#B9).
      useAgentStore.getState().clearCacheForTab(sessionId);
      // Phase 3 §3.1: drop per-tab path grants so an authorized external
      // file can't be read again after the tab is gone.
      bridge.clearPathGrants(sessionId).catch(() => {});
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
    const currentTabId = useSessionStore.getState().selectedSessionId;
    if (currentTabId) {
      useChatStore.getState().saveToCache(currentTabId);
      useAgentStore.getState().saveToCache(currentTabId);
    }
    const newDraftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    useChatStore.getState().ensureTab(newDraftId);
    useChatStore.getState().resetTab(newDraftId);
    useSessionStore.getState().addDraftSession(newDraftId, realPath);
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

  // Rename from context menu — trigger inline edit in SessionItem
  const handleRenameFromMenu = useCallback((session: SessionListItem) => {
    setRenamingSessionId(session.id);
  }, []);

  const handleSelectMode = useCallback((_project: string) => {
    setMultiSelect(true);
    setSelectedIds(new Set());
  }, []);

  return (
    <div className="flex flex-col gap-1 px-3">
      {/* Search + Filters */}
      <div className="px-1 mb-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-xl
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
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="flex-shrink-0 p-0.5 rounded text-text-tertiary
                  hover:text-text-primary transition-smooth">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
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

      {/* Project groups — detect duplicate folder names for disambiguation */}
      {projectGroups.map(([project, items]) => {
        const baseName = projectLabel(project);
        const isDuplicate = projectGroups.filter(([k]) => projectLabel(k) === baseName).length > 1;
        return (
        <SessionGroup
          key={project}
          projectKey={project}
          projectLabel={projectLabel(project, isDuplicate)}
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
          renamingSessionId={renamingSessionId}
          onRenameDone={() => setRenamingSessionId(null)}
        />
        );
      })}

      {/* Content matches section (async, appears after metadata results) */}
      {searchQuery.trim() && contentOnlyMatches.length > 0 && (
        <div className="mt-3 mb-1">
          <div className="flex items-center gap-2 px-3 py-1">
            <div className="flex-1 h-px bg-border-subtle" />
            <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
              {t('conv.contentMatches')} ({contentOnlyMatches.length})
            </span>
            <div className="flex-1 h-px bg-border-subtle" />
          </div>
          {contentOnlyMatches.map((session) => {
            const result = contentSearchResults.get(session.id);
            return (
              <SessionItem
                key={session.id}
                session={session}
                isSelected={selectedId === session.id}
                isRunning={runningSessions.has(session.id)}
                isPinned={pinnedSessions.has(session.id)}
                isArchived={archivedSessions.has(session.id)}
                displayName={displayName(session)}
                contentSnippet={result?.snippet}
                matchCount={result?.match_count}
                searchQuery={searchQuery}
                multiSelect={multiSelect}
                isChecked={selectedIds.has(session.id)}
                onSelect={handleLoadSession}
                onContextMenu={handleContextMenu}
                onRename={handleRename}
                onToggleCheck={handleToggleCheck}
                triggerRename={renamingSessionId === session.id}
                onRenameDone={() => setRenamingSessionId(null)}
              />
            );
          })}
        </div>
      )}

      {/* Content search loading spinner */}
      {searchQuery.trim() && isContentSearching && (
        <div className="flex items-center justify-center gap-1.5 py-3 text-text-tertiary">
          <div className="w-3 h-3 border-[1.5px] border-text-tertiary/20
            border-t-text-tertiary/60 rounded-full animate-spin" />
          <span className="text-[10px]">{t('conv.searchingContent')}</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && contentOnlyMatches.length === 0 && !isContentSearching && (
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
