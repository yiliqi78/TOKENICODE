# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TOKENICODE is a native desktop GUI for Claude Code (Anthropic's CLI), built with **Tauri 2 + React 19 + TypeScript + Tailwind CSS 4**. It wraps the Claude CLI in a rich interface with file exploration, session management, rewind/snapshot, and slash commands.

## Development Commands

```bash
# Install dependencies
pnpm install

# Development (starts Vite dev server + Tauri app)
pnpm tauri dev

# Build production app
pnpm tauri build

# Frontend only (Vite dev server on port 1420)
pnpm dev

# Type check + Vite build (frontend only)
pnpm build

# Rust checks (from src-tauri/)
cargo check
cargo clippy
```

Package manager is **pnpm**. The Tauri dev command automatically runs `pnpm dev` as its `beforeDevCommand`.

## Architecture

### IPC Bridge Pattern

All frontend↔backend communication goes through a single bridge file:

```
React Component → src/lib/tauri-bridge.ts → Tauri invoke() → src-tauri/src/lib.rs (Rust commands)
```

Backend→frontend events use Tauri's event system (`emit_to_frontend` / `listen()`). Key event channels:
- `claude:stream:{sessionId}` — NDJSON output from Claude CLI
- `claude:stderr:{sessionId}` — stderr output
- `claude:exit:{sessionId}` — process exit
- `fs:change` — file system watcher events

### Claude CLI Integration

The Rust backend spawns Claude CLI as a subprocess with `--output-format stream-json`. Sessions are managed per-process: first message spawns a new process, follow-ups use `--resume <session_id>` to continue the conversation in a new process.

### State Management

Eight independent **Zustand** stores in `src/stores/`:

| Store | Responsibility |
|-------|---------------|
| `chatStore` | Messages, session status, activity phase |
| `sessionStore` | Session list, selection, drafts, running state |
| `fileStore` | File tree, preview, editing, project selection |
| `settingsStore` | Theme, font size, layout, model/mode (persisted to localStorage) |
| `snapshotStore` | File snapshots for rewind functionality |
| `agentStore` | Available agents |
| `skillStore` | Available skills |
| `commandStore` | Command palette state |

### Frontend Structure

- `src/components/chat/` — Chat panel, message rendering, input bar, rewind, slash commands
- `src/components/layout/` — App shell, sidebar, secondary panel
- `src/components/files/` — File explorer, preview, project selector
- `src/components/conversations/` — Session list, export
- `src/hooks/` — `useClaudeStream` (stream parsing), `useFileAttachments`, `useRewind`
- `src/lib/tauri-bridge.ts` — All Tauri IPC calls (single source of truth for the native API)
- `src/lib/i18n.ts` — Chinese/English translations

### Rust Backend

- `src-tauri/src/lib.rs` — All Tauri command handlers (~1400 LOC): session management, file operations, git commands, skill/agent listing, file watching
- `src-tauri/src/commands/claude_process.rs` — Claude CLI process spawning and parameter types

### Key Design Decisions

- **Transparent title bar** with `titleBarStyle: "Transparent"` and `hiddenTitle: true` — components must account for the traffic light area on macOS
- **macOS-specific native code** via `cocoa`/`objc` crates for window customization
- **NDJSON streaming** — Claude CLI output is parsed line-by-line as newline-delimited JSON
- **Snapshot/rewind system** — files are snapshotted before Claude makes changes, enabling rollback
- **i18n** — all user-facing strings go through `src/lib/i18n.ts` (supports `zh` and `en`)
