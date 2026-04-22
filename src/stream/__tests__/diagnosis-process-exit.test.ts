/**
 * Diagnosis: process_exit handler stdinId race simulation
 *
 * This test simulates the exact code flow in useStreamProcessor.ts
 * handleStreamMessage → process_exit case, to verify the stdinId race bug.
 *
 * The bug: when an old process exits after a new one was spawned,
 * the foreground handler resolves tabId via fallback to activeTabId
 * (because old stdinId was already unregistered), then incorrectly
 * sets the active tab to 'idle' — killing the new session.
 */
import { describe, it, expect } from 'vitest';

// Simulate the minimal state needed
interface TabState {
  sessionStatus: string;
  stdinId: string | undefined;
  messages: Array<{ role: string; type: string }>;
}

interface SimState {
  tabs: Map<string, TabState>;
  stdinToTab: Record<string, string>;
  selectedSessionId: string | null;
}

function createSimState(): SimState {
  return {
    tabs: new Map(),
    stdinToTab: {},
    selectedSessionId: null,
  };
}

/**
 * Simulates the tabId resolution logic from useStreamProcessor.ts:735-752
 */
function resolveTabId(state: SimState, msgStdinId: string | undefined): string | undefined {
  const ownerTabId = msgStdinId ? state.stdinToTab[msgStdinId] : undefined;
  const activeTabId = state.selectedSessionId;
  const isBackground = ownerTabId && ownerTabId !== activeTabId;

  if (isBackground) {
    return ownerTabId; // background handler
  }

  // Foreground: ownerTabId || activeTabId
  return ownerTabId || activeTabId || undefined;
}

/**
 * Simulates the process_exit handler logic from useStreamProcessor.ts:1909+
 * (WITHOUT the stdinId guard that's missing on main)
 */
function handleProcessExitBuggy(state: SimState, msg: { __stdinId?: string }) {
  const tabId = resolveTabId(state, msg.__stdinId);
  if (!tabId) return;

  const tab = state.tabs.get(tabId);
  if (!tab) return;

  // This is what the buggy code does: set idle + clear stdinId unconditionally
  tab.sessionStatus = 'idle';
  tab.stdinId = undefined;

  // Unregister stdinToTab
  if (msg.__stdinId) {
    delete state.stdinToTab[msg.__stdinId];
  }
}

/**
 * Simulates the FIXED process_exit handler (with stdinId guard)
 */
function handleProcessExitFixed(state: SimState, msg: { __stdinId?: string }) {
  const tabId = resolveTabId(state, msg.__stdinId);
  if (!tabId) return;

  const tab = state.tabs.get(tabId);
  if (!tab) return;

  // GUARD: check if this exit belongs to the current session
  const currentStdinId = tab.stdinId;
  if (currentStdinId && msg.__stdinId && currentStdinId !== msg.__stdinId) {
    // Stale exit — ignore
    return;
  }

  tab.sessionStatus = 'idle';
  tab.stdinId = undefined;

  if (msg.__stdinId) {
    delete state.stdinToTab[msg.__stdinId];
  }
}

describe('process_exit stdinId race: buggy vs fixed', () => {
  it('BUG: old process exit incorrectly sets active tab to idle', () => {
    const state = createSimState();

    // Setup: Tab A is active, new process running
    state.tabs.set('tabA', {
      sessionStatus: 'running',
      stdinId: 'new_002',
      messages: [{ role: 'user', type: 'text' }],
    });
    state.stdinToTab['new_002'] = 'tabA';
    state.selectedSessionId = 'tabA';

    // Old process "old_001" was already unregistered when killed
    // Now it sends process_exit

    // Resolve tabId for old_001:
    // stdinToTab['old_001'] = undefined → ownerTabId = undefined
    // isBackground = false (ownerTabId is falsy)
    // tabId = ownerTabId || activeTabId = 'tabA'  ← WRONG!
    handleProcessExitBuggy(state, { __stdinId: 'old_001' });

    // THE BUG: tabA was set to idle even though its actual stdinId is new_002
    expect(state.tabs.get('tabA')?.sessionStatus).toBe('idle'); // ← this is the bug
    expect(state.tabs.get('tabA')?.stdinId).toBeUndefined();    // ← stdinId wiped
    // New process is now orphaned — it's still running but frontend thinks session is idle
  });

  it('FIXED: stdinId guard correctly ignores stale process exit', () => {
    const state = createSimState();

    state.tabs.set('tabA', {
      sessionStatus: 'running',
      stdinId: 'new_002',
      messages: [{ role: 'user', type: 'text' }],
    });
    state.stdinToTab['new_002'] = 'tabA';
    state.selectedSessionId = 'tabA';

    // Old process sends exit — but with the guard, it checks:
    // currentStdinId='new_002' !== msg.__stdinId='old_001' → ignore
    handleProcessExitFixed(state, { __stdinId: 'old_001' });

    // Session remains running
    expect(state.tabs.get('tabA')?.sessionStatus).toBe('running');
    expect(state.tabs.get('tabA')?.stdinId).toBe('new_002');
  });

  it('FIXED: current process exit correctly sets tab to idle', () => {
    const state = createSimState();

    state.tabs.set('tabA', {
      sessionStatus: 'running',
      stdinId: 'current_001',
      messages: [{ role: 'user', type: 'text' }],
    });
    state.stdinToTab['current_001'] = 'tabA';
    state.selectedSessionId = 'tabA';

    // Current process exits normally
    handleProcessExitFixed(state, { __stdinId: 'current_001' });

    // Correctly set to idle
    expect(state.tabs.get('tabA')?.sessionStatus).toBe('idle');
    expect(state.tabs.get('tabA')?.stdinId).toBeUndefined();
  });

  it('BUG: race window between kill and new spawn', () => {
    const state = createSimState();

    // Step 1: Session running with old process
    state.tabs.set('tabA', {
      sessionStatus: 'running',
      stdinId: 'old_001',
      messages: [{ role: 'user', type: 'text' }],
    });
    state.stdinToTab['old_001'] = 'tabA';
    state.selectedSessionId = 'tabA';

    // Step 2: User switches Provider → InputBar kills old, clears stdinId
    delete state.stdinToTab['old_001'];
    state.tabs.get('tabA')!.stdinId = undefined; // cleared by setSessionMeta

    // Step 3: Before new process spawns, old process exit arrives
    // At this point: tab.stdinId = undefined, msg.__stdinId = 'old_001'
    // In buggy code: tabId resolves to activeTabId = 'tabA' (because stdinToTab['old_001'] is gone)
    handleProcessExitBuggy(state, { __stdinId: 'old_001' });

    // Bug: tab is now idle before new process even starts
    expect(state.tabs.get('tabA')?.sessionStatus).toBe('idle');

    // Step 4: New process would need to override this, but InputBar sets 'running'
    // again during spawn. If the timing is tight, there's a visible flash of 'idle'.

    // With the FIXED version, the guard checks:
    // currentStdinId = undefined (was cleared in step 2)
    // Guard: if (currentStdinId && ...) → currentStdinId is undefined → guard doesn't fire
    // This means the fix needs to be: if no currentStdinId and msg has stdinId,
    // check if msg.__stdinId is still in stdinToTab. If not, it's stale → ignore.
  });

  it('COMPREHENSIVE FIX: check stdinToTab mapping existence', () => {
    // The proper fix is: if stdinToTab[msg.__stdinId] doesn't map to this tab,
    // the exit is stale and should be ignored.
    function handleProcessExitComprehensive(state: SimState, msg: { __stdinId?: string }) {
      const msgStdinId = msg.__stdinId;

      // Guard 1: if msg has a stdinId, check if it maps to a known tab
      if (msgStdinId) {
        const mappedTab = state.stdinToTab[msgStdinId];
        // If mapping doesn't exist → stale exit from a killed process
        if (!mappedTab) {
          return; // ignore
        }
      }

      const tabId = resolveTabId(state, msgStdinId);
      if (!tabId) return;

      const tab = state.tabs.get(tabId);
      if (!tab) return;

      // Guard 2: if tab has a different stdinId, this exit is from an old process
      if (tab.stdinId && msgStdinId && tab.stdinId !== msgStdinId) {
        return;
      }

      tab.sessionStatus = 'idle';
      tab.stdinId = undefined;

      if (msgStdinId) {
        delete state.stdinToTab[msgStdinId];
      }
    }

    const state = createSimState();

    state.tabs.set('tabA', {
      sessionStatus: 'running',
      stdinId: undefined, // cleared during provider switch
      messages: [{ role: 'user', type: 'text' }],
    });
    state.selectedSessionId = 'tabA';
    // old_001 already unregistered from stdinToTab

    // Old process exit → stdinToTab['old_001'] doesn't exist → ignore
    handleProcessExitComprehensive(state, { __stdinId: 'old_001' });

    // Tab stays running (not clobbered)
    expect(state.tabs.get('tabA')?.sessionStatus).toBe('running');
  });
});
