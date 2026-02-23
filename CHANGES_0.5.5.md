# TOKENICODE v0.5.5 修改清单

> 日期：2026-02-23
> 编辑环境：Claude Code 远程操作（非本机直接编辑）
> 构建验证：`cargo check` ✅ | `npm run build` (tsc + vite) ✅

---

## Task 1: Thinking 五档选择器

将 Thinking 的 boolean 开关改为 Off / Low / Medium / High / Max 五档选择器，修复关闭不生效的 bug。

| 文件 | 改动说明 |
|------|----------|
| `src/stores/settingsStore.ts` | 新增 `ThinkingLevel` 类型，`thinkingEnabled: boolean` → `thinkingLevel: ThinkingLevel`，persist migration v3→v4 |
| `src/lib/tauri-bridge.ts` | `StartSessionParams` 中 `thinking_enabled?: boolean` → `thinking_level?: string` |
| `src-tauri/src/commands/claude_process.rs` | Rust 参数 `thinking_enabled: Option<bool>` → `thinking_level: Option<String>` |
| `src-tauri/src/lib.rs` | Thinking 参数拼装：off 时显式传 `alwaysThinkingEnabled:false`；非 off 时注入 `CLAUDE_CODE_EFFORT_LEVEL` 环境变量 |
| `src/components/chat/InputBar.tsx` | 删除 `ThinkToggle`，新增 `ThinkLevelSelector` 下拉组件（向上弹出、checkmark、outside-click 关闭）；3 个调用点 `thinking_enabled` → `thinking_level` |
| `src/components/chat/ChatPanel.tsx` | pre-warm 调用点 `thinking_enabled` → `thinking_level` |
| `src/lib/i18n.ts` | 新增 `think.off/low/medium/high/max` 中英文翻译 |

**已删除文件**：`src/hooks/useClaudeStream.ts` — 死代码，从未被 import

---

## Task 2: Output Token 上限提升 + Token 预警 + Auto-compact

解决 `API Error: Claude's response exceeded the 32000 output token maximum` 问题。

| 文件 | 改动说明 |
|------|----------|
| `src-tauri/src/lib.rs` | 注入 `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`，使用 `entry().or_insert_with()` 不覆盖用户自定义值 |
| `src/components/chat/ChatPanel.tsx` | `ActivityIndicator` 新增琥珀色上下文预警（inputTokens > 120K 时显示） |
| `src/components/chat/InputBar.tsx` | 新增 `autoCompactFiredRef`，result 事件中 inputTokens > 160K 时自动发送 `/compact`，每会话最多一次；新会话 spawn 时重置 |
| `src/lib/i18n.ts` | 新增 `chat.tokenWarning`、`chat.autoCompacting` 中英文翻译 |

---

## Task 3: 会话断点续传机制修复（6 项）

修复断网/重启后会话丢失上下文的问题。

| 文件 | 改动说明 |
|------|----------|
| `src/components/chat/InputBar.tsx` | **Stop 按钮修复**：`setSessionMeta({})` → `setSessionMeta({ stdinId: undefined })`；移除即时 unlisten，改为 3 秒安全网 setTimeout；新增 `onSessionExit` 备用退出订阅 |
| `src/stores/sessionStore.ts` | **lastActiveSessionId 持久化**：新增 `saveLastSessionId()` / `loadLastSessionId()` / `getLastSessionId()`，`setSelectedSession` 和 `promoteDraft` 自动写入 localStorage |
| `src/components/conversations/ConversationList.tsx` | 初始 `useEffect` 中自动恢复上次活跃会话；delete/draft 路径改用 `resetSession()` |
| `src/components/chat/ChatPanel.tsx` | `ActivityIndicator` 新增红色超时预警（turn > 3 分钟且 outputTokens 为 0）；`startDraftSession` 改用 `resetSession()` |
| `src-tauri/src/lib.rs` | stdout reader 任务新增 `claude:exit:{sid}` 备用退出事件发射 |
| `src/stores/chatStore.ts` | `clearMessages()` 改为保留 `sessionMeta`（支持恢复）；新增 `resetSession()` 完全重置 |
| `src/components/layout/Sidebar.tsx` | "New Chat" 改用 `resetSession()` |
| `src/components/commands/CommandPalette.tsx` | "New Chat" 改用 `resetSession()` |
| `src/lib/i18n.ts` | 新增 `chat.stallWarning` 中英文翻译 |

---

## Task 4: Plan 审批流程重构

Bypass 模式不再自动跳过计划审批，所有模式统一为「批准并执行」一键流程。

| 文件 | 改动说明 |
|------|----------|
| `src/components/chat/InputBar.tsx` | **移除 Bypass 自动批准**（早期检测 + 完整消息处理两处）；**handlePlanApprove 模式感知**：Plan→Code，Bypass/Code 保持原模式；**新增 `tokenicode:plan-execute` 事件监听**；**Empty Enter 快捷键**改为 dispatch 事件；**PlanApprovalBar 条件扩展**为 `plan \|\| bypass` |
| `src/components/chat/PlanReviewCard.tsx` | `handleApprove` 从 `sendRawStdin('y')` 改为标记 resolved + dispatch `tokenicode:plan-execute`；按钮文案改为「批准并执行」；移除 `bridge` import |

---

## Task 5: 对话框 UI 优化（4 项）

用户气泡视觉降权、附件卡片化、一键复制、AI 输出路径可点击。

| 文件 | 改动说明 |
|------|----------|
| `src/components/chat/MessageBubble.tsx` | **5-1** 用户气泡 `text-base` → `text-sm`，padding 收紧；**5-2** 新增 hover 复制按钮（`group/user` + `navigator.clipboard`）；**5-3** 附件从 chip 升级为卡片（`w-8 h-8` 缩略图、扩展名 badge、`border-white/15`、`max-w-[180px]`） |
| `src/components/shared/MarkdownRenderer.tsx` | **5-4** 新增 `code` 自定义渲染器 + `FILE_PATH_RE` 正则检测内联路径；匹配到的路径渲染为可点击按钮，调用 `useFileStore.selectFile()` 在侧边栏打开；新增 `useFileStore` import |
| `src/lib/i18n.ts` | 新增 `msg.copyText` 中英文翻译 |

---

## Task 6: 代理模块重构（2 项）

梳理代理模块的显示逻辑与系统调用逻辑，修复子代理状态不更新的问题；将代理标签从侧边栏 tab 移至对话框右上角浮动按钮，点击弹出 popover 面板，点击空白处退出。

| 文件 | 改动说明 |
|------|----------|
| `src/components/chat/InputBar.tsx` | **6-1 代理状态监控修复**：stream_event 实时追踪——text_delta → `updatePhase(writing)`、thinking_delta → `updatePhase(thinking)`、Task content_block_start → 提前创建子 agent；text / tool_use / tool_result / thinking / question / todo 消息全部注入 `agentDepth`，修复子代理消息缩进不生效的问题 |
| `src/stores/settingsStore.ts` | **6-2 代理标签按钮化**：`SecondaryPanelTab` 移除 `'agents'`；新增 `agentPanelOpen: boolean` + `toggleAgentPanel()` |
| `src/stores/agentStore.ts` | 新增 `getAgentDepth()` 辅助函数，计算 agent 嵌套深度 |
| `src/components/layout/SecondaryPanel.tsx` | 移除 agents tab 及 `AgentPanel` import，释放侧边栏空间 |
| `src/components/chat/ChatPanel.tsx` | 顶栏右上角新增 Agent 浮动按钮（活跃数量脉冲 badge + 完成绿点）；按钮下方 popover 渲染 `AgentPanel`；click-away 关闭 |
| `src/components/commands/CommandPalette.tsx` | "显示代理" 命令从 `setSecondaryTab('agents')` 改为 `toggleAgentPanel()` |
| `src/lib/i18n.ts` | 新增 `agents.toggle` 中英文翻译 |

---

## Task 7: API 模块改造（4 项）

修复 API 端点默认占位符错误、添加顶栏通路指示让用户知道当前走的是哪条通路、Base URL 输入保存反馈、API Key 输入即保存并可通过 Eye 图标查看已存储的真实 Key。

| 文件 | 改动说明 |
|------|----------|
| `src/lib/i18n.ts` | **7-1** `api.baseUrlPlaceholder` 从 `openrouter.ai/api/v1` 改为 `api.example.com`（Anthropic 原生 API 无 `/api/v1` 路径）；新增 `api.routeCli` / `api.routeApi` 中英文翻译 |
| `src/components/chat/ChatPanel.tsx` | **7-2** 顶栏新增 API 通路 badge：inherit → 灰色 `CLI 通路`，official → 蓝色 `API 通路 · Anthropic`，custom → 蓝色 `API 通路 · {providerName}`；新增 `apiProviderMode` / `customProviderName` store hooks |
| `src/components/settings/SettingsPanel.tsx` | **7-3** Base URL input 新增 600ms debounce "已保存" 反馈（绿色文字，2s 后消失）；**7-4** API Key 改为输入即保存（800ms debounce），移除手动 Save 按钮；Eye 图标点击调用 `bridge.loadApiKey()` 显示真实解密后的 Key，再次点击重新 mask；移除 focus 清空行为 |

---

## Changelog 更新

| 文件 | 改动说明 |
|------|----------|
| `src/lib/changelog.ts` | v0.5.5 条目覆盖 Task 1-7 全部用户可感知变更；补录 v0.5.4 条目（从 GitHub Releases 回填） |

---

## 汇总

- **修改文件**：21 个（去重后，部分文件跨多个 Task 修改）
- **删除文件**：1 个（`useClaudeStream.ts`）
- **新增文件**：0 个

### 全部涉及文件一览

```
src-tauri/src/lib.rs                              ← Task 1 + 2 + 3
src-tauri/src/commands/claude_process.rs           ← Task 1
src/stores/settingsStore.ts                        ← Task 1 + 6
src/stores/agentStore.ts                           ← Task 6
src/stores/chatStore.ts                            ← Task 3
src/stores/sessionStore.ts                         ← Task 3
src/lib/tauri-bridge.ts                            ← Task 1 + 3
src/lib/i18n.ts                                    ← Task 1 + 2 + 3 + 5 + 6 + 7
src/lib/changelog.ts                               ← Changelog
src/components/chat/InputBar.tsx                   ← Task 1 + 2 + 3 + 4 + 6
src/components/chat/ChatPanel.tsx                  ← Task 1 + 2 + 3 + 6 + 7
src/components/chat/MessageBubble.tsx              ← Task 5
src/components/chat/PlanReviewCard.tsx             ← Task 4
src/components/shared/MarkdownRenderer.tsx         ← Task 5
src/components/settings/SettingsPanel.tsx           ← Task 7
src/components/conversations/ConversationList.tsx  ← Task 3
src/components/layout/Sidebar.tsx                  ← Task 3
src/components/layout/SecondaryPanel.tsx           ← Task 6
src/components/commands/CommandPalette.tsx          ← Task 3 + 6
```

**已删除**：`src/hooks/useClaudeStream.ts`
