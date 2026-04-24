# TOKENICODE CLI Test Tool & Batch Test Runner

CLI 工具 + 批量测试运行器，用于从命令行驱动 TOKENICODE GUI 进行端到端测试。仅在 debug 构建下可用。

---

## 一、架构

```
┌─────────────────────────────────────────────────────────────┐
│  AI / 人类                                                   │
│  ├── 直接调用: node scripts/tokenicode-cli.mjs <command>     │
│  └── 批量测试: node scripts/run-tests.mjs <test.json>       │
│       └── 内部逐条调用 tokenicode-cli.mjs                    │
└────────────────────────┬────────────────────────────────────┘
                         │ NDJSON over Unix socket
                         │ /tmp/tokenicode-test.sock
                         v
┌─────────────────────────────────────────────────────────────┐
│  Test harness transport (Rust, debug builds only)                  │
│  cfg(debug_assertions) 门控，release 构建完全不含             │
└────────────────────────┬────────────────────────────────────┘
                         │ Tauri event system
                         v
┌─────────────────────────────────────────────────────────────┐
│  Frontend JS listeners → window.__tokenicode_test            │
│  import.meta.env.DEV 门控，production build 自动剥离         │
│  通过 Zustand store 直操 / DOM 查询 控制 GUI                 │
└─────────────────────────────────────────────────────────────┘
```

**两阶段测试工作流**：

```
阶段 1（设计）：AI 分析 bug/feature → 编写测试定义 JSON
阶段 2（执行）：run-tests.mjs 机械化执行 → 全量记录 → 输出结构化报告 JSON
阶段 3（分析）：AI 读报告 → 定位问题 → 迭代修复
```

执行阶段无 AI 参与，纯机械化。

---

## 二、前置条件

1. 启动 TOKENICODE dev 构建：`pnpm tauri dev`
2. 确认控制台输出：`[TOKENICODE] Test harness registered on /tmp/tokenicode-test.sock`
3. 验证连通性：`node scripts/tokenicode-cli.mjs ping`（应返回 `{"ok":true,"pong":true}`）

---

## 二点五、AI 测试行为准则

### 界面状态判断：元素查询优先，截图仅兜底

**禁止用截图判断界面状态。** 必须使用 `query-page --mode map` 或 `wait-for --selector` 来判断 UI 元素是否存在、状态是否正确。

截图（`screenshot`）仅限以下场景：
- 需要人工肉眼确认视觉呈现问题（样式错乱、布局偏移、颜色异常）
- 所有元素查询手段都无法回答当前问题

```
✅ query-page --mode map → 检查 send-button 是否存在 → 判断编辑器可用
✅ wait-for --selector '[data-testid=permission-card]' → 判断权限卡片出现
✅ status → 检查 active/phase/messageCount
❌ screenshot → 看图猜编辑器在不在
❌ get-visible-text → 通过搜索文本判断元素存在（fragile，文本会变）
```

### 操作前必检：编辑器是否挂载

`type` 和 `send` 依赖 TipTap 编辑器挂载。以下状态 **没有编辑器**：
- 欢迎页（刚启动 / `new-session` 后 / 重启后）
- 无项目选中的空白页

**每次 `type` 前必须确认编辑器已挂载**，未通过则先 `switch-session`：

```bash
# 检查编辑器
node scripts/tokenicode-cli.mjs wait-for --selector '[data-testid=send-button]' --timeout 5000
# → ok：可以 type + send
# → timeout/error：先 switch-session <SESSION_ID>，再重试
```

### 正确的新会话流程

```bash
# ✅ 推荐：指定工作区创建新会话（有编辑器，可直接 type）
node scripts/tokenicode-cli.mjs new-session --cwd ~/Documents
node scripts/tokenicode-cli.mjs check-editor   # 确认编辑器可用
node scripts/tokenicode-cli.mjs type "hello"
node scripts/tokenicode-cli.mjs send

# ✅ 备选：切到已有会话
node scripts/tokenicode-cli.mjs switch-session <SESSION_ID>

# ❌ 错误：new-session 无参数后直接 type（欢迎页无编辑器，type 静默失败）
node scripts/tokenicode-cli.mjs new-session
node scripts/tokenicode-cli.mjs type "hello"  # 无效
```

`new-session` 无参数仅用于：测试欢迎页 UI、重置到空白状态。

### 重启应用

```bash
# 同窗口重启（webview reload，推荐）
node scripts/tokenicode-cli.mjs restart

# 硬重启（杀进程 + 新窗口，仅 Tauri 后端出问题时用）
node scripts/tokenicode-cli.mjs relaunch
```

---

## 三、CLI 工具：tokenicode-cli.mjs

### 基本用法

```bash
node scripts/tokenicode-cli.mjs <command> [args] [--flags]
```

所有输出为单行 JSON：`{"ok":true, ...}` 或 `{"ok":false, "error":"..."}`。零外部依赖。

### 全部命令（30 个）

#### 健康检查

```bash
# 检测 TOKENICODE 是否在运行
node scripts/tokenicode-cli.mjs ping
# → {"ok":true,"pong":true}

# 全局状态快照（最常用的诊断命令）
node scripts/tokenicode-cli.mjs status
# → {"ok":true,"session":"uuid","sessionCount":52,"model":"claude-opus-4-6",
#    "provider":"id-or-null","active":false,"phase":null,
#    "pendingPermission":false,"settingsOpen":false,"messageCount":16}

# 同窗口重启（webview reload，不开新窗口）
node scripts/tokenicode-cli.mjs restart
node scripts/tokenicode-cli.mjs restart --timeout 30000
# → {"ok":true,"restarted":true,"mode":"reload","elapsed":10000}

# 硬重启（杀进程 + 重新 spawn，开新窗口，仅 Tauri 后端出问题时使用）
node scripts/tokenicode-cli.mjs relaunch
node scripts/tokenicode-cli.mjs relaunch --timeout 120000
# → {"ok":true,"restarted":true,"elapsed":7000,"pid":12345}
```

`status` 返回字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `session` | string\|null | 当前 session ID |
| `sessionCount` | number | 总 session 数 |
| `model` | string | 当前模型 ID（如 `claude-opus-4-6`） |
| `provider` | string\|null | 当前 provider ID（null = 系统默认） |
| `active` | boolean | 会话是否活跃（覆盖 thinking/writing/tool/awaiting 四个阶段） |
| `phase` | string\|null | 当前活跃阶段：`thinking` / `writing` / `tool` / `awaiting` / `completed` / `null` |
| `pendingPermission` | boolean | 是否有等待响应的权限请求 |
| `settingsOpen` | boolean | 设置面板是否打开 |
| `messageCount` | number | 当前 tab 的消息总数 |

`restart` 工作流程：webview `location.reload()` → 轮询 `execute_js` 直到就绪。

`relaunch` 工作流程：
1. 通过 `lsof -t -U` 查找监听 socket 的进程 PID（尊重 `TOKENICODE_SOCKET` 环境变量）
2. 解析真实 PGID（`ps -o pgid=`），SIGTERM 杀进程组
3. 等待进程退出（最多 10s），超时升级 SIGKILL
4. 杀 Vite dev server（port 1420）
5. 清理残留 socket 文件
5. 在项目根目录 spawn `pnpm tauri dev`（detached）
6. 轮询 ping 直到应用就绪

#### 对话

```bash
# 输入文字到 TipTap 编辑器
node scripts/tokenicode-cli.mjs type "你好"

# 发送消息（触发 Claude CLI）
node scripts/tokenicode-cli.mjs send

# 停止生成
node scripts/tokenicode-cli.mjs stop

# 删除当前 session（清理 tab + 终止 CLI 进程，防止 session 累积）
node scripts/tokenicode-cli.mjs delete-session
# → {"ok":true,"deleted":true,"session":"desk_..."}

# 读消息（默认最后 10 条）
node scripts/tokenicode-cli.mjs get-messages
node scripts/tokenicode-cli.mjs get-messages --last 3
node scripts/tokenicode-cli.mjs get-messages --all
# → {"ok":true,"messages":[...],"total":16}

# 默认返回摘要（content 截断 150 字，thinking → [thinking]，tool_result → 前 80 字）
# 需要完整内容时加 --full
node scripts/tokenicode-cli.mjs get-messages --last 5 --full

# 检查编辑器是否可用（type/send 前必检）
node scripts/tokenicode-cli.mjs check-editor
# → {"ok":true,"hasEditor":true,"hasChatPanel":true,"session":"uuid"}

# 检查是否正在生成
node scripts/tokenicode-cli.mjs is-streaming
node scripts/tokenicode-cli.mjs is-streaming --tab <TAB_ID>
```

消息对象字段：

| 字段 | 说明 |
|------|------|
| `id` | 消息唯一 ID |
| `role` | `user` / `assistant` / `system` |
| `type` | `text` / `thinking` / `tool_use` / `tool_result` |
| `content` | 消息文本内容 |
| `toolName` | tool_use 时的工具名 |
| `subAgentDepth` | sub-agent 嵌套深度（0=主 agent） |
| `timestamp` | 时间戳 |

#### Session 管理

```bash
node scripts/tokenicode-cli.mjs get-active-session
node scripts/tokenicode-cli.mjs get-all-sessions
node scripts/tokenicode-cli.mjs switch-session <SESSION_ID>  # 完整加载：读 JSONL + 设 working dir + 填充消息
node scripts/tokenicode-cli.mjs new-session                  # 无参数：导航到欢迎页（无编辑器）
node scripts/tokenicode-cli.mjs new-session --cwd /path/to   # 有 cwd：创建可用新会话（有编辑器）
```

> **`new-session` 无参数**时只导航到欢迎页（无编辑器，不可 type）。<br>
> **`new-session --cwd <path>`** 在指定工作区创建新会话，编辑器可用，可以直接 type + send。<br>
> 详见「二点五、正确的新会话流程」。

#### 模型和 Provider

```bash
node scripts/tokenicode-cli.mjs get-current-model
node scripts/tokenicode-cli.mjs get-current-provider
node scripts/tokenicode-cli.mjs switch-model claude-sonnet-4-6
node scripts/tokenicode-cli.mjs switch-provider <PROVIDER_ID>
node scripts/tokenicode-cli.mjs switch-provider null   # 重置为系统默认
```

#### 设置面板

```bash
node scripts/tokenicode-cli.mjs open-settings
node scripts/tokenicode-cli.mjs close-settings
node scripts/tokenicode-cli.mjs switch-settings-tab provider   # general|provider|cli|mcp
```

#### 权限处理

```bash
node scripts/tokenicode-cli.mjs allow-permission
node scripts/tokenicode-cli.mjs deny-permission
```

#### 页面内容

```bash
# 获取页面可见文本（纯文字，无 HTML 噪音）
node scripts/tokenicode-cli.mjs get-visible-text
node scripts/tokenicode-cli.mjs get-visible-text --selector '[data-testid=chat-messages]'

# 截图（返回文件路径，用 Read 工具查看图片）
node scripts/tokenicode-cli.mjs screenshot

# 页面结构/状态/应用信息
node scripts/tokenicode-cli.mjs query-page --mode state
node scripts/tokenicode-cli.mjs query-page --mode info
node scripts/tokenicode-cli.mjs query-page --mode map

# 精简元素查询（仅交互元素 + 不含文本内容，大幅减少输出噪音）
node scripts/tokenicode-cli.mjs query-page --mode map --interactive-only
node scripts/tokenicode-cli.mjs query-page --mode map --interactive-only --no-content

# 原始 HTML
node scripts/tokenicode-cli.mjs get-dom
```

#### 等待

```bash
# 等待文本出现
node scripts/tokenicode-cli.mjs wait-for --text "收到" --timeout 5000

# 等待元素出现
node scripts/tokenicode-cli.mjs wait-for --selector '[data-testid=permission-card]'

# 等待消息生成完成（轮询 status，超时=失败）
node scripts/tokenicode-cli.mjs wait-until-done --timeout 60000

# 等待特定 phase（如等模型进入 writing 阶段再中断）
node scripts/tokenicode-cli.mjs wait-for-phase writing --timeout 15000
# phases: thinking | writing | tool | awaiting | completed

# 纯延时（不检查状态，用于时序控制）
node scripts/tokenicode-cli.mjs delay 3000
```

`wait-until-done` 返回值：

| 结果 | ok | status | 下一步 |
|------|-----|--------|--------|
| 生成完成 | `true` | `completed` | `get-messages` 读回复 |
| 权限阻塞 | `true` | `permission_pending` | `allow-permission` 或 `deny-permission` |
| 超时 | **`false`** | `timeout` | 步骤失败。若需继续执行后续步骤，加 `continueOnError: true` |

> **注意**：`wait-until-done` 超时返回 `ok: false`（步骤失败）。如果你需要"等 N 秒然后继续"的行为，用 `delay` 命令。

`wait-for-phase` 返回值：

| 结果 | ok | 说明 |
|------|-----|------|
| 到达目标 phase | `true` | 返回完整 status 数据 |
| session 提前结束 | `false` | session 在到达目标 phase 前就结束了 |
| 超时 | `false` | 未在超时内到达目标 phase |

#### 原始 JS 执行

```bash
node scripts/tokenicode-cli.mjs exec "document.title"
node scripts/tokenicode-cli.mjs exec "JSON.stringify(window.__tokenicode_test.status())"
```

### 默认超时

| 命令 | 默认超时 |
|------|---------|
| 普通命令 | 10s |
| `screenshot` | 15s |
| `switch-session` | 30s |
| `wait-until-done` | 60s |
| `wait-for` | 10s |
| `wait-for-phase` | 30s |
| `delay` | 无（按参数时长） |
| `restart` | 30s |
| `relaunch` | 120s |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TOKENICODE_SOCKET` | `/tmp/tokenicode-test.sock` | 覆盖 socket 路径（restart 命令也遵循） |

### 可用的 data-testid

用于 `get-visible-text --selector` 和 `wait-for --selector`：

| testid | 位置 |
|--------|------|
| `chat-input-editor` | TipTap 编辑器容器 |
| `send-button` | 发送按钮 |
| `stop-button` | 停止按钮 |
| `chat-messages` | 聊天消息滚动区域 |
| `model-selector` | 模型选择器触发按钮 |
| `model-option-{id}` | 模型选项 |
| `new-session-button` | 新建 session 按钮 |
| `current-session-card` | 当前 session 卡片 |
| `session-item-{sessionId}` | session 列表项 |
| `permission-card` | 权限请求卡片 |
| `permission-allow-button` | 允许按钮 |
| `permission-deny-button` | 拒绝按钮 |
| `settings-button` | 设置按钮 |
| `settings-panel` | 设置面板 |
| `settings-close-button` | 关闭设置按钮 |
| `settings-tab-{id}` | 设置 tab（general/provider/cli/mcp） |
| `provider-card-{id}` | Provider 卡片 |
| `provider-inherit-button` | 继承系统默认 Provider 按钮 |

---

## 四、批量测试运行器：run-tests.mjs

### 基本用法

```bash
node scripts/run-tests.mjs <test-file.json> [--flags]
```

全量阶段入口：

```bash
# Phase 1：基础/无 LLM；Phase 2：LLM 交互；Phase 3：分支回归
bash .test/scripts/run-e2e.sh --phase 1 --detail minimal
bash .test/scripts/run-all-phases.sh --detail minimal
bash .test/scripts/run-branch-validation.sh --cycles 3 --phases 1,2,3 --detail minimal --retry 1
```

### 运行器参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--report <path>` | `/tmp/tokenicode-test-report-{时间戳}.json` | 报告输出路径 |
| `--retry <N>` | `0` | 全局重试次数（单测定义 `retry` 优先） |
| `--test-timeout <ms>` | `120000` | 单测超时（硬上限：step 超时被 clamp 到剩余预算） |
| `--stop-after <N>` | `3` | 连续 N 次失败后触发 restart |
| `--no-auto-restart` | — | 禁用自动 restart |
| `--detail <level>` | `standard` | 报告详尽度：`minimal`（无状态快照）、`standard`（状态快照 + UI 命令可见文本）、`full`（状态快照 + 每步可见文本） |
| `--no-snapshots` | — | 禁用状态快照（加速执行，但丢失前后状态对比） |

### 运行器行为

1. **预检**：启动时 `ping` 检查 TOKENICODE 是否在运行
2. **Schema 校验**：验证所有测试定义的 `steps`/`setup`/`teardown` 格式，不合法直接退出
3. **串行执行**：一个测试完了才跑下一个
4. **全量记录**：每步的输入命令、输出 JSON、耗时、执行前后 UI 状态快照、可见文本
5. **自动重试**：step 失败 → 重试整个测试（所有 attempt 历史都保留在报告中）
6. **超时硬上限**：`testTimeout` 是硬限制，每步的超时被 clamp 到剩余测试预算（teardown 例外：至少 3s 做清理）
7. **兜底策略**：
   - 连续 3 个测试失败 → 先自动 `restart`（同窗口 reload）
   - restart 失败 → 升级 `relaunch`（杀掉 Tauri/Vite 后重启 `pnpm tauri dev`）
   - relaunch 也失败 → 终止运行，剩余测试标记 `skipped`
8. **stdout**：每个测试一行 JSON 摘要 + 最终一行 `_summary`
9. **报告文件**：完整 JSON 报告存盘，`_summary` 中包含 `reportWritten` 和 `reportWriteError` 告知写入状态

`run-e2e.sh` 会为每个 suite 写两个文件：

| 文件 | 内容 |
|------|------|
| `*.ndjson` | runner 控制台日志与摘要行 |
| `*.report.json` | `run-tests.mjs --report` 生成的结构化报告 |
| `SUMMARY.md` | 本轮总览 |

### 测试定义格式

```json
{
  "tests": [
    {
      "name": "测试名称（必填，显示在报告和摘要中）",
      "timeout": 60000,
      "retry": 1,
      "captureSnapshots": true,
      "setup": [
        {"cmd": "switch-session", "args": ["SESSION_ID"]}
      ],
      "steps": [
        {"cmd": "type", "args": ["测试文本"]},
        {"cmd": "send"},
        {"cmd": "wait-until-done", "flags": {"timeout": "30000"}},
        {"cmd": "get-messages", "flags": {"last": "2"}},
        {"cmd": "status"}
      ],
      "teardown": [
        {"cmd": "stop"}
      ]
    }
  ],
  "retry": 0,
  "captureSnapshots": true,
  "testTimeout": 120000
}
```

也支持纯数组 `[{...}, {...}]` 或单个测试对象 `{name, steps}` 作为顶层。

#### Step 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cmd` | string | 是 | tokenicode-cli.mjs 命令名 |
| `args` | string[] | 否 | 位置参数 |
| `flags` | object | 否 | `--key value` 标志，值为字符串或 `true`（布尔标志） |
| `timeout` | number | 否 | 该步超时（ms），默认 30s，受 testTimeout 剩余预算 clamp。**对 wait 类命令（`wait-until-done`/`wait-for-phase`/`wait-for`），必须设此值且 > flags.timeout（建议 +5s），否则 step 会在命令内部超时前被 runner 杀掉** |
| `continueOnError` | boolean | 否 | 该步失败是否继续执行后续步骤（默认 false） |
| `assert` | object | 否 | 对命令输出的断言。key 是字段名，value 是期望值。支持后缀：`_gte`（>=）、`_lte`（<=）、`_contains`（字符串包含） |

#### 执行顺序

```
setup[0] → setup[1] → ... → steps[0] → steps[1] → ... → teardown[0] → teardown[1] → ...
```

- `setup` 失败 → 跳过 `steps`，仍执行 `teardown`
- `steps` 中某步失败（且 `continueOnError` 非 true）→ 跳到 `teardown`
- `teardown` **始终执行**（即使前面失败了），失败不影响测试 pass/fail，但会作为 `teardown_failure` 出现在 issues 中

### 报告结构

```
report.json
├── meta                ← 【第一步读这个】通过率、耗时、是否中断
│   ├── startTime, endTime, elapsed
│   ├── totalTests, passed, failed, skipped
│   ├── config: { testFile, captureSnapshots, retry }
│   ├── aborted?: boolean
│   └── abortReason?: string
│
├── issues[]            ← 【第二步读这个】失败摘要 + 失败步骤上下文
│   ├── type: 'test_failure' | 'teardown_failure'
│   ├── test, testIndex, attempts, error
│   └── failedStep: { index, phase, cmd, args, error, output, beforeState, afterState, visibleText }
│
└── tests[]             ← 【按需深挖】完整记录
    ├── index, name, status, totalAttempts, maxRetries, elapsed, error
    ├── attempts[]      ← 每次重试的完整记录（重试历史不丢失）
    │   ├── attempt, passed, elapsed, error, teardownFailed
    │   └── steps[]
    └── steps[]         ← 最后一次 attempt 的步骤（快捷访问）
        ├── index, phase ('setup'|'step'|'teardown')
        ├── cmd, args, flags
        ├── startTime, endTime, elapsed
        ├── success, error
        ├── output           ← 命令返回的完整 JSON
        ├── beforeState      ← 执行前的 status() 快照
        ├── afterState       ← 执行后的 status() 快照
        └── visibleText      ← 页面可见文本（仅 UI 变更命令，见下）
```

**visibleText 触发条件**：仅在以下命令执行后自动采集 `[data-testid=chat-messages]` 区域的可见文本：`send` `type` `switch-session` `switch-model` `switch-provider` `allow-permission` `deny-permission` `open-settings` `close-settings` `new-session` `restart`。其他命令该字段为 `null`。如需手动采集，加一步 `{"cmd": "get-visible-text", "flags": {"selector": "..."}}`。

**beforeState/afterState**：teardown 阶段默认不采集状态快照（减少干扰）。setup 和 step 阶段始终采集（除非 `--no-snapshots`）。

#### AI 读报告的正确姿势

1. **先读 meta** — 知道总体结果（多少通过/失败、是否中断）
2. **再读 issues** — 知道哪些失败了、什么现象、UI 状态是什么
3. **按需读 tests[N].steps** — 只读失败测试的具体步骤，看命令返回了什么
4. **不要全量读 tests 数组** — 通过的测试不需要看细节，避免污染上下文

```bash
# 读 meta
node -e "const r=require('.test/runs/<日期>/<主题>/run-001.json'); console.log(JSON.stringify(r.meta, null, 2))"

# 读 issues
node -e "const r=require('.test/runs/<日期>/<主题>/run-001.json'); console.log(JSON.stringify(r.issues, null, 2))"

# 读特定失败测试的步骤
node -e "const r=require('.test/runs/<日期>/<主题>/run-001.json'); console.log(JSON.stringify(r.tests[2].steps, null, 2))"

# 跨 suite 汇总分析（自动分类 JS timeout / socket error / 真实 bug）
python3 .test/scripts/analyze-reports.py .test/runs/<日期目录>
```

### stdout 输出格式

运行器在 stdout 输出两种 JSON 行（stderr 是日志，stdout 是给程序/AI 消费的）：

**每个测试一行摘要**：
```json
{"test":"发送消息","status":"pass","elapsed":3200,"attempts":1}
{"test":"切换模型","status":"fail","elapsed":30100,"attempts":2,"error":"Step 0 (switch-model) failed: timeout"}
```

**最终一行总结**：
```json
{"_summary":true,"total":10,"passed":8,"failed":2,"skipped":0,"elapsed":45000,"reportPath":"/tmp/report.json","reportWritten":true,"reportWriteError":null,"aborted":false}
```

### 测试设计模式

#### 模式 1：发送消息并验证回复

```json
{
  "name": "发送消息 - 基础",
  "setup": [{"cmd": "switch-session", "args": ["SESSION_ID"]}],
  "steps": [
    {"cmd": "type", "args": ["请只回复两个字：收到"]},
    {"cmd": "send"},
    {"cmd": "wait-until-done", "flags": {"timeout": "30000"}, "assert": {"status": "completed"}},
    {"cmd": "get-messages", "flags": {"last": "2"}, "assert": {"total_gte": 2}},
    {"cmd": "status", "assert": {"active": false}}
  ]
}
```

#### 模式 2：处理权限请求

`wait-until-done` 遇到权限请求会立即返回 `status: "permission_pending"`，这时执行 `allow-permission` 或 `deny-permission` 放行。

```json
{
  "name": "权限请求 - 允许",
  "setup": [{"cmd": "switch-session", "args": ["SESSION_ID"]}],
  "steps": [
    {"cmd": "type", "args": ["请创建一个文件 /tmp/test.txt"]},
    {"cmd": "send"},
    {"cmd": "wait-until-done", "flags": {"timeout": "15000"}},
    {"cmd": "allow-permission"},
    {"cmd": "wait-until-done", "flags": {"timeout": "30000"}},
    {"cmd": "get-messages", "flags": {"last": "3"}}
  ]
}
```

#### 模式 3：状态切换压测

```json
{
  "name": "快速切换模型",
  "steps": [
    {"cmd": "switch-model", "args": ["claude-sonnet-4-6"]},
    {"cmd": "status"},
    {"cmd": "switch-model", "args": ["claude-haiku-4-5-20251001"]},
    {"cmd": "status"},
    {"cmd": "switch-model", "args": ["claude-opus-4-6"]},
    {"cmd": "get-current-model"}
  ]
}
```

#### 模式 4：长时间模拟用户操作

```json
{
  "name": "多轮对话",
  "timeout": 180000,
  "setup": [{"cmd": "switch-session", "args": ["SESSION_ID"]}],
  "steps": [
    {"cmd": "type", "args": ["你好"]},
    {"cmd": "send"},
    {"cmd": "wait-until-done", "flags": {"timeout": "60000"}},
    {"cmd": "get-messages", "flags": {"last": "2"}},
    {"cmd": "type", "args": ["请问你能做什么？"]},
    {"cmd": "send"},
    {"cmd": "wait-until-done", "flags": {"timeout": "60000"}},
    {"cmd": "get-messages", "flags": {"last": "4"}},
    {"cmd": "get-visible-text", "flags": {"selector": "[data-testid=chat-messages]"}}
  ],
  "teardown": [{"cmd": "stop"}]
}
```

#### 模式 5：故障恢复

```json
{
  "name": "死锁恢复测试",
  "retry": 1,
  "steps": [
    {"cmd": "type", "args": ["test"]},
    {"cmd": "send"},
    {"cmd": "wait-until-done", "flags": {"timeout": "5000"}},
    {"cmd": "status"}
  ],
  "teardown": [{"cmd": "stop"}]
}
```

#### 模式 6：中断后恢复

验证 stop 能否干净终止 → 状态回到 idle → 第二条消息能否正常完成。

```json
{
  "name": "writing阶段中断后发送",
  "timeout": 90000,
  "setup": [
    {"cmd": "new-session", "flags": {"cwd": "/tmp/tokenicode-test"}},
    {"cmd": "check-editor", "assert": {"hasEditor": true}},
    {"cmd": "switch-model", "args": ["claude-sonnet-4-6"]}
  ],
  "steps": [
    {"cmd": "type", "args": ["请写一篇3000字的科普文章"]},
    {"cmd": "send"},
    {"cmd": "wait-for-phase", "args": ["writing"], "flags": {"timeout": "20000"}, "timeout": 25000},
    {"cmd": "status", "assert": {"active": true}},
    {"cmd": "stop"},
    {"cmd": "status", "assert": {"active": false}},
    {"cmd": "type", "args": ["请只回复：OK"]},
    {"cmd": "send"},
    {"cmd": "wait-until-done", "flags": {"timeout": "60000"}, "assert": {"status": "completed"}, "timeout": 65000},
    {"cmd": "get-messages", "assert": {"total_gte": 3}}
  ],
  "teardown": [{"cmd": "stop", "continueOnError": true}]
}
```

要点：`wait-for-phase` 精确等到文本输出再中断；第二条用短回复快速验证；`total_gte: 3` 验证 user1 + user2 + assistant2 都在。

#### 模式 7：对比实验

同一操作只变一个因素（如模型），其他完全相同，一次对比出差异。

```json
{
  "tests": [
    {
      "name": "sonnet-发送基础消息",
      "setup": [
        {"cmd": "new-session", "flags": {"cwd": "/tmp/tokenicode-test"}},
        {"cmd": "check-editor"},
        {"cmd": "switch-model", "args": ["claude-sonnet-4-6"]}
      ],
      "steps": [
        {"cmd": "type", "args": ["回复OK"]},
        {"cmd": "send"},
        {"cmd": "wait-until-done", "flags": {"timeout": "30000"}, "assert": {"status": "completed"}, "timeout": 35000},
        {"cmd": "get-messages", "assert": {"total_gte": 2}}
      ],
      "teardown": [{"cmd": "stop", "continueOnError": true}]
    },
    {
      "name": "opus-发送基础消息",
      "setup": [
        {"cmd": "new-session", "flags": {"cwd": "/tmp/tokenicode-test"}},
        {"cmd": "check-editor"},
        {"cmd": "switch-model", "args": ["claude-opus-4-6"]}
      ],
      "steps": [
        {"cmd": "type", "args": ["回复OK"]},
        {"cmd": "send"},
        {"cmd": "wait-until-done", "flags": {"timeout": "60000"}, "assert": {"status": "completed"}, "timeout": 65000},
        {"cmd": "get-messages", "assert": {"total_gte": 2}}
      ],
      "teardown": [{"cmd": "stop", "continueOnError": true}]
    }
  ]
}
```

可扩展变量：不同 prompt 长度、不同 session mode、不同 provider。

### 反模式

1. **不要用 `wait-until-done` 做延时** — `wait-until-done` 超时=步骤失败。要纯等待用 `delay`。
2. **不要省略 wait-until-done** — 发消息后必须等，否则后续 `get-messages` 拿到的是旧数据。
3. **不要一步到位** — 拆细步骤，每步做一件事。失败时能精确定位是哪步出问题。
4. **不要跳过 setup** — 确保测试有明确的起始状态（哪个 session、什么模型）。
5. **不要忘记 teardown** — 用 `stop` 清理运行中的会话，避免影响下一个测试。teardown 的 stop 加 `"continueOnError": true`，即使没有运行中的会话也不阻塞。
6. **不要忽略断言** — 步骤 pass 只代表命令没报错，不代表结果正确。用 `assert` 检查关键字段。注意 assert 检查的是**命令返回的 JSON 输出**，不是 beforeState/afterState。

---

## 五、完整端到端示例

仓库内置了一个最小可复制 suite：

```bash
.test/suites/examples/health-smoke.json
```

单独运行：

```bash
RUN=".test/runs/$(date +%Y-%m-%d_%H-%M-%S)-example"
mkdir -p "$RUN"

node scripts/run-tests.mjs .test/suites/examples/health-smoke.json \
  --report "$RUN/examples__health-smoke.report.json" \
  --detail standard \
  > "$RUN/examples__health-smoke.ndjson" 2>&1

python3 .test/scripts/analyze-reports.py "$RUN"
```

加入阶段测试前，先把新 suite 按同样方式单独跑通。确认稳定后，再把它加入 `.test/scripts/run-e2e.sh` 对应 phase。

大量测试时不要只跑一轮：

```bash
bash .test/scripts/run-branch-validation.sh --cycles 5 --phases 1,2,3 --detail minimal --retry 1
```

脚本会生成 `.test/runs/<timestamp>-branch-validation/RUNS.md` 和 `BUGS.md`。
分支验证阶段只记录 bug，不顺手修业务代码。

---

## 六、源码改动

### 新增文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `scripts/tokenicode-cli.mjs` | ~715 | CLI 工具主体，30 个命令（含 restart/relaunch），零外部依赖 |
| `scripts/run-tests.mjs` | ~646 | 批量测试运行器：串行执行 + Schema 校验 + 自动重试 + 超时硬上限 + 全量记录 + 兜底 restart/relaunch |
| `.test/scripts/run-e2e.sh` | ~230 | 分阶段运行 suites，写 `*.ndjson` + `*.report.json` + `SUMMARY.md` |
| `.test/scripts/run-all-phases.sh` | ~20 | 全阶段入口，运行后调用分析器 |
| `.test/scripts/run-branch-validation.sh` | ~210 | 多轮分支验证入口，生成 `RUNS.md` + `BUGS.md` |
| `.test/scripts/analyze-reports.py` | ~300 | 汇总新旧报告格式，识别稳定/间歇性失败 |
| `.test/suites/examples/health-smoke.json` | 示例 | 最小可复制 suite 模板 |
| `.test/README.md` | 索引 | 测试目录入口说明 |
| `.test/CLI-TEST-TOOL.md` | 本文件 | 完整文档 |

### 修改文件

#### `src/App.tsx`

在 `useEffect` 中扩展了 `window.__tokenicode_test` 对象（仅 `import.meta.env.DEV` 下生效）：

**新增 import**：
```typescript
import { parseSessionMessages } from './lib/session-loader';
```

**修改 `getMessages()`**（约 195-203 行）：
- 返回格式从 `Message[]` 改为 `{messages: Message[], total: number}`
- 新增 `{last?: number, tabId?: string}` 参数支持
- 默认不截断，CLI 端负责 `--last` 截断

**修改 `getLastMessage()`**（约 205-207 行）：
- 适配新的 `getMessages` 返回格式

**新增 `status()` 方法**（约 231-249 行）：
- 一次性返回全局状态快照
- `active` 字段覆盖四个活跃阶段（thinking/writing/tool/awaiting），比旧的 `isStreaming` 更全面
- `pendingPermission` 检查 `window.__tokenicode_respond_permission` 是否存在

**新增 `loadSession(sessionId)` 方法**（约 268-338 行）：
- 完整的 session 加载流程，复刻了 `ConversationList.tsx` 的 `handleLoadSession` 逻辑
- 路径：保存当前 session 缓存 → 切换 → 尝试缓存恢复 → 磁盘加载 JSONL → parseSessionMessages → 填充消息和 agents
- 防竞态：异步加载完成后检查 `selectedSessionId` 是否仍是目标 session
- 三种路径：缓存命中（fast）/ draft session（空）/ 磁盘加载（完整 JSONL 解析）

**关键设计决策**：
- `loadSession` 是 async 的，但 `execute_js` 不支持 await Promises（序列化为 `{}`）
- CLI 端使用 per-request ID 的全局变量轮询模式：`window.__tkn_loads[reqId]`
- 每次 `switch-session` 调用用 `randomUUID().slice(0,8)` 作为 reqId，避免并发冲突

### 未修改的依赖（已有代码）

| 文件 | 作用 |
|------|------|
| `src-tauri/Cargo.toml` | 测试通道依赖（`tauri-plugin-mcp`），`cfg(debug_assertions)` 门控 |
| `src-tauri/src/lib.rs` (`run()` 末尾) | 测试通道注册，在 `/tmp/tokenicode-test.sock` 启动 socket server |
| `package.json` | 测试通道 npm 包（`tauri-plugin-mcp`，提供前端 event listeners） |

这些是之前 test-harness-bridge 任务的产物，CLI 工具复用了它们提供的 socket 通道。

---

## 七、已知限制

- **HMR 不更新 test helper**：修改 `App.tsx` 后，Vite HMR 不会更新 `useEffect` 闭包。需要 `exec "location.reload()"` 全量刷新 webview。
- **execute_js 不支持 async**：返回 Promise 的代码会被序列化为 `{}`。`switch-session` 因此使用全局变量 + 轮询模式。
- **欢迎页没有编辑器**：`new-session` 无参数和 `restart` 后会停在欢迎页，该页面没有 TipTap 编辑器。对话测试必须使用 `new-session --cwd <path>` 创建可用会话，或先 `switch-session <SESSION_ID>` 加载已有会话。详见「二点五、正确的新会话流程」。
- **DOM click 对 React 组件无效**：所有交互走 `execute_js` + Zustand store 直操，不走原生点击事件。
- **relaunch 开新窗口**：`relaunch` 命令 spawn 新进程，会开新 Tauri 窗口。日常测试用 `restart`（同窗口 reload）即可。
- **relaunch 进程泄漏**：`relaunch` 通过 `lsof` 找 socket 持有者 PID 来杀进程，但旧的 `target/debug/tokenicode` 子进程经常杀不干净。长时间无人值守测试（5 小时）实测累积了 76 个僵尸进程。测试前后手动清理：`pkill -9 -f 'target/debug/tokenicode'`。
- **tmux 环境缺 cargo**：在 tmux session 中跑 `pnpm tauri dev`（或 relaunch 内部调用）需要先 `source ~/.cargo/env`，否则 `cargo metadata` 报 "No such file or directory"。
- **Webview 冻结导致 restart 也失效**：restart 依赖 `execute_js` 做 `location.reload()`，webview 冻住时 restart 必然超时。此时只能 relaunch（或手动 `pkill -9` + 重新 `pnpm tauri dev`）。

---

## 八、安全

- Socket server 仅在 `cfg(debug_assertions)` 下编译，release 构建完全不含
- `data-testid` 属性通过 `import.meta.env.DEV` 门控，production build 自动剥离
- `window.__tokenicode_test` helper 仅在 `import.meta.env.DEV` 下挂载
- restart 的进程查找使用 `execFileSync`（无 shell 注入），socket 清理使用 `fs.rmSync`（无路径拼接注入）
