# Changelog / 更新日志

All notable changes to TOKENICODE will be documented in this file.

本文件记录 TOKENICODE 的所有重要更新。

---

## [0.2.0] - 2026-02-16

### Added / 新增功能

#### CLI Auto-Detection, Installation & Login Wizard / CLI 自动检测、安装与登录引导

**English:**

TOKENICODE now automatically detects whether the Claude Code CLI is installed when launched for the first time. If the CLI is missing or the user is not logged in, a step-by-step setup wizard guides them through the entire process — no terminal required.

- **Auto-detection**: On app launch, checks if `claude` binary exists on the system using multiple search paths (PATH, `~/Library/Application Support/Claude/`, common global install paths).
- **One-click installation**: If the CLI is not found, users can install it directly from the app. The install script (`curl -fsSL https://claude.ai/install.sh | sh`) runs in the background with real-time streaming output displayed in the wizard.
- **Login flow**: After installation, the wizard checks authentication status. If not logged in, users can initiate OAuth login (`claude login`) which opens the browser automatically.
- **Skip option**: Users can skip the wizard at any step to proceed directly to the main interface.
- **Persistence**: Once completed or skipped, the wizard won't appear again on subsequent launches (stored in localStorage).
- **Cross-platform**: macOS/Linux use `curl | sh`, Windows uses `powershell -Command "irm ... | iex"`.
- **Bilingual UI**: All wizard strings are available in both Chinese and English.

**New Rust commands:**
- `check_claude_cli` — Detect CLI installation and version
- `install_claude_cli` — Run install script with streaming output
- `start_claude_login` — Initiate OAuth login flow
- `check_claude_auth` — Check authentication status via `claude doctor`

**New frontend components:**
- `SetupWizard` component (`src/components/setup/SetupWizard.tsx`)
- `setupStore` Zustand store (`src/stores/setupStore.ts`)

---

**中文：**

TOKENICODE 现在会在首次启动时自动检测系统中是否已安装 Claude Code CLI。如果未安装或未登录，应用会通过分步引导向导帮助用户完成整个设置过程，无需打开终端。

- **自动检测**：启动时检查系统中是否存在 `claude` 二进制文件，搜索路径包括 PATH、`~/Library/Application Support/Claude/`、常见全局安装路径等。
- **一键安装**：如果未找到 CLI，用户可以直接在应用内安装。安装脚本（`curl -fsSL https://claude.ai/install.sh | sh`）在后台运行，安装输出实时流式显示在向导界面中。
- **登录引导**：安装完成后，向导会检查认证状态。如果未登录，用户可以一键发起 OAuth 登录（`claude login`），浏览器会自动打开。
- **跳过选项**：用户可以在任意步骤跳过向导，直接进入主界面。
- **持久化**：完成或跳过后，后续启动不再显示向导（保存在 localStorage）。
- **跨平台支持**：macOS/Linux 使用 `curl | sh`，Windows 使用 `powershell -Command "irm ... | iex"`。
- **中英双语**：向导界面的所有文案均支持中英文切换。

**新增 Rust 命令：**
- `check_claude_cli` — 检测 CLI 安装状态和版本
- `install_claude_cli` — 运行安装脚本并流式输出
- `start_claude_login` — 发起 OAuth 登录流程
- `check_claude_auth` — 通过 `claude doctor` 检查认证状态

**新增前端组件：**
- `SetupWizard` 组件（`src/components/setup/SetupWizard.tsx`）
- `setupStore` Zustand 状态管理（`src/stores/setupStore.ts`）

#### Terminology: "Chat" → "Task" / 术语变更：「对话」→「任务」

**English:**

All user-facing text has been updated to use "Task" instead of "Chat" or "Conversation". This better reflects the tool-driven, goal-oriented workflow of Claude Code.

- "New Chat" → "New Task"
- "Search conversations" → "Search tasks"
- "No conversations yet" → "No tasks yet"
- All slash command descriptions, rewind labels, export menus, and sidebar labels updated accordingly.

**中文：**

所有用户界面文案中的「对话」已统一替换为「任务」，更贴合 Claude Code 面向目标的工作流。

- 「新对话」→「新任务」
- 「搜索对话」→「搜索任务」
- 「暂无对话」→「暂无任务」
- 侧栏、命令面板、回退面板、导出菜单等所有相关文案均已同步更新。

---

#### Auto-Hide Scrollbars / 滚动条自动隐藏

**English:**

All scrollbars across the app are now hidden by default and only appear when the user hovers over a scrollable area. This provides a cleaner, more immersive interface.

**中文：**

全局滚动条现在默认隐藏，仅在鼠标悬停于可滚动区域时显示，界面更加简洁沉浸。

---

#### Secondary Panel Tab Bar Fix / 右侧面板标签栏修复

**English:**

Fixed the secondary panel (Files/Agents/Skills/MCP) tab bar text wrapping when the panel is resized narrow. Tab labels now stay on a single line and clip gracefully. Also removed the unnecessary horizontal scrollbar at the bottom of the panel.

**中文：**

修复了右侧面板（文件/代理/技能/MCP）标签栏在面板缩窄时文字换行的问题。标签文字现在保持单行显示，溢出部分优雅裁切。同时移除了面板底部多余的水平滚动条。

---

### Fixed / 修复

#### Setup Wizard Auto-Dismiss & Terminal Login / 安装向导自动跳过与终端登录

**English:**

- The setup wizard no longer appears every time a new task is started. If the CLI is already installed and authenticated, the wizard auto-completes and never shows.
- Changed the login flow from in-app OAuth (which couldn't open the browser) to opening a native terminal window running `claude login`. The wizard polls for auth status and auto-advances once login succeeds.

**中文：**

- 安装向导不再在每次新建任务时弹出。如果 CLI 已安装且已认证，向导会自动完成，不再显示。
- 登录流程从应用内 OAuth（无法打开浏览器）改为打开原生终端窗口运行 `claude login`。向导会轮询认证状态，登录成功后自动进入下一步。

---

#### Slash Command Autocomplete Filtering / 斜杠命令自动补全过滤

**English:**

Fixed slash command autocomplete filtering. Previously, typing a letter after `/` would show almost all commands because the filter used `includes()` which matched any command containing that letter anywhere in the name (e.g., typing `a` matched `/plan`, `/clear`, `/compact`, etc.). Now commands whose name starts with the query are shown first, followed by description matches.

**中文：**

修复了斜杠命令自动补全的过滤逻辑。之前在 `/` 后输入字母会显示几乎所有命令，因为过滤使用了 `includes()` 匹配名称中任何位置的字母（例如输入 `a` 会匹配 `/plan`、`/clear`、`/compact` 等）。现在优先显示名称以输入字母开头的命令，其次显示描述匹配的命令。

---

#### Ask/Plan Mode Prefix for Follow-up Messages / Ask/Plan 模式跟进消息前缀

**English:**

Fixed Ask and Plan mode not being applied to follow-up messages in an active session. Previously the mode prefix (`/ask`, `/plan`) was only sent for the first message. Now the mode prefix is applied to all messages when Ask or Plan mode is active.

**中文：**

修复了 Ask 和 Plan 模式在活跃会话的跟进消息中不生效的问题。之前模式前缀（`/ask`、`/plan`）仅在首条消息中发送，现在 Ask 或 Plan 模式激活时，所有消息都会附带模式前缀。

---

#### Theme Color Overhaul / 主题色彩全面改版

**English:**

Redesigned the entire theme system with four new color themes, removed all liquid glass effects, and adopted Apple-style superellipse (squircle) rounded corners throughout the interface.

- **Four new themes**: Black (default, white accent), Blue (`#4E80F7`), Orange (`#C47252`), Green (`#57A64B`), replacing the old Purple/Orange/Green/Liquid Glass themes.
- **Removed liquid glass effects**: All `backdrop-filter`, `glass`, `glass-tint`, and `glass-hover-tint` utility classes have been removed. Panels now use solid light gray backgrounds for a cleaner look.
- **Superellipse corners**: Buttons (New Task, Send, Stop) use `rounded-[20px]`, avatars and small controls use `rounded-[10px]`, following Apple's squircle design language.
- **Full light/dark mode support**: Each theme defines separate light and dark mode palettes with consistent accent colors, gradients, and glow effects.
- **Theme-adaptive shadows**: Hardcoded `rgba()` shadow values replaced with CSS variable references (`var(--color-accent-glow)`) so running indicators and glow effects adapt to the active theme.
- **Dark mode user bubble fix**: Fixed dark mode user message bubble colors (`--color-bg-user-msg`) not matching their respective theme accent colors for Blue, Orange, and Green themes.

**Affected files:**
- `App.css` — Complete theme system rewrite
- `settingsStore.ts` — `ColorTheme` type updated to `'black' | 'blue' | 'orange' | 'green'`
- `App.tsx` — Theme accent color map and class switching logic
- `SettingsPanel.tsx` — Theme picker UI updated
- `i18n.ts` — Theme label translations
- All component files — Glass classes replaced with solid backgrounds

---

**中文：**

全面重新设计了主题系统，新增四套主题配色，移除所有毛玻璃效果，并在整个界面采用 Apple 风格的超椭圆（Squircle）圆角。

- **四套新主题**：黑色（默认，白色强调色）、蓝色（`#4E80F7`）、橙色（`#C47252`）、绿色（`#57A64B`），替代旧的紫色/橙色/绿色/毛玻璃主题。
- **移除毛玻璃效果**：所有 `backdrop-filter`、`glass`、`glass-tint`、`glass-hover-tint` 工具类已移除。面板改用纯色浅灰背景，视觉更简洁。
- **超椭圆圆角**：按钮（新任务、发送、停止）使用 `rounded-[20px]`，头像和小控件使用 `rounded-[10px]`，遵循 Apple 的 Squircle 设计语言。
- **完整的明暗模式支持**：每个主题分别定义明/暗模式调色板，强调色、渐变和发光效果保持一致。
- **主题自适应阴影**：硬编码的 `rgba()` 阴影值替换为 CSS 变量引用（`var(--color-accent-glow)`），运行指示器和发光效果随主题切换自动适配。
- **暗色模式气泡修复**：修复了蓝色、橙色、绿色主题在暗色模式下用户消息气泡颜色（`--color-bg-user-msg`）与主题强调色不一致的问题。

**涉及文件：**
- `App.css` — 主题系统完全重写
- `settingsStore.ts` — `ColorTheme` 类型更新为 `'black' | 'blue' | 'orange' | 'green'`
- `App.tsx` — 主题强调色映射和类名切换逻辑
- `SettingsPanel.tsx` — 主题选择器 UI 更新
- `i18n.ts` — 主题标签翻译
- 所有组件文件 — 毛玻璃类名替换为纯色背景

---

### Changed / 变更

- `settingsStore` now persists a `setupCompleted` flag to control wizard visibility.
- `WelcomeScreen` conditionally renders the setup wizard when `setupCompleted` is `false`.
- Setup wizard auto-detects CLI + auth status and skips entirely when both are satisfied.
- Login flow opens native Terminal.app instead of in-app OAuth.

- `settingsStore` 新增持久化字段 `setupCompleted`，用于控制向导是否显示。
- `WelcomeScreen` 在 `setupCompleted` 为 `false` 时显示安装引导向导。
- 安装向导自动检测 CLI 和认证状态，均通过时完全跳过。
- 登录流程改为打开原生终端而非应用内 OAuth。

---

## [0.1.1] - 2025

### Fixed / 修复

- Fixed rewind deleting project files
- Added error boundary

## [0.1.0] - 2025

### Added / 新增功能

- Initial release of TOKENICODE — a beautiful desktop GUI for Claude Code
- Chat interface with NDJSON streaming
- File explorer with preview and editing
- Session management (create, resume, delete, export)
- Snapshot/rewind system for code rollback
- Slash commands and skills support
- MCP server configuration panel
- Chinese/English bilingual interface
- macOS transparent titlebar with native integration
