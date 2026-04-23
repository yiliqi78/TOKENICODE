# Directory Structure

> How frontend code is organized in TOKENICODE.

---

## Overview

TOKENICODE is a Tauri 2 + React 19 desktop app. The frontend lives in `src/` with a **domain-based component hierarchy** and flat utility layers.

Key architectural rule: **All Tauri IPC calls go through `src/lib/tauri-bridge.ts`** — no direct `invoke()` anywhere else.

---

## Directory Layout

```
src/
├── App.tsx                     # Root: theme, font, file watcher, global hotkeys
├── App.css                     # Global styles (Tailwind + custom)
├── main.tsx                    # React root + ErrorBoundary
├── vite-env.d.ts               # Vite type declarations
│
├── components/                 # UI components (~46 files), organized by domain
│   ├── layout/                 # App shell, sidebar, panels
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx
│   │   └── SecondaryPanel.tsx
│   ├── chat/                   # Core chat UI (largest domain, ~16 files)
│   │   ├── ChatPanel.tsx       # Main chat view
│   │   ├── InputBar.tsx        # Message input + send logic
│   │   ├── MessageBubble.tsx   # Message rendering
│   │   ├── TiptapEditor.tsx    # Rich text editor
│   │   ├── PermissionCard.tsx  # SDK permission prompt
│   │   ├── QuestionCard.tsx    # User question card
│   │   ├── PlanReviewCard.tsx  # Plan review UI
│   │   ├── RewindPanel.tsx     # Checkpoint restore
│   │   ├── SlashCommandPopover.tsx
│   │   ├── ToolGroup.tsx       # Tool use display
│   │   ├── ModelSelector.tsx
│   │   ├── ModeSelector.tsx
│   │   ├── CommandProcessingCard.tsx
│   │   ├── FileChipView.tsx    # File attachment chips
│   │   ├── FileUploadChips.tsx
│   │   └── file-chip-extension.ts  # TipTap extension
│   ├── files/                  # File explorer + preview
│   │   ├── FileExplorer.tsx
│   │   ├── FilePreview.tsx
│   │   └── ProjectSelector.tsx
│   ├── conversations/          # Session list, groups, context menu
│   │   ├── ConversationList.tsx
│   │   ├── SessionItem.tsx
│   │   ├── SessionGroup.tsx
│   │   ├── SessionContextMenu.tsx
│   │   └── ExportMenu.tsx
│   ├── commands/               # Command palette
│   │   └── CommandPalette.tsx
│   ├── agents/                 # Agent tree panel
│   │   └── AgentPanel.tsx
│   ├── skills/                 # Skills management
│   │   └── SkillsPanel.tsx
│   ├── mcp/                    # MCP server panel
│   │   └── McpPanel.tsx
│   ├── settings/               # Settings with multiple tabs (~11 files)
│   │   ├── SettingsPanel.tsx
│   │   ├── GeneralTab.tsx
│   │   ├── CliTab.tsx
│   │   ├── McpTab.tsx
│   │   ├── ProviderTab.tsx
│   │   ├── ProviderManager.tsx
│   │   ├── ProviderForm.tsx
│   │   ├── ProviderCard.tsx
│   │   ├── AddProviderMenu.tsx
│   │   ├── AvatarCropModal.tsx
│   │   └── settingsUtils.ts
│   ├── setup/                  # First-run wizard
│   │   └── SetupWizard.tsx
│   └── shared/                 # Reusable components (~9 files)
│       ├── MarkdownRenderer.tsx
│       ├── ImageLightbox.tsx
│       ├── ConfirmDialog.tsx
│       ├── FileIcon.tsx
│       ├── UpdateButton.tsx
│       ├── ChangelogModal.tsx
│       ├── Toast.tsx
│       ├── AiAvatar.tsx
│       └── UserAvatar.tsx
│
├── hooks/                      # Custom React hooks (flat, 5 files)
│   ├── useStreamProcessor.ts   # NDJSON stream handling (foreground + background)
│   ├── useFileAttachments.ts   # File upload, drag-drop
│   ├── useRewind.ts            # Rewind orchestration
│   ├── useAutoUpdateCheck.ts   # Periodic update check
│   └── useRemoteSession.ts     # Remote session
│
├── stores/                     # Zustand stores (flat, 10 files)
│   ├── chatStore.ts            # Messages, streaming, per-tab cache
│   ├── sessionStore.ts         # Session list, tabs, routing
│   ├── settingsStore.ts        # Theme, locale, model (persisted to localStorage)
│   ├── fileStore.ts            # File tree, preview
│   ├── agentStore.ts           # Agent tree, per-tab cache
│   ├── commandStore.ts         # Unified commands
│   ├── skillStore.ts           # Skills CRUD
│   ├── mcpStore.ts             # MCP servers
│   ├── providerStore.ts        # API providers (persisted to disk)
│   └── setupStore.ts           # CLI install wizard
│
└── lib/                        # Utilities & services (flat, ~14 files)
    ├── tauri-bridge.ts         # ALL Tauri IPC calls + event listeners (single source of truth)
    ├── i18n.ts                 # zh/en translations
    ├── api-provider.ts         # Model resolution, env fingerprint
    ├── api-config.ts           # Provider config import/export (v1/v2 format)
    ├── provider-presets.ts     # Pre-configured provider templates
    ├── session-loader.ts       # JSONL -> ChatMessage[] parser
    ├── turns.ts                # Turn parsing (pure functions)
    ├── platform.ts             # OS detection, modifier keys
    ├── changelog.ts            # Version changelog entries
    ├── codemirror-theme.ts     # CodeMirror theme configuration
    ├── drag-state.ts           # File tree drag coordination
    ├── strip-ansi.ts           # ANSI escape removal
    ├── edition.ts              # Edition detection
    └── __tests__/              # Unit tests for lib modules
```

---

## Module Organization Rules

### Where new code goes

| Code type | Location | Rule |
|-----------|----------|------|
| UI component | `components/<domain>/` | Group by feature domain, not by type |
| Reusable UI (no domain) | `components/shared/` | Dialogs, renderers, icons, avatars |
| React hook | `hooks/` | Flat. Prefix with `use` |
| Zustand store | `stores/` | Flat. Suffix with `Store` |
| Utility / service | `lib/` | Flat. Only create subdirectory for multi-file subsystems |
| IPC / native call | `lib/tauri-bridge.ts` | **Always** add here, never scatter `invoke()` |

### When to create a new domain folder

Create a new `components/<domain>/` when:
- 3+ closely related components emerge
- The feature has its own distinct UI area (e.g. panel, page, modal group)

Don't create a folder for a single component — put it in the closest existing domain or `shared/`.

---

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Component file | PascalCase `.tsx` | `MessageBubble.tsx` |
| Non-component TS | kebab-case `.ts` | `tauri-bridge.ts`, `api-provider.ts` |
| TipTap extension | kebab-case `.ts` | `file-chip-extension.ts` |
| Hook file | `use` + PascalCase `.ts` | `useStreamProcessor.ts` |
| Store file | camelCase + `Store.ts` | `chatStore.ts` |
| Test directory | `__tests__/` | `src/lib/__tests__/` |
| Test file | `<module>.test.ts` | `turns.test.ts` |
| CSS | `App.css` (single global file) | Tailwind utility classes inline |

---

## Approximate Scale

| Directory | Files | Notes |
|-----------|-------|-------|
| `components/` | ~46 | Largest by file count and LOC |
| `stores/` | 10 | One store per domain |
| `hooks/` | 5 | Feature orchestration |
| `lib/` | ~14 | Utilities and services |

---

## Examples of Well-Organized Domains

- **`components/chat/`** — Largest domain. Each card type (Permission, Question, PlanReview) is its own file. The TipTap editor extension logic is split from the view component.
- **`components/settings/`** — Multi-tab panel where each tab is its own component file, with shared utilities in `settingsUtils.ts`.
- **`components/conversations/`** — Session list with supporting components (SessionItem, SessionGroup, SessionContextMenu, ExportMenu) each in their own file.
