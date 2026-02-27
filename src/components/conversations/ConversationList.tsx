import { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore, generateMessageId } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { useAgentStore } from '../../stores/agentStore';
import { bridge, SessionListItem } from '../../lib/tauri-bridge';
import { save } from '@tauri-apps/plugin-dialog';
import { t as tStatic, useT } from '../../lib/i18n';

/** Resolve a project path to an absolute path.
 *  Handles: absolute (/… or C:\…), tilde (~/…), and dash-encoded (-Users-… or C-Users-…). */
let _cachedHomeDir: string | null = null;
// Eagerly cache home directory for tilde expansion
bridge.getHomeDir().then((h) => { _cachedHomeDir = h; }).catch(() => {});

/** Check if a string looks like a Windows absolute path (e.g. "C:\..." or "C:/...") */
function isWindowsAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(p);
}

function resolveProjectPath(raw: string): string {
  // Already absolute (Unix or Windows)
  if (raw.startsWith('/') || isWindowsAbsolutePath(raw)) return raw;
  if (raw.startsWith('~/') || raw === '~') {
    if (_cachedHomeDir) return raw.replace('~', _cachedHomeDir);
    // Fallback: can't expand yet, return as-is (will be fixed on next load)
    return raw;
  }
  // Dash-encoded: detect Windows ("C-Users-...") vs Unix ("-Users-...")
  // Windows: single letter followed by dash → drive letter
  if (/^[A-Za-z]-/.test(raw)) {
    const drive = raw[0];
    const rest = raw.slice(2); // skip "C-"
    return `${drive}:\\${rest.replace(/-/g, '\\')}`;
  }
  // Unix: "-Users-foo-bar" → "/Users/foo/bar"
  return raw.replace(/-/g, '/');
}

function formatRelativeTime(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return tStatic('conv.justNow');
  if (minutes < 60) return `${minutes}${tStatic('conv.mAgo')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${tStatic('conv.hAgo')}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}${tStatic('conv.dAgo')}`;
  return new Date(ms).toLocaleDateString();
}

// --- Context menu state ---
interface ContextMenuState {
  x: number;
  y: number;
  session: SessionListItem;
}

interface ProjectMenuState {
  x: number;
  y: number;
  project: string; // project path
}

export function ConversationList() {
  const t = useT();
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

  // Context menu (session-level)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Context menu (project-level)
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSessions().then(() => {
      // Auto-restore last active session on app restart
      const currentSelected = useSessionStore.getState().selectedSessionId;
      if (!currentSelected) {
        const lastId = useSessionStore.getState().getLastSessionId();
        if (lastId) {
          const sessions = useSessionStore.getState().sessions;
          const match = sessions.find((s) => s.id === lastId);
          if (match) {
            handleLoadSession(match.path, match.id, match.project);
          }
        }
      }
    });
    // Periodic refresh every 10s to catch missed updates
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  // Close project menu on outside click or ESC
  useEffect(() => {
    if (!projectMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProjectMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [projectMenu]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Get display name for a session
  const displayName = useCallback((session: SessionListItem) => {
    return customPreviews[session.id] || session.preview || '';
  }, [customPreviews]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        displayName(s).toLowerCase().includes(q) ||
        s.preview.toLowerCase().includes(q) ||
        s.project.toLowerCase().includes(q)
    );
  }, [sessions, searchQuery, displayName]);

  const handleDeleteSession = useCallback(async (
    sessionId: string,
    sessionPath: string,
  ) => {
    try {
      // Draft sessions (path === '') have no disk file — just remove locally
      if (sessionPath) {
        await bridge.deleteSession(sessionId, sessionPath);
      } else {
        // Remove draft from session list directly
        useSessionStore.getState().removeDraft(sessionId);
      }
      if (selectedId === sessionId) {
        setSelected('');
        useChatStore.getState().resetSession();
        useSettingsStore.getState().setWorkingDirectory('');
      }
      // Also remove from chat cache so it doesn't linger
      useChatStore.getState().removeFromCache(sessionId);
      fetchSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [selectedId, setSelected, fetchSessions]);

  const handleLoadSession = useCallback(async (
    sessionPath: string,
    sessionId: string,
    projectOrDir: string,
  ) => {
    const currentTabId = selectedId;

    // Don't reload if already selected
    if (currentTabId === sessionId) return;

    // 1) Save current session state to cache (preserve messages & running process)
    if (currentTabId) {
      useChatStore.getState().saveToCache(currentTabId);
      useAgentStore.getState().saveToCache(currentTabId);
    }

    // 2) Close file preview if open
    useFileStore.getState().closePreview();

    // 3) Switch selection
    setSelected(sessionId);

    // 3) Try restoring from cache first (covers draft sessions & previously viewed sessions)
    const restored = useChatStore.getState().restoreFromCache(sessionId);
    if (restored) {
      // Restore agents for this session
      useAgentStore.getState().restoreFromCache(sessionId);
      // Restore working directory for cached session
      if (projectOrDir) {
        useSettingsStore.getState().setWorkingDirectory(resolveProjectPath(projectOrDir));
      }
      return;
    }

    // 4) Draft sessions with no path — just reset for a fresh chat
    if (!sessionPath) {
      useChatStore.getState().resetSession();
      useAgentStore.getState().clearAgents();
      return;
    }

    // 5) Load historical session from disk (first time opening)
    useSettingsStore.getState().setWorkingDirectory(resolveProjectPath(projectOrDir));

    const { clearMessages, addMessage, setSessionStatus, setSessionMeta } = useChatStore.getState();
    const agentActions = useAgentStore.getState();
    clearMessages();
    agentActions.clearAgents();
    setSessionStatus('running');
    setSessionMeta({ sessionId: sessionId });

    try {
      const rawMessages = await bridge.loadSession(sessionPath);

      // First pass: create main agent with session start time
      const firstMsg = rawMessages[0];
      const sessionStartTime = firstMsg?.timestamp
        ? new Date(firstMsg.timestamp).getTime()
        : Date.now();
      agentActions.upsertAgent({
        id: 'main',
        parentId: null,
        description: 'Main',
        phase: 'completed',
        startTime: sessionStartTime,
        endTime: Date.now(),
        isMain: true,
      });

      // Detect system-injected content that should not be shown to users
      const isSystemText = (text: string): boolean => {
        const t = text.trimStart();
        return t.startsWith('<')                            // XML tags like <system-reminder>
          || t.startsWith('This session is being continued') // continuation summaries
          || /^Analysis:\s*\n/.test(t)                       // continuation analysis blocks
          || /^Summary:\s*\n/.test(t)                        // continuation summary blocks
          || t.startsWith('In this environment you have access to') // tool definitions
          || t.startsWith('Human:')                          // raw conversation format leaks
          || t.includes('<system-reminder>')                 // embedded system reminders
          || t.includes('</system-reminder>');
      };

      for (const msg of rawMessages) {
        // Skip system-injected meta messages (skill content, image descriptions, etc.)
        if (msg.isMeta) continue;

        // Handle tool_result messages: attach result to parent tool_use card
        if (msg.toolUseResult || msg.type === 'tool_result') {
          const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
          for (const b of blocks) {
            if (b?.type === 'tool_result' && b.tool_use_id) {
              const resultText = typeof b.content === 'string'
                ? b.content
                : Array.isArray(b.content)
                  ? b.content.map((c: any) => c.text || c.content || '').join('')
                  : '';
              if (resultText) {
                const { updateMessage } = useChatStore.getState();
                updateMessage(b.tool_use_id, { toolResultContent: resultText });
              }
            }
          }
          continue;
        }

        if (msg.type === 'human' || msg.type === 'user' || msg.role === 'user') {
          // Extract text blocks, filtering out system-injected content
          const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
          const userTexts: string[] = [];
          for (const b of blocks) {
            const text = typeof b === 'string' ? b : b?.type === 'text' ? b.text : '';
            if (text && !isSystemText(text)) userTexts.push(text);
          }
          // Fallback for plain string content
          if (blocks.length === 0 && typeof msg.message?.content === 'string') {
            const text = msg.message.content;
            if (!isSystemText(text)) userTexts.push(text);
          }
          let content = userTexts.join('');
          // Extract file attachments from text (e.g. "[附加的文件]\n/path1\n/path2")
          const attachments: Array<{ name: string; path: string; isImage: boolean }> = [];
          const attachRegex = /\n?\n?\[(?:附加的文件|Attached files)\]\n([\s\S]+)$/;
          const attachMatch = content.match(attachRegex);
          if (attachMatch) {
            content = content.slice(0, attachMatch.index!).trimEnd();
            const paths = attachMatch[1].split('\n').map(p => p.trim()).filter(Boolean);
            for (const p of paths) {
              const name = p.split(/[\\/]/).pop() || p;
              const ext = name.split('.').pop()?.toLowerCase() || '';
              const isImage = ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext);
              attachments.push({ name, path: p, isImage });
            }
          }
          if (content.trim()) {
            addMessage({
              id: msg.uuid || generateMessageId(),
              role: 'user',
              type: 'text',
              content,
              timestamp: msg.timestamp || Date.now(),
              attachments: attachments.length > 0 ? attachments : undefined,
            });
          }
        } else if (msg.type === 'assistant') {
          const blocks = msg.message?.content;
          if (Array.isArray(blocks)) {
            for (const block of blocks) {
              if (block.type === 'text') {
                // Filter out system-injected content
                if (isSystemText(block.text || '')) continue;
                addMessage({
                  id: msg.uuid || generateMessageId(),
                  role: 'assistant',
                  type: 'text',
                  content: block.text,
                  timestamp: msg.timestamp || Date.now(),
                });
              } else if (block.type === 'tool_use') {
                // Rebuild agent tree from Task tool_use blocks
                if (block.name === 'Task') {
                  agentActions.upsertAgent({
                    id: block.id || generateMessageId(),
                    parentId: 'main',
                    description: block.input?.description || block.input?.prompt || 'Agent',
                    phase: 'completed',
                    startTime: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                    endTime: Date.now(),
                    isMain: false,
                  });
                }
                if (block.name === 'AskUserQuestion' && block.input?.questions) {
                  addMessage({
                    id: block.id || generateMessageId(),
                    role: 'assistant',
                    type: 'question',
                    content: '',
                    toolName: block.name,
                    toolInput: block.input,
                    questions: block.input.questions,
                    resolved: true,
                    timestamp: msg.timestamp || Date.now(),
                  });
                } else if (block.name === 'TodoWrite' && block.input?.todos) {
                  addMessage({
                    id: block.id || generateMessageId(),
                    role: 'assistant',
                    type: 'todo',
                    content: '',
                    toolName: block.name,
                    toolInput: block.input,
                    todoItems: block.input.todos,
                    timestamp: msg.timestamp || Date.now(),
                  });
                } else {
                  addMessage({
                    id: block.id || generateMessageId(),
                    role: 'assistant',
                    type: 'tool_use',
                    content: '',
                    toolName: block.name,
                    toolInput: block.input,
                    timestamp: msg.timestamp || Date.now(),
                  });
                }
              } else if (block.type === 'tool_result') {
                const resultText = Array.isArray(block.content)
                  ? block.content.map((b: any) => b.text || b.content || '').join('')
                  : typeof block.content === 'string'
                    ? block.content
                    : block.output || '';
                if (block.tool_use_id && resultText) {
                  const { updateMessage } = useChatStore.getState();
                  updateMessage(block.tool_use_id, { toolResultContent: resultText });
                }
              } else if (block.type === 'thinking') {
                addMessage({
                  id: generateMessageId(),
                  role: 'assistant',
                  type: 'thinking',
                  content: block.thinking || '',
                  timestamp: msg.timestamp || Date.now(),
                });
              }
            }
          }
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

  // --- Context menu handlers ---

  const handleContextMenu = useCallback((e: React.MouseEvent, session: SessionListItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  }, []);

  const handleRenameStart = useCallback((session: SessionListItem) => {
    setContextMenu(null);
    setRenamingId(session.id);
    setRenameValue(customPreviews[session.id] || session.preview || '');
  }, [customPreviews]);

  const handleRenameConfirm = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      setCustomPreview(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, setCustomPreview]);

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const handleRevealInFinder = useCallback((session: SessionListItem) => {
    setContextMenu(null);
    if (session.path) {
      bridge.revealInFinder(session.path).catch(() => {});
    }
  }, []);

  const handleExportMarkdown = useCallback(async (session: SessionListItem) => {
    setContextMenu(null);
    if (!session.path) return;
    const outputPath = await save({
      defaultPath: `${session.id}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (outputPath) {
      bridge.exportSessionMarkdown(session.path, outputPath).catch(() => {});
    }
  }, []);

  const handleDeleteFromMenu = useCallback((session: SessionListItem) => {
    setContextMenu(null);
    handleDeleteSession(session.id, session.path);
  }, [handleDeleteSession]);

  // --- Project context menu handlers ---
  const handleProjectContextMenu = useCallback((e: React.MouseEvent, project: string) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectMenu({ x: e.clientX, y: e.clientY, project });
  }, []);

  const handleNewSessionInProject = useCallback((project: string) => {
    setProjectMenu(null);
    const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    useSettingsStore.getState().setWorkingDirectory(project);
    useChatStore.getState().resetSession();
    useSessionStore.getState().addDraftSession(draftId, project);
  }, []);

  const handleDeleteAllInProject = useCallback(async (project: string) => {
    // Close menu first, then confirm — avoids stale menu staying open
    setProjectMenu(null);

    // Use sessions from store directly (filtered may be stale in closure)
    const allSessions = useSessionStore.getState().sessions;
    const projectSessions = allSessions.filter((s) => {
      const raw = s.project || s.projectDir;
      // Inline normalize: replace home path with ~ for consistent matching
      const home = _cachedHomeDir;
      const key = home && raw.startsWith(home) ? '~' + raw.slice(home.length) : raw;
      return key === project;
    });
    if (projectSessions.length === 0) return;

    const ok = confirm(
      `确定删除「${projectLabel(project)}」下的全部 ${projectSessions.length} 个任务吗？此操作不可撤销。`
    );
    if (!ok) return;

    for (const session of projectSessions) {
      await handleDeleteSession(session.id, session.path);
    }
    fetchSessions();
  }, [handleDeleteSession, fetchSessions]);

  // Collapsed project groups state
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((project: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  }, []);

  // Normalize project key: replace full home path with ~ for consistent grouping
  const normalizeProjectKey = useCallback((raw: string) => {
    // Unix:    /Users/foo/bar → ~/bar  or  /home/foo/bar → ~/bar
    // Windows: C:\Users\foo\bar → ~\bar
    const unix = raw.match(/^\/(?:Users|home)\/[^/]+(\/.*)/);
    if (unix) return '~' + unix[1];
    const win = raw.match(/^[A-Za-z]:[/\\]Users[/\\][^/\\]+([/\\].*)/i);
    if (win) return '~' + win[1];
    return raw;
  }, []);

  // Group sessions by project, sorted by most recent activity
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
  }, [filtered, normalizeProjectKey]);

  const projectLabel = (project: string) => {
    const parts = project.replace(/^~[\\/]/, '').split(/[\\/]/);
    return parts[parts.length - 1] || project;
  };

  return (
    <div className="flex flex-col gap-1 px-3">
      {/* Search */}
      <div className="px-1 mb-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl
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
      </div>

      {/* Loading — only shown on initial load when no data yet */}
      {isLoading && sessions.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-accent/30
            border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {/* Project groups */}
      {projectGroups.map(([project, items]) => {
        const isCollapsed = collapsed.has(project);
        return (
          <div key={project} className="mb-1">
            {/* Project header — collapsible */}
            <button
              onClick={() => toggleCollapse(project)}
              onContextMenu={(e) => handleProjectContextMenu(e, project)}
              className="w-full flex items-center gap-2 px-3 py-1.5
                hover:bg-bg-secondary rounded-lg transition-smooth group"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.5"
                className={`text-accent transition-transform
                  ${isCollapsed ? '' : 'rotate-90'}`}>
                <path d="M3 1l4 4-4 4" />
              </svg>
              <span className="text-[13px] font-extrabold text-text-primary
                truncate flex-1 text-left">
                {projectLabel(project)}
              </span>
              <span className="text-[11px] text-text-tertiary flex-shrink-0">
                {items.length} {t('conv.sessions')}
              </span>
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); handleNewSessionInProject(project); }}
                className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
                  hover:bg-bg-tertiary transition-smooth text-text-tertiary hover:text-accent"
                title={t('conv.newChat')}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </span>
            </button>
            {/* Project path */}
            {!isCollapsed && project !== projectLabel(project) && (
              <div className="px-7 pb-0.5">
                <span className="text-[10px] text-text-tertiary truncate block">
                  {project}
                </span>
              </div>
            )}
            {/* Sessions */}
            {!isCollapsed && items.map((session) => (
              <button
                key={session.id}
                onClick={() => handleLoadSession(session.path, session.id, session.project || session.projectDir)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRenameStart(session);
                }}
                onContextMenu={(e) => handleContextMenu(e, session)}
                className={`w-full text-left pl-7 pr-3 py-1.5 rounded-xl
                  transition-smooth group
                  ${selectedId === session.id
                    ? 'bg-accent/10 ring-1 ring-accent/20'
                    : 'hover:bg-bg-secondary'
                  }`}
              >
                <div className="flex items-center gap-2">
                  {renamingId === session.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameConfirm();
                        if (e.key === 'Escape') handleRenameCancel();
                      }}
                      onBlur={handleRenameConfirm}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-text-primary leading-snug font-normal
                        flex-1 min-w-0 bg-bg-secondary border border-border-focus rounded-md
                        px-1.5 py-0.5 outline-none"
                    />
                  ) : (
                    <div className={`text-xs truncate leading-snug font-normal flex-1 min-w-0
                      ${displayName(session) ? 'text-text-primary' : 'text-text-muted italic'}`}>
                      {displayName(session)
                        || (session.path === '' ? t('conv.newChat') : t('conv.empty'))}
                    </div>
                  )}
                  <span className="text-[10px] text-text-tertiary flex-shrink-0">
                    {formatRelativeTime(session.modifiedAt)}
                  </span>
                  {/* Blinking working indicator — shown when session is running in background */}
                  {runningSessions.has(session.id) && (
                    <span className="flex-shrink-0 w-2 h-2 rounded-full bg-success
                      shadow-[0_0_6px_var(--color-accent-glow)]
                      animate-pulse-soft" />
                  )}
                </div>
              </button>
            ))}
          </div>
        );
      })}

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

      {/* Context menu — rendered via portal to escape overflow-hidden + backdrop-filter ancestors */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[160px] py-1.5 rounded-xl
            bg-bg-card border border-border-subtle shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => handleRenameStart(contextMenu.session)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5
              text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
            </svg>
            {t('conv.rename')}
          </button>
          {contextMenu.session.path && (
            <button
              onClick={() => handleRevealInFinder(contextMenu.session)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5
                text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 4h4l2 2h6v7H2V4z" />
              </svg>
              {t('conv.revealInFinder')}
            </button>
          )}
          {contextMenu.session.path && (
            <button
              onClick={() => handleExportMarkdown(contextMenu.session)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5
                text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 14h8M8 2v9M5 8l3 3 3-3" />
              </svg>
              {t('conv.export')}
            </button>
          )}
          <div className="my-1 border-t border-border-subtle" />
          <button
            onClick={() => handleDeleteFromMenu(contextMenu.session)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5
              text-xs text-red-500 hover:bg-red-500/10 transition-smooth"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
            </svg>
            {t('conv.delete')}
          </button>
        </div>,
        document.body
      )}

      {/* Project context menu */}
      {projectMenu && createPortal(
        <div
          ref={projectMenuRef}
          className="fixed z-[9999] min-w-[160px] py-1.5 rounded-xl
            bg-bg-card border border-border-subtle shadow-xl"
          style={{ left: projectMenu.x, top: projectMenu.y }}
        >
          <button
            onClick={() => handleNewSessionInProject(projectMenu.project)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5
              text-xs text-text-primary hover:bg-bg-secondary transition-smooth"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            {t('conv.newChat')}
          </button>
          <div className="my-1 border-t border-border-subtle" />
          <button
            onClick={() => handleDeleteAllInProject(projectMenu.project)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5
              text-xs text-red-500 hover:bg-red-500/10 transition-smooth"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
            </svg>
            删除全部任务
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
