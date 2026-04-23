# Component Guidelines

> How components are built in TOKENICODE.

---

## Overview

TOKENICODE uses **React 19 functional components** with Zustand stores, Tailwind CSS 4, and Tauri IPC bridge. No class components, no HOCs, no React.FC.

---

## Component Structure

Standard file layout:

```tsx
// 1. Imports — React, stores, lib, sibling components
import { useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

// 2. Props interface
interface Props {
  message: ChatMessage;
}

// 3. Helper functions (file-scoped, before component)
function buildSummary(items: Item[]): string {
  // pure logic, no hooks
}

// 4. Component — named export, function declaration
/**
 * ComponentName — one-line purpose description.
 *
 * Optional: state machine, interaction flow, or key behaviors.
 */
export function ComponentName({ message }: Props) {
  const t = useT();
  // hooks, then state, then derived values, then handlers, then JSX
}
```

### Rules

- **Named exports only** — no `export default`
- **Function declarations** — `export function Foo()`, not `const Foo = () =>`
- **One component per file** — helper sub-components (not exported) are OK in the same file
- **JSDoc on exported components** — describe purpose and key behaviors
- Helper functions go **before** the component, at file scope

---

## Props Conventions

### Naming

- Domain components: `interface Props` (since the file name provides context)
- Shared/reusable components: `interface XxxProps` (e.g. `ConfirmDialogProps`)
- Destructure in function params: `export function Foo({ bar, baz }: Props)`

### Patterns

```tsx
// Simple props — interface, not type alias
interface Props {
  message: ChatMessage;
  disabled?: boolean;
}

// Inline for trivial cases
export function ModelSelector({ disabled = false }: { disabled?: boolean }) {

// Callback props — name with "on" prefix
interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

// Slot / composition props — React.ReactNode
interface AppShellProps {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  secondary?: React.ReactNode;
}
```

### Anti-patterns

- Don't spread `...rest` onto DOM elements (explicit props only)
- Don't pass store actions as props — components access stores directly
- Don't create "god props" objects — keep props flat and minimal

---

## Store Access

Components access Zustand stores directly with selectors:

```tsx
// Correct — granular selectors
const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);

// Correct — getState() for event handlers (no subscription)
const handleClick = useCallback(() => {
  const tab = useChatStore.getState().getTab(tabId);
}, [tabId]);

// Wrong — selecting entire store (causes unnecessary re-renders)
const settings = useSettingsStore();
```

---

## i18n

Every user-facing string goes through the `useT()` hook:

```tsx
const t = useT();
return <p>{t('msg.noMessages')}</p>;
```

For static contexts outside React (helper functions at file scope):

```tsx
import { t as tStatic } from '../../lib/i18n';
function formatTime(ms: number): string {
  return `${minutes}${tStatic('conv.mAgo')}`;
}
```

---

## Styling Patterns

### Tailwind CSS 4 — inline utility classes

```tsx
// Standard approach — className string
<div className="flex items-center gap-2 px-3 py-1.5 rounded-lg">

// Conditional classes — template literal
<button className={`px-3 py-1.5 text-xs rounded-lg
  ${isDanger ? 'bg-error/10 text-error' : 'bg-bg-tertiary text-text-primary'}`}
>

// Multi-line for long class strings — use backticks
<div className="bg-bg-card border border-border-subtle rounded-xl p-5
  shadow-lg max-w-sm w-full mx-4 animate-fade-in"
>
```

### Design tokens (CSS variables)

Use semantic tokens, not raw colors:

| Token pattern | Usage |
|---------------|-------|
| `bg-bg-card`, `bg-bg-secondary`, `bg-bg-tertiary` | Background surfaces |
| `text-text-primary`, `text-text-muted`, `text-text-tertiary` | Text colors |
| `border-border-subtle` | Borders |
| `bg-accent`, `text-accent` | Brand accent |
| `bg-error/10`, `text-error` | Error states |
| `transition-smooth` | Standard transition |
| `hover-spring` | Spring-like hover animation |

### Icons — inline SVG

No icon library. SVGs are inline:

```tsx
<svg width="12" height="12" viewBox="0 0 12 12" fill="none"
  stroke="currentColor" strokeWidth="1.5">
  <path d="M3 2l4 3-4 3" />
</svg>
```

### Modals / Overlays — createPortal

```tsx
import { createPortal } from 'react-dom';

if (!open) return null;
return createPortal(
  <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
    {/* content */}
  </div>,
  document.body,
);
```

---

## Memoization

- **`useMemo`** for derived data from props/state (e.g. filtering lists, building summaries)
- **`useCallback`** for event handlers passed to children or used in effects
- **`memo()`** only on expensive render components (e.g. `MarkdownRenderer`)
- Don't over-memoize — simple components don't need it

---

## IPC / Native Calls

All Tauri calls go through `bridge`:

```tsx
import { bridge } from '../../lib/tauri-bridge';

// In event handlers — not in render
const handleSave = useCallback(async () => {
  await bridge.writeFileContent(path, content);
}, [path, content]);
```

**Never** call `invoke()` directly. Always add new IPC methods to `tauri-bridge.ts` first.

---

## Common Mistakes

1. **Selecting entire store** instead of individual fields — causes unnecessary re-renders
2. **Calling `invoke()` directly** instead of going through `tauri-bridge.ts`
3. **Hardcoding strings** instead of using `t()` / `tStatic()`
4. **Using raw color values** (`text-gray-500`) instead of semantic tokens (`text-text-muted`)
5. **Creating wrapper hooks for store access** — just use the store selector directly
6. **Forgetting `cursor-pointer`** on interactive elements styled with Tailwind
7. **Missing `onClick={e => e.stopPropagation()}`** on modal content to prevent backdrop dismiss
