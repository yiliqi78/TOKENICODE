# TOKENICODE 回撤与相关斜杠命令审计（CLI UX 对齐）

> 创建日期：2026-02-24  
> 目标：按 Claude Code 官方行为审计回撤（`/rewind` + `Esc Esc`）及同类斜杠命令体验，定位导致“看起来可用但实际不顺畅/不一致”的问题。

## 1) 官方基线（先看文档）

依据官方文档：

- 入口：`Esc` + `Esc` 或 `/rewind` 打开回撤菜单。
- 选项：
  1. Restore code and conversation
  2. Restore conversation
  3. Restore code
  4. Summarize from here
  5. Never mind
- 恢复任务或摘要后，所选消息的原始 prompt 会回填输入框。
- 限制：Bash 改动不在 checkpoint 跟踪范围；外部并发改动不保证被跟踪。

并且在官方 Interactive Mode 的“Built-in commands”里，`/rewind` 属于标准内建命令。

## 2) 现状审计（客户端实现）

### 2.1 当前行为概览

- 回撤按钮在工具栏已被注释隐藏。  
  参考：`src/components/chat/InputBar.tsx:2363`
- 但 `/rewind` 仍是内建命令，且仍可触发事件。  
  参考：`src/components/chat/InputBar.tsx:409`、`src-tauri/src/lib.rs:2295`
- 双击 `Esc` 仍会打开回撤面板。  
  参考：`src/components/chat/InputBar.tsx:298`

即：**视觉入口被关，但键盘/命令入口还在**。

### 2.2 关键实现链路

- 回撤编排：`useRewind` 负责 kill session、恢复代码/会话、摘要等。  
  参考：`src/hooks/useRewind.ts:152`
- 快照机制：`snapshotStore` 在每轮发送前做快照，恢复时写回文件并删除创建文件。  
  参考：`src/stores/snapshotStore.ts:67`、`src/stores/snapshotStore.ts:150`
- 回撤面板动作 5 选项与官方形式对齐。  
  参考：`src/components/chat/RewindPanel.tsx:65`

## 3) 主要问题（按优先级）

## P0（必须先修）

1. **`restoreFromMessages` 的 Git 路径存在实质失效**  
   `useRewind` 调用了 `git ls-files`，但后端 allowlist 不允许该子命令。  
   结果：该分支会始终报错进入 fallback，无法正确区分 tracked/untracked 文件。  
   参考：`src/hooks/useRewind.ts:58`、`src-tauri/src/lib.rs:2455`

2. **快照只抓“发送前已 dirty 文件”，会漏掉“本轮新改动的原始内容”**  
   `captureSnapshot` 只读取 git diff 集合；若文件在发送前是 clean、在本轮被 Edit/Write 修改，其 pre-image 可能不存在于快照。  
   且 `recordFileContent` 未被调用，补录机制未生效。  
   参考：`src/stores/snapshotStore.ts:67`、`src/stores/snapshotStore.ts:134`、`src/components/chat/InputBar.tsx:728`

3. **回撤被禁用时（运行中）是“静默失败”**  
   事件处理仅在 `canRewind` 时打开面板，禁用态没有任何反馈；`rewind.disabled` 文案存在但未使用。  
   参考：`src/components/chat/InputBar.tsx:291`、`src/lib/i18n.ts:202`

## P1（体验与一致性）

4. **“UI 已屏蔽回撤”与“命令/快捷键仍可触发”冲突**  
   用户视角会认为功能被移除，但仍可能被 `/rewind` 或 `Esc Esc` 调出。  
   参考：`src/components/chat/InputBar.tsx:2363`、`src/components/chat/InputBar.tsx:409`

5. **Summarize 逻辑与官方语义有偏差**  
   当前是本地截断拼接摘要文本，不是官方所述的“AI 生成压缩摘要并保留可引用历史语义”的同等行为。  
   参考：`src/hooks/useRewind.ts:253`

6. **斜杠命令覆盖面与官方“常用内建”有差距**  
   官方列表里的 `/debug`、`/copy`、`/desktop` 未在 TOKENICODE 内建命令表中出现。  
   参考：`src-tauri/src/lib.rs:2274`

## 4) 结论（针对你当前诉求）

你现在遇到的核心体验问题是合理的：

- 回撤功能并非真正“关闭”，而是处于**入口不一致**状态；
- 回撤恢复链路存在 P0 级技术缺口，导致“可点但不总是准确恢复”；
- 与回撤同类的斜杠命令体系也存在“官方体验 vs 本地实现”偏差。

## 5) 建议动作（不改代码版）

1. **先做产品决策：回撤是“彻底关闭”还是“恢复为官方同等体验”**  
2. 若“彻底关闭”：统一关掉 3 个入口（按钮、`/rewind`、`Esc Esc`），并从命令列表移除。  
3. 若“恢复体验”：先修 P0，再做命令与文档对齐（同类斜杠命令一并梳理）。

## 6) 下个版本重构清单（可直接执行）

> 目标：把回撤和斜杠命令做成“原生 CLI 语义 + TOKENICODE UI 映射层”，减少前端自定义分叉。

### A. 回撤（Rewind）重构

1. **统一入口策略（二选一）**  
   - 方案 A：完全恢复（按钮 + `/rewind` + `Esc Esc` 全开）  
   - 方案 B：完全关闭（3 个入口全关，命令列表移除 `/rewind`）

2. **修复恢复链路 P0**  
   - 后端 `run_git_command` allowlist 增加 `ls-files`（或改前端逻辑不依赖该命令）  
   - `snapshotStore` 增加“首改文件 pre-image 补录”闭环（把 `recordFileContent` 真正接入）

3. **补全禁用态反馈**  
   - 运行中触发 `/rewind` 或 `Esc Esc` 时显示 `rewind.disabled` 系统反馈，不再静默

4. **Summarize 对齐策略**  
   - 明确选择：保留“本地摘要（快）”或改为“模型摘要（更接近官方）”  
   - 若保留本地摘要，UI 明示“本地摘要”避免用户误解

### B. 斜杠命令（Slash Commands）重构

1. **建立命令策略表（单一真相）**  
   - 每个命令标注：`ui` / `session` / `cli` / `disabled`  
   - UI、执行器、文档都从这张表生成，避免多处散落分叉

2. **梳理“回撤同类命令”一致性**  
   - 优先审计：`/rewind`、`/compact`、`/clear`、`/resume`、`/status`、`/permissions`  
   - 目标：命令可见性、可执行性、错误反馈三者一致

3. **官方对齐补齐/降级策略**  
   - 对官方常见命令：缺失则补齐；不能支持则显式标注 disabled + 原因  
   - 避免“命令出现在列表里但行为并不真实可用”

4. **命令错误反馈统一化**  
   - 无活动会话、运行中禁用、参数错误等，统一系统消息模板  
   - 禁止静默失败

### C. 代码落点（建议顺序）

1. `src-tauri/src/lib.rs`（命令 allowlist / list_all_commands）  
2. `src/stores/snapshotStore.ts`（快照补录）  
3. `src/hooks/useRewind.ts`（恢复策略与错误反馈）  
4. `src/components/chat/InputBar.tsx`（入口统一与交互反馈）  
5. `src/components/chat/RewindPanel.tsx`（动作文案与状态）  
6. `src/stores/commandStore.ts` + `src/components/chat/SlashCommandPopover.tsx`（命令策略统一）

### D. 验收清单（发布前）

1. 入口一致：按钮、`/rewind`、`Esc Esc` 与产品策略完全一致。  
2. 运行中触发回撤有明确提示，不静默。  
3. `restore_all` / `restore_code` 在“tracked + untracked + 新建文件”场景下可重复通过。  
4. 命令列表与实际执行能力一致，不出现“可见不可用”。  
5. 与官方文档差异项在 UI 或文档中明确标注。

---

## 官方参考链接

- Checkpointing（回撤/摘要与限制）  
  https://docs.anthropic.com/en/docs/claude-code/checkpointing
- Interactive mode（快捷键与 built-in commands）  
  https://docs.anthropic.com/en/docs/claude-code/interactive-mode
