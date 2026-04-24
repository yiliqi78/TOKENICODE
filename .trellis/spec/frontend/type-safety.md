# Type Safety

> TypeScript type patterns and conventions in TOKENICODE.

---

## Overview

TOKENICODE uses **TypeScript 5.8 strict mode**. Types are co-located with their domain — no central `types/` directory. The IPC bridge (`tauri-bridge.ts`) serves as the type boundary between frontend and Rust backend.

---

## Type Organization

| Where | What goes there | Example |
|-------|----------------|---------|
| `stores/*.ts` | Domain types used by store + consumers | `ChatMessage`, `SessionStatus`, `ApiProvider` |
| `lib/tauri-bridge.ts` | IPC request/response types (Rust <-> TS boundary) | `StartSessionParams`, `SessionListItem`, `FileNode` |
| `lib/*.ts` | Types specific to a utility module | `Turn`, `CodeChange`, `ModelResolution` |
| `hooks/*.ts` | Types exported from hooks | `FileAttachment`, `RewindAction` |
| `components/*/` | Component-local types (Props interfaces) | `interface Props`, `ConfirmDialogProps` |

### Rules

- **Types live where they're defined** — no shared `types/` folder
- **Export types from their source module** — consumers import from there
- Domain types (ChatMessage, SessionMeta) belong in the store that owns them

---

## Type Definitions

### Use `interface` for object shapes

```tsx
// interface for objects
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'tool_use' | 'thinking';
  content: string;
  timestamp: number;
}

// interface for props
interface Props {
  message: ChatMessage;
  disabled?: boolean;
}
```

### Use `type` for unions and aliases

```tsx
// type for union literals
export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';
export type ActivityPhase = 'idle' | 'thinking' | 'writing' | 'tool' | 'awaiting';

// type for computed types
export type ModelResolution = { resolved: string; env: Record<string, string> }
  | { error: string };
```

### Use `const` arrays for runtime + type

```tsx
// When you need both runtime array and type
export const MODEL_OPTIONS: { id: ModelId; label: string; short: string }[] = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', short: 'Opus 4.6' },
  // ...
];
```

### Provider model display helpers

When provider model mappings affect multiple UI surfaces, derive display options in `lib/api-provider.ts` and export the option shape from that module. Do not rebuild labels independently inside components.

```tsx
export interface ModelDisplayOption {
  id: string;
  label: string;
  short: string;
  mapped: boolean;
  isExtra: boolean;
  providerModel?: string;
  sourceTier?: string;
}

const options = getModelDisplayOptions(activeProvider);
const selectedOptionId = getSelectedModelOptionId(selectedModel, options);
```

Provider-specific non-Claude mappings must display only configured provider model names, without appending Claude tier labels such as `(Opus 4.7)`. Components such as `GeneralTab` and `ModelSelector` should consume `ModelDisplayOption` directly so selection, labels, and deduplication stay consistent.

---

## IPC Type Boundary

`tauri-bridge.ts` is the single source of truth for frontend <-> backend types:

```tsx
// Types mirror the Rust struct fields — snake_case for IPC params
export interface StartSessionParams {
  prompt: string;
  cwd: string;
  model?: string;
  session_id?: string;          // Keep snake_case — matches Rust struct
  resume_session_id?: string;
  permission_mode?: string;
}

// Bridge methods are typed with invoke<T>
export const bridge = {
  startSession: (params: StartSessionParams) =>
    invoke<SessionInfo>('start_claude_session', { params }),

  readFileContent: (path: string) =>
    invoke<string>('read_file_content', { path }),
};
```

**IPC params use snake_case** (matching Rust structs via serde). Internal TypeScript uses camelCase.

This is the critical type boundary: the snake_case convention ensures the TypeScript interface stays aligned with the Rust `#[derive(Deserialize)]` struct fields. Do not convert IPC param fields to camelCase — it will break deserialization on the Rust side.

---

## Generic Patterns

### Zustand selector with tab awareness

```tsx
export function useActiveTab<T>(selector: (tab: TabSession) => T): T {
  return useChatStore((state) => {
    const tabId = useSessionStore.getState().selectedSessionId;
    const tab = tabId ? state.tabs.get(tabId) : undefined;
    return selector(tab ?? DEFAULT_TAB);
  });
}
```

### Event listener with typed payload

```tsx
export function onClaudeStream(
  stdinId: string,
  handler: (event: { payload: string }) => void,
): Promise<UnlistenFn> {
  return listen<string>(`claude:stream:${stdinId}`, handler);
}
```

---

## `any` Usage Policy

Strict mode is on, but `any` exists in specific situations:

| Acceptable | Example |
|-----------|---------|
| CLI stream JSON parsing | `useStreamProcessor.ts` — NDJSON events have dynamic shapes |
| Tauri plugin handles | `useAutoUpdateCheck.ts` — update handle type is opaque |
| Test mocks | `as ChatMessage` in test factories |
| Third-party interop | TipTap extension types |

### Rules

- **Prefer specific types or `unknown`** over `any`
- **Use `@ts-expect-error` over `@ts-ignore`** — expect-error fails if the error is fixed
- **Never let `any` leak into exported interfaces** — keep it internal to implementation
- **Limit scope** — if `any` is needed, constrain it to the smallest possible expression

---

## Validation

No runtime validation library (no Zod, no Yup). Type safety is enforced at compile time.

Runtime checks exist at system boundaries:

```tsx
// Stream event parsing — runtime shape check
function handleStreamMessage(event: { payload: string }) {
  const parsed = JSON.parse(event.payload);
  if (parsed.type === 'text_delta') { ... }
  if (parsed.type === 'message_start') { ... }
}

// Provider config — structural checks before use
if (!provider.baseUrl || provider.modelMappings.length === 0) {
  return { error: 'Invalid provider config' };
}
```

---

## Forbidden Patterns

1. **Untyped function parameters** — all functions must have typed params (strict mode enforces this)
2. **`any` in exported interfaces** — use specific types or `unknown`
3. **`@ts-ignore`** — use `@ts-expect-error` instead (breaks when the underlying issue is fixed)
4. **Central `types/` directory** — types belong with their domain module
5. **Duplicating Rust types manually** — define them once in `tauri-bridge.ts`, import everywhere
6. **`as` type assertion for normal flow** — only in tests or genuinely unavoidable cases
7. **`enum`** — use union types (`type X = 'a' | 'b'`) instead (smaller bundle, better inference)
