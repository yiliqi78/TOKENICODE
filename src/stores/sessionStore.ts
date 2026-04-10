import { create } from 'zustand';
import { bridge, SessionListItem, ContentSearchResult } from '../lib/tauri-bridge';

// --- Orphan drain callback ---
// useStreamProcessor exports drainOrphanBuffer(), but sessionStore can't import
// it directly (circular dependency). Instead, useStreamProcessor registers its
// drain function at module init via setOrphanDrainCallback(). registerStdinTab
// then calls it so text that arrived before the mapping existed is flushed.
let _orphanDrainCallback: ((stdinId: string, tabId: string) => void) | null = null;
export function setOrphanDrainCallback(cb: (stdinId: string, tabId: string) => void) {
  _orphanDrainCallback = cb;
}

// Persist custom session names in localStorage as fast cache,
// and sync to disk via Tauri backend for durability.
const CUSTOM_PREVIEWS_KEY = 'tokenicode_custom_previews';
const LAST_SESSION_KEY = 'tokenicode_last_session';
const STDIN_TO_TAB_KEY = 'tokenicode_stdinToTab';

function loadCustomPreviewsSync(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_PREVIEWS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCustomPreviewsLocal(map: Record<string, string>) {
  localStorage.setItem(CUSTOM_PREVIEWS_KEY, JSON.stringify(map));
}

/** Persist the last active session ID so app restart can auto-restore */
function saveLastSessionId(id: string | null) {
  if (id && !id.startsWith('draft_')) {
    sessionStorage.setItem(LAST_SESSION_KEY, id);
  }
}

function loadLastSessionId(): string | null {
  return sessionStorage.getItem(LAST_SESSION_KEY);
}

/** Persist stdinToTab across page refreshes using sessionStorage.
 *  sessionStorage survives same-window refreshes but clears on app restart,
 *  which is exactly the right scope for process-lifetime mappings. */
function loadStdinToTabSync(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STDIN_TO_TAB_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveStdinToTab(map: Record<string, string>) {
  sessionStorage.setItem(STDIN_TO_TAB_KEY, JSON.stringify(map));
}

interface SessionState {
  sessions: SessionListItem[];
  isLoading: boolean;
  searchQuery: string;
  selectedSessionId: string | null;
  /** Previously selected session ID, for Ctrl+Tab quick switch */
  previousSessionId: string | null;
  /** Custom display names keyed by session ID, persisted to disk */
  customPreviews: Record<string, string>;
  /** Track which sessions are actively running (streaming/working) */
  runningSessions: Set<string>;
  /** Map stdinId → tabId so stream events can be routed to the correct session */
  stdinToTab: Record<string, string>;
  /** Content search results keyed by session ID */
  contentSearchResults: Map<string, ContentSearchResult>;
  isContentSearching: boolean;
  contentSearchQuery: string;

  fetchSessions: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedSession: (id: string | null) => void;
  /** Insert a temporary "draft" session at the top of the list */
  addDraftSession: (id: string, projectPath: string) => void;
  /** Update an existing draft session's project path (e.g. after folder selection) */
  updateDraftProject: (id: string, projectPath: string) => void;
  /** Set a custom display name for a session */
  setCustomPreview: (sessionId: string, name: string) => void;
  /** Get the display name for a session (custom > preview > fallback) */
  getDisplayName: (session: SessionListItem) => string;
  /** Mark a session as running (actively streaming/working) */
  setSessionRunning: (sessionId: string, running: boolean) => void;
  /** Check if a session is currently running */
  isSessionRunning: (sessionId: string) => boolean;
  /** Register a stdinId → tabId mapping (persisted to sessionStorage) */
  registerStdinTab: (stdinId: string, tabId: string) => void;
  /** Remove a stdinId mapping on process exit (cleans sessionStorage too) */
  unregisterStdinTab: (stdinId: string) => void;
  /** Look up which tabId owns a given stdinId */
  getTabForStdin: (stdinId: string) => string | undefined;
  /** Remove a draft session from the local list (no disk deletion needed) */
  removeDraft: (draftId: string) => void;
  /** Promote a draft session to a real session ID (when CLI returns the actual UUID).
   *  Updates session id, selectedSessionId, stdinToTab mapping, and runningSessions. */
  promoteDraft: (oldDraftId: string, newRealId: string) => void;
  /** Switch to the previously selected session (Ctrl+Tab) */
  switchToPrevious: () => void;
  /** Load custom previews from backend (called once on init) */
  loadCustomPreviewsFromDisk: () => Promise<void>;
  /** Get the last active session ID from localStorage (for app restart recovery) */
  getLastSessionId: () => string | null;
  /** Search session content via backend */
  searchSessionContent: (query: string) => Promise<void>;
  /** Clear content search results */
  clearContentSearch: () => void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  isLoading: false,
  searchQuery: '',
  selectedSessionId: null,
  previousSessionId: null,
  customPreviews: loadCustomPreviewsSync(),
  runningSessions: new Set<string>(),
  stdinToTab: loadStdinToTabSync(),
  contentSearchResults: new Map<string, ContentSearchResult>(),
  isContentSearching: false,
  contentSearchQuery: '',

  fetchSessions: async () => {
    const isFirstLoad = get().sessions.length === 0;
    if (isFirstLoad) set({ isLoading: true });
    try {
      const diskSessions = await bridge.listSessions();
      // Preserve draft sessions (path === '') that haven't been written to disk yet
      const drafts = get().sessions.filter(
        (s) => s.path === '' && !diskSessions.some((d) => d.id === s.id),
      );
      set({ sessions: [...drafts, ...diskSessions], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedSession: (id) => {
    saveLastSessionId(id);
    set((state) => ({
      selectedSessionId: id,
      previousSessionId: state.selectedSessionId !== id ? state.selectedSessionId : state.previousSessionId,
    }));
  },

  addDraftSession: (id, projectPath) => set((state) => {
    const projectDir = projectPath.replace(/\//g, '-');
    const draft: SessionListItem = {
      id,
      path: '',
      project: projectPath,
      projectDir,
      modifiedAt: Date.now(),
      preview: '',
    };
    return {
      sessions: [draft, ...state.sessions],
      selectedSessionId: id,
    };
  }),

  updateDraftProject: (id, projectPath) => set((state) => ({
    sessions: state.sessions.map((s) =>
      s.id === id
        ? { ...s, project: projectPath, projectDir: projectPath.replace(/\//g, '-'), modifiedAt: Date.now() }
        : s,
    ),
  })),

  setCustomPreview: (sessionId, name) => {
    const updated = { ...get().customPreviews, [sessionId]: name };
    // Fast local cache
    saveCustomPreviewsLocal(updated);
    set({ customPreviews: updated });
    // Persist to disk via backend (fire-and-forget)
    bridge.saveCustomPreviews(updated).catch(() => {});
  },

  getDisplayName: (session) => {
    const custom = get().customPreviews[session.id];
    return custom || session.preview || '';
  },

  setSessionRunning: (sessionId, running) => set((state) => {
    const next = new Set(state.runningSessions);
    if (running) next.add(sessionId);
    else next.delete(sessionId);
    return { runningSessions: next };
  }),

  isSessionRunning: (sessionId) => get().runningSessions.has(sessionId),

  registerStdinTab: (stdinId, tabId) => {
    const next = { ...get().stdinToTab, [stdinId]: tabId };
    saveStdinToTab(next);
    set({ stdinToTab: next });
    // Drain any orphaned stream buffer that arrived before this mapping existed
    _orphanDrainCallback?.(stdinId, tabId);
  },

  unregisterStdinTab: (stdinId) => {
    const { [stdinId]: _, ...rest } = get().stdinToTab;
    saveStdinToTab(rest);
    set({ stdinToTab: rest });
  },

  getTabForStdin: (stdinId) => get().stdinToTab[stdinId],

  removeDraft: (draftId) => set((state) => ({
    sessions: state.sessions.filter((s) => s.id !== draftId),
  })),

  promoteDraft: (oldDraftId, newRealId) => {
    saveLastSessionId(newRealId);
    set((state) => {
    // 1) Rename session in the list
    const sessions = state.sessions.map((s) =>
      s.id === oldDraftId ? { ...s, id: newRealId } : s,
    );

    // 2) Update selectedSessionId if it was the draft
    const selectedSessionId = state.selectedSessionId === oldDraftId
      ? newRealId
      : state.selectedSessionId;

    // 3) Migrate runningSessions
    const runningSessions = new Set(state.runningSessions);
    if (runningSessions.has(oldDraftId)) {
      runningSessions.delete(oldDraftId);
      runningSessions.add(newRealId);
    }

    // 4) Migrate stdinToTab entries that pointed to oldDraftId
    const stdinToTab = { ...state.stdinToTab };
    for (const [k, v] of Object.entries(stdinToTab)) {
      if (v === oldDraftId) stdinToTab[k] = newRealId;
    }

    // 5) Migrate previousSessionId if it was the draft
    const previousSessionId = state.previousSessionId === oldDraftId
      ? newRealId
      : state.previousSessionId;

    // 6) Migrate customPreviews if the old draft had a custom name
    const customPreviews = { ...state.customPreviews };
    if (customPreviews[oldDraftId]) {
      customPreviews[newRealId] = customPreviews[oldDraftId];
      delete customPreviews[oldDraftId];
      saveCustomPreviewsLocal(customPreviews);
      bridge.saveCustomPreviews(customPreviews).catch(() => {});
    }

    saveStdinToTab(stdinToTab);
    return { sessions, selectedSessionId, previousSessionId, runningSessions, stdinToTab, customPreviews };
  });
  },

  switchToPrevious: () => {
    const { previousSessionId, selectedSessionId, sessions } = get();
    if (!previousSessionId || previousSessionId === selectedSessionId) return;
    // Verify the previous session still exists
    const exists = sessions.some((s) => s.id === previousSessionId);
    if (!exists) return;
    set({
      selectedSessionId: previousSessionId,
      previousSessionId: selectedSessionId,
    });
  },

  loadCustomPreviewsFromDisk: async () => {
    try {
      const diskPreviews = await bridge.loadCustomPreviews();
      // Merge: disk data takes precedence, but keep any localStorage-only entries
      const localPreviews = get().customPreviews;
      const merged = { ...localPreviews, ...diskPreviews };
      saveCustomPreviewsLocal(merged);
      set({ customPreviews: merged });
    } catch {
      // Silently fall back to localStorage data
    }
  },

  getLastSessionId: () => loadLastSessionId(),

  searchSessionContent: async (query: string) => {
    set({ isContentSearching: true, contentSearchQuery: query });
    try {
      const results = await bridge.searchSessions(query);
      // Stale check: discard if query has changed while awaiting
      if (get().contentSearchQuery !== query) return;
      const map = new Map<string, ContentSearchResult>();
      for (const r of results) {
        map.set(r.session_id, r);
      }
      set({ contentSearchResults: map, isContentSearching: false });
    } catch {
      set({ isContentSearching: false });
    }
  },

  clearContentSearch: () => {
    set({
      contentSearchResults: new Map<string, ContentSearchResult>(),
      isContentSearching: false,
      contentSearchQuery: '',
    });
  },
}));
