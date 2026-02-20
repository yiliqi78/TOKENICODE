# Auto-Compact 可行性调研

> 调研日期：2026-02-20
> 状态：待实现（不紧急）
> 关联：TK Backlog

## 背景

用户使用第三方 API 时，模型上下文长度有限，容易遇到 "Prompt too long" 错误。希望在 token 使用量达到阈值时自动执行 `/compact`，同时提供开关让官方模型用户可以关闭此功能。

## 结论：完全可行

所有必需的数据链路和执行通道已就位，无需新增后端能力。

## 数据可用性

### Token 累积

`sessionMeta.inputTokens` 和 `sessionMeta.outputTokens` 在每个 NDJSON 流事件中实时累积：

- **主动标签**：`InputBar.tsx` 的 `handleStreamMessage()` 中处理
  - `message_start` → 累加 `inputTokens`
  - `message_delta` → 累加 `outputTokens`
- **后台标签**：`handleBackgroundStreamMessage()` 中同步累积到 `sessionCache`

### 访问方式

```typescript
// 主动会话
const { inputTokens, outputTokens } = useChatStore.getState().sessionMeta;

// 后台会话
const snapshot = useChatStore.getState().sessionCache.get(tabId);
const { inputTokens, outputTokens } = snapshot?.sessionMeta || {};

// 总 token
const totalTokens = (inputTokens || 0) + (outputTokens || 0);
```

## 执行通道

`/compact` 已是 `session` 类型命令（`src-tauri/src/lib.rs` 行 1684），通过 `bridge.sendStdin(stdinId, '/compact')` 执行，`CommandProcessingCard` 自动显示进度和成本。

## 实现方案

### 设置项（settingsStore.ts）

```typescript
autoCompactEnabled: boolean;       // 默认 false
autoCompactThreshold: number;      // 默认 50000 (tokens)
```

### 触发逻辑（InputBar.tsx）

在 `message_delta` 处理点添加检查：

```typescript
if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
  const current = useChatStore.getState().sessionMeta.outputTokens || 0;
  const newTotal = current + evt.usage.output_tokens;
  setSessionMeta({ outputTokens: newTotal });

  // Auto-compact 触发
  const { autoCompactEnabled, autoCompactThreshold } = useSettingsStore.getState();
  const inputTokens = useChatStore.getState().sessionMeta.inputTokens || 0;
  if (autoCompactEnabled && (inputTokens + newTotal) > autoCompactThreshold) {
    triggerAutoCompact();
  }
}
```

### 幂等保护

- `sessionMeta` 新增 `lastAutoCompactAt?: number`
- 触发前检查：`Date.now() - lastAutoCompactAt > 60_000`（至少间隔 60 秒）
- 仅在 `sessionStatus === 'idle'` 时触发（不打断正在进行的对话）

### 用户反馈

- `CommandProcessingCard` 中标记 `autoTriggered: true`
- 显示提示如 "Auto-compact triggered (token usage exceeded threshold)"

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/stores/settingsStore.ts` | 添加 `autoCompactEnabled` + `autoCompactThreshold` |
| `src/components/chat/InputBar.tsx` | 触发逻辑 + `triggerAutoCompact()` 函数 |
| `src/components/settings/SettingsPanel.tsx` | 设置 UI（开关 + 滑块/输入框） |
| `src/stores/chatStore.ts` | `sessionMeta` 添加 `lastAutoCompactAt` |
| `src/components/chat/CommandProcessingCard.tsx` | 自动触发标记展示（可选） |

## 风险点

1. **阈值选择**：不同模型上下文窗口不同（Haiku 200k, Sonnet 200k, Opus 200k vs 第三方可能 8k-128k），建议按百分比或让用户自定义
2. **compact 期间新消息**：需要阻止用户在 compact 进行中发送新消息
3. **累积精度**：`inputTokens` 是累加值，compact 后实际上下文会缩小但累积计数不会重置 → 需要在 compact 完成后重置计数器
