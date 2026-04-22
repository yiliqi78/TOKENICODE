# Phase 1: R1/R2 lifecycle + ownership guard

## 方案文档

**完整修复方案**：`.trellis/workspace/suyuan/fix-plan-2026-04-21-v3.md`（§7.1-§7.4）
**本 PRD 是 v3 §7 Phase 1 的可执行子集**，包含第 4 轮审查的仲裁修正。

---

## 背景

TOKENICODE 是 Claude Code 的 Tauri 2 桌面 GUI。CLI 作为子进程运行，前端通过 stdin/stdout 与 CLI 交互。

当前核心问题：启动/关闭 CLI 会话的步骤分散在多个调用点，每个点缺不同的步骤（listener 未绑、映射未清、进程未 kill 等）。

---

## 目标

1. 新建 `src/lib/sessionLifecycle.ts`（纯函数模块），提供 `spawnSession()` 和 `teardownSession()` 两个入口
2. 所有 spawn/kill/exit 路径统一收口到这两个入口
3. 加 ownership guard 到所有流事件处理路径（不只 process_exit）
4. 加 `finalizeOnce(stdinId)` 幂等门，避免重复收尾
5. Rust 后端 EOF 清理（`drop_entry`）

---

## 第 4 轮审查仲裁修正（实施时必须遵守）

以下是三个独立审查员（GPT-5.2 / GPT-5.3-codex / GPT-5.4）对 v3 的共识修正：

1. **spawn 调用点实际是 4 个**（不是 v3 写的 5 个）：
   - `InputBar.tsx:1089` 正常 spawn
   - `ChatPanel.tsx:825` pre-warm
   - `App.tsx:212` watchdog 恢复
   - `useStreamProcessor.ts:1589` auto-retry

2. **kill/teardown 调用点至少 9 个**（不是 v3 写的 5 个）：
   - `InputBar.tsx:1510` Stop 按钮
   - `InputBar.tsx:857` Provider 切换 kill
   - `InputBar.tsx:891` Model 切换 kill
   - `useRewind.ts:63` Rewind
   - `App.tsx:163` watchdog kill
   - `App.tsx:362` 启动 orphan sweep
   - `useStreamProcessor.ts:1523` auto-retry kill
   - `useStreamProcessor.ts:1641` ExitPlan restart kill
   - `ConversationList.tsx:390` 删除会话

3. **必须加 `finalizeOnce(stdinId)` 幂等门**：后端会同时发 stream `process_exit` 和 dedicated `claude:exit:{stdinId}`（`lib.rs:2008-2019`），前端还有 backup exit listener（`InputBar.tsx:1054-1068`）。没有幂等门会重复 finalize。

4. **ownership guard 不能只覆盖 process_exit**：流路由 fallback 也要（`useStreamProcessor.ts:753`），assistant/result 消息处理也要（`useStreamProcessor.ts:946,1478`）。

5. **permission_request listener 通道不一致**：前端注册 `claude:permission_request:*`（`tauri-bridge.ts:498-506`），后端只在 stream 发 `tokenicode_permission_request`（`lib.rs:1872-1884`）。**方案**：删掉前端死 listener（`InputBar.tsx:999-1052` + `tauri-bridge.ts:498-506`），统一由 stream 通道 `tokenicode_permission_request` 驱动。

6. **provider/model 切换路径缺 `unregisterStdinTab`**：`InputBar.tsx:857-865,891-899` kill 后没注销映射。必须走统一 teardown。

7. **AskUserQuestion "重试同步权限"需要可行方案**：后端 `send_control_request` 只支持 interrupt/set_permission_mode/set_model/rewind_files（`lib.rs:2134-2169`），不支持 replay pending control_request。**方案**：改为"超时后显示 error 状态 + 手动重发按钮 → 触发 teardown + resume"，不走 control protocol replay。

---

## 第 5 轮审查修正（2026-04-22，实施时必须遵守）

以下是第 5 轮 review 发现的自相撞车问题，必须在 Phase 1 实施时修正：

1. **cliResumeId 为唯一 resume 凭据**：
   - `sessionStore.ts:109` 已有 `cliResumeId` 字段
   - teardown 只清 `stdinId` 映射，**不清 `cliResumeId`**
   - 切模型/Provider 的 respawn 路径依赖 `cliResumeId` 做 resume
   - v3 原方案在 teardown 里清 `cliSessionId` 会导致 respawn 退回 fresh start

2. **spawnConfigHash 不包含 sessionMode**：
   - sessionMode 走运行时 `set_permission_mode`，不触发 kill+respawn
   - hash 定义只包含：`model + providerId + thinkingLevel + envFingerprint`
   - v3 原方案把 sessionMode 算进 hash 与运行时切 mode 撞车

3. **lifecycle helper 绑 `tokenicode_permission_request`**：
   - 后端真正发的是 stream channel 里的 `tokenicode_permission_request`（`lib.rs:1872`）
   - 前端 `tauri-bridge.ts:498` 的 `onPermissionRequest` 是孤立监听器，无对应 emit
   - spawnSession 不绑孤立的 `onPermissionRequest`，权限走 stream 通道

---

## 实施步骤（按顺序）

### Step 1: 创建 `src/lib/sessionLifecycle.ts`

```typescript
// 纯函数模块，不是 React hook（ChatPanel pre-warm 需要调用）
interface SpawnParams {
  tabId: string;
  stdinId: string;
  cwdSnapshot: string;
  configSnapshot: {
    model: string;
    providerId: string;
    thinkingLevel: ThinkingLevel;
    permissionMode: PermissionMode;
    envFingerprint?: string;  // 同 providerId 但 key/url 变了的场景
  };
  sessionParams: StartSessionParams;
  onStream: (msg: any) => void;
  onStderr: (line: string) => void;
  onProcessExit: (exit: ExitEvent) => void;
}

interface SpawnResult {
  stdinId: string;
  cliSessionId?: string;
  unlisten: () => void;
}

async function spawnSession(params: SpawnParams): Promise<SpawnResult>
async function teardownSession(stdinId: string, tabId: string, reason: TeardownReason): Promise<void>
```

注意：**不绑 `claude:permission_request:*` listener**（死通道，见仲裁修正 #5）。权限走 stream 通道 `tokenicode_permission_request`。

`spawnSession` 步骤：
1. `registerStdinTab(stdinId, tabId)`
2. 注册 3 个 listener：stream / stderr / process_exit（tag `__stdinId`）
3. `bridge.startSession(sessionParams)`
4. 写 sessionMeta（stdinId / cwdSnapshot / configSnapshot / spawnConfigHash）
5. 等 CLI UUID 到达 → 写 `cliSessionId` → `trackSession(cliSessionId)`
6. 返回 SpawnResult
7. 任一步失败 → 回滚

`teardownSession` 步骤：
1. 设 `sessionStatus: 'stopping'`
2. 调 `bridge.killSession(stdinId)`
3. **不 unregister、不清 listener** — 由 process_exit handler 统一做
4. 5 秒超时兜底：`finalizeSession(stdinId, tabId, 'timeout')`

### Step 2: `finalizeOnce` 幂等门

```typescript
const finalizedSet = new Set<string>();

function finalizeSession(stdinId: string, tabId: string, trigger: string) {
  if (finalizedSet.has(stdinId)) return;
  finalizedSet.add(stdinId);
  // ... 全量收尾逻辑 ...
  // 收尾完成后 30 秒清理 Set（避免泄漏）
  setTimeout(() => finalizedSet.delete(stdinId), 30_000);
}
```

### Step 3: ownership guard（扩大范围）

在 `useStreamProcessor.ts` 的**所有** message handler 入口加 guard，不只 process_exit：

```typescript
function ownershipCheck(msg: any): { tabId: string; tab: TabState } | null {
  const stdinId = msg.__stdinId;
  const ownerTabId = useSessionStore.getState().getTabForStdin(stdinId);
  if (!ownerTabId) return null;  // 已 unregister → skip
  const tab = useChatStore.getState().getTab(ownerTabId);
  if (!tab) return null;  // tab 被删 → skip
  if (tab.sessionMeta.stdinId && tab.sessionMeta.stdinId !== stdinId) return null;  // stale
  return { tabId: ownerTabId, tab };
}
```

应用到：
- `handleStreamMessage`（前台+后台）
- `handleProcessExit`（前台+后台）
- assistant / tool_use / result 路径
- 流路由 fallback 路径（`useStreamProcessor.ts:753` 的 `|| activeTabId` 改为走 orphan 队列）

### Step 4: process_exit 统一收尾

`finalizeSession` 内容：
1. flush stream buffer
2. partial → interrupted message
3. 未回答 Question → cancelled
4. pending → inputDraft 回填
5. autoCompactFiredMap.delete(tabId)
6. sessionMeta 清理（stdinId → undefined，**保留 cliResumeId**、cwdSnapshot、configSnapshot）
7. unregisterStdinTab
8. unlisten 所有 listener
9. StreamController.forgetCompletion(stdinId)
10. 设 sessionStatus（stopped/error/idle）

### Step 5: Rust 后端 `drop_entry`

`claude_process.rs` 新增：
```rust
impl ProcessManager {
    pub async fn drop_entry(&self, sid: &str) { self.processes.lock().await.remove(sid); }
}
impl StdinManager {
    pub async fn drop_entry(&self, sid: &str) { self.pipes.lock().await.remove(sid); }
}
impl BypassModeMap {
    pub async fn unregister(&self, sid: &str) { self.map.lock().await.remove(sid); }
}
```

`lib.rs` stdout reader EOF 路径（`:2008-2023`）emit process_exit 后追加：
```rust
stdin_mgr.drop_entry(&sid).await;
state.drop_entry(&sid).await;
bypass_map.unregister(&sid).await;
```

### Step 6: 迁移所有 spawn/kill 调用点

**Spawn 点（4 个）全改走 `spawnSession()`**：
- `InputBar.tsx:1089` → 正常 spawn
- `ChatPanel.tsx:825` → pre-warm
- `App.tsx:212` → watchdog（prompt 不能空，传最后一条用户消息）
- `useStreamProcessor.ts:1589` → auto-retry（传**原 tabId**，不读 selectedSessionId）

**Kill/teardown 点（9 个）全改走 `teardownSession()`**：
- `InputBar.tsx:1510` → reason: 'stop'
- `InputBar.tsx:857` → reason: 'switch'（Provider）
- `InputBar.tsx:891` → reason: 'switch'（Model）
- `useRewind.ts:63` → reason: 'rewind'（用 `sessionMeta.cwdSnapshot` 不用全局 cwd）
- `App.tsx:163` → reason: 'watchdog'
- `App.tsx:362` → reason: 'orphan-sweep'
- `useStreamProcessor.ts:1523` → reason: 'retry-kill'
- `useStreamProcessor.ts:1641` → reason: 'exit-plan-restart'
- `ConversationList.tsx:390` → reason: 'delete'（先 teardown 等退出，再 deleteSession）

### Step 7: 删掉死 listener 代码

- 删 `InputBar.tsx:999-1052`（`claude:permission_request:*` 注册）
- 删 `tauri-bridge.ts:498-506`（`onPermissionRequest` 注册函数）或标记 deprecated

### Step 8: chatStore LRU 改为真 LRU

`chatStore.ts:581-600`：TabState 加 `lastAccessedAt`。`ensureTab` 改为按 `lastAccessedAt` 排序淘汰。保护 `streaming / running / reconnecting / stopping` 状态。

### Step 9: 删除会话先 teardown

`ConversationList.tsx:390-406`：调 `teardownSession` 等进程退出，再调 `deleteSession` 删 JSONL。

---

## Phase 1 附带修复（在主线改动中顺手做）

| # | 修改 |
|---|------|
| S13 | 前后台 result handler 抽 shared finalizer；auto-compact 从前台 hook 移进 per-tabId Map |
| NEW-B | `autoCompactFiredMap<tabId, boolean>`，teardown 时 delete |
| NEW-C | sessionMeta 新增 `cliSessionId`；watchdog/resume 只读 `cliSessionId` |
| NEW-E | orphan fallback：映射缺失时写 orphan 队列，不落 active tab |
| NEW-H | sessionMeta 新增 `cwdSnapshot`；watchdog/Rewind 用 snapshot |
| C1 | lifecycle helper 写完整 snapshot |
| C2 | Rust drop_entry |
| S8 | ConversationList 删除走 teardownSession |
| S19 | chatStore 真 LRU |

**不在 Phase 1 做的**（拆到后续或 cleanup）：
- NEW-K（App 关闭 unlisten map）→ cleanup
- NEW-J（tauri-bridge 死 listener）→ Step 7 顺手删
- NEW-P（orphan permission queue）→ 与 NEW-E 合并简化实现

---

## 测试要求

1. 现有测试全过：
   ```bash
   npx vitest run src/__tests__/diagnosis-stdinId-guard.test.ts \
     src/__tests__/diagnosis-thinkingLevel-watcher.test.ts \
     src/__tests__/diagnosis-watchdog-listener.test.ts \
     src/stream/__tests__/diagnosis-process-exit.test.ts \
     src/stream/__tests__/diagnosis-race.test.ts \
     src/stream/__tests__/diagnosis-settings.test.ts
   ```

2. 新增测试：
   - `src/__tests__/sessionLifecycle.test.ts` — spawnSession / teardownSession 单测
   - `src/__tests__/finalizeOnce.test.ts` — 幂等门 + 竞态
   - `src/__tests__/ownership-guard.test.ts` — stale exit / tab 被删 / 映射缺失场景

3. TypeScript 编译通过：
   ```bash
   npx tsc --noEmit
   ```

4. Rust 编译通过：
   ```bash
   cd src-tauri && cargo check && cargo clippy
   ```

---

## check agent 完成后的 codex 三方审代码（强制约束）

check agent 审完代码后，**必须**执行以下代码审查流程：

1. 生成审查 prompt 写到 task 目录：`.trellis/tasks/04-22-phase-1-lifecycle/codex-review-prompt.txt`
   prompt 内容：git diff 摘要 + 改动文件清单 + 本 PRD 的验收标准 + 要求 Pass/Conditional/Fail 判定

2. 用 `codex exec` 非交互模式并发跑三个模型：
   ```bash
   mkdir -p codex-review-logs
   PROMPT=$(cat .trellis/tasks/04-22-phase-1-lifecycle/codex-review-prompt.txt)
   codex exec -m gpt-5.2       -c model_reasoning_effort=xhigh -c service_tier=fast "$PROMPT" > codex-review-logs/gpt-5.2.log 2>&1 &
   codex exec -m gpt-5.3-codex -c model_reasoning_effort=xhigh -c service_tier=fast "$PROMPT" > codex-review-logs/gpt-5.3-codex.log 2>&1 &
   codex exec -m gpt-5.4       -c model_reasoning_effort=xhigh -c service_tier=fast "$PROMPT" > codex-review-logs/gpt-5.4.log 2>&1 &
   wait
   ```

3. 读三份 log，自行仲裁（≥2 模型指出的问题 → 自修；单方 → 验证后决定）

4. 输出 `CODEXREVIEW_FINISH` marker（check.jsonl 里配了此 marker）

**禁止**直接调用 `mcp__codex__codex`。必须用 `codex exec` CLI 命令。

---

## 不允许的操作

- 不 `git push`
- 不 `git merge`
- 不创建 PR
- 不修改 `.trellis/workspace/` 下的文件（仅读取 v3 文档作参考）
- 不做 Phase 2-5 的内容（模型切换/安全/P1单点/P2批量）
- 不修改 v3 文档本身
