# TOKENICODE Architecture

> **Purpose**: Help AI assistants quickly understand the codebase structure, avoiding full source reads on every debug session.
> **Last updated**: 2026-03-02

## Overview

TOKENICODE is a native desktop GUI for Claude Code CLI, built with **Tauri 2 + React 19 + TypeScript + Tailwind CSS 4 + Zustand 5**. It supports macOS, Windows, and Linux.

```
┌─────────────────────────────────────────────────────┐
│                    Tauri Window                      │
│  ┌──────────┬──────────────────┬──────────────────┐ │
│  │ Sidebar  │    ChatPanel     │ SecondaryPanel   │ │
│  │          │                  │ (Files/Skills)   │ │
│  │ Sessions │  Messages +      │                  │ │
│  │ NewChat  │  InputBar        │ FilePreview      │ │
│  │ Settings │                  │                  │ │
│  └──────────┴──────────────────┴──────────────────┘ │
│               ↕ Tauri IPC (invoke + events)          │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Rust Backend (lib.rs)               │ │
│  │  ProcessManager · StdinManager · WatcherManager │ │
│  │  ProviderSystem · SDK Control Protocol          │ │
│  │         ↕ stdin/stdout pipes (NDJSON)            │ │
│  │     Claude CLI (stream-json + control protocol)  │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
TOKENICODE/
├── src/                          # Frontend (React 19 + TS, ~77 files)
│   ├── App.tsx                   # Entry: theme, font, file watcher, global hotkeys
│   ├── main.tsx                  # React root + ErrorBoundary
│   ├── stores/                   # Zustand state management (10 stores)
│   ├── components/               # UI components (~48 files)
│   │   ├── layout/               # AppShell, Sidebar, SecondaryPanel
│   │   ├── chat/                 # ChatPanel, InputBar, MessageBubble, etc.
│   │   ├── files/                # FileExplorer, FilePreview, ProjectSelector
│   │   ├── conversations/        # ConversationList, SessionGroup, SessionItem, ExportMenu
│   │   ├── commands/             # CommandPalette
│   │   ├── agents/               # AgentPanel
│   │   ├── skills/               # SkillsPanel
│   │   ├── mcp/                  # McpPanel
│   │   ├── settings/             # SettingsPanel, ProviderManager, ProviderTab, CliTab, etc.
│   │   ├── setup/                # SetupWizard
│   │   └── shared/               # MarkdownRenderer, ImageLightbox, ConfirmDialog,
│   │                               ChangelogModal, UpdateButton, FileIcon
│   ├── hooks/                    # useStreamProcessor, useFileAttachments, useRewind,
│   │                               useAutoUpdateCheck
│   └── lib/                      # tauri-bridge.ts, i18n.ts, turns.ts, session-loader.ts,
│                                   api-provider.ts, api-config.ts, provider-presets.ts,
│                                   changelog.ts, platform.ts, drag-state.ts,
│                                   codemirror-theme.ts, strip-ansi.ts
├── src-tauri/
│   └── src/
│       ├── lib.rs                # Main backend: 55+ Tauri commands (~4600 LOC)
│       ├── protocol.rs           # SDK Control Protocol types (ControlRequest/Response)
│       ├── main.rs               # Tauri entry point
│       └── commands/
│           ├── mod.rs             # Module re-exports
│           └── claude_process.rs  # Types: StartSessionParams, SessionInfo,
│                                    ProcessManager, StdinManager, ManagedProcess
└── package.json / Cargo.toml
```

---

## State Management (Zustand Stores)

| Store | File | Purpose | Persisted |
|-------|------|---------|-----------|
| **chatStore** | `stores/chatStore.ts` | Messages, streaming, session meta/status, per-tab cache, permission state | No |
| **sessionStore** | `stores/sessionStore.ts` | Session list, selection, drafts, stdin→tab routing, custom names, pin/archive | No |
| **settingsStore** | `stores/settingsStore.ts` | Theme, colorTheme, locale, model, mode, layout, font, thinkingLevel, update state | Yes (localStorage) |
| **fileStore** | `stores/fileStore.ts` | File tree, preview, edit buffer, changed files, recent projects | No |
| **agentStore** | `stores/agentStore.ts` | Agent tree (multi-agent), phase tracking, per-tab cache | No |
| **commandStore** | `stores/commandStore.ts` | Unified commands (built-in + custom + skills), prefix mode | No |
| **skillStore** | `stores/skillStore.ts` | Skills CRUD, enable/disable, content editing | No |
| **providerStore** | `stores/providerStore.ts` | Multi-provider API config (base URL, key, model mappings) | Yes (providers.json on disk) |
| **setupStore** | `stores/setupStore.ts` | CLI install/login progress | No |
| **mcpStore** | `stores/mcpStore.ts` | MCP servers from ~/.claude.json | No |

### Tab-Switching Pattern
`chatStore` and `agentStore` implement `saveToCache(tabId)` / `restoreFromCache(tabId)` for seamless session tab switching.

---

## IPC Bridge (`src/lib/tauri-bridge.ts`)

All frontend-to-backend communication goes through this single file (~470 LOC).

### Key Command Groups

| Group | Commands | Notes |
|-------|----------|-------|
| **Session** | `startSession`, `sendStdin`, `sendRawStdin`, `killSession`, `trackSession`, `deleteSession` | `startSession` spawns CLI child process |
| **Session List** | `listSessions`, `loadSession`, `listRecentProjects` | Session discovery and loading |
| **Session Meta** | `loadCustomPreviews`, `saveCustomPreviews`, `loadPinnedSessions`, `savePinnedSessions`, `loadArchivedSessions`, `saveArchivedSessions`, `generateSessionTitle` | Session names, pinning, archiving, AI titling |
| **Files** | `readFileTree`, `readFileContent`, `writeFileContent`, `copyFile`, `renameFile`, `deleteFile`, `createDirectory`, `readFileBase64`, `getFileSize`, `checkFileAccess` | FileExplorer + FilePreview |
| **Watch** | `watchDirectory`, `unwatchDirectory` | Emits `fs:change` events |
| **Git** | `runGitCommand` | Allowlisted operations only |
| **Rewind** | `rewindFiles` | SDK control protocol primary, CLI spawn fallback |
| **Skills** | `listSkills`, `readSkill`, `writeSkill`, `deleteSkill`, `toggleSkillEnabled` | CRUD for custom skills |
| **Commands** | `listSlashCommands`, `listAllCommands` | Unified command discovery |
| **Setup** | `checkClaudeCli`, `installClaudeCli`, `checkNodeEnv`, `installNodeEnv`, `checkClaudeAuth`, `startClaudeLogin`, `openTerminalLogin` | First-run wizard, CLI install via npm |
| **Provider** | `loadProviders`, `saveProviders`, `testProviderConnection` | Multi-provider API config |
| **SDK Control** | `respondPermission`, `setPermissionMode`, `setModel`, `interruptSession` | Runtime control without CLI restart |
| **Export** | `exportSessionMarkdown`, `exportSessionJson` | Session export |
| **Shell** | `openInVscode`, `revealInFinder`, `openWithDefaultApp`, `runClaudeCommand`, `saveTempFile`, `setDockIcon` | OS integration |

### Event Streams (Rust → Frontend)

```
claude:stream:{sessionId}      → NDJSON messages from Claude CLI stdout
                                  (includes tokenicode_permission_request for SDK protocol)
claude:stderr:{sessionId}      → Stderr output
claude:exit:{sessionId}        → Process exit
sessions:changed               → Session list invalidation
fs:change                      → File system change notifications
setup:download:progress        → CLI/Node.js/Git install progress
setup:login:output             → Login process stdout/stderr
setup:login:exit               → Login process exit
```

---

## Rust Backend (`src-tauri/src/lib.rs`)

### Core Managers

- **ProcessManager** — `HashMap<sessionId, ManagedProcess>`: tracks active CLI child processes
- **StdinManager** — `HashMap<stdinId, ChildStdin>`: routes stdin to correct process
- **WatcherManager** — `HashMap<path, RecommendedWatcher>`: file change notifications

### SDK Control Protocol (`protocol.rs`)

Bidirectional communication with Claude CLI when launched with `--permission-prompt-tool stdio`:

- **CLI → TOKENICODE** (`control_request`): Permission requests (`can_use_tool`), hook callbacks
- **TOKENICODE → CLI** (`control_response`): Allow/deny decisions with `updatedInput`
- **TOKENICODE → CLI** (`control_request`): Runtime commands — `interrupt`, `set_permission_mode`, `set_model`, `rewind_files`

### Provider System

Multi-provider API configuration stored as plaintext JSON at `~/.tokenicode/providers.json`:
- Supports Anthropic and OpenAI API formats
- Per-provider: base URL, API key, model tier mappings, extra env vars
- Environment variable injection into CLI child process
- Connection testing via `test_provider_connection`

### Claude CLI Invocation

```rust
// Spawned command pattern (stream-json persistent input mode):
claude \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --replay-user-messages \
  [--resume <existingSessionId>] \
  [--model <model>] \
  [--permission-mode <mode> --permission-prompt-tool stdio] \
  [--dangerously-skip-permissions]  // only in bypass mode \
  [--settings '{"alwaysThinkingEnabled":true|false}']
```

Environment variables injected:
- `CLAUDE_CODE_EFFORT_LEVEL` — thinking effort (low/medium/high/max)
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` — raised to 64K (default was 32K)
- `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` — enables rewind checkpoints
- `CLAUDE_CODE_GIT_BASH_PATH` — auto-detected git-bash on Windows
- Provider-specific: `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, custom env vars
- Proxy vars from login shell (macOS/Linux GUI apps don't inherit them)

### Logging & Diagnostics (`diagnostics.rs`)

Production builds used to log only via `eprintln!` / `console.log`, which never reach disk. Now:

- **tauri-plugin-log** is registered first in `run()`. Rust code uses `log::info!/warn!/error!` (no `eprintln!` left in `lib.rs`); the webview forwards `console.warn/error` and `[TOKENICODE]`-prefixed logs via `src/lib/log-forwarder.ts` into the same file.
- **Location**: `app_log_dir()` → macOS `~/Library/Logs/com.tinyzhuang.tokenicode/tokenicode.log`, Windows `%LOCALAPPDATA%\com.tinyzhuang.tokenicode\logs\`, Linux `~/.local/share/com.tinyzhuang.tokenicode/logs/`.
- **Rotation**: 5 MB per file, rotated files renamed `tokenicode_<timestamp>.log`, 5 rotated files kept (`RotationStrategy::KeepSome`). Level: Info in release, Debug in dev (dev also mirrors to stderr).
- **Redaction**: every line passes through `redact_secrets()` (sk- keys, Bearer, JWT, `*_API_KEY=` / `token:` pairs, URL userinfo and `?key=` params); env dumps already go through `redacted_env_for_log()`.
- **Commands**: `get_log_dir`, `open_log_dir`, `export_diagnostics(dest, meta)` — the latter writes a zip with `logs/*.log` (re-redacted), `diagnostics.json` (app/CLI/OS versions, provider host-only, model, last session id) and a README. Surfaced in Settings → Feedback.

### Binary Discovery

`find_claude_binary()` searches in priority order:
1. App-local download directory (`~/Library/Application Support/com.tinyzhuang.tokenicode/cli/`)
2. npm-global/bin (local `--prefix` install)
3. System PATH (`which claude`)
4. Claude Desktop App bundled CLI (versioned directories)
5. Common global install paths (`.npm-global/bin`, `.local/bin`, Homebrew, etc.)

### CLI Installation Pipeline

`install_claude_cli()`:
1. Detect network (China vs Global via Google reachability)
2. (Windows) Auto-install PortableGit if git-bash missing
3. Ensure npm is available — download Node.js LTS locally if needed
4. Install CLI via `npm install -g @anthropic-ai/claude-code` with region-aware registry mirrors
5. (Windows) Add directories to user PATH and set `CLAUDE_CODE_GIT_BASH_PATH`

### Session Directory Encoding

CLI stores sessions at `~/.claude/projects/<encoded-path>/sessions/`
Encoding: `/Users/foo/my-project` → `-Users-foo-my-project`

**Important**: `decode_project_name()` uses greedy filesystem-segment matching with multi-separator probing (hyphen, space, dot) because hyphens in directory names are indistinguishable from path separators.

---

## Key Data Flows

### New Message Flow
```
User types in InputBar
  → bridge.startSession({ prompt, cwd, model, thinking_level, permission_mode, provider_id })
  → Rust spawns CLI with stream-json I/O
  → Stdout reader: parse NDJSON, intercept control_request, forward rest
  → claude:stream events → useStreamProcessor parses → chatStore.addMessage()
  → React re-renders ChatPanel
```

### Follow-up Message Flow (persistent session)
```
User types follow-up → bridge.sendStdin(sessionId, message)
  → StdinManager writes NDJSON to existing CLI process stdin
  → Same stream processing pipeline
```

### Permission Request Flow (SDK Control Protocol)
```
CLI stdout: control_request { subtype: "can_use_tool", tool_name, input }
  → Rust intercepts, emits tokenicode_permission_request on stream channel
  → Frontend renders PermissionCard with approve/deny buttons
  → User clicks → bridge.respondPermission(sessionId, requestId, allow, updatedInput)
  → Rust sends control_response via StdinManager → CLI proceeds
```

### Session Switching
```
Click tab → chatStore.saveToCache(oldTabId) + agentStore.saveToCache(oldTabId)
  → sessionStore.setSelectedSession(newTabId)
  → chatStore.restoreFromCache(newTabId) + agentStore.restoreFromCache(newTabId)
  → useStreamProcessor re-attaches to new stdinId
```

### Rewind Flow
```
Click Rewind → useRewind.parseTurns(messages) → show RewindPanel with turn list
  → User selects turn + action (restore_all | restore_conversation | restore_code | summarize)
  → Kill active CLI process
  → Restore files: bridge.rewindFiles() → SDK control_request{rewind_files} or CLI --rewind-files
  → Truncate messages in chatStore
  → Resume session with --resume flag
```

### New Chat (from Sidebar)
```
Click "New Chat" → OS folder picker dialog
  → setWorkingDirectory(path) → clearMessages()
  → addDraftSession(draftId) → pre-warm CLI process (empty prompt)
  → Ready for first message
```

---

## Component Hierarchy

```
App.tsx
└── AppShell (layout: sidebar | main | secondary)
    ├── Sidebar
    │   ├── ConversationList (session tabs)
    │   │   ├── SessionGroup (by project, with pin/archive sections)
    │   │   ├── SessionItem (individual session entry)
    │   │   └── SessionContextMenu (right-click: rename, pin, archive, delete)
    │   └── Settings button
    ├── ChatPanel (main)
    │   ├── MessageBubble[] (messages)
    │   │   ├── ToolGroup (tool_use + tool_result pairs)
    │   │   ├── PermissionCard (SDK control protocol approve/deny)
    │   │   ├── QuestionCard (AskUserQuestion tool)
    │   │   ├── PlanReviewCard (ExitPlanMode tool)
    │   │   └── CommandProcessingCard (slash command progress)
    │   ├── RewindPanel (overlay with turn list)
    │   └── InputBar
    │       ├── TiptapEditor (rich text with file chip extension)
    │       ├── SlashCommandPopover (unified: commands + skills)
    │       ├── FileUploadChips / FileChipView
    │       ├── ModelSelector / ModeSelector
    │       └── Shortcut hint (⏎ Send · ⌘⏎ New line)
    ├── SecondaryPanel (tabbed: files | skills)
    │   ├── FileExplorer + FilePreview (with CodeMirror editor)
    │   └── SkillsPanel
    ├── AgentPanel (floating overlay, multi-agent tree view)
    ├── SettingsPanel (modal overlay)
    │   ├── GeneralTab (theme, font, language, etc.)
    │   ├── ProviderTab → ProviderManager
    │   │   ├── ProviderCard (per-provider config)
    │   │   ├── ProviderForm (add/edit provider)
    │   │   └── AddProviderMenu (presets: OpenRouter, Gemini, etc.)
    │   ├── McpTab (MCP server management)
    │   └── CliTab (CLI version, reinstall, doctor)
    ├── CommandPalette (⌘K overlay)
    ├── ImageLightbox (full-screen image viewer)
    └── ChangelogModal (what's new after update)
```

---

## Frontend Hooks

| Hook | File | Purpose |
|------|------|---------|
| **useStreamProcessor** | `hooks/useStreamProcessor.ts` | Core stream message parsing: NDJSON events → chatStore messages, agent tracking, permission interception, background tab routing (~1300 LOC) |
| **useFileAttachments** | `hooks/useFileAttachments.ts` | Drag-drop, paste, file picker → temp file save → attachment chips |
| **useRewind** | `hooks/useRewind.ts` | Turn parsing, kill-process, message truncation, CLI checkpoint restore, summarization |
| **useAutoUpdateCheck** | `hooks/useAutoUpdateCheck.ts` | Startup + periodic update check via Tauri updater plugin |

## Frontend Lib Modules

| Module | File | Purpose |
|--------|------|---------|
| **tauri-bridge** | `lib/tauri-bridge.ts` | All Tauri IPC calls + event listeners (single source of truth, ~470 LOC) |
| **i18n** | `lib/i18n.ts` | Chinese/English translation maps (~1250 LOC) |
| **session-loader** | `lib/session-loader.ts` | Parse raw JSONL into structured ChatMessage[] + AgentData[] |
| **turns** | `lib/turns.ts` | Parse messages into conversation turns for rewind |
| **api-provider** | `lib/api-provider.ts` | Resolve model ID to provider model name, env fingerprint |
| **api-config** | `lib/api-config.ts` | Provider config import/export (JSON v2 format) |
| **provider-presets** | `lib/provider-presets.ts` | Pre-configured provider templates (OpenRouter, etc.) |
| **changelog** | `lib/changelog.ts` | Version changelog data for ChangelogModal |
| **platform** | `lib/platform.ts` | OS detection utilities |
| **drag-state** | `lib/drag-state.ts` | Shared drag-and-drop state for file tree operations |
| **codemirror-theme** | `lib/codemirror-theme.ts` | VS Code-style theme for CodeMirror editor |
| **strip-ansi** | `lib/strip-ansi.ts` | Strip ANSI escape sequences from strings |

---

## Debugging Quick Reference

### Common Bug Locations

| Issue Type | Check These Files |
|------------|-------------------|
| Message rendering | `MessageBubble.tsx`, `ToolGroup.tsx` |
| Stream parsing | `hooks/useStreamProcessor.ts`, `chatStore.ts` |
| Permission cards | `PermissionCard.tsx`, `useStreamProcessor.ts` (control_request intercept) |
| Session management | `sessionStore.ts`, `Sidebar.tsx`, `ChatPanel.tsx` |
| CLI spawning/args | `lib.rs` → `start_claude_session()` |
| CLI binary discovery | `lib.rs` → `find_claude_binary()`, `build_enriched_path()` |
| Provider/API config | `providerStore.ts`, `ProviderManager.tsx`, `lib.rs` → `resolve_provider_env()` |
| SDK control protocol | `protocol.rs`, `lib.rs` (stdout reader), `tauri-bridge.ts` (respondPermission) |
| File preview | `FilePreview.tsx`, `fileStore.ts` |
| Layout/panels | `AppShell.tsx` |
| InputBar behavior | `InputBar.tsx`, `TiptapEditor.tsx`, `commandStore.ts` |
| Theme/styling | `settingsStore.ts`, `App.tsx`, `App.css` |
| Tab switching | `chatStore.saveToCache/restoreFromCache`, `sessionStore.ts` |
| Rewind/checkpoints | `useRewind.ts`, `RewindPanel.tsx`, `lib.rs` → `rewind_files()` |
| i18n | `lib/i18n.ts` (zh/en translation maps) |
| Path encoding/decoding | `lib.rs` → `decode_project_name()` |
| Auto-update | `useAutoUpdateCheck.ts`, `UpdateButton.tsx` |
| CLI installation | `lib.rs` → `install_claude_cli()`, `install_cli_via_npm()`, `install_node_env_inner()` |
| Windows git-bash | `lib.rs` → `find_git_bash()`, `install_git_bash_inner()` |
| Logs / diagnostics bundle | `diagnostics.rs`, `lib/log-forwarder.ts`, `FeedbackTab.tsx`; log file at `~/Library/Logs/com.tinyzhuang.tokenicode/` (macOS) |

### Build Commands

```bash
# Frontend only (type check)
pnpm run build

# Rust only
cd src-tauri && cargo build

# Full app (dev mode)
pnpm tauri dev

# Full app (production build)
pnpm tauri build
```

### Key Constants

- Version: `0.8.0`
- Models: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- Session modes: `code` (acceptEdits), `ask` (default), `plan`, `bypass` (bypassPermissions)
- Thinking levels: `off`, `low`, `medium`, `high`, `max`
- Color themes: `black`, `blue`, `orange`, `green`
- Sidebar width: default 280px (persisted)
- Secondary panel tabs: `files`, `skills`
- Max output tokens: 64,000 (env var override)
- Node.js LTS for local install: v22.22.0
- Title generation model: `claude-haiku-4-5-20251001`
- Data dirs: `~/.tokenicode/` (persistent), `~/Library/.../com.tinyzhuang.tokenicode/` (app data)

### Cross-Platform Notes

- **macOS**: Transparent title bar (traffic light area), login shell PATH/proxy capture, Xcode CLT-safe git resolution, `cocoa`/`objc` for dock icon
- **Windows**: `.cmd` shim handling via `cmd /C`, CREATE_NO_WINDOW flag, PortableGit auto-install, PE header validation, nvm/volta/fnm PATH discovery, user PATH modification via PowerShell
- **Linux**: xdg-open for file manager, common terminal emulator detection for login
