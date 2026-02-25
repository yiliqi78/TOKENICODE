# TOKENICODE 对话流交互审计（交互 / 卡片 / 输出输入 / 接受 / 多模态）

> 创建日期：2026-02-25  
> 目标：把对话流恢复到接近原生 CLI 的“简洁、优雅、顺畅”，重点解决卡住、假成功、跨会话污染与展示割裂。

## 1. 审计范围

本次审计覆盖：

- 输入与提交链路（输入框、提交、等待态、跟进消息）
- 流式输出链路（stdout/stderr 解析、消息入库、卡片生成）
- 交互卡片（PlanReview / Question / Permission）
- 用户“接受/拒绝/确认”回写机制（stdin/raw stdin）
- 多模态展示（Markdown、图片、附件）

核心文件：

- `src/components/chat/InputBar.tsx`
- `src/components/chat/PlanReviewCard.tsx`
- `src/components/chat/QuestionCard.tsx`
- `src/components/chat/PermissionCard.tsx`
- `src/components/shared/MarkdownRenderer.tsx`
- `src/components/chat/MessageBubble.tsx`
- `src/stores/chatStore.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/claude_process.rs`

---

## 2. 当前链路（简图）

1) 用户在 `TiptapEditor` 输入 -> `InputBar.handleSubmit` 发送。  
2) 后端 `start_claude_session` 启进程，stdout 走 `onClaudeStream`，stderr 走 `onClaudeStderr`。  
3) 前端把事件映射成消息/卡片（text、tool_use、question、plan_review、permission）。  
4) 用户在卡片点击后，通过 `sendStdin` 或 `sendRawStdin` 回写。  
5) UI 将状态切回 running/thinking。

结论：主链路可运行，但“等待态与交互态”没有形成严格状态机，导致多个点位会“先改 UI，再尝试发送”，出现假成功和卡住感。

---

## 3. 关键问题（按优先级）

## P0（必须先修）

### P0-1 权限审批在后端被全局跳过，前端权限卡机制与真实 CLI 行为冲突

- 证据：`start_claude_session` 无条件追加 `--dangerously-skip-permissions`（`src-tauri/src/lib.rs:745`）。
- 同时前端仍在传 `dangerously_skip_permissions`（`src/components/chat/InputBar.tsx:869`、`src/components/chat/ChatPanel.tsx:766`），但后端未按该参数分支处理。
- 影响：
  - UI 端权限卡与真实权限机制不一致；
  - 容易出现“有的审批看不到/不该出现却出现”的错觉；
  - Plan/Permission 的等待流会出现伪交互。

### P0-2 stderr 交互事件未按会话路由，存在跨标签串流风险

- 证据：`handleStderrLine(line, _sid)` 明确忽略 sid（`src/components/chat/InputBar.tsx:1988`）。
- stdout 有背景会话路由（`src/components/chat/InputBar.tsx:1177`），stderr 没有等价逻辑。
- 影响：后台会话的权限/plan 提示可能污染当前会话 UI，导致“莫名卡片”。

### P0-3 Question/Permission 采用乐观完成，发送失败会“假成功”

- `PermissionCard` 点击后直接 `updateMessage(...resolved: true)`，无 `await/try-catch`（`src/components/chat/PermissionCard.tsx:25`、`src/components/chat/PermissionCard.tsx:26`）。
- `QuestionCard` 最终确认路径也未 `await`，直接 resolved + 恢复 running（`src/components/chat/QuestionCard.tsx:111`、`src/components/chat/QuestionCard.tsx:112`）。
- 影响：stdin 写入失败时用户看见“已处理”，但 CLI 未收到输入，随后进入卡住态。

### P0-4 awaiting 状态下输入仍可直接发送，容易把普通文本误投喂为交互回答

- 证据：仅在 `activity.phase !== awaiting` 时才入 pending 队列（`src/components/chat/InputBar.tsx:714` ~ `src/components/chat/InputBar.tsx:717`）。
- 即：正在等待 Question/Plan/Permission 时，用户仍可直接 submit 到 stdin。
- 影响：高概率误操作，尤其在中文输入+回车确认时，导致交互流错位。

### P0-5 Markdown 渲染启用 `rehypeRaw` 且无 sanitize，存在注入风险

- 证据：`rehypeRaw` 启用（`src/components/shared/MarkdownRenderer.tsx:4`、`src/components/shared/MarkdownRenderer.tsx:172`、`src/components/shared/MarkdownRenderer.tsx:335`）。
- 影响：模型输出的原始 HTML 会被解析渲染，安全与稳定性边界不清晰（尤其链接、内联 HTML 组件）。

---

## P1（强烈建议本版本修）

### P1-1 PlanReview “修改”按钮仍查找 textarea，已与 Tiptap 架构脱节

- 证据：`document.querySelector('textarea')`（`src/components/chat/PlanReviewCard.tsx:65`）。
- 当前输入组件是 `TiptapEditor`（`src/components/chat/InputBar.tsx:2255`）。
- 影响：用户点击“修改”经常无效，破坏 Plan 交互闭环。

### P1-2 Permission 卡片未进入浮层体系，且一次只允许一个未解决请求

- 浮层只处理 `plan_review/question`（`src/components/chat/InputBar.tsx:214`、`src/components/chat/InputBar.tsx:2191`）。
- permission 仍走消息流（`src/components/chat/MessageBubble.tsx:39`）。
- stderr 检测里存在“有一个未解决 permission 就直接 return”的短路（`src/components/chat/InputBar.tsx:2043` ~ `src/components/chat/InputBar.tsx:2054`）。
- 影响：审批容易被淹没，连续审批被吞。

### P1-3 Plan 审批存在竞态：先 resolved，再执行恢复逻辑

- Plan 卡片点击后先置 `resolved: true`（`src/components/chat/PlanReviewCard.tsx:60`），再发事件。
- 处理函数里若检测“CLI 还在 running”会直接返回（`src/components/chat/InputBar.tsx:175` ~ `src/components/chat/InputBar.tsx:180`）。
- 影响：在时序边界上可能出现“卡片消失但未真正推进”的体感卡住。

### P1-4 流处理实现过重且前后台双份逻辑，后续极易漂移

- `InputBar.tsx` 体量 2377 行（`wc -l src/components/chat/InputBar.tsx`）。
- 前台 `handleStreamMessage`（`src/components/chat/InputBar.tsx:1172`）与后台 `handleBackgroundStreamMessage`（`src/components/chat/InputBar.tsx:906`）存在大量近似分支。
- 影响：修一个流分支，另一个常漏改，卡片/状态 bug 会反复出现。

### P1-5 Edit diff 指标计算不准确

- `computeEditDiff` 直接返回新旧全文行数（`src/components/chat/MessageBubble.tsx:348` ~ `src/components/chat/MessageBubble.tsx:355`），并非真实增删行。
- 影响：工具卡片指标误导用户，降低变更可读性。

---

## P2（体验增强）

### P2-1 多问题交互进度是组件本地状态，切会话/重挂载后会丢

- `QuestionCard` 的 `currentIdx/selectedMap/answeredMap` 全在本地 state（`src/components/chat/QuestionCard.tsx:31` ~ `src/components/chat/QuestionCard.tsx:35`）。
- 影响：复杂问答流程可恢复性不足。

### P2-2 多模态图片交互风格不统一

- 本地图走 Lightbox，远程图点击直接 `openUrl` 外跳（`src/components/shared/MarkdownRenderer.tsx:242` ~ `src/components/shared/MarkdownRenderer.tsx:255`）。
- 影响：会话内阅读流被打断，体验割裂。

---

## 4. vNext 改造清单（直接可执行）

## 4.1 交互状态机（P0）

- [ ] 引入统一 `interactionQueue`：`plan_review | question | permission` 三类同队列。
- [ ] 状态统一为：`pending -> sending -> resolved | failed | expired`。
- [ ] 只有收到 stdin 回写成功后才能从 `sending` 进入 `resolved`。
- [ ] `awaiting` 时默认锁定普通提交，仅允许“卡片操作”与明确的快捷操作。

## 4.2 会话路由与事件层（P0）

- [ ] stderr 按 sid 路由到对应 tab（对齐 stdout 的 `stdinId -> tabId` 机制）。
- [ ] 当前 tab 只消费自己的 stderr 交互事件，后台 tab 入各自 cache。

## 4.3 权限与 Plan 卡片（P0/P1）

- [ ] 后端去掉“无条件 skip”，按会话策略决定是否 skip（见 `permission-approval-redesign.md`）。
- [ ] permission 纳入浮层卡体系，与 plan/question 一致。
- [ ] 支持连续审批队列（不要因为已有一条未处理就吞掉后续请求）。
- [ ] PlanReview 先进入 `sending`，确认推进成功再 resolved。

## 4.4 输入组件对齐（P1）

- [ ] 修复 PlanReview “修改”按钮：通过 InputBar 暴露 focus API（或事件总线）聚焦 `TiptapEditor`。
- [ ] 删除所有 `textarea` 时代遗留 DOM 查询。

## 4.5 渲染安全与多模态（P0/P2）

- [ ] Markdown 渲染增加 sanitize（或禁用 raw HTML）。
- [ ] 链接与图片 URL 做 scheme 白名单。
- [ ] 远程图片优先会话内预览（lightbox），外跳作为次级操作。

## 4.6 结构重构（P1）

- [ ] 抽离 `useStreamReducer`（纯函数）统一处理前台/后台事件。
- [ ] InputBar 只保留“提交、输入、按钮”；流解析独立模块。
- [ ] 增加事件回放测试样本（AskUserQuestion、ExitPlanMode、Permission、Result、ProcessExit）。

---

## 5. 验收用例（建议明天直接手测）

1. **连续交互**：同一轮出现 Question -> Permission -> PlanReview，确认按队列逐张处理。  
2. **发送失败**：断开 stdin 后点击“允许/确认”，卡片应进入 failed，可重试，不得假成功。  
3. **多标签隔离**：A 会话触发权限，B 会话不应出现卡片。  
4. **awaiting 保护**：等待交互时普通 Enter 不应把文本直接投喂 CLI。  
5. **Plan 修改**：点击“修改”必须稳定聚焦输入框。  
6. **安全回归**：包含 HTML 的 Markdown 不应执行危险内容。  

---

## 6. 推荐落地顺序（最小风险）

- 第 1 步（P0）：事件路由 + 交互状态机 + 发送回执。  
- 第 2 步（P1）：卡片统一浮层 + Plan/Tiptap 对齐 + 输入防误触。  
- 第 3 步（P2）：多模态一致性和展示增强。  

先把 P0 做完，Plan 卡住和权限“看不见/点了没反应”的核心体感问题会明显下降。
