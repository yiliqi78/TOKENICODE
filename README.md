<div align="center">

<img src="public/app-icon.png" alt="TOKENICODE Logo" width="120" />

# TOKENICODE

### A Beautiful Desktop Client for Claude Code

[![Version](https://img.shields.io/github/v/release/yiliqi78/TOKENICODE?style=flat-square&color=blue)](https://github.com/yiliqi78/TOKENICODE/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](#installation)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)

**TOKENICODE** wraps the powerful [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) in a polished desktop interface — bring your own API key, connect any provider, and get a native coding experience with file exploration, session management, and structured permission control.

[**Download**](https://github.com/yiliqi78/TOKENICODE/releases) · [**Features**](#features) · [**Screenshots**](#screenshots)

---

**[English](README.md)** | **[中文](README_zh.md)**

</div>

## Why TOKENICODE?

| | | | |
|:---:|:---:|:---:|:---:|
| 🔑 **Bring Your Own API** | 🇨🇳 **China-Ready** | 🛡️ **SDK Control Protocol** | 🎨 **Beautiful & Native** |
| 6 preset providers + custom endpoints. One-click config import/export. | Gitee mirror for updates, pre-configured Chinese API providers (DeepSeek, Zhipu GLM, Qwen, Kimi, MiniMax). | Structured permission approval — 4 work modes (code / ask / plan / bypass) with typed allow/deny over stdin. | Tauri 2 native desktop experience. Multiple themes × light/dark mode. |

<div align="center">

![Main Interface](screenshots/main-interface.png)

</div>

## Installation

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — TOKENICODE can auto-detect, install, and authenticate it for you on first launch

### macOS

Download the latest `.dmg` from [Releases](https://github.com/yiliqi78/TOKENICODE/releases), open it, and drag **TOKENICODE** to your Applications folder.

Available for both Apple Silicon (arm64) and Intel (x86_64). The app is code-signed and notarized — no extra steps needed.

### Windows

Download the latest `.msi` or `.exe` installer from [Releases](https://github.com/yiliqi78/TOKENICODE/releases) and run it. Requires Windows 10 or later.

### Linux

Download the `.AppImage`, `.deb`, or `.rpm` package from [Releases](https://github.com/yiliqi78/TOKENICODE/releases). Requires WebKit2GTK.

> **China users:** If GitHub downloads are slow, grab releases from the [Gitee mirror](https://gitee.com/yiliqiseven/TOKENICODE/releases). The app also checks Gitee for updates when GitHub is unreachable.

## Getting Started

1. **Open TOKENICODE** — if the Claude Code CLI is not installed, the setup wizard guides you through installation and login, no terminal required
2. **Select a project folder** from the welcome screen or input bar
3. **Start chatting** — the Claude CLI session runs seamlessly in the background
4. **Configure your API** (optional) — open Settings → API Provider to add third-party keys or import a config

## Features

### Third-Party API Providers

Use Claude through any compatible API endpoint — not just Anthropic's official API.

- **6 preset providers** in a visual 2×3 grid: Anthropic, DeepSeek, Zhipu GLM, Qwen Coder, Kimi k2, MiniMax
- **Custom endpoints** with Anthropic or OpenAI-compatible format
- **One-click JSON import** to share configs across machines
- **Quick connection test** with response time display (e.g. `326ms`)
- **Per-card export** for easy backup

### China-Ready

TOKENICODE is designed to work well behind the Great Firewall:

- **Gitee update mirror** — when GitHub is unreachable, auto-update falls back to Gitee
- **Chinese API presets** — DeepSeek, Zhipu GLM, Qwen Coder, Kimi k2, MiniMax are pre-configured with correct endpoints
- **Proxy auto-detection** — inherits system proxy environment variables on macOS
- **Full Chinese UI** — switch to Chinese from Settings at any time

### SDK Control Protocol

TOKENICODE v0.8.0 uses Claude CLI's native control protocol for permission handling:

- Permission requests flow as structured JSON through stdout
- Responses are typed `allow` / `deny` messages via stdin
- Switch between **code**, **ask**, **plan**, and **bypass** modes at runtime
- Change model on-the-fly without restarting the session

### Streaming Chat

Real-time conversation with Claude Code using NDJSON streaming. The UI shows distinct phases:

- **Thinking** — spinner animation while Claude reasons
- **Writing** — blue indicator as Claude composes its response
- **Tool execution** — animated display of file edits, shell commands, and more

### Session Management

All Claude Code sessions are persisted and fully manageable:

- **Pin** sessions to the top of each project group
- **Archive** sessions to hide them from the default view
- **Batch operations** — multi-select for bulk delete or archive
- **Date separators** — Today / Yesterday / This Week / Earlier
- **Smart collapse** — only the active project group auto-expands
- **AI title generation** — automatic short title after the first reply
- **Undo delete** — 5-second recovery window for accidental deletions
- **Search** with a running-sessions-only filter
- **Export** to Markdown or JSON, rename, resume any session

### File Explorer & Editor

Browse your project tree with full file management:

- **SVG file icons** for 20+ file types with color coding
- **Change markers** on files modified by Claude
- **Create new files and folders** via right-click context menu
- **Flat search** with relative path context
- **Built-in CodeMirror editor** with syntax highlighting for 12+ languages (Python, TypeScript, Rust, Go, Java, C++, SQL, Markdown, JSON, YAML, HTML, CSS, XML)
- **Double-click** to open in VS Code

### Checkpoints & Rewind

File restoration uses Claude CLI's native checkpoint system:

- Restore **code**, **conversation**, or **both** independently
- Powered by `--replay-user-messages` and CLI file checkpointing
- Integrated restore button in the conversation timeline

### Slash Commands & Command Palette

- Full Claude Code slash command support with autocomplete popover
- Shows built-in commands, project commands, and skills
- **Command Palette** (`Cmd+K` / `Ctrl+K`) for quick access to new chats, panel toggles, theme switching, and settings

### Agent Activity

Monitor Claude's sub-agents in real-time — see which agents are spawning, thinking, running tools, or completed.

### Skills & MCP

Manage Claude Code skills (edit, enable/disable, right-click context menu) and MCP server connections directly from the UI.

### Customization

- **Themes** — multiple accent colors with light, dark, and system-following modes
- **Languages** — full Chinese and English support, switchable from Settings
- **Font size** — adjustable with keyboard shortcuts
- **Thinking depth** — 5-level thinking depth control

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

> On Windows/Linux, replace `Cmd` with `Ctrl`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | [Tauri 2](https://tauri.app) |
| Frontend | [React 19](https://react.dev) + TypeScript 5.8 |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) |
| State management | [Zustand 5](https://zustand.docs.pmnd.rs) (10 stores) |
| Code editor | [CodeMirror 6](https://codemirror.net) |
| Bundler | [Vite 7](https://vite.dev) |
| Backend | Rust (tokio, reqwest, serde, notify) |
| Package manager | pnpm |

## Screenshots

**Main Interface** — Three-panel layout with sidebar, chat, and file explorer
![Main Interface](screenshots/main-interface.png)

**Streaming Chat** — Real-time thinking, writing, and tool execution
![Streaming Chat](screenshots/streaming-chat.png)

**Session Management** — Pin, archive, date groups, batch operations
![Session Management](screenshots/文件管理.png)

**File Explorer** — SVG icons, change markers, flat search
![File Explorer](screenshots/file-explorer.png)

**File Editing** — Built-in CodeMirror editor with syntax highlighting
![File Editing](screenshots/file-editing.png)

**Plan Mode** — SDK permission approval cards
![Plan Mode](screenshots/plan-mode.png)

**Agent Activity** — Monitor sub-agent tasks in real-time
![Agent Activity](screenshots/Agents.png)

**Skills Management** — Right-click context menu for skills
![Skills](screenshots/skills.png)

**HTML Preview** — Live preview of HTML files
![HTML Preview](screenshots/html-preview.png)

**Settings** — Four-tab layout with theme preview cards
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

**If you find TOKENICODE useful, please consider giving it a ⭐!**

</div>
