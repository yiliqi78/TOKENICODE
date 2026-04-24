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

## Stream Thinking Reconciliation

`useStreamProcessor` and `StreamController` share ownership of visible thinking state:

- Live thinking renders from `chatStore.partialThinking`.
- Committed thinking renders as a `ChatMessage` with `type: 'thinking'`.
- `StreamController` may still hold an unflushed thinking tail in its stdin-scoped buffer.

Do not let more than one of those sources remain visible for the same assistant turn. Before committing a final thinking snapshot, merge:

```ts
resolveThinkingPersistence(
  msg.uuid,
  content,
  currentTab?.partialThinking,
  streamController.peekBufferedThinking(stdinId),
);
```

After the commit succeeds, clear both live and buffered thinking:

```ts
commitThinkingBeforeAssistantText({ tabId, msgUuid: msg.uuid, thinkingPersistence, stdinId, timestamp });
```

That helper must clear `chatStore.partialThinking` and `streamController.clearThinking(stdinId)`. Otherwise a late rAF/interval flush can recreate a second live "thinking" block after the committed thinking message is already visible.

Text buffers are different: do not clear pending text just because a thinking snapshot arrived. Use `streamController.clearThinking(stdinId)` when only thinking is committed, and reserve `streamController.clearPartial(stdinId)` for final text/result boundaries that supersede both text and thinking.

Pure thinking-only assistant snapshots are not a commit boundary when partial messages are enabled. Merge them into live `partialThinking` until the stream reaches text, tool/todo, result, or process-exit boundaries. Committing pure thinking snapshots early can be followed by later `thinking_delta` events and produce a duplicate live block beside the historical message. Dropping them is also wrong: some provider/CLI paths may send thinking in assistant snapshots without matching `thinking_delta` events.

Raw live thinking delta appends must preserve exact stream bytes, including repeated adjacent chunks. Do not dedupe in `chatStore.updatePartialThinking`; stream deltas are not word-boundary aligned, and even exact repeated chunks can be valid output. Snapshot-tail suppression must be scoped to the reconciliation path that just preserved a pure thinking-only assistant snapshot.

Effective thinking level is a display contract, not just a spawn contract. If `getEffectiveThinking(tab.sessionMeta) === 'off'`, ignore provider/CLI `thinking_delta` events, skip final `content[].type === 'thinking'` materialization, clear live/buffered thinking, and keep activity in `writing` rather than `thinking`. This is required because Anthropic-compatible API providers can emit visible thinking even after the backend passed `alwaysThinkingEnabled:false`.

`AskUserQuestion` is a text boundary, but not a thinking boundary. When it materializes from either `tokenicode_permission_request` or assistant `tool_use`, clear same-turn `partialText` and flush/drop its text buffer so hidden raw question wording cannot reappear after the user answers. Preserve or commit thinking separately.

Result-only fallbacks must commit any live/buffered thinking before terminal status cleanup clears partials. This preserves reasoning for providers that emit thinking deltas but finish with only a `result` payload.

rAF flushes must delete empty per-stdin buffers after text/thinking is drained; otherwise the fallback interval can keep waking up with no work during awaiting/tool states.

## Stream Interrupt Recovery Contract

### 1. Scope / Trigger

This contract applies whenever a user stops an in-flight CLI/provider turn and then sends another message in the same tab. It covers `InputBar`, `useStreamProcessor`, `sessionLifecycle`, `chatStore.sessionMeta`, and `sessionStore` stdin routing.

### 2. Signatures

- `SessionMeta.turnAcceptedForResume?: boolean`
- `SessionMeta.pendingTurnMessageId?: string`
- `SessionMeta.pendingTurnInput?: string`
- `SessionMeta.teardownReason?: 'stop' | 'rewind' | 'plan-approve' | 'delete' | 'switch'`
- `handleProcessExitFinalize(stdinId: string, isTimeout?: boolean): void`
- `getRecentlyFinalizedStdin(stdinId: string): { tabId: string; reason?: TeardownReason; finalizedAt: number } | undefined`
- `useSessionStore.getState().getTabForStdin(stdinId): string | undefined`

### 3. Contracts

- A send marks the turn as pending with `turnAcceptedForResume: false`.
- Any assistant-side stream evidence must set `turnAcceptedForResume: true`, including hidden thinking, `message_start`, `message_delta`, `content_block_start`, `content_block_delta`, `content_block_stop`, `assistant`, and direct `content_block_delta` payloads.
- Stop finalization must record a short-lived stdin tombstone before clearing the stdin route. Late stop/result events use that tombstone to finalize as `stopped`, not as a generic error.
- Resume selection must only pass a CLI resume id when the tab has visible assistant evidence or `turnAcceptedForResume === true`.
- Draft promotion may move the active tab id from `draft_*` to the CLI uuid. After promotion, all remaining same-turn metadata writes must target the current stdin owner, not the stale draft id.
- Explicit stop may remove an unacknowledged pending user message and restore it to input draft. Tests must not require the cancelled first turn to stay in the transcript unless assistant evidence was accepted.

### 4. Validation & Error Matrix

| Event sequence | Expected status | Expected next send |
|----------------|-----------------|--------------------|
| stop before assistant evidence | `stopped`; pending input restored to draft | fresh send in same tab; no `--resume` from a desk id |
| stop after thinking evidence, visible or hidden | `stopped`; resume evidence kept | next send resumes same CLI conversation |
| stop after provider body text | `stopped`; late provider result ignored or classified as user stop | next send completes; no `API 响应异常中断` |
| late non-success `result` after route cleanup | `stopped` through recent-finalized tombstone | no toast/error path |
| draft `system:init` promotion | promoted real tab id receives ready/meta writes | no duplicate sidebar conversation |

### 5. Good/Base/Bad Cases

- Good: `turnAcceptedForResume` is set from protocol evidence, not provider/model names.
- Good: late stop results are classified by `teardownReason`, recent-finalized stdin, or `subtype === 'user_abort'`.
- Base: system configuration stop during writing may restore the interrupted input to the editor and leave only the second exchange in messages.
- Bad: `result` after user Stop falls through to generic provider error handling.
- Bad: post-spawn metadata clears `sessionMeta.sessionId` on a promoted tab because it still writes to the stale draft id.

### 6. Tests Required

- Unit-test hidden/provider thinking evidence setting `turnAcceptedForResume`.
- Unit-test stop timeout with `teardownReason: 'stop'` resolves to `stopped`.
- Regression-test promoted draft post-spawn metadata writes to `getTabForStdin(stdinId)`.
- E2E-test API provider stop during thinking and writing, followed by a short second send.
- E2E-test system configuration stop during thinking and writing, but assert the second user/assistant exchange and same-tab continuity rather than requiring the cancelled first turn to remain visible.

### 7. Wrong vs Correct

#### Wrong

```ts
const hadRealExchange = messages.some((m) => m.role === 'assistant' && m.type === 'text');
const existingSessionId = hadRealExchange ? sessionMeta.sessionId : undefined;
```

This misses hidden thinking and provider stream events that establish a real CLI conversation.

#### Correct

```ts
const hasResumableEvidence =
  hasResumableConversationEvidence(messages)
  || sessionMeta.turnAcceptedForResume === true;
const existingSessionId = hasResumableEvidence ? sessionMeta.sessionId : undefined;
```

Resume is gated by actual assistant-side stream evidence, including evidence that may not be displayed.

## API Retry Indicator Contract

### 1. Scope / Trigger

This contract applies to CLI/provider retry events that arrive as `system.subtype === 'api_retry'`, including provider HTTP 429/rate-limit retries.

### 2. Signatures

- `ApiRetryStatus` in `src/lib/api-retry.ts`
- `SessionMeta.apiRetry?: ApiRetryStatus`
- `buildApiRetryStatus(message: unknown, now?: number): ApiRetryStatus`
- `isRateLimitRetry(status?: ApiRetryStatus): boolean`
- `formatRetryDelaySeconds(ms?: number): string | undefined`
- `formatElapsedCompact(ms: number): string` in `src/lib/elapsed-time.ts`

### 3. Contracts

- `api_retry` must update one transient `sessionMeta.apiRetry` slot. Do not append chat bubbles for every retry attempt.
- Foreground and background stream handlers must both preserve retry metadata.
- Retry metadata must clear on normal assistant progress, `result`, `process_exit`, and system error/init events.
- `rate_limit_event` remains separate from `api_retry`; do not regress `sessionMeta.rateLimits`.
- Activity UI may display retry status while the turn is running, but it must not change provider retry policy or synthesize assistant text.
- Elapsed-time formatting must clamp negative or non-finite durations to `0s`. UI clocks are display data, not evidence that a turn really started in the future.

### 4. Validation & Error Matrix

| Event sequence | Expected metadata | Expected UI |
|----------------|-------------------|-------------|
| `api_retry` attempt 1 | `sessionMeta.apiRetry.attempt === 1` | one retry indicator |
| `api_retry` attempt 2 | same metadata slot updated | no duplicate messages |
| 429/rate-limit retry | `isRateLimitRetry() === true` | rate-limit copy |
| retry followed by `content_block_delta` | `apiRetry: undefined` | retry indicator clears |
| retry followed by `result`/error/exit | `apiRetry: undefined` | terminal state/error owns UI |
| future `turnStartTime` | elapsed formatter returns `0s` | never shows `-1s`/`-1 秒` |

### 5. Tests Required

- Parse direct and nested retry payload shapes.
- Verify repeated retry events coalesce into one metadata slot.
- Verify clear-boundary classification for content, assistant, result, and process exit.
- Verify elapsed formatter clamps negative and non-finite durations.
- Run an app-level `.test` that injects `api_retry` while a turn is active and asserts visible retry copy.

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
