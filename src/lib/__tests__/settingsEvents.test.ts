/**
 * Phase B · B10 — settings event bus.
 *
 * Regression guarded here:
 *   Before this bus existed, settingsStore.setSelectedModel / setThinkingLevel
 *   / setSessionMode were pure state writes. Running streams that had already
 *   captured a turn-start snapshot never learned the user had changed the
 *   setting, so the next retry/resume still used the stale value.
 *
 *   Roadmap §4.3.5 — settingsStore 事件化. This file pins down the contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Install an in-memory localStorage stub BEFORE settingsStore is imported —
// zustand/persist captures the storage reference at module initialization.
// vi.hoisted runs before ESM import resolution, which is the only place this
// setup can land in time.
vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
    configurable: true,
  });
});

vi.mock('../tauri-bridge', () => ({
  bridge: {
    listSessions: vi.fn(() => Promise.resolve([])),
    loadCustomPreviews: vi.fn(() => Promise.resolve({})),
    saveCustomPreviews: vi.fn(() => Promise.resolve()),
    setPermissionMode: vi.fn(() => Promise.resolve()),
  },
}));

// settingsStore subscribes to sessionMode changes and dynamically imports
// chatStore + sessionStore to push set_permission_mode to the live CLI session.
// In unit-test environment those dynamic imports can resolve AFTER the test
// environment is torn down, which surfaces as an unhandled rejection. Stub the
// transitive modules so the promise chain resolves synchronously with no-ops.
vi.mock('../../stores/chatStore', () => ({
  useChatStore: { getState: () => ({ setSessionMeta: () => {} }) },
  getActiveTabState: () => ({ sessionMeta: {} }),
}));
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      getSessionByStdinId: () => undefined,
      selectedSessionId: null,
    }),
  },
}));

import { settingsEvents } from '../settingsEvents';
import { useSettingsStore } from '../../stores/settingsStore';

describe('settingsEvents · emitter contract', () => {
  beforeEach(() => {
    settingsEvents._reset();
  });

  it('on/off round-trip: unsubscribe stops subsequent calls', () => {
    const handler = vi.fn();
    const off = settingsEvents.on('model-changed', handler);
    settingsEvents.emit('model-changed', { old: 'a', next: 'b' });
    off();
    settingsEvents.emit('model-changed', { old: 'b', next: 'c' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ old: 'a', next: 'b' });
  });

  it('a throwing handler does not break other listeners', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    settingsEvents.on('thinking-changed', bad);
    settingsEvents.on('thinking-changed', good);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    settingsEvents.emit('thinking-changed', { old: 'off', next: 'high' });
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('events stay typed and independent per channel', () => {
    const modelH = vi.fn();
    const thinkingH = vi.fn();
    settingsEvents.on('model-changed', modelH);
    settingsEvents.on('thinking-changed', thinkingH);
    settingsEvents.emit('model-changed', { old: 'x', next: 'y' });
    expect(modelH).toHaveBeenCalledTimes(1);
    expect(thinkingH).not.toHaveBeenCalled();
  });
});

describe('settingsStore setters · emit on change', () => {
  beforeEach(() => {
    settingsEvents._reset();
  });

  it('setSelectedModel fires model-changed with old+next', () => {
    const h = vi.fn();
    settingsEvents.on('model-changed', h);
    const initial = useSettingsStore.getState().selectedModel;
    useSettingsStore.getState().setSelectedModel('claude-haiku-4-5-20251001');
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith({ old: initial, next: 'claude-haiku-4-5-20251001' });
    // Restore
    useSettingsStore.getState().setSelectedModel(initial);
  });

  it('setSelectedModel does NOT fire if value is unchanged', () => {
    const h = vi.fn();
    const current = useSettingsStore.getState().selectedModel;
    settingsEvents.on('model-changed', h);
    useSettingsStore.getState().setSelectedModel(current);
    expect(h).not.toHaveBeenCalled();
  });

  it('setThinkingLevel fires thinking-changed', () => {
    const h = vi.fn();
    settingsEvents.on('thinking-changed', h);
    const initial = useSettingsStore.getState().thinkingLevel;
    const next = initial === 'high' ? 'low' : 'high';
    useSettingsStore.getState().setThinkingLevel(next);
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith({ old: initial, next });
    useSettingsStore.getState().setThinkingLevel(initial);
  });

  it('setSessionMode fires session-mode-changed', () => {
    const h = vi.fn();
    settingsEvents.on('session-mode-changed', h);
    const initial = useSettingsStore.getState().sessionMode;
    const next = initial === 'code' ? 'ask' : 'code';
    useSettingsStore.getState().setSessionMode(next);
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith({ old: initial, next });
    useSettingsStore.getState().setSessionMode(initial);
  });
});
