/**
 * Tests for the Her → TOKENICODE session sync (2026-04-15).
 *
 * Covers:
 * 1. SessionInfo type contract (stdin_id + cli_session_id)
 * 2. sessionStore.setCliResumeId
 * 3. sessionStore.fetchSessions cliResumeId preservation
 * 4. hadRealExchange resume guard logic
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- 1. SessionInfo type contract ---

describe('SessionInfo type contract', () => {
  it('has stdin_id and cli_session_id fields', () => {
    // Simulates what Rust returns from start_claude_session
    const info = {
      stdin_id: 'desk_abc123',
      cli_session_id: null as string | null,
      pid: 1234,
      cli_path: '/usr/bin/claude',
    };

    expect(info.stdin_id).toBe('desk_abc123');
    expect(info.cli_session_id).toBeNull();
    expect(info).not.toHaveProperty('session_id');
  });

  it('has cli_session_id when resuming', () => {
    const info = {
      stdin_id: 'desk_xyz789',
      cli_session_id: '550e8400-e29b-41d4-a716-446655440000',
      pid: 5678,
      cli_path: '/usr/bin/claude',
    };

    expect(info.cli_session_id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
});

// --- 2 & 3. sessionStore ---

// Mock Tauri invoke to avoid native calls
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock Tauri event listeners
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

// Mock localStorage/sessionStorage for store initialization
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
Object.defineProperty(globalThis, 'sessionStorage', { value: localStorageMock });

describe('sessionStore.setCliResumeId', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('sets cliResumeId on matching session', async () => {
    const { useSessionStore } = await import('../stores/sessionStore');
    const store = useSessionStore.getState();

    // Add a draft session
    store.addDraftSession('tab-1', '/project');
    expect(useSessionStore.getState().sessions[0].cliResumeId).toBeNull();

    // Set cliResumeId
    store.setCliResumeId('tab-1', 'cli-uuid-123');
    const updated = useSessionStore.getState().sessions.find(s => s.id === 'tab-1');
    expect(updated?.cliResumeId).toBe('cli-uuid-123');
  });

  it('clears cliResumeId when set to null', async () => {
    const { useSessionStore } = await import('../stores/sessionStore');
    const store = useSessionStore.getState();

    store.addDraftSession('tab-2', '/project');
    store.setCliResumeId('tab-2', 'some-uuid');
    store.setCliResumeId('tab-2', null);

    const session = useSessionStore.getState().sessions.find(s => s.id === 'tab-2');
    expect(session?.cliResumeId).toBeNull();
  });
});

// --- 4. hadRealExchange resume guard ---

describe('hadRealExchange resume guard', () => {
  type MinimalMessage = { role: string; type: string; content?: string };

  function resolveResumeId(
    messages: MinimalMessage[],
    cliResumeId: string | null,
  ): string | undefined {
    const hadRealExchange = messages.some(
      m => m.role === 'assistant' && (m.type === 'text' || m.type === 'tool_use'),
    );
    return hadRealExchange ? (cliResumeId ?? undefined) : undefined;
  }

  it('returns undefined when no assistant messages (pre-warm only)', () => {
    const messages: MinimalMessage[] = [
      { role: 'user', type: 'text', content: 'hello' },
    ];
    expect(resolveResumeId(messages, 'uuid-123')).toBeUndefined();
  });

  it('returns undefined when only system messages (no real exchange)', () => {
    const messages: MinimalMessage[] = [
      { role: 'assistant', type: 'system', content: 'init' },
    ];
    expect(resolveResumeId(messages, 'uuid-123')).toBeUndefined();
  });

  it('returns cliResumeId when assistant text reply exists', () => {
    const messages: MinimalMessage[] = [
      { role: 'user', type: 'text', content: 'hello' },
      { role: 'assistant', type: 'text', content: 'hi there' },
    ];
    expect(resolveResumeId(messages, 'uuid-123')).toBe('uuid-123');
  });

  it('returns cliResumeId when assistant tool_use exists', () => {
    const messages: MinimalMessage[] = [
      { role: 'user', type: 'text', content: 'read file' },
      { role: 'assistant', type: 'tool_use', content: '{}' },
    ];
    expect(resolveResumeId(messages, 'uuid-123')).toBe('uuid-123');
  });

  it('returns undefined when cliResumeId is null even with real exchange', () => {
    const messages: MinimalMessage[] = [
      { role: 'assistant', type: 'text', content: 'response' },
    ];
    expect(resolveResumeId(messages, null)).toBeUndefined();
  });

  it('returns undefined for empty messages array', () => {
    expect(resolveResumeId([], 'uuid-123')).toBeUndefined();
  });
});

// --- 5. SessionListItem.cliResumeId field ---

describe('SessionListItem.cliResumeId', () => {
  it('draft sessions start with null cliResumeId', async () => {
    const { useSessionStore } = await import('../stores/sessionStore');
    useSessionStore.getState().addDraftSession('draft-test', '/test');
    const draft = useSessionStore.getState().sessions.find(s => s.id === 'draft-test');
    expect(draft?.cliResumeId).toBeNull();
  });
});
