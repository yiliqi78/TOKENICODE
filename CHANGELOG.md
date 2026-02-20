# Changelog / 更新日志

All notable changes to TOKENICODE will be documented in this file.

本文件记录 TOKENICODE 的所有重要更新。

---

## [0.5.0] - 2026-02-20

### New Features / 新功能

- **Plan Panel Redesign** — Plan panel moved from top slide-down overlay to a right-side sidebar (272px). Toggle button relocated to the input toolbar next to model selector. Panel state persists across session switches.

- **计划面板重构** — 计划面板从顶部弹出式覆盖层改为右侧边栏（272px）。切换按钮移至输入工具栏的模型选择器旁边。面板状态在切换会话时保持不变。

- **Thinking Streaming** — AI thinking process now streams in real-time with a collapsible panel, instead of waiting for completion. Uses `partialThinking` accumulation with live pulse cursor.

- **Thinking 流式输出** — AI 思考过程现在实时流式显示在可折叠面板中，无需等待完成。使用 `partialThinking` 累积机制和实时脉冲光标。

- **Edit Tool Diff View** — Edit tool results now show red/blue diff highlighting for removed/added lines, making code changes easier to review.

- **Edit 工具 Diff 视图** — Edit 工具结果现在以红蓝色差异高亮显示删除/新增的行，更容易审查代码变更。

- **Changelog in Settings** — "What's New" button added to Settings panel, allowing users to view release notes at any time.

- **设置面板更新内容入口** — 设置面板新增「查看更新内容」按钮，用户可随时查看版本更新说明。

### Bug Fixes / 修复

- **Markdown Image Preview (TK-101)** — Fixed local image preview in Tauri 2 webview. `file://` URLs don't work in WKWebView, so images are now loaded via `bridge.readFileBase64()` through the `AsyncImage` component. Supports click-to-zoom via lightbox.

- **Markdown 图片预览修复 (TK-101)** — 修复 Tauri 2 webview 中本地图片预览。`file://` URL 在 WKWebView 中不可用，现通过 `AsyncImage` 组件调用 `bridge.readFileBase64()` 加载。支持点击放大。

- **Plan Mode Exit Stuck (TK-105)** — Fixed ExitPlanMode re-delivery creating duplicate unresolved plan review cards. Added `block.id` dedup guard that detects when a plan_review already exists and is resolved, skipping the re-delivered event.

- **Plan Mode 退出卡死 (TK-105)** — 修复 ExitPlanMode 重新投递创建重复未解决的计划审核卡片。添加 `block.id` 去重保护，检测到已存在且已解决的 plan_review 时跳过重复事件。

- **Slash Command Cost Line (TK-209)** — Cost/Duration/Turns/Tokens summary for `/compact` and other commands now displays inside the `CommandProcessingCard` instead of as a separate assistant message.

- **Slash 命令成本行 (TK-209)** — `/compact` 等命令的 Cost/Duration/Turns/Tokens 摘要现在显示在 `CommandProcessingCard` 内部，而不是作为单独的助手消息。

- **AskUserQuestion Form Dedup (TK-103)** — Fixed duplicate question forms caused by `--include-partial-messages` re-delivery. Uses fixed sentinel ID for deduplication.

- **AskUserQuestion 表单去重 (TK-103)** — 修复 `--include-partial-messages` 重新投递导致的重复问题表单。使用固定哨兵 ID 去重。

- **AskUserQuestion Unicode (TK-106)** — Fixed Unicode escape sequences (`\u0026` etc.) not being rendered in question text.

- **AskUserQuestion Unicode (TK-106)** — 修复问题文本中 Unicode 转义序列（`\u0026` 等）未渲染的问题。

- **AskUserQuestion Skip State (TK-107)** — Fixed session status not updating after skipping or confirming a question, which could leave the session in a stuck state.

- **AskUserQuestion 跳过状态 (TK-107)** — 修复跳过或确认问题后会话状态未更新，可能导致会话卡住的问题。

- **Debug Info Leaking (TK-104)** — Filtered out internal debug messages from appearing in the chat stream.

- **调试信息泄漏 (TK-104)** — 过滤掉出现在聊天流中的内部调试信息。

- **Slash Command Card Stuck (TK-109)** — Fixed `CommandProcessingCard` never transitioning to completed state.

- **Slash 命令卡片卡死 (TK-109)** — 修复 `CommandProcessingCard` 永远不会转换为完成状态的问题。

- **Scroll Wheel Interception (TK-108)** — Fixed first upward scroll being intercepted by auto-scroll.

- **滚轮上滑拦截 (TK-108)** — 修复首次向上滚动被自动滚动拦截的问题。

- **Input Shrink (TK-206)** — Fixed input bar not shrinking after deleting text.

- **输入框收缩 (TK-206)** — 修复删除文字后输入框不自动收缩。

- **Attachment Persistence (TK-207)** — Pending attachments now persist across session switches via `SessionSnapshot`.

- **附件持久化 (TK-207)** — 待发送附件现在通过 `SessionSnapshot` 在会话切换时保持。

- **macOS File Access (TK-208)** — Added startup detection for Full Disk Access permission with guided setup dialog.

- **macOS 文件权限 (TK-208)** — 新增启动时全磁盘访问权限检测及引导设置对话框。

- **Session Rename Sync (TK-204)** — Custom session names now persist to disk and survive app restart.

- **会话重命名同步 (TK-204)** — 自定义会话名称现在持久化到磁盘，重启后保留。

### Changed / 变更

- User/AI message font sizes unified (TK-201)
- Sidebar and file tree font sizes reduced (TK-203)
- Ctrl+Tab quick switch between recent sessions (TK-005)
- Plan panel font size reduced to `text-xs` for compact display

- 用户/AI 消息字体大小统一 (TK-201)
- 侧栏和文件树字体缩小 (TK-203)
- Ctrl+Tab 快速切换最近两个会话 (TK-005)
- 计划面板字体缩小至 `text-xs`，显示更紧凑

---

## [0.4.4] - 2026-02-20

### New Features / 新功能

- **Windows CLI Detection** — Auto-detect Claude CLI on Windows via `where`, %LOCALAPPDATA%, npm global, Scoop, nvm-windows, and Volta paths. Windows `.cmd` files now spawn correctly via `cmd /C` with `CREATE_NO_WINDOW` flag.

- **Windows 全面适配** — 自动检测 Windows 上的 Claude CLI 安装路径，支持 npm 全局、Scoop、nvm-windows、Volta 等安装方式。修复 `.cmd` 文件启动和路径分隔符问题。

- **Cross-platform Path Handling** — All path operations (`split`, `pop`, `dirname`) now handle both `/` and `\` separators. Windows drive letter paths (`C:\...`) recognized throughout.

- **跨平台路径处理** — 所有路径操作兼容 `/` 和 `\` 分隔符，识别 Windows 盘符路径。

- **Token Usage Display** — Sidebar now shows input/output token counts (↑/↓) instead of dollar cost, with a status dot indicator.

- **Token 用量显示** — 侧栏显示输入/输出 token 数量（↑/↓），替代原先的美元消费显示。

- **YAML Frontmatter Preview** — Markdown file preview now renders YAML frontmatter as a styled metadata block instead of plain text.

- **YAML Frontmatter 渲染** — 文件预览中的 YAML frontmatter 以独立样式块展示，不再显示为纯文本。

### Bug Fixes / 修复

- **Scrollbar Styling** — Thin theme-aware scrollbars (5px) with consistent behavior regardless of OS "show scrollbar" setting. Removed aggressive global `overflow-x: clip` that was clipping ring/border effects.

- **滚动条样式优化** — 统一细滚动条（5px），主题色适配，修复因全局裁切导致的选中框/色彩圆形截断问题。

- **Session List Clipping** — Active session highlight no longer clips at container edge; switched from `border` to `ring` (box-shadow based).

- **会话列表截断修复** — 当前选中会话的高亮边框不再被容器裁切。

- **Input Bar Text Alignment** — Single-line input text now vertically centers within the input field.

- **输入框文字居中** — 单行输入文字在输入框内垂直居中。

---

## [0.4.3] - 2026-02-19

### Bug Fixes / 修复

- **History Attachment Display** — File attachments in historical sessions now render as styled chips instead of raw file paths.

- **历史附件显示修复** — 历史对话中的附加文件现在显示为卡片样式，而不是原始路径文本。

---

## [0.4.2] - 2026-02-19

### Bug Fixes / 修复

- **Session Switch Cache** — Fixed chat history disappearing when clicking "New Task" while a session is running. Background stream messages now correctly route to cache.

- **会话切换缓存修复** — 修复在运行中的会话点击"新任务"后聊天记录丢失的问题。

### New Features / 新功能

- **Long Message Collapse** — User messages longer than 12 lines collapse by default with expand/collapse toggle.

- **长消息折叠** — 超过 12 行的用户消息默认折叠，可点击展开/收起。

- **Auto-Expanding Input** — Chat input grows up to 50% of window height, then scrolls.

- **输入框自动增高** — 输入框随内容自动增高，最大到窗口高度的一半。

---

## [0.4.1] - 2026-02-19

### Bug Fixes / 修复

- **CJK Path Decoding** — Fixed project paths containing Chinese/CJK characters (e.g. `2026工作间`) being corrupted into slashes, causing empty file tree and broken session grouping. Now reads the authoritative `cwd` field from session JSONL instead of relying on lossy directory name decoding.

- **中文路径解码修复** — 修复包含中文字符的项目路径（如 `2026工作间`）被错误解码为斜杠，导致文件树为空、会话分组显示异常的严重 Bug。现在直接从 session JSONL 中读取真实的 `cwd` 路径，不再依赖有损的目录名解码。

---

## [0.4.0] - 2026-02-19

### Added / 新增功能

#### File Context Menu / 文件右键菜单

Full context menu for the file explorer: Copy Path, Copy File, Paste, Rename, Delete, and Insert to Chat. Directory operations (paste into, delete recursively) are supported.

文件管理器完整右键菜单：复制路径、拷贝文件、粘贴、重命名、删除、插入到聊天。支持文件夹操作（粘贴到目录、递归删除）。

#### File Tree Drag to Chat / 文件树拖拽到聊天

Drag files from the file tree directly into the chat input to attach them. Uses a custom mouse-based drag implementation to work around Tauri WKWebView's HTML5 drag-and-drop limitation.

从文件树拖拽文件到聊天输入框即可附加文件。采用自定义鼠标拖拽实现，绕过 Tauri WKWebView 的 HTML5 拖放限制。

#### Mode Selector Dropdown / 模式选择器下拉菜单

Replaced the horizontal button group with a compact dropdown selector for Code/Ask/Plan/Bypass modes. Opens upward from the input toolbar.

将水平按钮组替换为紧凑的下拉选择器，集成 Code/Ask/Plan/Bypass 模式。从输入工具栏向上弹出。

#### Editor Word Wrap / 编辑器自动折行

File preview and editor now wrap long lines automatically using `EditorView.lineWrapping`, both in edit and read-only mode.

文件预览和编辑器现在通过 `EditorView.lineWrapping` 自动折行，编辑和只读模式均生效。

### Fixed / 修复

#### File Tree Not Loading on Session Switch / 切换会话后文件树不加载

Fixed a critical bug where switching to a historical session showed an empty file tree. Root cause: `decode_project_name` in Rust shortened absolute paths to `~/...` format, which the frontend couldn't resolve. Now returns full absolute paths. Added `resolveProjectPath()` on the frontend as a safety net for tilde, absolute, and dash-encoded path formats.

修复切换到历史会话后文件树为空的严重 Bug。根因：Rust 端 `decode_project_name` 将绝对路径缩短为 `~/...` 格式，前端无法识别。现在始终返回完整绝对路径。前端新增 `resolveProjectPath()` 统一处理波浪号、绝对路径和 dash 编码路径。

#### Claude CLI Binary Path Resolution / Claude CLI 路径解析

Fixed "Failed to spawn claude" error after CLI updates. The version directory sorter used string comparison (`"2.1.9" > "2.1.41"`), now uses semantic version sorting. Also iterates all version directories instead of only checking the first one.

修复 CLI 更新后出现 "Failed to spawn claude" 错误。版本目录排序使用字符串比较导致排序错误（`"2.1.9" > "2.1.41"`），改为语义版本排序。同时遍历所有版本目录，而非仅检查第一个。

#### Export Missing User Messages / 导出缺少用户发言

Fixed exported markdown only containing Assistant messages. The JSONL parser matched `"human"` but actual CLI format uses `"user"`. Also handles both string and array content formats.

修复导出的 Markdown 只包含助手消息。JSONL 解析器匹配 `"human"` 但实际 CLI 格式为 `"user"`。同时处理字符串和数组两种内容格式。

#### Multi-Image Paste Collision / 多图粘贴文件名冲突

`save_temp_file` now generates unique filenames with timestamp + counter suffix, preventing multiple pasted images from overwriting each other.

`save_temp_file` 现在生成带时间戳和计数器后缀的唯一文件名，防止多张粘贴图片相互覆盖。

#### External File Drop Deduplication / 外部文件拖放去重

Added debounce guard and internal-drag detection to `onDragDropEvent`, preventing duplicate attachments from Tauri's multi-fire behavior and internal file tree drags.

为 `onDragDropEvent` 添加防抖保护和内部拖拽检测，防止 Tauri 多次触发和文件树内部拖拽导致的重复附件。

### Changed / 变更

#### Performance Optimization / 性能优化

- `MessageBubble` and `ToolUseMsg` wrapped with `React.memo` to prevent unnecessary re-renders
- `MarkdownRenderer` wrapped with `React.memo`; plugin arrays and components object stabilized with module-level constants and `useMemo`
- Merged `activityStatus` update into `updatePartialMessage` — reduced from 3 store `set()` calls to 1 per streaming text delta
- Auto-scroll changed from forced scroll-to-bottom to sticky-to-bottom pattern (only scrolls when user is within 80px of bottom)
- Auth check now tries instant credential file detection before falling back to `claude doctor` subprocess

- `MessageBubble` 和 `ToolUseMsg` 使用 `React.memo` 包裹，避免不必要的重渲染
- `MarkdownRenderer` 使用 `React.memo` 包裹；插件数组和组件对象通过模块级常量和 `useMemo` 稳定化
- `activityStatus` 更新合并到 `updatePartialMessage`——每次流式文本增量从 3 次 store `set()` 减少到 1 次
- 自动滚动从强制滚动到底部改为粘性滚动（仅当用户距底部 80px 以内时才滚动）
- 认证检查优先尝试即时的凭证文件检测，再回退到 `claude doctor` 子进程

#### Other / 其他

- Chat font size increased for better readability
- File tree and task list font size increased
- Session list loading spinner only shown on first load (not on background refresh)
- History system messages filtered out (no longer displayed as user bubbles)
- File preview auto-refreshes on external changes; manual refresh button added

- 聊天区正文字体加大
- 文件树和任务列表字体增大
- 会话列表加载动画仅在首次加载时显示（后台刷新不再显示）
- 历史记录系统消息已过滤（不再显示为用户气泡）
- 文件预览支持外部变更自动刷新，新增手动刷新按钮

---

## [0.3.0] - 2026-02-19

### Added / 新增功能

#### In-App Update / 应用内更新

Built-in update mechanism using `tauri-plugin-updater` + GitHub Releases. Users can now check for, download, and install updates directly from the Settings panel — no need to visit GitHub manually.

- "Check for Updates" button in Settings → About section
- Displays new version number when an update is available
- Download progress bar with percentage indicator
- One-click restart after update installation
- Update signing with Ed25519 keypair for secure distribution
- GitHub Actions workflow updated with signing environment variables

内置更新机制，基于 `tauri-plugin-updater` + GitHub Releases。用户现在可以在设置面板中直接检查、下载和安装更新，无需手动访问 GitHub。

- 设置面板「关于」区域新增「检查更新」按钮
- 有新版本时显示版本号
- 下载进度条及百分比
- 更新安装完成后一键重启
- Ed25519 签名密钥对确保更新分发安全
- GitHub Actions 工作流添加签名环境变量

#### Extended Thinking Toggle / 深度思考开关

New "Think" toggle button in the input toolbar. When enabled, Claude sessions start with `--settings '{"alwaysThinkingEnabled":true}'`.

- Persistent setting (saved in localStorage)
- Visual indicator: amber glow when active
- Passed through to Rust backend via `thinking_enabled` parameter

输入工具栏新增「Think」开关按钮。启用后 Claude 会话以深度思考模式启动。

- 设置持久化（保存在 localStorage）
- 视觉指示：启用时显示琥珀色高亮
- 通过 `thinking_enabled` 参数传递至 Rust 后端

#### Windows Platform Adaptation / Windows 平台适配

Cross-platform UI text now adapts to the detected OS:

- Keyboard shortcut hints: `⌘` on macOS → `Ctrl` on Windows/Linux
- File manager references: `Finder` → `Explorer` (Windows) / `Files` (Linux)
- Session path grouping: supports both Unix (`/Users/...`) and Windows (`C:\Users\...`) path formats
- New `platform.ts` utility with cached platform detection

UI 文本现在根据检测到的操作系统自适应：

- 快捷键提示：macOS 显示 `⌘`，Windows/Linux 显示 `Ctrl`
- 文件管理器名称：macOS `Finder` → Windows `资源管理器` / Linux `文件管理器`
- 会话路径分组：同时支持 Unix (`/Users/...`) 和 Windows (`C:\Users\...`) 路径格式
- 新增 `platform.ts` 工具，带缓存的平台检测

#### `/code` Slash Command

Added missing `/code` built-in command to switch back to default code mode.

新增 `/code` 内置命令，用于切换回默认 code 模式。

### Fixed / 修复

#### Project Path Decoding / 项目路径解码

Rewrote `decode_project_name` in Rust to handle directory names containing hyphens (e.g., `ppt-maker` was incorrectly decoded as `ppt/maker`). New algorithm greedily matches real filesystem segments from left to right.

重写 Rust 端的 `decode_project_name`，修复包含连字符的目录名被错误解码的问题（如 `ppt-maker` 被解码为 `ppt/maker`）。新算法从左到右贪心匹配真实的文件系统路径段。

#### Ask/Plan Mode Prefix Scope / Ask/Plan 模式前缀作用域

Mode prefix (`/ask`, `/plan`) is now only applied to the first message of a new session, not to follow-up messages. Previously, follow-up messages also received the prefix, which the CLI could misinterpret as a skill invocation.

模式前缀（`/ask`、`/plan`）现在只在新会话的首条消息中添加，不再应用于后续消息。之前后续消息也会附带前缀，CLI 可能将其误解为技能调用。

#### Window Dragging / 窗口拖拽

Replaced all manual `startDragging()` JS handlers with native `data-tauri-drag-region` attribute. Removed `getCurrentWindow()` imports from Sidebar, ChatPanel, SecondaryPanel, and AppShell.

用原生 `data-tauri-drag-region` 属性替代所有手动 `startDragging()` JS 处理。从 Sidebar、ChatPanel、SecondaryPanel、AppShell 中移除 `getCurrentWindow()` 导入。

#### Session Deletion Cleanup / 会话删除清理

Deleting the current session now properly clears session metadata and working directory, preventing stale state.

删除当前会话时现在会正确清理会话元数据和工作目录，防止残留状态。

#### Context Menu Clipping / 右键菜单裁切

File explorer context menu now detects viewport boundaries and repositions to stay fully visible. Z-index raised to `z-[9999]`.

文件管理器右键菜单现在检测视口边界并自动调整位置确保完全可见。Z-index 提升至 `z-[9999]`。

### Changed / 变更

- Model IDs updated: `claude-opus-4-0` → `claude-opus-4-6`, `claude-sonnet-4-0` → `claude-sonnet-4-6`, `claude-haiku-3-5` → `claude-haiku-4-5`
- Default font size: 14px → 18px
- Default sidebar width: 260px → 280px
- Dark mode text colors adjusted for better readability (`text-tertiary`, `text-muted`)
- Secondary panel tab text: `text-xs` → `text-sm`
- Session count label: `text-[10px]` → `text-[11px]`
- Version display in Settings now dynamically reads from Tauri `getVersion()` API instead of hardcoded string
- Agent cache saved/restored on session switch (via `agentStore.saveToCache`)
- localStorage migration (version 0 → 1) for model ID updates

---

## [0.2.1] - 2026-02-19

### Fixed / 修复

#### Model ID Update / 模型 ID 更新

Updated all model IDs to match the latest Anthropic API:
- `claude-opus-4-0` → `claude-opus-4-6`
- `claude-sonnet-4-0` → `claude-sonnet-4-6`
- `claude-haiku-3-5` → `claude-haiku-4-5`

Added localStorage migration (version 0 → 1) to automatically update persisted model selections.

更新所有模型 ID 以匹配最新的 Anthropic API：
- `claude-opus-4-0` → `claude-opus-4-6`
- `claude-sonnet-4-0` → `claude-sonnet-4-6`
- `claude-haiku-3-5` → `claude-haiku-4-5`

新增 localStorage 迁移（version 0 → 1），自动更新已保存的模型选择。

#### New Task Flow / 新建任务流程优化

- Sidebar "New Task" button now navigates to WelcomeScreen instead of directly opening folder picker
- WelcomeScreen button text changed from "新建任务" to "选择文件夹" with folder icon
- App starts at WelcomeScreen on every launch (workingDirectory no longer persisted)
- Deleting current session returns to WelcomeScreen

- 侧栏「新任务」按钮现在导航至 WelcomeScreen 而非直接弹出文件夹选择器
- WelcomeScreen 按钮文案从「新建任务」改为「选择文件夹」，图标改为文件夹
- 每次启动应用都从 WelcomeScreen 开始（workingDirectory 不再持久化）
- 删除当前会话后返回 WelcomeScreen

#### Session Grouping Fix / 会话分组修复

Fixed duplicate project groups in sidebar caused by path format mismatch between draft sessions (full path `/Users/xxx/...`) and historical sessions (`~/...`). Added `normalizeProjectKey` to unify grouping.

修复侧栏中同一文件夹出现两个分组的问题，原因是草稿会话（完整路径）和历史会话（`~/` 前缀路径）格式不一致。新增 `normalizeProjectKey` 统一分组键。

#### Titlebar Drag & Double-Click Maximize / 标题栏拖拽与双击最大化

- Switched from `titleBarStyle: "Transparent"` to `"Overlay"` for native macOS titlebar behavior
- Replaced JS `startDragging()` hacks with `data-tauri-drag-region` — system handles drag and double-click-to-maximize natively
- Removed manual cocoa `NSFullSizeContentViewWindowMask` setup (Tauri handles this with Overlay mode)

- 标题栏样式从 `Transparent` 切换为 `Overlay`，使用 macOS 原生标题栏行为
- 用 `data-tauri-drag-region` 替代 JS `startDragging()` hack——系统原生处理拖拽和双击最大化
- 移除手动设置的 cocoa `NSFullSizeContentViewWindowMask`（Overlay 模式下 Tauri 自动处理）

#### File Explorer Context Menu / 文件管理器右键菜单

- Fixed context menu text being clipped by window edge — added viewport boundary detection
- Increased z-index to `z-[9999]` to prevent overlay issues

- 修复右键菜单文字被窗口边界截断的问题——添加视口边界检测
- 提升 z-index 至 `z-[9999]` 防止图层遮挡

#### UI Consistency / UI 一致性

- Unified file tree font size (`text-sm` → `text-[13px]`) to match conversation list

- 统一文件树字体大小（`text-sm` → `text-[13px]`）与任务列表一致

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
