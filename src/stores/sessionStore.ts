import { create } from 'zustand';
import { bridge, SessionListItem } from '../lib/tauri-bridge';

// Persist custom session names in localStorage
const CUSTOM_PREVIEWS_KEY = 'tokenicode_custom_previews';

function loadCustomPreviews(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_PREVIEWS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCustomPreviews(map: Record<string, string>) {
  localStorage.setItem(CUSTOM_PREVIEWS_KEY, JSON.stringify(map));
}

interface SessionState {
  sessions: SessionListItem[];
  isLoading: boolean;
  searchQuery: string;
  selectedSessionId: string | null;
  /** Custom display names keyed by session ID, persisted in localStorage */
  customPreviews: Record<string, string>;
  /** Track which sessions are actively running (streaming/working) */
  runningSessions: Set<string>;
  /** Map stdinId → tabId so stream events can be routed to the correct session */
  stdinToTab: Record<string, string>;

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
  /** Register a stdinId → tabId mapping */
  registerStdinTab: (stdinId: string, tabId: string) => void;
  /** Look up which tabId owns a given stdinId */
  getTabForStdin: (stdinId: string) => string | undefined;
  /** Remove a draft session from the local list (no disk deletion needed) */
  removeDraft: (draftId: string) => void;
  /** Promote a draft session to a real session ID (when CLI returns the actual UUID).
   *  Updates session id, selectedSessionId, stdinToTab mapping, and runningSessions. */
  promoteDraft: (oldDraftId: string, newRealId: string) => void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  isLoading: false,
  searchQuery: '',
  selectedSessionId: null,
  customPreviews: loadCustomPreviews(),
  runningSessions: new Set<string>(),
  stdinToTab: {},

  fetchSessions: async () => {
    set({ isLoading: true });
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

  setSelectedSession: (id) => set({ selectedSessionId: id }),

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
    saveCustomPreviews(updated);
    set({ customPreviews: updated });
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

  registerStdinTab: (stdinId, tabId) => set((state) => ({
    stdinToTab: { ...state.stdinToTab, [stdinId]: tabId },
  })),

  getTabForStdin: (stdinId) => get().stdinToTab[stdinId],

  removeDraft: (draftId) => set((state) => ({
    sessions: state.sessions.filter((s) => s.id !== draftId),
  })),

  promoteDraft: (oldDraftId, newRealId) => set((state) => {
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

    return { sessions, selectedSessionId, runningSessions, stdinToTab };
  }),
}));
