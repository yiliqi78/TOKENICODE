# Task 4: Plan 审批流程修复

## 问题分析

### 当前行为（Bypass 模式）

1. CLI 以 `--dangerously-skip-permissions` 启动（无 `--mode plan`）
2. Claude 决定制定计划，调用 `ExitPlanMode`
3. 前端在 stream 中检测到 `ExitPlanMode` → **自动发送 `'y'`**（InputBar.tsx:1236）
4. CLI 可能也在内部自动批准了 ExitPlanMode（因为 skip-permissions）
5. CLI 退出任务，不执行计划
6. UI 卡死——用户必须手动切换到 Code 模式才能继续

### 根因

两个问题叠加：
- **前端自动发 'y'**：bypass 模式下前端在两个位置（early detection + full handler）自动发送 `bridge.sendRawStdin(stdinId, 'y')`
- **CLI 行为**：`--dangerously-skip-permissions` 可能导致 CLI 内部也自动批准 ExitPlanMode，前端额外发送的 'y' 被解释为新消息，造成混乱

### 各模式的当前行为对比

| 模式 | CLI 参数 | ExitPlanMode 处理 | 批准后行为 |
|------|----------|-------------------|-----------|
| Code | `--permission-mode acceptEdits` | 显示 PlanReviewCard → 用户点 Approve → 发 'y' | CLI 继续执行 ✅ |
| Plan | `--mode plan` | 显示 PlanReviewCard → 用户点 Approve → 发 'y'<br>但 CLI 不会继续，需要 TK-306 workaround | Kill → 切 code → 重新提交 ✅ |
| Bypass | `--dangerously-skip-permissions` | **自动发 'y'** → CLI 退出 | 卡死 ❌ |

## 方案

### 核心原则

**Plan 审批始终需要用户确认**，无论什么模式。批准后的执行策略根据模式不同：

| 模式 | 批准方式 | 批准后动作 |
|------|----------|-----------|
| Code/Ask | 发 'y' 到 stdin | CLI 自行继续 |
| Plan | TK-306 | Kill → 切 code → 以 resume 重新提交 |
| Bypass | TK-306 变体 | Kill → **保持 bypass** → 以 resume 重新提交 |

Plan 和 Bypass 都需要 kill-and-restart 方式：
- Plan 模式：CLI 以 `--mode plan` 启动，批准后不会自动执行
- Bypass 模式：`--dangerously-skip-permissions` 可能内部已自动批准，发 'y' 无效或造成干扰

### 具体修改

#### 1. InputBar.tsx — 移除 bypass 自动批准（2 处）

**位置 A**：Early detection（约 1230-1258 行）

```typescript
// 删除整个 isBypass 分支，统一为：
addMessage({
  id: 'plan_review_current',
  role: 'assistant',
  type: 'plan_review',
  content: planContent,
  planContent: planContent,
  resolved: false,   // 始终等待用户
  timestamp: Date.now(),
});
setActivityStatus({ phase: 'awaiting' });
```

**位置 B**：Full assistant message handler（约 1445-1473 行）

同上，删除 `isBypassMode` 分支，统一为 `resolved: false` + `awaiting`。

#### 2. PlanReviewCard.tsx — 模式感知的批准逻辑

当前 `handleApprove` 只发 'y'。改为根据模式选择不同策略：

```typescript
import { useSettingsStore } from '../../stores/settingsStore';

const handleApprove = useCallback(async () => {
  if (isResolved || approving) return;
  setApproving(true);

  const sessionMode = useSettingsStore.getState().sessionMode;
  const stdinId = useChatStore.getState().sessionMeta.stdinId;

  // Mark as resolved in all modes
  useChatStore.getState().updateMessage(message.id, { resolved: true });

  if (sessionMode === 'bypass' || sessionMode === 'plan') {
    // Bypass/Plan: CLI won't continue normally after ExitPlanMode.
    // Kill current process, dispatch event for InputBar to re-execute.
    if (stdinId) {
      useChatStore.getState().setSessionMeta({ stdinId: undefined });
      bridge.killSession(stdinId).catch(() => {});
    }
    // For plan mode: switch to code (existing TK-306 behavior)
    if (sessionMode === 'plan') {
      useSettingsStore.getState().setSessionMode('code');
    }
    // Dispatch to InputBar for re-execution
    window.dispatchEvent(new CustomEvent('tokenicode:execute-plan'));
  } else {
    // Code/Ask: send 'y', CLI continues normally
    if (!stdinId) { setApproving(false); return; }
    try {
      await bridge.sendRawStdin(stdinId, 'y');
      useChatStore.getState().setSessionStatus('running');
      useChatStore.getState().setActivityStatus({ phase: 'thinking' });
    } catch {
      setApproving(false);
    }
  }
}, [isResolved, approving, message.id]);
```

#### 3. InputBar.tsx — 监听 plan 执行事件

新增 `useEffect`，监听 `tokenicode:execute-plan`：

```typescript
useEffect(() => {
  const handler = () => {
    setInput('Execute the plan above.');
    requestAnimationFrame(() => handleSubmitRef.current());
  };
  window.addEventListener('tokenicode:execute-plan', handler);
  return () => window.removeEventListener('tokenicode:execute-plan', handler);
}, [setInput]);
```

这复用了 `handleSubmit` 的已有逻辑：检测到无 stdinId → 以 resume_session_id 生成新进程。

#### 4. InputBar.tsx — Empty Enter 快捷批准的模式感知

修改 lines 597-616 的 Enter 快捷键逻辑：

```typescript
if (pendingPlanReview && !text && !useCommandStore.getState().activePrefix) {
  const stdinId = useChatStore.getState().sessionMeta.stdinId;
  const currentMode = useSettingsStore.getState().sessionMode;

  useChatStore.getState().updateMessage(pendingPlanReview.id, { resolved: true });

  if (currentMode === 'bypass' || currentMode === 'plan') {
    // Same as PlanReviewCard bypass/plan path
    if (stdinId) {
      useChatStore.getState().setSessionMeta({ stdinId: undefined });
      bridge.killSession(stdinId).catch(() => {});
    }
    if (currentMode === 'plan') {
      useSettingsStore.getState().setSessionMode('code');
    }
    window.dispatchEvent(new CustomEvent('tokenicode:execute-plan'));
  } else {
    // Code/Ask: send 'y'
    if (stdinId) {
      await bridge.sendRawStdin(stdinId, 'y');
      setSessionStatus('running');
      useChatStore.getState().setActivityStatus({ phase: 'thinking' });
    }
  }
  return;
}
```

#### 5. InputBar.tsx — PlanApprovalBar 扩展到 bypass 模式

修改渲染条件（line 2076）：

```typescript
{(sessionMode === 'plan' || sessionMode === 'bypass')
  && !isStreaming && hasLastAssistantMessage && !hasPendingPlanReview
  && (sessionStatus === 'completed' || sessionStatus === 'error') && (
  <PlanApprovalBar onApprove={handlePlanApprove} onSwitchMode={handleSwitchToCode} />
)}
```

修改 `handlePlanApprove`（line 206-230），不强制切换 code 模式：

```typescript
const handlePlanApprove = useCallback(async () => {
  const stdinId = useChatStore.getState().sessionMeta.stdinId;
  const currentMode = useSettingsStore.getState().sessionMode;

  // Only switch to code for plan mode (TK-306 original behavior)
  // Bypass mode stays in bypass
  if (currentMode === 'plan') {
    useSettingsStore.getState().setSessionMode('code');
  }

  if (stdinId) {
    useChatStore.getState().setSessionMeta({ stdinId: undefined });
    bridge.killSession(stdinId).catch(() => {});
  }

  setInput('Execute the plan above.');
  requestAnimationFrame(() => handleSubmitRef.current());
}, [setInput]);
```

## 文件清单

| 文件 | 变更 |
|------|------|
| `src/components/chat/InputBar.tsx` | 移除 bypass 自动批准(2处)、新增 execute-plan 事件监听、修改 Enter 快捷键、扩展 PlanApprovalBar 条件、重构 handlePlanApprove |
| `src/components/chat/PlanReviewCard.tsx` | 新增 useSettingsStore import、handleApprove 模式感知逻辑 |

**无需新增 i18n key**——复用已有翻译。

## 验证要点

1. **Bypass 模式**：Claude 生成 plan → 显示 PlanReviewCard → 用户点 Approve → kill → 以 bypass 重启 → 执行 plan
2. **Plan 模式**：同上但切换到 code → 执行 plan（TK-306 不变）
3. **Code 模式**：显示 PlanReviewCard → 用户点 Approve → 发 'y' → CLI 继续（不变）
4. **Empty Enter**：在所有模式下均与按钮行为一致
5. **PlanApprovalBar**：在 bypass 模式下作为兜底也能出现
