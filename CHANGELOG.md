# Changelog / 更新日志

All notable changes to TOKENICODE will be documented in this file.

本文件记录 TOKENICODE 的所有重要更新。

---

## [0.5.6] - 2026-02-24

### New Features

- **Tiptap Rich Text Editor** — Replaced the plain textarea with a tiptap contenteditable editor. File references now render as inline chips instead of raw text. FileChip nodes serialize to backtick-wrapped paths for Claude CLI.

- **Inline File Chip** — Dragging a file from the file manager into the input area inserts an inline chip at cursor position. Hover shows full path tooltip (position:fixed to escape overflow clipping). Click opens the file in the sidebar explorer.

- **Default Model Mappings** — Custom provider model mappings now ship with three pre-filled defaults: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001.

### Bug Fixes

- **Windows CLI PATH** — After `claude install`, if the CLI is still not found, automatically adds the installation directory to user PATH via PowerShell `[Environment]::SetEnvironmentVariable`.

- **Thinking Auto-Scroll** — The streaming thinking block now auto-scrolls to bottom as new content arrives, using a dedicated `thinkingPreRef`.

- **Multi-SubAgent Output Interruption** — Fixed single-tab scenario where sub-agent outputs could interrupt parent message flow. Added `parent_tool_use_id` check in `case 'result'`.

- **React #31 Crash** — Fixed `{text, type}` objects being rendered as JSX children (React Minified error #31). Added `safeContent()` helper to extract text strings.

- **Reinstall CLI Button** — Settings panel now shows a "Reinstall" button when CLI is detected, allowing users to re-run the installation.

### Changed

- **Default Model** — Changed from Opus 4.6 to Sonnet 4.6.
- **Default Thinking** — Changed from `high` to `off`; users choose their own thinking depth.
- **Settings Layout** — API provider and MCP servers moved to bottom under a distinct "Advanced" section header.
- **Rewind Button Hidden** — Temporarily hidden from UI pending UX refactor (TK-307).

---

### 新功能

- **Tiptap 富文本编辑器** — 用 tiptap contenteditable 替代原有 textarea。文件引用渲染为行内 chip，不再是纯文本。FileChip 节点序列化为反引号包裹的路径，传给 Claude CLI。

- **行内文件 Chip** — 从文件管理器拖拽文件到输入区，在光标位置插入行内 chip。悬停显示完整路径 tooltip（position:fixed 解决溢出裁剪）。点击在侧边栏打开文件。

- **默认模型映射** — 自定义提供商模型映射预填三个默认值：claude-opus-4-6、claude-sonnet-4-6、claude-haiku-4-5-20251001。

### 修复

- **Windows CLI PATH** — `claude install` 后若 CLI 仍不可用，自动通过 PowerShell `[Environment]::SetEnvironmentVariable` 将安装目录加入用户 PATH。

- **思考块自动滚动** — 流式思考块现在随内容生成自动滚到底部，使用专用 `thinkingPreRef`。

- **多子代理输出中断** — 修复单 tab 场景下子代理输出可能打断父消息流的问题，在 `case 'result'` 中添加 `parent_tool_use_id` 校验。

- **React #31 崩溃** — 修复 `{text, type}` 对象被当作 JSX 子节点渲染导致的 React Minified error #31，新增 `safeContent()` 辅助函数。

- **重新安装 CLI 按钮** — 设置面板在已检测到 CLI 时显示「重新安装」按钮。

### 变更

- **默认模型** — 从 Opus 4.6 改为 Sonnet 4.6。
- **默认思考** — 从 `high` 改为 `off`，用户自行选择思考深度。
- **设置布局** — API 提供商和 MCP 服务器移至底部，新增「高级」分区标题。
- **回退按钮隐藏** — 暂时从 UI 隐藏，等待 UX 重构（TK-307）。

---

## [0.5.5] - 2026-02-24

### New Features

- **Thinking 5-Level Selector** — Replaced the on/off toggle with Off / Low / Medium / High / Max levels. Uses CLI native `CLAUDE_CODE_EFFORT_LEVEL` environment variable. Fixed the bug where disabling thinking had no effect by explicitly passing `alwaysThinkingEnabled:false`.

- **Output Token Cap Raised** — Injects `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` via environment variable, doubling the per-turn output limit from 32K to 64K. Uses `entry().or_insert_with()` to respect user-defined values.

- **Token Warning + Auto-Compact** — Amber context warning appears when input tokens exceed 120K. At 160K, the app automatically sends `/compact` to reduce context size. Fires at most once per session.

- **Session Token Counter** — Sidebar now shows cumulative token usage across all turns, not just per-turn data.

- **Agent Monitoring Float Panel** — Agent status moved from sidebar tab to a floating top-bar button. Active agents show a pulsing badge. Clicking opens a popover with real-time phase tracking (thinking/writing/tool). Click away to dismiss.

- **API Route Indicator** — Top bar now shows the active API route: gray "CLI Route" badge for inherited config, blue "API Route · Anthropic" for official API, or blue "API Route · {provider}" for custom endpoints.

- **API Key UX Improvements** — API Key input now auto-saves with 800ms debounce (no manual Save button). Eye icon reveals the real decrypted key from Rust backend. Base URL input shows green "Saved" feedback with 600ms debounce.

### Bug Fixes

- **Unified Plan Approval Flow** — Completely reworked plan approval across all three session modes. Code mode transparently handles EnterPlanMode/ExitPlanMode tools (suppressed from UI) with automatic session recovery. Bypass mode routes by CLI alive/dead state. Plan mode switches to Code mode for execution. All modes now share a consistent approval flow.

- **Session Resume Fixes (6 items)** — Fixed Stop button causing stdinId leak; persisted `lastActiveSessionId` to localStorage for cross-restart recovery; added stall detection (red warning when turn exceeds 3 min with 0 output tokens); added `onSessionExit` backup event channel; `clearMessages()` now preserves sessionMeta; unified `resetSession()` across all "New Chat" entry points.

- **Permission Request Fix** — ANSI escape codes are now stripped before regex matching for permission prompts, fixing cases where permission cards wouldn't appear. Added "Holding" mechanism that pauses the generation status while awaiting user approval.

- **Chat UI Polish** — User message bubbles use smaller font (`text-sm`), tighter padding. File attachments upgraded from chips to cards with thumbnails and extension badges. Added hover copy button for user messages. AI output file paths are now clickable — opens the file in the sidebar file explorer.

- **File Explorer Theme Sync** — Change status badges (A/M/D) now use theme CSS variables instead of hardcoded colors, correctly following theme switching.

### Changed

- **Dead Code Cleanup** — Removed `src/hooks/useClaudeStream.ts` (never imported).
- **Agent Store** — New `agentStore.ts` with `getAgentDepth()` helper for calculating agent nesting depth.
- **Agent depth injection** — All message types (text, tool_use, tool_result, thinking, question, todo) now carry `agentDepth` for proper visual indentation of sub-agent operations.

---

### 新功能

- **Thinking 五档选择器** — Off / Low / Medium / High / Max 替代 on/off 开关，通过 CLI 原生 `CLAUDE_CODE_EFFORT_LEVEL` 环境变量控制思考深度。修复「关闭思考仍在思考」的 bug，现在显式传 `alwaysThinkingEnabled:false`。

- **Output Token 上限提升** — 注入 `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` 环境变量，单次回复上限从 32K 翻倍至 64K。使用 `entry().or_insert_with()` 不覆盖用户自定义值。

- **Token 预警 + Auto-compact** — 上下文超 120K 时显示琥珀色预警；超 160K 自动发送 `/compact` 压缩上下文，每会话至多触发一次。

- **会话 Token 累计计数** — 侧栏显示整个任务的总 Token 消耗，不再只显示单轮数据。

- **Agent 监控浮动面板** — 代理状态从侧边栏 tab 移至顶栏浮动按钮。活跃时脉冲徽章提示，点击弹出 popover，实时追踪 thinking/writing/tool 阶段。点击空白处关闭。

- **API 通路指示** — 顶栏显示当前 API 通路：继承配置时灰色「CLI 通路」，官方 API 时蓝色「API 通路 · Anthropic」，自定义时蓝色「API 通路 · {提供商}」。

- **API Key 体验优化** — API Key 输入即保存（800ms 防抖），移除手动保存按钮。Eye 图标点击显示 Rust 后端解密后的真实 Key。Base URL 输入新增绿色「已保存」反馈（600ms 防抖）。

### 修复

- **Plan 审批统一** — 全面重构三种会话模式的计划审批流程。Code 模式透明处理 EnterPlanMode/ExitPlanMode 工具（不在 UI 显示），CLI 退出后自动恢复会话。Bypass 模式按 CLI 存活状态分流。Plan 模式批准后切换 Code 模式执行。三种模式共享统一审批流程。

- **会话断点续传修复（6 项）** — 修复 Stop 按钮导致 stdinId 泄漏；`lastActiveSessionId` 持久化到 localStorage 支持跨重启恢复；新增 stall 检测（turn 超 3 分钟且输出为 0 时红色预警）；新增 `onSessionExit` 备用退出通道；`clearMessages()` 改为保留 sessionMeta；所有「新对话」入口统一使用 `resetSession()`。

- **权限请求修复** — 修复 ANSI 转义码导致权限弹窗正则匹配失败不显示的问题。新增 Holding 机制：弹窗等待期间暂停生成状态指示。

- **对话框 UI 优化** — 用户气泡字体缩小（`text-sm`）、padding 收紧。附件从 chip 升级为卡片（缩略图 + 扩展名角标）。新增 hover 复制按钮。AI 输出中的文件路径可点击，在侧边栏文件浏览器中打开。

- **文件管理器主题适配** — 变更标记（A/M/D）改用主题 CSS 变量，颜色随主题切换。

### 变更

- **死代码清理** — 移除 `src/hooks/useClaudeStream.ts`（从未被 import）。
- **Agent Store** — 新增 `agentStore.ts`，提供 `getAgentDepth()` 辅助函数计算代理嵌套深度。
- **代理深度注入** — 所有消息类型（text、tool_use、tool_result、thinking、question、todo）均注入 `agentDepth`，子代理操作正确缩进显示。

---

## [0.5.4] - 2026-02-21

### New Features

- **Third-Party API Provider Switching (TK-303)** — Built-in API provider switching in Settings panel. Three modes: Inherit (system config), Official API, Custom (third-party endpoint + API key + model mapping). Uses process-level env var injection — no global config file modification, no conflict with CC-Switch or other tools.

- **API Key Encrypted Storage** — Custom API keys are encrypted with AES-256-GCM and stored in `{app_data_dir}/credentials.enc`. Keys never touch localStorage. The Rust backend handles decryption transparently via a `USE_STORED_KEY` sentinel — the real key never crosses the IPC boundary during session startup.

- **Connection Test Button** — One-click API connectivity test in custom provider settings. Sends a minimal request to verify endpoint + authentication. Only HTTP 401 is treated as auth failure; all other server responses confirm the connection is working.

- **Model Name Mapping** — Map UI model tiers (Opus/Sonnet/Haiku) to provider-specific model names. The `--model` CLI argument is translated before process spawn, since Claude Code CLI does not support `ANTHROPIC_DEFAULT_*_MODEL` env vars.

- **Scroll to Bottom Button** — A floating "scroll to bottom" button appears when the user scrolls more than 300px away from the bottom of the chat. Smooth-scrolls back and resets auto-scroll lock.

- **CLI Management in Settings** — Check CLI status and reinstall Claude Code directly from the Settings panel, without going through the Setup Wizard again.

- **Stale Session Detection** — Environment fingerprint mechanism detects when API provider config changes mid-session. Kills pre-warmed processes with stale env vars and spawns fresh ones automatically.

- **Thinking Signature Auto-Retry** — When switching providers mid-conversation, resume may fail due to thinking block signature mismatch. The app automatically detects this error, abandons resume, and re-sends the user's message via a fresh session — no manual intervention needed.

### Bug Fixes

- **ANSI Escape Code Stripping** — CLI output displayed during installation or version checks no longer shows raw terminal escape sequences (`[?2026h`, `[1C`, etc.). Added `strip_ansi()` on the Rust side for all CLI output, plus frontend safety net in SetupWizard and CliSection.

- **Sub-Agent Tool Call Indentation** — Tool calls from sub-agents (Task tool) are now visually indented with a left accent border, making it easy to distinguish sub-agent operations from main agent operations.

- **Hidden Files Visible in File Tree** — The file explorer now shows dotfiles and dotfolders (`.claude`, `.github`, `.vscode`, etc.). Only `.git`, `.DS_Store`, `node_modules`, `target`, and `__pycache__` are hidden.

- **Delete File Dialog `{name}` Fix** — The delete confirmation dialog now correctly interpolates the filename instead of showing the literal `{name}` placeholder.

- **Delete to Trash** — File deletion now moves files to the system trash/recycle bin (via `trash` crate) instead of permanent deletion. Dialog text updated to reflect this.

- **Binary File Preview UX** — Changed "二进制文件无法预览" to "无法预览该文件" (friendlier wording). Added "Open with Default App" button to open the file in the system's default application.

- **UI Stuck on "Thinking" During Streaming** — Fixed the UI permanently showing "thinking" animation while the backend was actively outputting text. Root cause: `--include-partial-messages` sends intermediate `assistant` messages containing only thinking blocks (no text). These triggered aggressive `clearPartial()` calls that wiped `partialText` and reset `activityStatus.phase` from `writing` back to `thinking`. Fix: selective clearing (only wipe `partialText` when a text block is present), removed phase override in thinking block handler, and added save/restore of streaming state across intermediate messages. Same fix applied to background tab cache handler.

- **Windows CMD Flash Fix** — Fixed black console window flashing on every message send. The `where` command in `find_claude_binary()` now runs with `CREATE_NO_WINDOW` flag.

- **Windows/macOS CLI Path Fix** — `open_terminal_login` and `start_claude_login` now use enriched PATH and proper error handling instead of falling back to bare `claude.cmd`. TOKENICODE manages the CLI path internally — users never need terminal access.

---

### 新功能

- **第三方 API 切换 (TK-303)** — 设置面板内置 API 提供商切换功能。三种模式：继承系统配置、官方 API、自定义（第三方端点 + API Key + 模型映射）。通过进程级环境变量注入实现，不修改全局配置文件，与 CC-Switch 等工具互不冲突。

- **API Key 加密存储** — 自定义 API Key 使用 AES-256-GCM 加密存储于 `{app_data_dir}/credentials.enc`，不进入 localStorage。Rust 后端通过 `USE_STORED_KEY` 哨兵值透明解密，会话启动时真实密钥不经过 IPC。

- **连接测试按钮** — 自定义提供商设置中一键测试 API 连通性。发送最小请求验证端点和认证。仅 HTTP 401 视为认证失败，其他服务器响应均确认连接正常。

- **模型名称映射** — 将 UI 模型层级（Opus/Sonnet/Haiku）映射到提供商的模型名称。`--model` CLI 参数在进程启动前转换，因为 Claude Code CLI 不支持 `ANTHROPIC_DEFAULT_*_MODEL` 环境变量。

- **一键回到底部按钮** — 聊天区域向上滚动超过 300px 时显示浮动按钮，点击平滑滚动到底部并恢复自动跟随。

- **设置面板 CLI 管理** — 在设置面板中检查 CLI 状态并重新安装 Claude Code，无需再次进入安装向导。

- **过期会话检测** — 环境指纹机制检测会话期间 API 配置变更，自动终止带有旧环境变量的预热进程并重新启动。

- **Thinking 签名自动重试** — 对话中切换提供商时，resume 可能因 thinking block 签名不匹配而失败。应用自动检测此错误，放弃 resume 并通过全新会话重发用户消息，无需手动操作。

### 修复

- **ANSI 转义码过滤** — CLI 安装或版本检查时显示的输出不再出现原始终端控制序列。Rust 端所有 CLI 输出增加 `strip_ansi()` 处理，前端 SetupWizard 和 CliSection 也增加兜底过滤。

- **子代理工具调用缩进** — 子代理（Task 工具）的工具调用现在带有左侧强调色边框和缩进，方便区分主代理和子代理的操作。

- **文件树显示隐藏文件** — 文件浏览器现在显示点文件和点文件夹（`.claude`、`.github`、`.vscode` 等）。仅隐藏 `.git`、`.DS_Store`、`node_modules`、`target`、`__pycache__`。

- **删除文件对话框 `{name}` 修复** — 删除确认对话框现在正确显示文件名，不再显示字面量 `{name}`。

- **删除到回收站** — 文件删除改为移到系统回收站（通过 `trash` crate），不再永久删除。对话框文案同步更新。

- **二进制文件预览优化** — 文案从"二进制文件无法预览"改为"无法预览该文件"（更友好）。新增"使用默认应用打开"按钮。

- **UI 卡在「思考中」修复** — 修复后台持续输出文本时 UI 一直显示「思考中」动画的问题。根因：`--include-partial-messages` 发送的中间 `assistant` 消息仅包含 thinking block（无 text block），触发了 `clearPartial()` 清除 `partialText` 并将 `activityStatus.phase` 从 `writing` 重置为 `thinking`。修复：选择性清除（仅在有 text block 时才清除 `partialText`），移除 thinking block 处理中的 phase 覆盖，增加流式状态的保存/恢复机制。同步修复后台标签页缓存处理。

- **Windows CMD 窗口闪现修复** — 修复每次发送消息时黑色控制台窗口闪现。`find_claude_binary()` 中的 `where` 命令增加 `CREATE_NO_WINDOW` 标志。

- **Windows/macOS CLI 路径修复** — `open_terminal_login` 和 `start_claude_login` 改用 enriched PATH 和正确的错误处理。TOKENICODE 内部管理 CLI 路径，用户无需终端操作。

---

## [0.5.3] - 2026-02-21

### Changed

- **Apple Code Signing & Notarization** — Added Apple Developer ID certificate configuration to GitHub Actions release workflow. macOS builds are now signed and notarized, so users no longer need to run `xattr -cr` after downloading.

### Bug Fixes

- **Bypass Mode Plan Auto-Approval** — Fixed ExitPlanMode deadlock in bypass mode. When `--dangerously-skip-permissions` is active, plan review is now auto-approved immediately instead of waiting for manual user confirmation, preventing the session from hanging.

- **Plan Mode Exit Fix (TK-306)** — Fixed "Approve & Execute" button not working in Plan mode. The root cause was that the CLI process was started with `--mode plan`, and ExitPlanMode is broken at the SDK level. The fix kills the plan-mode process and restarts a new session in code mode using `resume_session_id` to carry over conversation context. Claude can now actually execute tools after plan approval.

- **Raw Stdin for Interactive Approvals** — Added `sendRawStdin` bridge command that sends plain text to CLI stdin without NDJSON wrapping. Used for interactive y/n prompts (PlanReview, ExitPlanMode) that require raw input instead of structured messages.

- **AskUserQuestion Duplicate Fix** — Fixed question forms appearing twice due to `--include-partial-messages` re-delivery overwriting `resolved: true` back to `false`.

---

### 变更

- **Apple 代码签名与公证** — 在 GitHub Actions 发布流程中配置了 Apple Developer ID 证书。macOS 构建产物现已签名并公证，用户下载后无需再执行 `xattr -cr`。

### 修复

- **Bypass 模式 Plan 自动审批** — 修复 bypass 模式下 ExitPlanMode 死锁问题。启用 `--dangerously-skip-permissions` 时，Plan 审批现在自动通过，不再等待用户手动确认，避免会话卡住。

- **Plan 模式退出修复 (TK-306)** — 修复 Plan 模式下"批准并执行"按钮无法正常工作的问题。根因是 CLI 进程以 `--mode plan` 启动，且 ExitPlanMode 在 SDK 层面存在 bug。修复方案：杀掉 plan 模式进程，以 code 模式重启新会话，通过 `resume_session_id` 继承对话上下文。批准后 Claude 现在能正常执行工具操作。

- **交互式审批原始 Stdin** — 新增 `sendRawStdin` 桥接命令，发送纯文本到 CLI stdin 而非 NDJSON 包装。用于需要原始输入的交互式 y/n 提示（PlanReview、ExitPlanMode）。

- **AskUserQuestion 重复表单修复** — 修复 `--include-partial-messages` 重新投递将已解决的问题重置为未解决，导致表单重复出现。

---

## [0.5.1] - 2026-02-20

### Changed

- **Code Block Syntax Colors (TK-211)** — Introduced dedicated `--syntax-*` CSS variables for syntax highlighting, decoupled from semantic colors (success/warning/error). Each of the 8 theme combinations (4 color themes × light/dark) now has a tailored palette that avoids color collisions with the theme accent.

- **CLI Direct Download (TK-302 v3)** — Replaced shell-script-based CLI installation (`curl | sh` / `irm | iex`) with Rust HTTP client direct download from Anthropic CDN. Streams binary with real-time progress, verifies SHA256 checksum, and runs `claude install` post-download. Works on all 6 platforms without requiring npm/curl/PowerShell.

- **Plan Panel Floating Overlay (TK-306)** — Plan panel is now a floating overlay with glassmorphism effect (backdrop blur, rounded corners, shadow) instead of a flex child that pushes main content. Button hidden when no plan content exists.

### Bug Fixes

- **Windows Spawn Error 193 (TK-305)** — Fixed Claude CLI failing to launch on Windows when installed via npm. The fallback binary name now uses `claude.cmd` on Windows, and the `where` lookup also searches for `claude.cmd`. Bare binary names without extensions are also wrapped via `cmd /C`.

---

### 变更

- **代码块语法配色优化 (TK-211)** — 引入独立的 `--syntax-*` CSS 变量用于语法高亮，与语义色（success/warning/error）解耦。8 种主题组合（4 色 × 明暗）各有定制配色，避免与主题强调色撞色。

- **CLI 直接下载安装 (TK-302 v3)** — 将基于脚本的 CLI 安装方式替换为 Rust HTTP 客户端直接从 Anthropic CDN 下载二进制文件。流式下载并实时显示进度，验证 SHA256 校验和，下载后自动运行 `claude install`。无需 npm/curl/PowerShell，支持全部 6 个平台。

- **Plan 面板浮动覆盖 (TK-306)** — Plan 面板改为磨砂玻璃效果的浮动覆盖层（背景模糊、圆角、阴影），不再挤压主聊天内容。无 Plan 内容时按钮自动隐藏。

### 修复

- **Windows 启动错误 193 (TK-305)** — 修复通过 npm 安装时 Windows 上无法启动 Claude CLI 的问题。回退二进制名在 Windows 下改为 `claude.cmd`，`where` 查找也会搜索 `claude.cmd`。无扩展名的裸二进制名也通过 `cmd /C` 启动。

---

## [0.5.0] - 2026-02-20

### New Features

- **Plan Panel Redesign** — Plan panel moved from top slide-down overlay to a right-side sidebar (272px). Toggle button relocated to the input toolbar next to model selector. Panel state persists across session switches.

- **Thinking Streaming** — AI thinking process now streams in real-time with a collapsible panel, instead of waiting for completion. Uses `partialThinking` accumulation with live pulse cursor.

- **Edit Tool Diff View** — Edit tool results now show red/blue diff highlighting for removed/added lines, making code changes easier to review.

- **Changelog in Settings** — "What's New" button added to Settings panel, allowing users to view release notes at any time.

### Bug Fixes

- **Markdown Image Preview (TK-101)** — Fixed local image preview in Tauri 2 webview. `file://` URLs don't work in WKWebView, so images are now loaded via `bridge.readFileBase64()` through the `AsyncImage` component. Supports click-to-zoom via lightbox.

- **Plan Mode Exit Stuck (TK-105)** — Fixed ExitPlanMode re-delivery creating duplicate unresolved plan review cards. Added `block.id` dedup guard that detects when a plan_review already exists and is resolved, skipping the re-delivered event.

- **Slash Command Cost Line (TK-209)** — Cost/Duration/Turns/Tokens summary for `/compact` and other commands now displays inside the `CommandProcessingCard` instead of as a separate assistant message.

- **AskUserQuestion Form Dedup (TK-103)** — Fixed duplicate question forms caused by `--include-partial-messages` re-delivery. Uses fixed sentinel ID for deduplication.

- **AskUserQuestion Unicode (TK-106)** — Fixed Unicode escape sequences (`\u0026` etc.) not being rendered in question text.

- **AskUserQuestion Skip State (TK-107)** — Fixed session status not updating after skipping or confirming a question, which could leave the session in a stuck state.

- **Debug Info Leaking (TK-104)** — Filtered out internal debug messages from appearing in the chat stream.

- **Slash Command Card Stuck (TK-109)** — Fixed `CommandProcessingCard` never transitioning to completed state.

- **Scroll Wheel Interception (TK-108)** — Fixed first upward scroll being intercepted by auto-scroll.

- **Input Shrink (TK-206)** — Fixed input bar not shrinking after deleting text.

- **Attachment Persistence (TK-207)** — Pending attachments now persist across session switches via `SessionSnapshot`.

- **macOS File Access (TK-208)** — Added startup detection for Full Disk Access permission with guided setup dialog.

- **Session Rename Sync (TK-204)** — Custom session names now persist to disk and survive app restart.

### Changed

- User/AI message font sizes unified (TK-201)
- Sidebar and file tree font sizes reduced (TK-203)
- Ctrl+Tab quick switch between recent sessions (TK-005)
- Plan panel font size reduced to `text-xs` for compact display

---

### 新功能

- **计划面板重构** — 计划面板从顶部弹出式覆盖层改为右侧边栏（272px）。切换按钮移至输入工具栏的模型选择器旁边。面板状态在切换会话时保持不变。

- **Thinking 流式输出** — AI 思考过程现在实时流式显示在可折叠面板中，无需等待完成。使用 `partialThinking` 累积机制和实时脉冲光标。

- **Edit 工具 Diff 视图** — Edit 工具结果现在以红蓝色差异高亮显示删除/新增的行，更容易审查代码变更。

- **设置面板更新内容入口** — 设置面板新增「查看更新内容」按钮，用户可随时查看版本更新说明。

### 修复

- **Markdown 图片预览修复 (TK-101)** — 修复 Tauri 2 webview 中本地图片预览。`file://` URL 在 WKWebView 中不可用，现通过 `AsyncImage` 组件调用 `bridge.readFileBase64()` 加载。支持点击放大。

- **Plan Mode 退出卡死 (TK-105)** — 修复 ExitPlanMode 重新投递创建重复未解决的计划审核卡片。添加 `block.id` 去重保护，检测到已存在且已解决的 plan_review 时跳过重复事件。

- **Slash 命令成本行 (TK-209)** — `/compact` 等命令的 Cost/Duration/Turns/Tokens 摘要现在显示在 `CommandProcessingCard` 内部，而不是作为单独的助手消息。

- **AskUserQuestion 表单去重 (TK-103)** — 修复 `--include-partial-messages` 重新投递导致的重复问题表单。使用固定哨兵 ID 去重。

- **AskUserQuestion Unicode (TK-106)** — 修复问题文本中 Unicode 转义序列（`\u0026` 等）未渲染的问题。

- **AskUserQuestion 跳过状态 (TK-107)** — 修复跳过或确认问题后会话状态未更新，可能导致会话卡住的问题。

- **调试信息泄漏 (TK-104)** — 过滤掉出现在聊天流中的内部调试信息。

- **Slash 命令卡片卡死 (TK-109)** — 修复 `CommandProcessingCard` 永远不会转换为完成状态的问题。

- **滚轮上滑拦截 (TK-108)** — 修复首次向上滚动被自动滚动拦截的问题。

- **输入框收缩 (TK-206)** — 修复删除文字后输入框不自动收缩。

- **附件持久化 (TK-207)** — 待发送附件现在通过 `SessionSnapshot` 在会话切换时保持。

- **macOS 文件权限 (TK-208)** — 新增启动时全磁盘访问权限检测及引导设置对话框。

- **会话重命名同步 (TK-204)** — 自定义会话名称现在持久化到磁盘，重启后保留。

### 变更

- 用户/AI 消息字体大小统一 (TK-201)
- 侧栏和文件树字体缩小 (TK-203)
- Ctrl+Tab 快速切换最近两个会话 (TK-005)
- 计划面板字体缩小至 `text-xs`，显示更紧凑

---

## [0.4.4] - 2026-02-20

### New Features

- **Windows CLI Detection** — Auto-detect Claude CLI on Windows via `where`, %LOCALAPPDATA%, npm global, Scoop, nvm-windows, and Volta paths. Windows `.cmd` files now spawn correctly via `cmd /C` with `CREATE_NO_WINDOW` flag.

- **Cross-platform Path Handling** — All path operations (`split`, `pop`, `dirname`) now handle both `/` and `\` separators. Windows drive letter paths (`C:\...`) recognized throughout.

- **Token Usage Display** — Sidebar now shows input/output token counts (↑/↓) instead of dollar cost, with a status dot indicator.

- **YAML Frontmatter Preview** — Markdown file preview now renders YAML frontmatter as a styled metadata block instead of plain text.

### Bug Fixes

- **Scrollbar Styling** — Thin theme-aware scrollbars (5px) with consistent behavior regardless of OS "show scrollbar" setting. Removed aggressive global `overflow-x: clip` that was clipping ring/border effects.

- **Session List Clipping** — Active session highlight no longer clips at container edge; switched from `border` to `ring` (box-shadow based).

- **Input Bar Text Alignment** — Single-line input text now vertically centers within the input field.

---

### 新功能

- **Windows 全面适配** — 自动检测 Windows 上的 Claude CLI 安装路径，支持 npm 全局、Scoop、nvm-windows、Volta 等安装方式。修复 `.cmd` 文件启动和路径分隔符问题。

- **跨平台路径处理** — 所有路径操作兼容 `/` 和 `\` 分隔符，识别 Windows 盘符路径。

- **Token 用量显示** — 侧栏显示输入/输出 token 数量（↑/↓），替代原先的美元消费显示。

- **YAML Frontmatter 渲染** — 文件预览中的 YAML frontmatter 以独立样式块展示，不再显示为纯文本。

### 修复

- **滚动条样式优化** — 统一细滚动条（5px），主题色适配，修复因全局裁切导致的选中框/色彩圆形截断问题。

- **会话列表截断修复** — 当前选中会话的高亮边框不再被容器裁切。

- **输入框文字居中** — 单行输入文字在输入框内垂直居中。

---

## [0.4.3] - 2026-02-19

### Bug Fixes

- **History Attachment Display** — File attachments in historical sessions now render as styled chips instead of raw file paths.

---

### 修复

- **历史附件显示修复** — 历史对话中的附加文件现在显示为卡片样式，而不是原始路径文本。

---

## [0.4.2] - 2026-02-19

### Bug Fixes

- **Session Switch Cache** — Fixed chat history disappearing when clicking "New Task" while a session is running. Background stream messages now correctly route to cache.

### New Features

- **Long Message Collapse** — User messages longer than 12 lines collapse by default with expand/collapse toggle.

- **Auto-Expanding Input** — Chat input grows up to 50% of window height, then scrolls.

---

### 修复

- **会话切换缓存修复** — 修复在运行中的会话点击"新任务"后聊天记录丢失的问题。

### 新功能

- **长消息折叠** — 超过 12 行的用户消息默认折叠，可点击展开/收起。

- **输入框自动增高** — 输入框随内容自动增高，最大到窗口高度的一半。

---

## [0.4.1] - 2026-02-19

### Bug Fixes

- **CJK Path Decoding** — Fixed project paths containing Chinese/CJK characters (e.g. `2026工作间`) being corrupted into slashes, causing empty file tree and broken session grouping. Now reads the authoritative `cwd` field from session JSONL instead of relying on lossy directory name decoding.

---

### 修复

- **中文路径解码修复** — 修复包含中文字符的项目路径（如 `2026工作间`）被错误解码为斜杠，导致文件树为空、会话分组显示异常的严重 Bug。现在直接从 session JSONL 中读取真实的 `cwd` 路径，不再依赖有损的目录名解码。

---

## [0.4.0] - 2026-02-19

### New Features

#### File Context Menu

Full context menu for the file explorer: Copy Path, Copy File, Paste, Rename, Delete, and Insert to Chat. Directory operations (paste into, delete recursively) are supported.

#### File Tree Drag to Chat

Drag files from the file tree directly into the chat input to attach them. Uses a custom mouse-based drag implementation to work around Tauri WKWebView's HTML5 drag-and-drop limitation.

#### Mode Selector Dropdown

Replaced the horizontal button group with a compact dropdown selector for Code/Ask/Plan/Bypass modes. Opens upward from the input toolbar.

#### Editor Word Wrap

File preview and editor now wrap long lines automatically using `EditorView.lineWrapping`, both in edit and read-only mode.

### Bug Fixes

#### File Tree Not Loading on Session Switch

Fixed a critical bug where switching to a historical session showed an empty file tree. Root cause: `decode_project_name` in Rust shortened absolute paths to `~/...` format, which the frontend couldn't resolve. Now returns full absolute paths. Added `resolveProjectPath()` on the frontend as a safety net for tilde, absolute, and dash-encoded path formats.

#### Claude CLI Binary Path Resolution

Fixed "Failed to spawn claude" error after CLI updates. The version directory sorter used string comparison (`"2.1.9" > "2.1.41"`), now uses semantic version sorting. Also iterates all version directories instead of only checking the first one.

#### Export Missing User Messages

Fixed exported markdown only containing Assistant messages. The JSONL parser matched `"human"` but actual CLI format uses `"user"`. Also handles both string and array content formats.

#### Multi-Image Paste Collision

`save_temp_file` now generates unique filenames with timestamp + counter suffix, preventing multiple pasted images from overwriting each other.

#### External File Drop Deduplication

Added debounce guard and internal-drag detection to `onDragDropEvent`, preventing duplicate attachments from Tauri's multi-fire behavior and internal file tree drags.

### Changed

#### Performance Optimization

- `MessageBubble` and `ToolUseMsg` wrapped with `React.memo` to prevent unnecessary re-renders
- `MarkdownRenderer` wrapped with `React.memo`; plugin arrays and components object stabilized with module-level constants and `useMemo`
- Merged `activityStatus` update into `updatePartialMessage` — reduced from 3 store `set()` calls to 1 per streaming text delta
- Auto-scroll changed from forced scroll-to-bottom to sticky-to-bottom pattern (only scrolls when user is within 80px of bottom)
- Auth check now tries instant credential file detection before falling back to `claude doctor` subprocess

#### Other

- Chat font size increased for better readability
- File tree and task list font size increased
- Session list loading spinner only shown on first load (not on background refresh)
- History system messages filtered out (no longer displayed as user bubbles)
- File preview auto-refreshes on external changes; manual refresh button added

---

### 新功能

#### 文件右键菜单

文件管理器完整右键菜单：复制路径、拷贝文件、粘贴、重命名、删除、插入到聊天。支持文件夹操作（粘贴到目录、递归删除）。

#### 文件树拖拽到聊天

从文件树拖拽文件到聊天输入框即可附加文件。采用自定义鼠标拖拽实现，绕过 Tauri WKWebView 的 HTML5 拖放限制。

#### 模式选择器下拉菜单

将水平按钮组替换为紧凑的下拉选择器，集成 Code/Ask/Plan/Bypass 模式。从输入工具栏向上弹出。

#### 编辑器自动折行

文件预览和编辑器现在通过 `EditorView.lineWrapping` 自动折行，编辑和只读模式均生效。

### 修复

#### 切换会话后文件树不加载

修复切换到历史会话后文件树为空的严重 Bug。根因：Rust 端 `decode_project_name` 将绝对路径缩短为 `~/...` 格式，前端无法识别。现在始终返回完整绝对路径。前端新增 `resolveProjectPath()` 统一处理波浪号、绝对路径和 dash 编码路径。

#### Claude CLI 路径解析

修复 CLI 更新后出现 "Failed to spawn claude" 错误。版本目录排序使用字符串比较导致排序错误（`"2.1.9" > "2.1.41"`），改为语义版本排序。同时遍历所有版本目录，而非仅检查第一个。

#### 导出缺少用户发言

修复导出的 Markdown 只包含助手消息。JSONL 解析器匹配 `"human"` 但实际 CLI 格式为 `"user"`。同时处理字符串和数组两种内容格式。

#### 多图粘贴文件名冲突

`save_temp_file` 现在生成带时间戳和计数器后缀的唯一文件名，防止多张粘贴图片相互覆盖。

#### 外部文件拖放去重

为 `onDragDropEvent` 添加防抖保护和内部拖拽检测，防止 Tauri 多次触发和文件树内部拖拽导致的重复附件。

### 变更

#### 性能优化

- `MessageBubble` 和 `ToolUseMsg` 使用 `React.memo` 包裹，避免不必要的重渲染
- `MarkdownRenderer` 使用 `React.memo` 包裹；插件数组和组件对象通过模块级常量和 `useMemo` 稳定化
- `activityStatus` 更新合并到 `updatePartialMessage`——每次流式文本增量从 3 次 store `set()` 减少到 1 次
- 自动滚动从强制滚动到底部改为粘性滚动（仅当用户距底部 80px 以内时才滚动）
- 认证检查优先尝试即时的凭证文件检测，再回退到 `claude doctor` 子进程

#### 其他

- 聊天区正文字体加大
- 文件树和任务列表字体增大
- 会话列表加载动画仅在首次加载时显示（后台刷新不再显示）
- 历史记录系统消息已过滤（不再显示为用户气泡）
- 文件预览支持外部变更自动刷新，新增手动刷新按钮

---

## [0.3.0] - 2026-02-19

### New Features

#### In-App Update

Built-in update mechanism using `tauri-plugin-updater` + GitHub Releases. Users can now check for, download, and install updates directly from the Settings panel — no need to visit GitHub manually.

- "Check for Updates" button in Settings → About section
- Displays new version number when an update is available
- Download progress bar with percentage indicator
- One-click restart after update installation
- Update signing with Ed25519 keypair for secure distribution
- GitHub Actions workflow updated with signing environment variables

#### Extended Thinking Toggle

New "Think" toggle button in the input toolbar. When enabled, Claude sessions start with `--settings '{"alwaysThinkingEnabled":true}'`.

- Persistent setting (saved in localStorage)
- Visual indicator: amber glow when active
- Passed through to Rust backend via `thinking_enabled` parameter

#### Windows Platform Adaptation

Cross-platform UI text now adapts to the detected OS:

- Keyboard shortcut hints: `⌘` on macOS → `Ctrl` on Windows/Linux
- File manager references: `Finder` → `Explorer` (Windows) / `Files` (Linux)
- Session path grouping: supports both Unix (`/Users/...`) and Windows (`C:\Users\...`) path formats
- New `platform.ts` utility with cached platform detection

#### `/code` Slash Command

Added missing `/code` built-in command to switch back to default code mode.

### Bug Fixes

#### Project Path Decoding

Rewrote `decode_project_name` in Rust to handle directory names containing hyphens (e.g., `ppt-maker` was incorrectly decoded as `ppt/maker`). New algorithm greedily matches real filesystem segments from left to right.

#### Ask/Plan Mode Prefix Scope

Mode prefix (`/ask`, `/plan`) is now only applied to the first message of a new session, not to follow-up messages. Previously, follow-up messages also received the prefix, which the CLI could misinterpret as a skill invocation.

#### Window Dragging

Replaced all manual `startDragging()` JS handlers with native `data-tauri-drag-region` attribute. Removed `getCurrentWindow()` imports from Sidebar, ChatPanel, SecondaryPanel, and AppShell.

#### Session Deletion Cleanup

Deleting the current session now properly clears session metadata and working directory, preventing stale state.

#### Context Menu Clipping

File explorer context menu now detects viewport boundaries and repositions to stay fully visible. Z-index raised to `z-[9999]`.

### Changed

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

### 新功能

#### 应用内更新

内置更新机制，基于 `tauri-plugin-updater` + GitHub Releases。用户现在可以在设置面板中直接检查、下载和安装更新，无需手动访问 GitHub。

- 设置面板「关于」区域新增「检查更新」按钮
- 有新版本时显示版本号
- 下载进度条及百分比
- 更新安装完成后一键重启
- Ed25519 签名密钥对确保更新分发安全
- GitHub Actions 工作流添加签名环境变量

#### 深度思考开关

输入工具栏新增「Think」开关按钮。启用后 Claude 会话以深度思考模式启动。

- 设置持久化（保存在 localStorage）
- 视觉指示：启用时显示琥珀色高亮
- 通过 `thinking_enabled` 参数传递至 Rust 后端

#### Windows 平台适配

UI 文本现在根据检测到的操作系统自适应：

- 快捷键提示：macOS 显示 `⌘`，Windows/Linux 显示 `Ctrl`
- 文件管理器名称：macOS `Finder` → Windows `资源管理器` / Linux `文件管理器`
- 会话路径分组：同时支持 Unix (`/Users/...`) 和 Windows (`C:\Users\...`) 路径格式
- 新增 `platform.ts` 工具，带缓存的平台检测

#### `/code` 命令

新增 `/code` 内置命令，用于切换回默认 code 模式。

### 修复

#### 项目路径解码

重写 Rust 端的 `decode_project_name`，修复包含连字符的目录名被错误解码的问题（如 `ppt-maker` 被解码为 `ppt/maker`）。新算法从左到右贪心匹配真实的文件系统路径段。

#### Ask/Plan 模式前缀作用域

模式前缀（`/ask`、`/plan`）现在只在新会话的首条消息中添加，不再应用于后续消息。之前后续消息也会附带前缀，CLI 可能将其误解为技能调用。

#### 窗口拖拽

用原生 `data-tauri-drag-region` 属性替代所有手动 `startDragging()` JS 处理。从 Sidebar、ChatPanel、SecondaryPanel、AppShell 中移除 `getCurrentWindow()` 导入。

#### 会话删除清理

删除当前会话时现在会正确清理会话元数据和工作目录，防止残留状态。

#### 右键菜单裁切

文件管理器右键菜单现在检测视口边界并自动调整位置确保完全可见。Z-index 提升至 `z-[9999]`。

### 变更

- 模型 ID 更新：`claude-opus-4-0` → `claude-opus-4-6`，`claude-sonnet-4-0` → `claude-sonnet-4-6`，`claude-haiku-3-5` → `claude-haiku-4-5`
- 默认字体大小：14px → 18px
- 默认侧栏宽度：260px → 280px
- 暗色模式文本颜色调整以提高可读性（`text-tertiary`、`text-muted`）
- 右侧面板标签文字：`text-xs` → `text-sm`
- 会话数标签：`text-[10px]` → `text-[11px]`
- 设置中的版本号改为从 Tauri `getVersion()` API 动态读取
- 会话切换时保存/恢复 Agent 缓存（通过 `agentStore.saveToCache`）
- localStorage 迁移（version 0 → 1）更新模型 ID

---

## [0.2.1] - 2026-02-19

### Bug Fixes

#### Model ID Update

Updated all model IDs to match the latest Anthropic API:
- `claude-opus-4-0` → `claude-opus-4-6`
- `claude-sonnet-4-0` → `claude-sonnet-4-6`
- `claude-haiku-3-5` → `claude-haiku-4-5`

Added localStorage migration (version 0 → 1) to automatically update persisted model selections.

#### New Task Flow

- Sidebar "New Task" button now navigates to WelcomeScreen instead of directly opening folder picker
- WelcomeScreen button text changed from "新建任务" to "选择文件夹" with folder icon
- App starts at WelcomeScreen on every launch (workingDirectory no longer persisted)
- Deleting current session returns to WelcomeScreen

#### Session Grouping Fix

Fixed duplicate project groups in sidebar caused by path format mismatch between draft sessions (full path `/Users/xxx/...`) and historical sessions (`~/...`). Added `normalizeProjectKey` to unify grouping.

#### Titlebar Drag & Double-Click Maximize

- Switched from `titleBarStyle: "Transparent"` to `"Overlay"` for native macOS titlebar behavior
- Replaced JS `startDragging()` hacks with `data-tauri-drag-region` — system handles drag and double-click-to-maximize natively
- Removed manual cocoa `NSFullSizeContentViewWindowMask` setup (Tauri handles this with Overlay mode)

#### File Explorer Context Menu

- Fixed context menu text being clipped by window edge — added viewport boundary detection
- Increased z-index to `z-[9999]` to prevent overlay issues

#### UI Consistency

- Unified file tree font size (`text-sm` → `text-[13px]`) to match conversation list

---

### 修复

#### 模型 ID 更新

更新所有模型 ID 以匹配最新的 Anthropic API：
- `claude-opus-4-0` → `claude-opus-4-6`
- `claude-sonnet-4-0` → `claude-sonnet-4-6`
- `claude-haiku-3-5` → `claude-haiku-4-5`

新增 localStorage 迁移（version 0 → 1），自动更新已保存的模型选择。

#### 新建任务流程优化

- 侧栏「新任务」按钮现在导航至 WelcomeScreen 而非直接弹出文件夹选择器
- WelcomeScreen 按钮文案从「新建任务」改为「选择文件夹」，图标改为文件夹
- 每次启动应用都从 WelcomeScreen 开始（workingDirectory 不再持久化）
- 删除当前会话后返回 WelcomeScreen

#### 会话分组修复

修复侧栏中同一文件夹出现两个分组的问题，原因是草稿会话（完整路径）和历史会话（`~/` 前缀路径）格式不一致。新增 `normalizeProjectKey` 统一分组键。

#### 标题栏拖拽与双击最大化

- 标题栏样式从 `Transparent` 切换为 `Overlay`，使用 macOS 原生标题栏行为
- 用 `data-tauri-drag-region` 替代 JS `startDragging()` hack——系统原生处理拖拽和双击最大化
- 移除手动设置的 cocoa `NSFullSizeContentViewWindowMask`（Overlay 模式下 Tauri 自动处理）

#### 文件管理器右键菜单

- 修复右键菜单文字被窗口边界截断的问题——添加视口边界检测
- 提升 z-index 至 `z-[9999]` 防止图层遮挡

#### UI 一致性

- 统一文件树字体大小（`text-sm` → `text-[13px]`）与任务列表一致

---

## [0.2.0] - 2026-02-16

### New Features

#### CLI Auto-Detection, Installation & Login Wizard

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

#### Terminology: "Chat" → "Task"

All user-facing text has been updated to use "Task" instead of "Chat" or "Conversation". This better reflects the tool-driven, goal-oriented workflow of Claude Code.

- "New Chat" → "New Task"
- "Search conversations" → "Search tasks"
- "No conversations yet" → "No tasks yet"
- All slash command descriptions, rewind labels, export menus, and sidebar labels updated accordingly.

#### Auto-Hide Scrollbars

All scrollbars across the app are now hidden by default and only appear when the user hovers over a scrollable area. This provides a cleaner, more immersive interface.

#### Secondary Panel Tab Bar Fix

Fixed the secondary panel (Files/Agents/Skills/MCP) tab bar text wrapping when the panel is resized narrow. Tab labels now stay on a single line and clip gracefully. Also removed the unnecessary horizontal scrollbar at the bottom of the panel.

### Bug Fixes

#### Setup Wizard Auto-Dismiss & Terminal Login

- The setup wizard no longer appears every time a new task is started. If the CLI is already installed and authenticated, the wizard auto-completes and never shows.
- Changed the login flow from in-app OAuth (which couldn't open the browser) to opening a native terminal window running `claude login`. The wizard polls for auth status and auto-advances once login succeeds.

#### Slash Command Autocomplete Filtering

Fixed slash command autocomplete filtering. Previously, typing a letter after `/` would show almost all commands because the filter used `includes()` which matched any command containing that letter anywhere in the name (e.g., typing `a` matched `/plan`, `/clear`, `/compact`, etc.). Now commands whose name starts with the query are shown first, followed by description matches.

#### Ask/Plan Mode Prefix for Follow-up Messages

Fixed Ask and Plan mode not being applied to follow-up messages in an active session. Previously the mode prefix (`/ask`, `/plan`) was only sent for the first message. Now the mode prefix is applied to all messages when Ask or Plan mode is active.

#### Theme Color Overhaul

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

### Changed

- `settingsStore` now persists a `setupCompleted` flag to control wizard visibility.
- `WelcomeScreen` conditionally renders the setup wizard when `setupCompleted` is `false`.
- Setup wizard auto-detects CLI + auth status and skips entirely when both are satisfied.
- Login flow opens native Terminal.app instead of in-app OAuth.

---

### 新功能

#### CLI 自动检测、安装与登录引导

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

#### 术语变更：「对话」→「任务」

所有用户界面文案中的「对话」已统一替换为「任务」，更贴合 Claude Code 面向目标的工作流。

- 「新对话」→「新任务」
- 「搜索对话」→「搜索任务」
- 「暂无对话」→「暂无任务」
- 侧栏、命令面板、回退面板、导出菜单等所有相关文案均已同步更新。

#### 滚动条自动隐藏

全局滚动条现在默认隐藏，仅在鼠标悬停于可滚动区域时显示，界面更加简洁沉浸。

#### 右侧面板标签栏修复

修复了右侧面板（文件/代理/技能/MCP）标签栏在面板缩窄时文字换行的问题。标签文字现在保持单行显示，溢出部分优雅裁切。同时移除了面板底部多余的水平滚动条。

### 修复

#### 安装向导自动跳过与终端登录

- 安装向导不再在每次新建任务时弹出。如果 CLI 已安装且已认证，向导会自动完成，不再显示。
- 登录流程从应用内 OAuth（无法打开浏览器）改为打开原生终端窗口运行 `claude login`。向导会轮询认证状态，登录成功后自动进入下一步。

#### 斜杠命令自动补全过滤

修复了斜杠命令自动补全的过滤逻辑。之前在 `/` 后输入字母会显示几乎所有命令，因为过滤使用了 `includes()` 匹配名称中任何位置的字母（例如输入 `a` 会匹配 `/plan`、`/clear`、`/compact` 等）。现在优先显示名称以输入字母开头的命令，其次显示描述匹配的命令。

#### Ask/Plan 模式跟进消息前缀

修复了 Ask 和 Plan 模式在活跃会话的跟进消息中不生效的问题。之前模式前缀（`/ask`、`/plan`）仅在首条消息中发送，现在 Ask 或 Plan 模式激活时，所有消息都会附带模式前缀。

#### 主题色彩全面改版

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

### 变更

- `settingsStore` 新增持久化字段 `setupCompleted`，用于控制向导是否显示。
- `WelcomeScreen` 在 `setupCompleted` 为 `false` 时显示安装引导向导。
- 安装向导自动检测 CLI 和认证状态，均通过时完全跳过。
- 登录流程改为打开原生终端而非应用内 OAuth。

---

## [0.1.1] - 2025

### Fixed

- Fixed rewind deleting project files
- Added error boundary

---

### 修复

- 修复 rewind 删除项目文件
- 新增错误边界

---

## [0.1.0] - 2025

### New Features

- Initial release of TOKENICODE — a beautiful desktop GUI for Claude Code
- Chat interface with NDJSON streaming
- File explorer with preview and editing
- Session management (create, resume, delete, export)
- Snapshot/rewind system for code rollback
- Slash commands and skills support
- MCP server configuration panel
- Chinese/English bilingual interface
- macOS transparent titlebar with native integration

---

### 新功能

- TOKENICODE 首发 — Claude Code 的桌面 GUI 客户端
- 基于 NDJSON 流式传输的聊天界面
- 文件浏览器，支持预览和编辑
- 会话管理（创建、恢复、删除、导出）
- 快照/回退系统，支持代码回滚
- Slash 命令和技能支持
- MCP 服务器配置面板
- 中英双语界面
- macOS 透明标题栏原生集成
