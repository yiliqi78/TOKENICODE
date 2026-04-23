# State Management

> How state is managed in TOKENICODE.

---

## Overview

TOKENICODE uses **Zustand 5** with independent stores — no single root store, no Redux, no context-heavy patterns. Each store owns a specific domain. Cross-store reads use `getState()`.

---

## Store Inventory

| Store | Domain | Persistence | Tab-aware |
|-------|--------|-------------|-----------|
| `chatStore` | Messages, streaming, per-tab session data | No | Yes (Map\<tabId, TabSession\>) |
| `sessionStore` | Session list, selection, stdinId routing | No (names to disk) | No |
| `settingsStore` | Theme, color theme, locale, model, mode, thinking level, layout, font size, update state | Yes (localStorage via `persist`) | No |
| `fileStore` | File tree, preview, edit buffer, changed files, drag-drop state | No | No |
| `agentStore` | Agent tree, phase tracking | No | Yes (saveToCache/restoreFromCache) |
| `commandStore` | Unified commands list, prefix mode | No | No |
| `skillStore` | Skills CRUD, enable/disable, content editing | No | No |
| `mcpStore` | MCP servers from ~/.claude.json | No | No |
| `providerStore` | API providers, model mappings, active provider | Yes (disk via Rust backend) | No |
| `setupStore` | CLI install wizard state | No | No |

---

## Store File Structure

```tsx
import { create } from 'zustand';

// 1. Types — exported for use by components and hooks
export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  // ...
}

// 2. State + Actions interface
interface ChatState {
  tabs: Map<string, TabSession>;
  addMessage: (tabId: string, message: ChatMessage) => void;
  // ...
}

// 3. Helper functions (module-level, before store creation)
function generateId(): string { ... }

// 4. Store creation
export const useChatStore = create<ChatState>()((set, get) => ({
  tabs: new Map(),

  addMessage: (tabId, message) => {
    const tabs = new Map(get().tabs);
    const tab = tabs.get(tabId);
    if (!tab) return;
    tabs.set(tabId, { ...tab, messages: [...tab.messages, message] });
    set({ tabs });
  },
}));
```

---

## State Categories

### What goes where

| State type | Location | Example |
|-----------|----------|---------|
| Per-session data | `chatStore` (TabSession) | Messages, streaming state, session meta |
| Cross-session UI | `settingsStore` | Theme, font size, sidebar width |
| Session list / routing | `sessionStore` | Selected session, stdinId-to-tab mapping |
| Feature-specific | Dedicated store | `agentStore`, `fileStore`, `mcpStore` |
| Ephemeral UI | Component `useState` | Dropdown open/close, hover state, form inputs |
| Non-serializable handles | Module-level variable | Update handle, stream buffers, timers |

### When to use `useState` vs store

- **`useState`**: UI state local to one component (dropdown open, input value, animation state)
- **Store**: State shared across components, survives navigation, or needs to be accessed from hooks/callbacks

---

## Persistence Strategies

### localStorage (Zustand `persist` middleware)

Used by `settingsStore` for user preferences:

```tsx
import { persist } from 'zustand/middleware';

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({ /* state + actions */ }),
    {
      name: 'tokenicode-settings',
      version: 4,
      migrate: (persisted, version) => { /* migrations */ },
    },
  ),
);
```

### Disk (Rust backend)

Used by `providerStore` for sensitive data (API keys). Config stored at `~/.tokenicode/providers.json`:

```tsx
load: async () => {
  const data = await bridge.loadProviders();
  set({ providers: data.providers, activeProviderId: data.active, loaded: true });
},
save: async () => {
  await bridge.saveProviders({ providers: get().providers, active: get().activeProviderId });
},
```

With debounced save to avoid excessive disk writes:

```tsx
let _saveTimer: ReturnType<typeof setTimeout> | undefined;
function debouncedSave(state: ProviderState) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => state.save().catch(console.error), 500);
}
```

---

## Multi-Tab (Multi-Session) Pattern

`chatStore` is the most complex store — it manages per-session state via a `Map<tabId, TabSession>`:

```tsx
interface ChatState {
  tabs: Map<string, TabSession>;

  // All operations take tabId as first argument
  addMessage: (tabId: string, message: ChatMessage) => void;
  setSessionStatus: (tabId: string, status: SessionStatus) => void;

  // Tab lifecycle
  ensureTab: (tabId: string) => void;
  removeTab: (tabId: string) => void;
  getTab: (tabId: string) => TabSession | undefined;

  // Cache operations for background tabs
  saveToCache: (tabId: string) => void;
  restoreFromCache: (tabId: string) => void;
}
```

**Immutable Map updates** — always create a new Map:

```tsx
addMessage: (tabId, message) => {
  const tabs = new Map(get().tabs);
  const tab = tabs.get(tabId);
  if (!tab) return;
  tabs.set(tabId, { ...tab, messages: [...tab.messages, message] });
  set({ tabs });
},
```

**Background tab handling**: Stream events for non-active tabs are routed via `stdinToTab` mapping in `sessionStore` and written to cache via `*InCache()` methods in `chatStore`.

**Tab-aware selector hook**:

```tsx
export function useActiveTab<T>(selector: (tab: TabSession) => T): T {
  return useChatStore((state) => {
    const tabId = useSessionStore.getState().selectedSessionId;
    const tab = tabId ? state.tabs.get(tabId) : undefined;
    return selector(tab ?? DEFAULT_TAB);
  });
}
```

---

## Cross-Store Communication

Stores read each other via `getState()` — no store-to-store subscriptions:

```tsx
// Inside an action, read another store
addMessage: (tabId, message) => {
  const stdinId = useSessionStore.getState().getTabForStdin(tabId);
  // ...
},

// In hooks/components, use multiple store selectors
const selectedModel = useSettingsStore((s) => s.selectedModel);
const sessionStatus = useActiveTab((t) => t.sessionStatus);

// Don't subscribe one store to another store
// Don't pass store actions as props between components
```

---

## Actions Pattern

### Flat actions (standard)

Most stores put actions directly on the state:

```tsx
interface SettingsState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}
```

### `set` + `get` usage

- `set()` for simple state updates
- `get()` when the action needs to read current state before updating

```tsx
toggleSidebar: () => {
  set({ sidebarOpen: !get().sidebarOpen });
},

addMessage: (tabId, message) => {
  const tabs = new Map(get().tabs);
  // ... build new state from current state
  set({ tabs });
},
```

---

## Common Mistakes

1. **Subscribing to entire store** — `useFooStore()` without selector causes re-render on any change. Always use `useFooStore((s) => s.field)`
2. **Mutating Maps/Sets in place** — always create a new `Map()` / `Set()` before modifying, then `set()` the new copy
3. **Cross-store subscriptions** — don't use `subscribe()` between stores. Read via `getState()` in actions
4. **Putting non-serializable state in persisted stores** — handles, timers, WebSocket refs go in module-level variables
5. **Creating a store for one component's state** — use `useState` for local UI state
6. **Forgetting tab isolation** — in multi-session context, always scope operations to `tabId`, never assume "current session"
