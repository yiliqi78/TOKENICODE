<div align="center">

<img src="icon/图标.svg" alt="TOKENICODE Logo" width="120" />

# TOKENICODE

### A Beautiful Native Desktop GUI for Claude Code

[![Version](https://img.shields.io/badge/version-0.1.1-blue?style=flat-square)](https://github.com/yiliqi78/TOKENICODE/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](#installation)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)

**TOKENICODE** wraps the powerful [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) in a rich, native desktop experience — with file exploration, session management, snapshot/rewind, slash commands, and more.

[**Download**](#installation) | [**Features**](#features-deep-dive)

---

**[English](README.md)** | **[中文](README_zh.md)** | **[日本語](README_ja.md)**

</div>

## Features at a Glance

| | | | |
|:---:|:---:|:---:|:---:|
| **Streaming Chat** | **File Explorer** | **Session Management** | **Snapshot & Rewind** |
| Real-time NDJSON streaming with thinking, writing, and tool-use indicators | Browse, preview, and edit project files with syntax highlighting | Persistent sessions with search, rename, export, and resume | Snapshot files before changes and roll back to any conversation turn |
| **Slash Commands** | **Command Palette** | **i18n** | **Themes** |
| Full Claude Code slash command support with autocomplete | Quick-access `Cmd+K` palette for all actions | Chinese & English with extensible translation system | Light, dark, and system themes with multiple accent colors |

## Quick Start

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- macOS 12+, Windows 10+, or Linux (with WebKit2GTK)

### Installation

#### macOS

Download the latest `.dmg` from [Releases](https://github.com/yiliqi78/TOKENICODE/releases), open it, and drag **TOKENICODE** to your Applications folder.

#### Windows

Download the latest `.msi` or `.exe` installer from [Releases](https://github.com/yiliqi78/TOKENICODE/releases) and run it.

#### Linux

Download the `.AppImage`, `.deb`, or `.rpm` package from [Releases](https://github.com/yiliqi78/TOKENICODE/releases).

### First Launch

1. Open TOKENICODE
2. Select a project folder from the welcome screen or input bar
3. Start chatting — the Claude CLI session runs seamlessly in the background

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

## Interface Preview

**Main Interface** — Three-panel layout
![Main Interface](screenshots/main-interface.png)

**Streaming Chat** — Real-time thinking & writing
![Streaming Chat](screenshots/streaming-chat.png)

**File Explorer** — Browse & preview with syntax highlighting
![File Explorer](screenshots/file-explorer.png)

**File Editing** — Built-in CodeMirror editor for 12+ languages
![File Editing](screenshots/file-editing.png)

**Slash Commands** — Autocomplete for all commands
![Slash Commands](screenshots/slash-commands.png)

**Snapshot & Rewind** — Roll back to any turn
![Rewind](screenshots/rewind.png)

**Skills Management** — Create, edit & manage skills
![Skills](screenshots/skills.png)

**HTML Preview** — Live preview of HTML files
![HTML Preview](screenshots/html-preview.png)

**Settings** — Themes, accent colors, i18n
![Settings](screenshots/settings.png)

## Contributing

Contributions are welcome! Please open an issue or pull request.

- Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
- Commit with conventional format: `feat: add new feature`
- Push and open a Pull Request

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
