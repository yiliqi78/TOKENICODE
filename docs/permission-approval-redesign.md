# TOKENICODE 权限审批改造方案（Claude Code CLI）

> 创建日期：2026-02-24
> 目标：把 CLI 权限请求在 TOKENICODE UI 中做到“稳定可见、可交互、可恢复”，并保持界面简洁。

## 1. 背景与问题

当前权限链路存在机制冲突，导致“有些权限审核不显示”或交互不稳定：

1. 后端启动 Claude 时无条件附加 `--dangerously-skip-permissions`，导致权限可能被直接绕过。  
   参考：`src-tauri/src/lib.rs:745`
2. 前端权限检测主要依赖 stderr 文本正则，且只要已有一个未处理权限就直接拦截后续权限，可能吞掉不同请求。  
   参考：`src/components/chat/InputBar.tsx:2023`、`src/components/chat/InputBar.tsx:2043`
3. 权限卡响应流程过于“乐观”：发送 `y/n` 后立即标记 resolved，缺少发送中/失败重试/确认回执。
   参考：`src/components/chat/PermissionCard.tsx:22`
4. 浮动审批卡仅覆盖 `plan_review/question`，`permission` 仍走普通消息流，容易被淹没。  
   参考：`src/components/chat/InputBar.tsx:216`

## 2. 改造目标

- **稳定**：任何权限请求都能被 UI 捕获并展示。
- **简洁**：用户永远只面对“当前待审批 1 张卡片 + 队列数量”。
- **可恢复**：发送失败可重试，不会误判“已处理”。
- **可配置**：权限策略与 Claude CLI 原生机制一致，而非前端临时概念。

## 3. Claude CLI 权限机制对齐

以本机 `claude 2.1.52` 为准：

- 支持 `--permission-mode`（`acceptEdits/default/plan/dontAsk/bypassPermissions`）
- 支持 `--dangerously-skip-permissions`
- 支持 `--permission-prompt-tool`（可接入外部审批逻辑）
- 当前已不支持 `--mode ask/plan`（会报 unknown option）

结论：TOKENICODE 应该以 `permission-mode` 为核心，stderr 正则仅保留兜底。

## 4. 目标架构

### 4.1 参数层（必须先改）

新增统一字段 `permission_mode`（前后端透传）：

- `code` -> `acceptEdits`
- `ask` -> `default`
- `plan` -> `plan`
- `bypass` -> `bypassPermissions`（或等价 skip）

后端启动规则：

1. 非 bypass：传 `--permission-mode <mode>`
2. bypass：传 `--dangerously-skip-permissions`
3. 移除“无条件 skip”

### 4.2 事件层（推荐分阶段）

**Phase A（短期）**：保留 stderr 解析，但升级为“可排队”的权限事件生成器。  
**Phase B（中期）**：接入 `permission-prompt-tool` / PermissionRequest Hook 结构化权限事件，stderr 仅 fallback。

### 4.3 状态层（权限状态机）

每个权限请求状态：

- `pending`：待用户操作
- `sending`：用户点击后，正在发 y/n
- `resolved`：CLI 已继续/请求已结束
- `failed`：发送失败，可重试
- `expired`：会话退出或请求失效

并维护 `permissionQueue`（FIFO）：只渲染队首卡片。

## 5. UI 交互设计（优雅且简洁）

### 5.1 浮动审批卡统一

把 `permission` 与 `plan_review/question` 一样放到输入框上方浮层（同一视觉体系）。

卡片结构：

- 标题：`需要授权` + 工具名
- 摘要：本次动作简介（尽量短）
- 风险提示：仅在高风险动作显示（如 Bash 写文件、网络访问、删除）
- 操作按钮：`允许` / `拒绝`
- 次要信息：`队列中还有 N 条`

### 5.2 Holding 机制

当有 `pending/sending` 权限请求时：

- 会话 activity 固定为 `awaiting`
- 输入区显示“等待你确认”状态
- 不继续“生成中”视觉反馈

### 5.3 异常反馈

- 点击后按钮进入 loading（`sending`）
- 发送失败显示错误文案 + `重试`
- 会话退出时未完成请求统一标记 `expired`

## 6. 实施分期（建议）

### Phase 1（建议先做，明天可直接验证）

1. 参数改造：前后端新增 `permission_mode`，移除无条件 skip
2. 权限队列：替换“recentPermission=全拦截”逻辑
3. PermissionCard 状态机：加入 `sending/failed`
4. 浮动审批：把 `permission` 纳入 floating card

**验收重点**：

- 同一轮连续出现 2+ 权限请求，均可依次看到并操作
- 拒绝后 UI 不假成功；发送失败可重试
- bypass 模式下不再显示权限卡（符合预期）

### Phase 2

1. 接入结构化权限通道（permission prompt tool/hook）
2. stderr 正则降级为 fallback
3. 增加“记住本会话策略（可选）”

### Phase 3

1. 可视化权限历史（本会话）
2. `/permissions` 页内化（替代“去终端看”）

## 7. 具体改动清单（文件级）

- `src-tauri/src/commands/claude_process.rs`  
  - 扩展 `StartSessionParams`：新增 `permission_mode?: string`
- `src-tauri/src/lib.rs`  
  - `start_claude_session` 参数映射与 CLI args 构建重写
- `src/lib/tauri-bridge.ts`  
  - `StartSessionParams` 增加 `permission_mode`
- `src/stores/settingsStore.ts` / `src/components/chat/ModeSelector.tsx`  
  - UI 模式到 permission mode 的映射（可内聚成 util）
- `src/components/chat/InputBar.tsx`  
  - 权限检测入队 + 去重策略重写 + floating permission card
- `src/components/chat/PermissionCard.tsx`  
  - 增加 sending/failed/retry 状态与回执控制
- `src/stores/chatStore.ts`  
  - 权限请求队列与状态字段（建议）

## 8. 验证用例（手工）

1. **连续审批**：触发多次工具权限（如多次 Bash），确认卡片按队列逐一出现。
2. **拒绝路径**：点拒绝后模型正确收到 deny，UI 结束 awaiting。
3. **发送失败**：人为断开 session 后点击允许，卡片进入 failed，可重试。
4. **模式对齐**：
   - code -> `acceptEdits`
   - ask -> `default`
   - plan -> `plan`
   - bypass -> `bypassPermissions`
5. **回归**：AskUserQuestion / PlanReview 不受影响，holding 行为一致。

## 9. 风险与回滚

风险：CLI 权限文本格式可能变动（stderr 方案天然脆弱）。  
应对：尽快推进 Phase 2 的结构化权限通道。

回滚：保留 feature flag（如 `useStructuredPermissionFlow`），必要时退回 stderr 方案。

---

如果明天先快速试跑，建议按 **Phase 1** 做最小可用闭环；验证通过后再上 Phase 2。
