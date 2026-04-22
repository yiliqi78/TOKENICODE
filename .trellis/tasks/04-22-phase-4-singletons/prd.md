# Phase 4: P1 Singletons — S3/S9/S10/S11/S15

## 方案文档

**完整修复方案**：`.trellis/workspace/suyuan/fix-plan-2026-04-21-v3.md`（§4 + §5.3 + §5.4 + §5.9）
**前置**：Phase 1 (`f5b4a7b`) + Phase 2 (`74dca2b`) + Phase 3 已 commit。

---

## 目标

修复 5 个独立 P0/P1 单点 bug，每个改动范围明确、互不交叉。

---

## Bug 1: S3 — AskUserQuestion 按钮灰（P0）

**根因**：QuestionCard 在 `control_request` 到达前就创建了卡片，`awaitingSdkPatch=true` 导致按钮灰。回答路径读 `getActiveTabState()` 而非 owner 字段，切 tab 后回答错 tab。

**实施**：

### 1a. QuestionCard 数据结构加 owner

`chatStore.ts` 的 QuestionCard message 新增字段：
```typescript
owner?: { tabId: string; stdinId: string; requestId?: string }
```

`useStreamProcessor.ts` 创建 QuestionCard 消息时写入 owner：
- `handleStreamMessage` 中 `subtype === 'ask_user_question'` 分支（约 `:1200-1220`）
- 写入 `owner: { tabId: currentTabId, stdinId: currentStdinId }`

### 1b. control_request 到达后才可交互

`QuestionCard.tsx:92` 现有 `awaitingSdkPatch` 逻辑保留。

新增超时机制：
- 5 秒内未收到 `control_request` patch（requestId 仍空）→ 显示"重试同步权限"按钮
- 按钮点击 → 触发 `teardownSession('sync-retry')` + 等 process_exit + 自动 resume spawn
- **禁止**用 legacy `sendStdin` 兜底（四方共识否决，见 §5.3）

**后端限制**：`send_control_request` 不支持 replay pending control_request（`lib.rs:2134-2169`），所以"重试"实际上是 teardown + resume，不是 control protocol replay。

### 1c. 回答路径改用 owner

`QuestionCard.tsx` 回答按钮点击事件：
- 从 message 的 `owner.stdinId` 和 `owner.requestId` 读取
- 不再调 `getActiveTabState()`
- 老消息无 owner 字段 → 显示"请重启会话以恢复交互"

### 1d. 失败态 UI

如果仍收不到 patch → 卡片标 `interactionState: 'failed'`，UI 灰色 disabled + 错误文案"与 CLI 失联，请重启会话"

---

## Bug 2: S9 — 切 tab 回来草稿丢（P1，只修路径 3）

**根因**：`chatStore.ts:625` `restoreFromCache` 中空消息即删条件没排除 inputDraft。

**实施**：

`chatStore.ts` 的 `restoreFromCache` 方法，找到删除空 tab 的条件：
```typescript
// 原：if (cached.messages.length === 0 && !cached.isStreaming) delete
// 改：if (cached.messages.length === 0 && !cached.isStreaming && !cached.inputDraft) delete
```

**只修路径 3**（用户决策），不碰 LRU 和 IME 路径。

---

## Bug 3: S10 — MCP 工具不可用（P0）

**根因**：`lib.rs:1299-1311` 传了 `--strict-mcp-config` 但没传 `--mcp-config`，CLI 在 strict 模式下不读 `~/.claude.json`。

**实施**：

### 3a. 前端传 MCP 配置路径

`InputBar.tsx` handleSubmit / `ChatPanel.tsx` prewarm：
- 从 `mcpStore` 获取用户启用的 MCP servers 列表
- 生成 scratch JSON 配置文件（只含启用的 servers），写到 `~/.tokenicode/mcp-session-<stdinId>.json`
- 将路径传给 Rust 后端（新增 `StartSessionParams.mcp_config_path` 字段）

### 3b. Rust 后端传 --mcp-config

`lib.rs` 的 `start_claude_session`：
- 如果 `mcp_config_path` 非空 → 追加 `--mcp-config <path>`
- 保留 `--strict-mcp-config`

### 3c. scratch 文件清理

`ProcessManager::drop_entry()` 或 stdout EOF handler 中删除 scratch 文件。

---

## Bug 4: S11 — AI 半程崩溃无错误提示（P1）

**根因**：`useStreamProcessor.ts:1961-1997` 的 process_exit handler 被 `!hasAssistantReply` 门槛挡住——AI 回了一半崩溃，有 reply 所以不显示错误。

**实施**：

### 4a. 统一 turn 结束判定器

`useStreamProcessor.ts` 新增辅助函数（或内联逻辑）：

判定 process_exit 是否异常退出：
- `exit_code !== 0` 且 `sessionStatus === 'running'` → 异常
- `result` 事件 `subtype !== 'success'` → 异常

异常退出时：
- 追加错误消息（`type: 'system'`）到消息列表
- **去重**：stderr / result / process_exit 三路可能重复报错，只显示一次

### 4b. Stop / 用户拒绝走专门文案

- 用户手动 Stop → "已停止"（不是错误）
- 用户拒绝权限 → "已拒绝 XX 操作"（不是崩溃）
- CLI 自身崩溃 → "AI 遇到错误，请重试"+ stderr 摘要

---

## Bug 5: S15 — OpenRouter key 不生效（P1）

**根因**：`provider-presets.ts:103-110` 用了 `ANTHROPIC_AUTH_TOKEN='${API_KEY}'` 字面量占位，`${API_KEY}` 从未被替换。`lib.rs:1078-1092` 非原生 Provider 分支移除 `ANTHROPIC_AUTH_TOKEN`。

**实施**：

### 5a. preset 改走 ANTHROPIC_API_KEY

`provider-presets.ts` OpenRouter preset 的 env 配置：
```typescript
// 原：ANTHROPIC_AUTH_TOKEN: '${API_KEY}'
// 改：ANTHROPIC_API_KEY: provider.apiKey
```

移除 `${API_KEY}` 占位写法，直接用 provider 对象的 apiKey 字段。

### 5b. 迁移已有配置

`providerStore.ts` 或 `api-config.ts` 的 providers.json 加载逻辑：
- 检测 OpenRouter provider 的 env 是否还有 `ANTHROPIC_AUTH_TOKEN: '${API_KEY}'`
- 如果有 → 自动迁移为 `ANTHROPIC_API_KEY: <provider.apiKey>`

---

## 测试

- 所有 Phase 1/2/3 既有测试通过
- 新增测试：
  - QuestionCard owner 字段 + 超时重试
  - restoreFromCache 不删有 draft 的 tab
  - MCP scratch config 生成 + 清理
  - process_exit 错误显示（正常退出 vs 崩溃 vs Stop）
  - OpenRouter preset 迁移
- tsc + cargo check + clippy

## 不允许

- 不 push / 不 PR
- 不改 Phase 1/2/3 核心逻辑
- S9 只修路径 3（用户决策）
- S3 不走 legacy sendStdin 兜底（四方共识否决）
- S10 不删 --strict-mcp-config
