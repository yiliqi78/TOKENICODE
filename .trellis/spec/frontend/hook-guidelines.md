# Hook Guidelines

> How custom hooks are structured and used in TOKENICODE.

---

## Overview

TOKENICODE uses custom hooks for **feature orchestration** and **event processing**. No data fetching library (no React Query, SWR) — data flows through Tauri bridge + Zustand stores.

---

## Hook Categories

| Category | Examples | Pattern |
|----------|----------|---------|
| Stream / event processing | `useStreamProcessor` | Listen to Tauri events, buffer updates, write to stores |
| Feature orchestration | `useRewind`, `useFileAttachments` | Coordinate multiple stores + bridge calls for a feature |
| Polling / timer | `useAutoUpdateCheck` | Periodic checks with interval cleanup |
| Effect-only | `useAutoUpdateCheck` | Pure side-effect, returns `void` |
| Placeholder | `useRemoteSession` | Reserved for future feature, minimal implementation |

---

## Hook Inventory

| Hook | LOC | Purpose |
|------|-----|---------|
| `useStreamProcessor` | ~2,000+ | NDJSON stream handling — foreground + background tab routing, message parsing, agent tracking |
| `useFileAttachments` | ~300 | File upload via picker + drag-drop (OS native + browser fallback) |
| `useRewind` | ~250 | Rewind orchestration — kill, truncate, checkpoint restore via CLI |
| `useAutoUpdateCheck` | ~50 | Periodic update check via tauri-plugin-updater |
| `useRemoteSession` | ~10 | Placeholder for remote session feature |

---

## File Structure

```tsx
// 1. Imports
import { useState, useCallback, useEffect } from 'react';
import { bridge } from '../lib/tauri-bridge';
import { useChatStore } from '../stores/chatStore';

// 2. Exported types (if the hook defines public types)
export interface FileAttachment {
  id: string;
  name: string;
  path: string;
}

// 3. Module-level state (non-serializable, shared across instances)
let _lastDropTime = 0;
const _streamBuffers = new Map<string, StreamBuffer>();

// 4. Helper functions (pure logic, no hooks)
function buildToolSummary(messages: ChatMessage[]): string { ... }

// 5. Hook function
export function useFeatureName(): ReturnType {
  // state, refs, callbacks, effects
}
```

---

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Hook file | `use` + PascalCase `.ts` | `useStreamProcessor.ts` |
| Hook function | `use` + PascalCase | `useStreamProcessor()` |
| Return type (complex) | `Use` + Name + `Return` | `UseRewindReturn` |
| Exported types | PascalCase | `FileAttachment`, `RewindAction` |

One hook per file. Tests go in `__tests__/`.

---

## Return Value Patterns

### Effect-only hook — returns void

```tsx
// Used for side-effects only (timers, event listeners)
export function useAutoUpdateCheck(): void {
  useEffect(() => {
    const timer = setInterval(doCheck, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
```

### Feature hook — returns typed object

```tsx
export function useRewind() {
  const messages = useActiveTab((t) => t.messages);
  const turns = useMemo(() => parseTurns(messages), [messages]);
  const canRewind = turns.length >= 1 && sessionStatus !== 'running';

  const executeRewind = useCallback(async (action: RewindAction, turn: Turn) => {
    // ...
  }, []);

  return { turns, showRewind, canRewind, executeRewind };
}
```

### Stream processor — returns control handles

```tsx
export function useStreamProcessor(tabId: string, stdinId: string | null) {
  // Sets up Tauri event listeners, writes to chatStore/agentStore
  // No explicit return — communicates through stores
}
```

---

## Module-Level State

Use module-level variables (not `useRef`) for state that:
- Must be shared across multiple hook instances
- Is non-serializable (handles, timers, buffers)
- Needs to survive component re-mounts

```tsx
// Module-level — shared across all instances, survives unmount
let _updateHandle: any = null;
const _streamBuffers = new Map<string, StreamBuffer>();
let _lastDropTime = 0;

// useRef — per-instance, survives re-renders but not unmount
const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

---

## Event Listener Pattern (Tauri)

```tsx
export function useStreamProcessor(/* ... */) {
  useEffect(() => {
    // Subscribe to Tauri events
    const unlistenStream = onClaudeStream(stdinId, handleStreamMessage);
    const unlistenStderr = onClaudeStderr(stdinId, handleStderrMessage);

    // Cleanup — always unlisten
    return () => {
      unlistenStream.then((fn) => fn());
      unlistenStderr.then((fn) => fn());
    };
  }, [stdinId]);
}
```

---

## High-Frequency Update Pattern (rAF throttling)

For streams that fire faster than 60fps, coalesce updates:

```tsx
// Per-session buffer to prevent cross-contamination
const _streamBuffers = new Map<string, StreamBuffer>();

function _scheduleStreamFlush(stdinId: string) {
  const buf = _getBuffer(stdinId);
  if (buf.raf) return; // already scheduled
  buf.raf = requestAnimationFrame(() => {
    buf.raf = 0;
    // Batch-apply accumulated text to store
    useChatStore.getState().appendPartialText(tabId, buf.text);
    buf.text = '';
  });
}
```

---

## Data Fetching

No library. Direct bridge calls in hooks:

```tsx
// In event handlers (useCallback)
const handleSave = useCallback(async () => {
  await bridge.writeFileContent(path, content);
}, [path, content]);

// In effects (for initial load / polling)
useEffect(() => {
  bridge.listSessions().then(setSessions);
}, []);
```

For polling, use `setInterval` with cleanup:

```tsx
useEffect(() => {
  const timer = setInterval(doCheck, CHECK_INTERVAL);
  return () => clearInterval(timer);
}, []);
```

---

## Common Mistakes

1. **Creating wrapper hooks for store selectors** — just use `useXxxStore((s) => s.field)` directly in components
2. **Forgetting effect cleanup** — always return unlisten/clearInterval/clearTimeout
3. **Using `useRef` for cross-instance state** — use module-level variables instead
4. **Missing `useCallback` on returned functions** — causes unnecessary re-renders in consumers
5. **Not scoping buffers per-session** — leads to cross-tab contamination in multi-session streaming
6. **Subscribing to Tauri events without stdinId guard** — will receive events from all sessions
