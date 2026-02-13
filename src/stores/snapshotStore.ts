/**
 * snapshotStore — manages file snapshots for each conversation turn.
 *
 * Before each turn (user sends message), InputBar captures the current
 * working directory state via git diff + file reads. When the user
 * rewinds and chooses "restore code", these snapshots restore files.
 *
 * Strategy:
 *   1. On submit → git diff --name-only to list dirty files
 *   2. Read their content via snapshot_files bridge
 *   3. During the turn, track new files (from Write tool_use)
 *   4. On restore → write back snapshot contents, delete created files
 */
import { create } from 'zustand';
import { bridge } from '../lib/tauri-bridge';

export interface TurnSnapshot {
  /** User message ID that starts this turn */
  userMessageId: string;
  /** File path → file content at the start of this turn */
  fileContents: Record<string, string>;
  /** Files created during this turn (didn't exist before) */
  createdFiles: string[];
  /** Git HEAD SHA at snapshot time (for reference) */
  headSha: string;
  /** Timestamp */
  timestamp: number;
}

interface SnapshotState {
  snapshots: Map<string, TurnSnapshot>;
  /** The user message ID of the currently running turn */
  currentTurnId: string | null;

  /** Create a snapshot of the working directory state */
  captureSnapshot: (userMessageId: string, cwd: string) => Promise<void>;
  /** Record that a file was created during the current turn */
  recordCreatedFile: (filePath: string) => void;
  /** Record a file's pre-edit content (for files not captured at snapshot time) */
  recordFileContent: (filePath: string, content: string) => void;
  /** Restore code to a specific turn's snapshot state */
  restoreToSnapshot: (userMessageId: string) => Promise<void>;
  /** Get a snapshot by user message ID */
  getSnapshot: (userMessageId: string) => TurnSnapshot | undefined;
  /** Get all snapshots between two turns (for cumulative restore) */
  getSnapshotsBetween: (fromId: string, toId: string | null) => TurnSnapshot[];
  /** Clear all snapshots */
  clearSnapshots: () => void;
  /** Set current turn ID */
  setCurrentTurnId: (id: string | null) => void;
}

export const useSnapshotStore = create<SnapshotState>()((set, get) => ({
  snapshots: new Map(),
  currentTurnId: null,

  captureSnapshot: async (userMessageId, cwd) => {
    try {
      // 1. Get HEAD SHA for reference
      let headSha = '';
      try {
        headSha = (await bridge.runGitCommand(cwd, ['rev-parse', 'HEAD'])).trim();
      } catch {
        // Not a git repo — snapshots won't work, but don't crash
      }

      // 2. Get list of all dirty files (modified + staged + untracked)
      const dirtyFiles: string[] = [];
      try {
        const modified = await bridge.runGitCommand(cwd, ['diff', '--name-only']);
        const staged = await bridge.runGitCommand(cwd, ['diff', '--cached', '--name-only']);
        const untracked = await bridge.runGitCommand(cwd, [
          'diff', '--name-only', '--diff-filter=A', 'HEAD',
        ]).catch(() => '');

        const allPaths = [...modified.split('\n'), ...staged.split('\n'), ...untracked.split('\n')]
          .map((p) => p.trim())
          .filter(Boolean);

        // Convert relative paths to absolute
        for (const rel of new Set(allPaths)) {
          dirtyFiles.push(cwd.endsWith('/') ? `${cwd}${rel}` : `${cwd}/${rel}`);
        }
      } catch {
        // Git not available — no dirty files to snapshot
      }

      // 3. Read file contents
      let fileContents: Record<string, string> = {};
      if (dirtyFiles.length > 0) {
        try {
          fileContents = await bridge.snapshotFiles(dirtyFiles);
        } catch {
          // Fallback: empty snapshot
        }
      }

      const snapshot: TurnSnapshot = {
        userMessageId,
        fileContents,
        createdFiles: [],
        headSha,
        timestamp: Date.now(),
      };

      const next = new Map(get().snapshots);
      next.set(userMessageId, snapshot);
      set({ snapshots: next, currentTurnId: userMessageId });
    } catch (err) {
      console.warn('[snapshotStore] Failed to capture snapshot:', err);
    }
  },

  recordCreatedFile: (filePath) => {
    const { currentTurnId, snapshots } = get();
    if (!currentTurnId) return;

    const snap = snapshots.get(currentTurnId);
    if (!snap) return;
    if (snap.createdFiles.includes(filePath)) return;

    // If the file was already in the snapshot's fileContents, it existed before
    // this turn — it's being overwritten, not created. Don't mark it for deletion.
    if (filePath in snap.fileContents) return;

    const next = new Map(snapshots);
    next.set(currentTurnId, {
      ...snap,
      createdFiles: [...snap.createdFiles, filePath],
    });
    set({ snapshots: next });
  },

  recordFileContent: (filePath, content) => {
    const { currentTurnId, snapshots } = get();
    if (!currentTurnId) return;

    const snap = snapshots.get(currentTurnId);
    if (!snap) return;
    if (filePath in snap.fileContents) return; // already recorded

    const next = new Map(snapshots);
    next.set(currentTurnId, {
      ...snap,
      fileContents: { ...snap.fileContents, [filePath]: content },
    });
    set({ snapshots: next });
  },

  restoreToSnapshot: async (userMessageId) => {
    const snap = get().snapshots.get(userMessageId);
    if (!snap) {
      console.warn('[snapshotStore] No snapshot found for', userMessageId);
      return;
    }

    // Collect all files that need to be restored and all files created
    // across all turns from the target turn onwards
    const allTurnIds = Array.from(get().snapshots.keys());
    const targetIdx = allTurnIds.indexOf(userMessageId);
    if (targetIdx === -1) return;

    // Merge all created files from target turn and later
    const allCreatedFiles = new Set<string>();
    for (let i = targetIdx; i < allTurnIds.length; i++) {
      const s = get().snapshots.get(allTurnIds[i]);
      if (s) {
        for (const f of s.createdFiles) allCreatedFiles.add(f);
      }
    }

    // Safety: never delete files that were in the original snapshot (they existed before)
    for (const fp of Object.keys(snap.fileContents)) {
      allCreatedFiles.delete(fp);
    }

    try {
      await bridge.restoreSnapshot(
        snap.fileContents,
        Array.from(allCreatedFiles),
      );
    } catch (err) {
      console.error('[snapshotStore] Failed to restore snapshot:', err);
      throw err;
    }
  },

  getSnapshot: (userMessageId) => get().snapshots.get(userMessageId),

  getSnapshotsBetween: (fromId, toId) => {
    const allIds = Array.from(get().snapshots.keys());
    const fromIdx = allIds.indexOf(fromId);
    const toIdx = toId ? allIds.indexOf(toId) : allIds.length;
    if (fromIdx === -1) return [];
    return allIds.slice(fromIdx, toIdx)
      .map((id) => get().snapshots.get(id))
      .filter(Boolean) as TurnSnapshot[];
  },

  clearSnapshots: () => set({ snapshots: new Map(), currentTurnId: null }),

  setCurrentTurnId: (id) => set({ currentTurnId: id }),
}));
