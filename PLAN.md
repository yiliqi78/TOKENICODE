# 实施计划：追加消息 + 对话标题

## 功能一：运行中追加消息

### 问题分析
当前每次发消息都 spawn 一个新的 `claude -p <prompt>` 进程，进程结束后才能发送下一条。
stdin 设为 `Stdio::null()`，无法向运行中的进程写入。

### 方案：`--resume` 新进程模式

Claude CLI 的 `-p` 模式是**单次 prompt**，处理完就退出。不支持在运行中插入消息。
最可靠的方式是：第一次消息 spawn 新进程，后续追加消息通过 `--resume <session_id>` spawn 新进程继续同一会话。

**具体改动：**

#### Step 1：Rust 后端 — `lib.rs`
- `StartSessionParams` 新增 `resume_session_id: Option<String>` 字段
- `start_claude_session` 中：
  - 如果 `resume_session_id` 有值，不生成新 UUID，使用 `--resume <id>` 替代 `-p` 的初始 session
  - 参数构建：`["-p", prompt, "--resume", resume_id, "--output-format", "stream-json", "--verbose"]`

#### Step 2：Bridge — `tauri-bridge.ts`
- `StartSessionParams` 新增 `resume_session_id?: string`

#### Step 3：前端 — `InputBar.tsx`
- 移除 `if (!text || isRunning) return;` 中的 `isRunning` 守卫
- 新增逻辑：
  - 如果 `sessionStatus === 'idle'`：正常 `bridge.startSession()` → 首次启动
  - 如果 `sessionStatus === 'running'` 或 `'completed'`：
    - 取 `chatStore.sessionMeta.sessionId`
    - 调用 `bridge.startSession({ ..., resume_session_id: sessionId })`
    - 不清空消息，不重置 agent store（追加到现有对话）
  - 状态重设为 `running`，重新挂载 stream listener
- textarea 和发送按钮始终启用
- 工具栏（mode/model/upload）在运行时仍可用，但 mode 和 model 选择器保持 disabled（进程已启动，无法更改）

#### Step 4：UI 调整
- textarea `disabled` 移除 `isRunning` 条件
- 发送按钮 `disabled` 移除 `isRunning` 条件
- placeholder 运行时改为"追加消息…"
- 上传按钮保持在运行时可用

#### Step 5：i18n
- 新增 `input.followUp`: 「追加消息...」/「Send follow-up...」

## 功能二：对话列表标题

### 问题分析
`extract_session_preview` 只看前 20 行，且只匹配 `content[].text`。
有些会话的第一个 user 消息的 content 是 `tool_result` 类型（不是 text），导致 preview 为空。

### 方案：改进 preview 提取 + 按项目分组

#### Step 6：Rust 后端 — 改进 `extract_session_preview`
- 扫描范围从 20 行增加到 **100 行**
- 匹配条件扩展：除了 `type=human`/`role=user`，还加 `type=user` + `message.role=user`
- content 解析扩展：如果 `content[]` 中没有 `text` 类型的 block，尝试递归查找嵌套的 text（比如 `tool_result.content[].text`）
- 最终 fallback：如果仍然找不到 text，取 content 数组第一个非空字符串

#### Step 7：前端 — ConversationList 按项目分组
- 当前按时间分组（今天/昨天/本周/更早），改为**双层分组**：
  - **一级分组：项目**（按最近修改时间排序）
  - **二级排序：按时间**（同一项目内最新的在前）
- 每个项目组显示：项目名（短路径）+ 会话数量
- 项目组可折叠
- 搜索仍然跨所有项目生效

#### Step 8：i18n
- `conv.sessions`: 「个会话」/ 「sessions」
- `conv.collapse`: 「收起」/ 「Collapse」
- `conv.expand`: 「展开」/ 「Expand」

## 修改文件清单

| 文件 | 变更 |
|------|------|
| `src-tauri/src/lib.rs` | Step 1 + Step 6 |
| `src-tauri/src/commands/claude_process.rs` | Step 1（StartSessionParams） |
| `src/lib/tauri-bridge.ts` | Step 2 |
| `src/components/chat/InputBar.tsx` | Step 3 + Step 4 |
| `src/components/conversations/ConversationList.tsx` | Step 7 |
| `src/lib/i18n.ts` | Step 5 + Step 8 |
