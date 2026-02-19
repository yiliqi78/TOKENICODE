# TOKENICODE Architecture

> **Purpose**: 帮助 AI 助手快速理解代码库结构，避免每次调试都全量阅读源码。
> **Last updated**: 2026-02-18

## Overview

TOKENICODE 是 Claude Code CLI 的原生 macOS 桌面 GUI，基于 **Tauri 2 + React 19 + TypeScript + Tailwind CSS 4 + Zustand 5** 构建。

```
┌─────────────────────────────────────────────────────┐
│                    Tauri Window                      │
│  ┌──────────┬──────────────────┬──────────────────┐ │
│  │ Sidebar  │    ChatPanel     │ SecondaryPanel   │ │
│  │          │                  │ (Files/Agents/   │ │
│  │ Sessions │  Messages +      │  Skills/MCP)     │ │
│  │ NewChat  │  InputBar        │                  │ │
│  │ Settings │                  │ FilePreview      │ │
│  └──────────┴──────────────────┴──────────────────┘ │
│               ↕ Tauri IPC (invoke + events)          │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Rust Backend (lib.rs)               │ │
│  │  ProcessManager · StdinManager · FileWatcher    │ │
│  │         ↕ stdin/stdout pipes                     │ │
│  │     Claude CLI (stream-json protocol)            │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
TOKENICODE/
├── src/                          # Frontend (React 19 + TS)
│   ├── App.tsx                   # Entry: theme, font, file watcher, global hotkeys
│   ├── main.tsx                  # React root + ErrorBoundary
│   ├── stores/                   # Zustand state management (10 stores)
│   ├── components/               # UI components (~30 files)
│   │   ├── layout/               # AppShell, Sidebar, SecondaryPanel
│   │   ├── chat/                 # ChatPanel, InputBar, MessageBubble, etc.
│   │   ├── files/                # FileExplorer, FilePreview, ProjectSelector
│   │   ├── conversations/        # ConversationList, ExportMenu
│   │   ├── commands/             # CommandPalette
│   │   ├── agents/               # AgentPanel
│   │   ├── skills/               # SkillsPanel
│   │   ├── mcp/                  # McpPanel
│   │   ├── settings/             # SettingsPanel
│   │   ├── setup/                # SetupWizard
│   │   └── shared/               # MarkdownRenderer, ImageLightbox
│   ├── hooks/                    # useClaudeStream, useFileAttachments, useRewind
│   └── lib/                      # tauri-bridge.ts, i18n.ts, turns.ts
├── src-tauri/
│   └── src/
│       ├── lib.rs                # Main backend: 45+ Tauri commands (~2000 LOC)
│       └── commands/
│           └── claude_process.rs # Types: StartSessionParams, SessionInfo
└── package.json / Cargo.toml
```

---

## State Management (Zustand Stores)

| Store | File | Purpose | Persisted |
|-------|------|---------|-----------|
| **chatStore** | `stores/chatStore.ts` | Messages, streaming, session meta/status, per-tab cache | No |
| **sessionStore** | `stores/sessionStore.ts` | Session list, selection, drafts, stdin→tab routing | No |
| **settingsStore** | `stores/settingsStore.ts` | Theme, locale, model, mode, layout, font, **thinkingEnabled** | Yes (localStorage) |
| **fileStore** | `stores/fileStore.ts` | File tree, preview, edit buffer, changed files | No |
| **snapshotStore** | `stores/snapshotStore.ts` | Per-turn file snapshots for rewind | No |
| **agentStore** | `stores/agentStore.ts` | Agent tree (multi-agent), phase tracking, per-tab cache | No |
| **commandStore** | `stores/commandStore.ts` | Commands (built-in + custom), prefix mode | No |
| **skillStore** | `stores/skillStore.ts` | Skills CRUD, enable/disable | No |
| **setupStore** | `stores/setupStore.ts` | CLI install/login progress | No |
| **mcpStore** | `stores/mcpStore.ts` | MCP servers from ~/.claude.json | No |

### Tab-Switching Pattern
`chatStore` and `agentStore` implement `saveToCache(tabId)` / `restoreFromCache(tabId)` for seamless session tab switching.

---

## IPC Bridge (`src/lib/tauri-bridge.ts`)

All frontend↔backend communication goes through this single file.

### Key Command Groups

| Group | Commands | Notes |
|-------|----------|-------|
| **Session** | `startSession`, `sendMessage`, `sendStdin`, `killSession`, `abortSession`, `trackSession` | `startSession` spawns Claude CLI child process |
| **Files** | `readFileTree`, `readFileContent`, `writeFileContent`, `readFileBase64` | Used by FileExplorer + FilePreview |
| **Snapshot** | `snapshot_files`, `restore_snapshot` | Pre-turn capture + rewind restore |
| **Watch** | `watchDirectory`, `unwatchDirectory` | Emits `fs:change` events |
| **Git** | `runGitCommand` | Allowlisted operations only |
| **Skills** | `listSkills`, `readSkill`, `writeSkill`, `deleteSkill`, `toggleSkillEnabled` | CRUD for custom skills |
| **Setup** | `checkClaudeCli`, `installClaudeCli`, `checkClaudeAuth`, `startClaudeLogin` | First-run wizard |

### Event Streams (Rust → Frontend)

```
claude:stream:{stdinId}    → NDJSON messages from Claude CLI stdout
claude:stderr:{stdinId}    → Stderr output
claude:exit:{stdinId}      → Process exit with code
fs:change                   → File system change notifications
```

---

## Rust Backend (`src-tauri/src/lib.rs`)

### Core Managers

- **ProcessManager** — `HashMap<sessionId, ManagedProcess>`: tracks active CLI child processes
- **StdinManager** — `HashMap<stdinId, ChildStdin>`: routes stdin to correct process
- **DirectoryWatcher** — `notify::RecommendedWatcher`: file change notifications

### Claude CLI Invocation

```rust
// Spawned command pattern:
claude <prompt> \
  --session <sessionId> \
  --output-format stream-json \
  --input-format stream-json \
  [--resume <existingSessionId>] \
  [--model claude-opus-4-0] \
  [--dangerously-skip-permissions] \
  [--settings '{"alwaysThinkingEnabled":true}']
```

### Session Directory Encoding

CLI stores sessions at `~/.claude/projects/<encoded-path>/sessions/`
Encoding: `/Users/foo/my-project` → `-Users-foo-my-project`

**Important**: `decode_project_name()` uses greedy filesystem-segment matching because hyphens in directory names (e.g., `ppt-maker`) are indistinguishable from path separators.

---

## Key Data Flows

### New Message Flow
```
User types in InputBar → snapshotStore.captureSnapshot()
  → bridge.startSession({ prompt, cwd, model, thinking_enabled })
  → Rust spawns CLI → claude:stream events
  → useClaudeStream hook parses NDJSON → chatStore.addMessage()
  → React re-renders ChatPanel
```

### Session Switching
```
Click tab → chatStore.saveToCache(oldTabId)
  → sessionStore.setSelectedSession(newTabId)
  → chatStore.restoreFromCache(newTabId)
  → useClaudeStream re-attaches to new stdinId
```

### New Chat (from Sidebar)
```
Click "New Chat" → OS folder picker dialog
  → setWorkingDirectory(path) → clearMessages()
  → addDraftSession(draftId) → pre-warm CLI process
  → Ready for first message
```

---

## Component Hierarchy

```
App.tsx
└── AppShell (layout: sidebar | main | secondary)
    ├── Sidebar
    │   ├── ConversationList (session tabs)
    │   └── Settings button
    ├── ChatPanel (main)
    │   ├── MessageBubble[] (messages)
    │   │   ├── ToolGroup (tool_use + tool_result pairs)
    │   │   ├── PermissionCard
    │   │   ├── QuestionCard
    │   │   ├── PlanReviewCard
    │   │   └── CommandProcessingCard
    │   ├── RewindPanel (overlay)
    │   └── InputBar
    │       ├── SlashCommandPopover
    │       ├── FileUploadChips
    │       ├── ModelSelector / ModeSelector / ThinkToggle
    │       └── Shortcut hint (⏎ Send · ⌘⏎ New line)
    ├── SecondaryPanel (tabbed)
    │   ├── FileExplorer + FilePreview
    │   ├── AgentPanel
    │   ├── SkillsPanel
    │   └── McpPanel
    └── SettingsPanel (modal overlay)
```

---

## Debugging Quick Reference

### Common Bug Locations

| Issue Type | Check These Files |
|------------|-------------------|
| Message rendering | `MessageBubble.tsx`, `ToolGroup.tsx` |
| Stream parsing | `hooks/useClaudeStream.ts`, `chatStore.ts` |
| Session management | `sessionStore.ts`, `Sidebar.tsx`, `ChatPanel.tsx` |
| CLI spawning/args | `lib.rs` → `start_claude_session()` |
| File preview | `FilePreview.tsx`, `fileStore.ts` |
| Layout/panels | `AppShell.tsx` |
| InputBar behavior | `InputBar.tsx`, `commandStore.ts` |
| Theme/styling | `settingsStore.ts`, `App.tsx`, `index.css` |
| Tab switching | `chatStore.saveToCache/restoreFromCache`, `sessionStore.ts` |
| Rewind/snapshots | `snapshotStore.ts`, `useRewind.ts`, `RewindPanel.tsx` |
| i18n | `lib/i18n.ts` (zh/en translation maps) |
| Path encoding/decoding | `lib.rs` → `decode_project_name()` |

### Build Commands

```bash
# Frontend only (type check)
pnpm run build

# Rust only
cd src-tauri && cargo build

# Full app (dev mode)
cargo tauri dev

# Full app (production build)
cargo tauri build
```

### Key Constants

- Sidebar width: 180–450px (default in settingsStore)
- Secondary panel: 200–600px
- Preview panel: 300–1200px (50% of window default)
- Models: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-haiku-3-5-20241022`
- Session modes: `code`, `ask`, `plan`, `bypass`
