<div align="center">

<img src="icon/图标.svg" alt="TOKENICODE Logo" width="120" />

# TOKENICODE

### A Beautiful Native Desktop GUI for Claude Code

[![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](https://github.com/tinyzhuang/tokenicode/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](#installation)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust&logoColor=black)](https://www.rust-lang.org)

**TOKENICODE** wraps the powerful [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) in a rich, native desktop experience — with file exploration, session management, snapshot/rewind, slash commands, and more.

[**Download**](#installation) | [**Features**](#-features) | [**Development**](#-development) | [**Contributing**](#-contributing)

---

**[English](README.md)** | **[中文](README_zh.md)** | **[日本語](README_ja.md)**

</div>

## Features

| | | | |
|:---:|:---:|:---:|:---:|
| **Streaming Chat** | **File Explorer** | **Session Management** | **Snapshot & Rewind** |
| Real-time NDJSON streaming with thinking, writing, and tool-use indicators | Browse, preview, and edit project files with syntax highlighting | Persistent sessions with search, rename, export, and resume | Snapshot files before changes and roll back to any conversation turn |
| **Slash Commands** | **Command Palette** | **i18n** | **Themes** |
| Full Claude Code slash command support with autocomplete | Quick-access `Cmd+K` palette for all actions | Chinese & English with extensible translation system | Light, dark, and system themes with multiple accent colors |

## Screenshots

<div align="center">

> Screenshots will be added after the first public release.
>
> The app features a three-panel layout: sidebar with conversations, central chat panel, and a secondary panel for files/agents/settings.

</div>

## Quick Start

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- macOS 12+, Windows 10+, or Linux (with WebKit2GTK)

### Installation

#### macOS

Download the latest `.dmg` from [Releases](https://github.com/tinyzhuang/tokenicode/releases), open it, and drag **TOKENICODE** to your Applications folder.

#### Windows

Download the latest `.msi` installer from [Releases](https://github.com/tinyzhuang/tokenicode/releases) and run it.

#### Linux

Download the `.AppImage` or `.deb` package from [Releases](https://github.com/tinyzhuang/tokenicode/releases).

### First Launch

1. Open TOKENICODE
2. Select a project folder from the welcome screen or input bar
3. Start chatting — the Claude CLI session runs seamlessly in the background

## Development

### System Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org) | 18+ | JavaScript runtime |
| [pnpm](https://pnpm.io) | 9+ | Package manager |
| [Rust](https://rustup.rs) | 1.75+ | Backend compilation |
| [Tauri CLI](https://tauri.app) | 2.x | App bundling & dev server |

### Setup

```bash
# Clone the repository
git clone https://github.com/tinyzhuang/tokenicode.git
cd tokenicode

# Install dependencies
pnpm install

# Start development (launches Vite + Tauri)
pnpm tauri dev
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm tauri dev` | Development mode (Vite dev server + Tauri app) |
| `pnpm tauri build` | Build production app |
| `pnpm dev` | Frontend only (Vite on port 1420) |
| `pnpm build` | Type-check + Vite build (frontend) |
| `cargo check` | Rust type checking (from `src-tauri/`) |
| `cargo clippy` | Rust linting (from `src-tauri/`) |

### Project Structure

```
tokenicode/
├── src/                          # Frontend (React + TypeScript)
│   ├── components/
│   │   ├── chat/                 # Chat panel, messages, input, rewind, slash commands
│   │   ├── layout/               # App shell, sidebar, secondary panel
│   │   ├── files/                # File explorer, preview, project selector
│   │   ├── conversations/        # Session list, export
│   │   ├── commands/             # Command palette
│   │   ├── agents/               # Agent activity panel
│   │   ├── skills/               # Skills management panel
│   │   ├── mcp/                  # MCP server management
│   │   ├── settings/             # Settings panel
│   │   └── shared/               # Markdown renderer, image lightbox
│   ├── stores/                   # Zustand state (8 independent stores)
│   ├── hooks/                    # useClaudeStream, useFileAttachments, useRewind
│   └── lib/                      # tauri-bridge.ts, i18n.ts, turns.ts
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── lib.rs                # All Tauri command handlers
│   │   └── commands/             # Claude CLI process management
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/                       # Static assets
└── icon/                         # App icon SVGs
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        TOKENICODE                            │
├──────────────┬───────────────────┬───────────────────────────┤
│   Sidebar    │    Chat Panel     │     Secondary Panel       │
│              │                   │  (Files/Agents/Settings)  │
│ Conversations│  Messages         │                           │
│ Project      │  Input Bar        │  File Explorer            │
│ Selector     │  Slash Commands   │  File Preview (CodeMirror)│
│ Theme Toggle │  Rewind Panel     │  Agent Activity           │
│              │  Mode Selector    │  Skills Manager           │
│              │  Model Selector   │  MCP Servers              │
│              │                   │  Settings                 │
├──────────────┴───────────────────┴───────────────────────────┤
│                    Zustand Stores (8)                         │
│  chatStore · sessionStore · fileStore · settingsStore         │
│  snapshotStore · agentStore · skillStore · commandStore       │
├──────────────────────────────────────────────────────────────┤
│                  tauri-bridge.ts (IPC)                        │
├──────────────────────────────────────────────────────────────┤
│                   Tauri invoke() / events                     │
├──────────────────────────────────────────────────────────────┤
│                  Rust Backend (lib.rs)                        │
│  Session Mgmt · File Ops · Git · Skills · Agents · Watcher   │
├──────────────────────────────────────────────────────────────┤
│               Claude Code CLI (subprocess)                    │
│            --output-format stream-json                        │
└──────────────────────────────────────────────────────────────┘
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single IPC bridge (`tauri-bridge.ts`) | All frontend-backend calls go through one file — easy to audit and maintain |
| NDJSON streaming | Claude CLI outputs newline-delimited JSON; parsed line-by-line for real-time updates |
| 8 independent Zustand stores | Each concern is isolated — no monolithic state, easy to reason about |
| Transparent title bar | Native macOS look with traffic-light window controls |
| Snapshot before changes | Files are captured before Claude edits them, enabling safe rollback |
| Resume via `--resume` flag | Each follow-up spawns a new CLI process with the session ID |

## Tech Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| ![React](https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black) | 19.1 | UI framework |
| ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) | 5.8 | Type safety |
| ![Tailwind](https://img.shields.io/badge/-Tailwind%20CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) | 4.1 | Utility-first styling |
| ![Zustand](https://img.shields.io/badge/-Zustand-433E38?style=flat-square) | 5.0 | State management |
| ![CodeMirror](https://img.shields.io/badge/-CodeMirror-D30707?style=flat-square) | 6.x | Code editing & preview |
| ![Vite](https://img.shields.io/badge/-Vite-646CFF?style=flat-square&logo=vite&logoColor=white) | 7.0 | Build tool & dev server |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| ![Rust](https://img.shields.io/badge/-Rust-DEA584?style=flat-square&logo=rust&logoColor=black) | 2021 | Native backend |
| ![Tauri](https://img.shields.io/badge/-Tauri-FFC131?style=flat-square&logo=tauri&logoColor=white) | 2.0 | Desktop framework |
| ![Tokio](https://img.shields.io/badge/-Tokio-232323?style=flat-square) | 1.x | Async runtime |
| ![Serde](https://img.shields.io/badge/-Serde-DEA584?style=flat-square) | 1.x | Serialization |

## Features Deep Dive

### Streaming Chat

Real-time conversation with Claude Code using NDJSON streaming. The UI shows distinct phases — thinking, writing, and tool execution — with animated indicators for each.

### File Explorer

Browse your entire project tree with expand/collapse directories. Files modified by Claude are highlighted with change markers. Double-click to open in VS Code, or preview directly in the built-in CodeMirror editor with full syntax highlighting.

### Snapshot & Rewind

Every time Claude modifies a file, a snapshot is taken beforehand. Use the Rewind panel to roll back to any conversation turn — restoring code, conversation, or both independently.

### Session Management

All Claude Code sessions are persisted and searchable. Resume any previous session, rename it, export to Markdown/JSON, or reveal the session file in Finder.

### Slash Commands

Full support for all Claude Code slash commands (`/ask`, `/plan`, `/compact`, `/model`, etc.) with an autocomplete popover showing built-in commands, project commands, and skills.

### Command Palette

Press `Cmd+K` to open a quick-access command palette for starting new chats, toggling panels, switching themes, and more.

### Agent Activity

Monitor Claude's sub-agent activity in real-time. See which agents are spawning, thinking, running tools, or completed.

### Skills & MCP

Manage Claude Code skills (create, edit, enable/disable) and MCP server connections directly from the UI.

### File Editing

Edit files directly in the built-in CodeMirror editor with syntax highlighting for 12+ languages. Save changes without leaving the app.

### Internationalization

Full Chinese and English support. All user-facing strings go through a centralized i18n system. The locale can be changed from Settings.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `Cmd+N` | New chat |
| `Cmd+B` | Toggle sidebar |
| `Cmd+.` | Toggle file panel |
| `Cmd+,` | Open settings |
| `Cmd+Enter` | Send message |
| `Cmd++` / `Cmd+-` | Adjust font size |
| `Cmd+0` | Reset font size |
| `Escape` | Close overlay / cancel |

## Contributing

Contributions are welcome! Here's how to get started:

### Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes following the code style below
4. Commit with conventional format: `feat: add new feature`
5. Push and open a Pull Request

### Code Style

- **Frontend**: TypeScript strict mode, Tailwind CSS for styling, Zustand for state
- **Backend**: Standard Rust formatting (`cargo fmt`), Clippy warnings treated as errors
- **Commits**: Use conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`)

### Bug Reports

Please open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- OS and app version
- Console output (if applicable)

## License

This project is licensed under the **Apache License 2.0** — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Anthropic](https://anthropic.com) for Claude Code CLI
- [Tauri](https://tauri.app) for the native desktop framework
- [React](https://react.dev) and the open-source ecosystem

---

<div align="center">

**If you find TOKENICODE useful, please consider giving it a star!**

</div>
