# Phase 5: P2 Batch — S16/S18/S20 + Capability Matrix

## 方案文档

**完整修复方案**：`.trellis/workspace/suyuan/fix-plan-2026-04-21-v3.md`（§4.3 + §7 Phase 5）
**前置**：Phase 1-4 已 commit。

---

## 目标

修复 P2 级别的 bug 批量 + 建立 CLI 能力矩阵。

---

## Bug 1: S16 — 目录名解码错

**根因**：`lib.rs:3464-3466` 计算了 `_decoded` 但实际使用 `dir_name.replace('-', "/")`。前端 `ConversationList.tsx:37` 和 `App.tsx:522` 用同样的 replace 逻辑。

**实施**：

### Rust 侧
`lib.rs` 的 `decode_project_name` 函数：确保返回值被使用（不是算了 `_decoded` 又用原始的 replace）。

### 前端侧
- `ConversationList.tsx:37` — 调用 Rust 的 decode 或在前端实现相同的 decode 逻辑，替换 `replace('-', '/')`
- `App.tsx:522` — 同上
- 刷新最近项目缓存，确保 decode 后的名称一致

---

## Bug 2: S18 — CLI 内部占位文本 "No response requested."

**根因**：`useStreamProcessor.ts:544-556, :1671-1725` 没有过滤 CLI 内部协议文本。

**实施**：

`useStreamProcessor.ts` 新增 allowlist/blocklist 过滤：
```typescript
const CLI_INTERNAL_TEXTS = [
  'No response requested.',
  // 其他已知的 CLI 内部占位文本
];
```

在 `handleStreamMessage` 的 assistant message 处理中：
- 如果 message text 完全匹配 `CLI_INTERNAL_TEXTS` 中任一 → 跳过，不渲染到 UI

---

## Bug 3: S20 — FD limit 幽灵 changelog

**根因**：`changelog.ts:535` 有一条关于 FD limit 的 changelog 条目，但实际没有 setrlimit 实现。

**实施**：

检查 `changelog.ts` 中 FD limit 相关条目：
- 如果确实没有对应的功能实现 → 删除或修改该 changelog 条目
- 如果有部分实现 → 评估是否需要补齐（macOS vs Linux 差异）

优先选择删除/修正文案，避免引入不必要的系统调用。

---

## Feature 4: 能力矩阵建模（C8/C9/NEW-N/NEW-O/NEW-Q）

**背景**：当前 Provider env 注入无条件（C8），CLI 版本不驱动行为（C9）。v7 migration 删除后已消化一部分，剩余需要系统性解决。

### 4a. 能力矩阵定义

`src/lib/api-provider.ts` 新增：
```typescript
interface CliCapabilities {
  supportsThinking: boolean;
  supportsMcp: boolean;
  supportsStreamJson: boolean;
  // 按需扩展
}

function getCliCapabilities(cliVersion: string): CliCapabilities;
```

### 4b. Provider env 条件注入（C8）

`lib.rs` 的 env 注入逻辑（`:1389-1408`）：
- 按 Provider 的 `api_format` 决定注入哪些 env（不是无条件全注入）
- Anthropic 原生：注入 `ANTHROPIC_API_KEY`
- OpenAI 兼容：注入 `OPENAI_API_KEY` + `OPENAI_BASE_URL`
- 合并 NEW-N / NEW-O 的修复

### 4c. CLI version 解析修复（NEW-Q）

`lib.rs:4675-4686` 当前用首 token 解析版本，改为正则 `\d+\.\d+\.\d+` 提取。

### 4d. CliStatus 字段统一（NEW-D）

`tauri-bridge.ts:104` 的 CliStatus 接口与 `lib.rs:4464-4470` 的 Rust 结构对齐。

---

## Bug 5: NEW-L — addMessage ID dedup 影响 plan sentinel

**根因**：`chatStore.ts:341-344` 的 ID dedup 逻辑可能把 plan sentinel 消息合并掉。

**实施**：

先验证是否是设计意图：
- 如果 plan sentinel 被误合并导致 UI 丢失 → 在 dedup 条件中排除 sentinel 类型
- 如果是设计意图（合并重复消息） → 确认无副作用后不改，写文档记录

---

## 不动的项（文档记录）

以下按用户决策暂不修改，只记录在代码注释或 spec 文档：
- C3: completedOnce 死代码
- NEW-J: permission_request listener 死绑
- NEW-R: settingsEvents 无订阅者
- NEW-M: StdinManager.remove 顺序

---

## 测试

- 所有前序 Phase 测试通过
- 新增测试：
  - decode_project_name ���确解码
  - CLI 内部文本被过滤
  - 能力矩阵版本解析
  - Provider env 条件注入
- tsc + cargo check + clippy

## 不允许

- 不 push / 不 PR
- 不改前序 Phase 核心逻辑
- 废代码暂不动（用户决策）
