# Quality Guidelines

> Code quality standards for TOKENICODE frontend development.

---

## Build & Type Check

```bash
# Frontend: TypeScript strict + Vite build (MUST pass)
pnpm build

# Rust backend (MUST pass if touching src-tauri/)
cd src-tauri && cargo check && cargo clippy

# Tests
pnpm test              # Vitest run
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report
```

### TypeScript Strict Mode

`tsconfig.json` enforces:
- `"strict": true`
- `"noUnusedLocals": true`
- `"noUnusedParameters": true`
- `"noFallthroughCasesInSwitch": true`

No ESLint configured — TypeScript compiler is the primary linter.

---

## Testing

### Framework: Vitest 4

Tests live in `__tests__/` directories next to the source:

```
src/lib/__tests__/turns.test.ts
src/lib/__tests__/strip-ansi.test.ts
```

### What to test

| Layer | What to test | Example |
|-------|-------------|---------|
| `lib/` | Pure functions, parsers, formatters | `turns.test.ts`, `strip-ansi.test.ts` |
| `stores/` | Store actions, state transitions | Store action unit tests |
| `hooks/` | Exported helper functions | Extracted pure logic |
| Components | **Not unit tested** — manual verification | Screenshots in PR |

### Test style

```tsx
import { describe, it, expect, vi } from 'vitest';

// Factory helper for test data
function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg_1',
    role: 'user',
    type: 'text',
    content: '',
    timestamp: 1000,
    ...overrides,
  } as ChatMessage;
}

describe('parseTurns', () => {
  it('returns empty for empty messages', () => {
    expect(parseTurns([])).toEqual([]);
  });
});
```

### Coverage scope

Vitest coverage (`v8` provider) includes:
- `src/lib/**`
- `src/stores/**`
- `src/hooks/**`

Components are excluded from coverage (tested manually).

---

## Forbidden Patterns

### 1. UI changes without information architecture thinking

**Don't**: See a reference screenshot, immediately build UI, add new stores/mapping layers.

**Do**: Ask first — "What's the data model? Can this be derived from existing data? What's the user flow?"

Real example: Workspace was just the existing `project` field rendered differently. No new store needed.

### 2. Configuration-level UI in message-level toolbar

**Don't**: Put engine/provider/auth selectors in InputBar (high-frequency interaction area).

**Do**: Configuration that involves installation, authentication, or multi-step setup belongs in Settings. InputBar only holds per-message controls (model, thinking level).

### 3. Adding tabs instead of integrating

**Don't**: Add a new settings tab next to existing tabs with overlapping responsibilities.

**Do**: Merge related concerns into one cohesive section. Design the information architecture first, then build the UI.

### 4. Surface-only UI without functional wiring

**Don't**: Ship a settings panel where switching engines doesn't trigger auth/provider/model cascading updates.

**Do**: If a UI control implies a workflow (engine switch -> install check -> auth -> provider config -> model select), the workflow must work end-to-end before shipping.

### 5. Raw color values

**Don't**: `text-gray-500`, `bg-white`, `border-slate-200`

**Do**: Use semantic tokens — `text-text-muted`, `bg-bg-card`, `border-border-subtle`

### 6. Hardcoded strings

**Don't**: `<p>没有消息</p>` or `<p>No messages</p>`

**Do**: `<p>{t('msg.noMessages')}</p>` — all strings through `i18n.ts`

### 7. Direct Tauri invoke

**Don't**: `import { invoke } from '@tauri-apps/api/core'; invoke('my_command', ...)`

**Do**: Add to `tauri-bridge.ts`, then `import { bridge } from '../lib/tauri-bridge'; bridge.myCommand(...)`

---

## Required Patterns

### Immutable state updates

Use spread operator or new Map/Set. Never mutate in place.

```tsx
// Correct
const tabs = new Map(get().tabs);
tabs.set(tabId, { ...tab, messages: [...tab.messages, msg] });
set({ tabs });

// Wrong
get().tabs.get(tabId)!.messages.push(msg);
```

### Tab-aware state access

Use `useActiveTab()` for multi-session state:

```tsx
// Correct
const messages = useActiveTab((t) => t.messages);

// Wrong — not tab-scoped
const messages = useChatStore((s) => s.messages);  // doesn't exist at top level
```

### Granular store selectors

```tsx
// Correct — only re-renders when this field changes
const theme = useSettingsStore((s) => s.theme);

// Wrong — re-renders on ANY settings change
const settings = useSettingsStore();
```

---

## Design Token System

All colors are CSS custom properties defined in `App.css` via Tailwind `@theme`:

| Category | Token pattern | Example |
|----------|---------------|---------|
| Background | `bg-bg-*` | `bg-bg-primary`, `bg-bg-card`, `bg-bg-secondary`, `bg-bg-tertiary` |
| Text | `text-text-*` | `text-text-primary`, `text-text-muted`, `text-text-tertiary` |
| Border | `border-border-*` | `border-border-subtle`, `border-border-focus` |
| Accent | `*-accent*` | `bg-accent`, `text-accent-light` |
| Status | `*-success/error/warning` | `text-error`, `bg-success` |
| Syntax | `*-syntax-*` | `text-syntax-keyword`, `text-syntax-string` |
| Shadow | `shadow-*` | `shadow-sm`, `shadow-md`, `shadow-lg` |

Themes (light/dark) override these variables. Using raw Tailwind colors bypasses theming.

---

## Pre-Commit Checklist

Before committing frontend changes:

- [ ] `pnpm build` passes (TypeScript + Vite)
- [ ] `cargo check && cargo clippy` passes (if Rust touched)
- [ ] `pnpm test` passes (if touching lib/stores/hooks)
- [ ] No `console.log` left in production code (use `console.warn`/`console.error` only for genuine warnings)
- [ ] No hardcoded strings — all through `t()`
- [ ] No raw color values — all through design tokens
- [ ] No direct `invoke()` — all through `tauri-bridge.ts`
- [ ] Immutable state updates (no mutation)
- [ ] Manual UI verification for visual changes

## Pre-UI Checklist

Before building any new UI feature:

- [ ] What's the data model? New or derived from existing?
- [ ] Where does this UI belong? (InputBar / Sidebar / Settings / Modal)
- [ ] Is this a one-time config or frequent interaction?
- [ ] Does the full flow work? (not just the UI surface)
- [ ] Does it align with existing visual patterns? (spacing, colors, component style)
