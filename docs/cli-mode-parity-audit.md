# TOKENICODE 四种模式机制审计与 CLI UX 对齐方案

> 创建日期：2026-02-24  
> 目标：把 TOKENICODE 的 `plan/code/ask/bypass` 彻底对齐 Claude Code CLI 原生模式，避免 Plan 卡住，并实现“简洁、优雅、顺畅”的原生体验。

## 1. 官方机制（先看文档结论）

基于官方文档（见文末链接）与本机 `claude 2.1.52` 校验：

1. CLI 现行核心是 **permission mode**，即 `--permission-mode`，可选：
   - `default`
   - `acceptEdits`
   - `plan`
   - `bypassPermissions`
   - `dontAsk`
2. 文档中交互切换描述为：`normal(default)` / `auto-accept-edits` / `plan`。
3. `--mode ask|plan` 不是当前主线参数（本机实测 `--mode` 会报 unknown option）。
4. `--permission-prompt-tool` 存在，可用于结构化权限审批桥接。

结论：TOKENICODE 应以 `permission-mode` 为主轴，前端不应再模拟一套“伪 mode 协议”。

## 2. 当前客户端实现现状（代码审计）

### 2.1 参数层偏差（高风险）

1. 后端无条件加 `--dangerously-skip-permissions`。  
   参考：`src-tauri/src/lib.rs:745`
2. ask/plan 模式继续传 `--mode ask|plan`。  
   参考：`src-tauri/src/lib.rs:750`
3. 前端参数结构仍是 `session_mode`（ask/plan）+ `dangerously_skip_permissions`。  
   参考：`src/lib/tauri-bridge.ts:17`

这导致“模式语义”与官方 CLI 参数不一致。

### 2.2 模式链路不一致（中高风险）

1. UI 定义四模式：`code/ask/plan/bypass`。  
   参考：`src/components/chat/ModeSelector.tsx:5`
2. 预热会话（pre-warm）未传 `session_mode`，只传 bypass bool。  
   参考：`src/components/chat/ChatPanel.tsx:761`

这会让“首轮请求”与用户当前选择的模式不一致。

### 2.3 Plan 流程被前端过度接管（核心问题）

前端对 `ExitPlanMode` 做了多通道拦截与自定义流程：

1. `stream_event` 中造 `plan_review` 卡。  
   参考：`src/components/chat/InputBar.tsx:1279`
2. `assistant` block 再造一次 `plan_review`。  
   参考：`src/components/chat/InputBar.tsx:1468`
3. `stderr` 再做回退检测。  
   参考：`src/components/chat/InputBar.tsx:1994`
4. 用户点批准后，前端会 kill/restart 并注入“Execute the plan above.”，而不是标准权限响应。  
   参考：`src/components/chat/InputBar.tsx:170`

这本质上是在“模拟 CLI 的 plan 机制”，复杂度高、状态竞争多、容易卡住。

## 3. 为什么 Plan 会卡住（根因链）

1. 模式参数不对齐（旧 `--mode` + 强制 skip）使 CLI 行为与 UI 预期分叉。
2. 前端自己构建 Plan 审批流程（卡片 + 重启 + 追发提示语），与 CLI 原生权限流程并行，状态冲突。
3. `handlePlanApprove` 在进程仍存活时只改 UI 状态，不向 CLI 发送明确权限决策，存在等待悬挂风险。  
   参考：`src/components/chat/InputBar.tsx:177`
4. 权限与 Plan 交互分散在多处规则，存在重复、竞态与“假 resolved”。

## 4. CLI UX 完整还原（目标架构）

## 4.1 单一事实来源：CLI permission-mode

保留现有四个 UI 名称（不打断用户习惯），但内部统一映射：

- `code` -> `acceptEdits`
- `ask` -> `default`
- `plan` -> `plan`
- `bypass` -> `bypassPermissions`

启动参数统一规则：

1. `bypassPermissions` 走 `--dangerously-skip-permissions`（或等价 mode）
2. 其余模式都走 `--permission-mode <mode>`
3. 移除 `--mode ask|plan`

## 4.2 Plan 不再走“前端二次编排”

- 不再 kill/restart 注入 “Execute the plan above.”
- `ExitPlanMode` 视为普通权限请求：
  - 展示审批卡
  - 点允许发送 `y`
  - 点拒绝发送 `n`
- 让 CLI 自己推进模式切换与后续执行（原生语义）

## 4.3 审批 UX 统一

把 `permission`、`plan_review`、`question` 统一成“待确认浮动卡”体系：

- 始终只显示当前 1 张 + 队列计数
- 状态统一：`pending -> sending -> resolved|failed|expired`
- 避免“点了就 resolved”的乐观更新

## 5. 精简改造清单（按优先级）

### P0（必须）

1. 参数协议改为 `permission_mode`（前后端）
2. 后端移除无条件 skip
3. 删除 `--mode ask|plan` 传参
4. pre-warm 同步传入当前 permission mode

### P1（强建议）

1. 移除 `tokenicode:plan-execute` 的重启注入路径
2. 合并 `ExitPlanMode` 检测入口，避免三处并发造卡
3. 将 permission 纳入 floating card

### P2（增强）

1. 接入 `--permission-prompt-tool` 或 PermissionRequest hook 做结构化审批
2. stderr 正则仅作兜底

## 6. 完成标准（你要的“简洁优雅顺畅”）

满足以下即达标：

1. 任意模式下，审批只走一条链路（无双轨逻辑）
2. Plan 不再出现“看起来在等你，但其实 CLI/前端状态错位”的卡死
3. 用户只面对最小交互：允许/拒绝，必要时重试
4. 模式切换后从首轮开始行为一致（包括 pre-warm 场景）

## 7. 参考资料（官方）

- Permissions（permission modes 定义）  
  https://docs.anthropic.com/en/docs/claude-code/iam#permission-modes
- Interactive mode（模式切换语义）  
  https://docs.anthropic.com/en/docs/claude-code/interactive-mode
- CLI reference（`--permission-mode` / `--permission-prompt-tool`）  
  https://docs.anthropic.com/en/docs/claude-code/cli-reference

