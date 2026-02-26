# TOKENICODE v0.6.12 改造清单（安装判定 + API）

> 基线版本：`v0.6.11`  
> 目标：首装/自部署稳定、判定准确；第三方 API 用户可无登录阻塞进入主界面。

## 1. P0（本版本必须完成）

### [ ] P0-1 安装判定从“找到路径”改为“可运行”
- 现状问题：`check_claude_cli` 在 `--version` 失败时仍可能返回 `installed: true`。
- 代码位置：
  - `src-tauri/src/lib.rs:2957`
  - `src-tauri/src/lib.rs:3038`
- 修改方法：
  1. 将 CLI 状态拆成 `found` 与 `runnable`（或直接以 `version command success` 作为 installed 条件）。
  2. 仅当 `claude --version` 成功时返回 `installed: true`。
  3. 执行失败时返回 `installed: false`，并保留错误信息用于 UI 展示。

### [ ] P0-2 Setup/Settings 统一使用“可运行”状态
- 现状问题：前端主要按 `installed` 布尔判定，容易被假阳性误导。
- 代码位置：
  - `src/components/setup/SetupWizard.tsx:61`
  - `src/components/settings/SettingsPanel.tsx:770`
- 修改方法：
  1. 前端判定改为：`installed === true` 且 `version` 非空（或新增后端字段 `runnable`）。
  2. 安装后复检若不可运行，直接进入 `install_failed`，不显示“已安装”。

### [ ] P0-3 API Key 清空即删除
- 现状问题：输入框清空后直接 return，密钥文件不会删除。
- 代码位置：
  - `src/components/settings/SettingsPanel.tsx:303`
  - `src/lib/tauri-bridge.ts:307`
- 修改方法：
  1. 在 `handleKeyChange` 中，`trimmed === ''` 时调用 `bridge.deleteApiKey()`。
  2. 删除成功后重置 UI 状态（`keyStatus='empty'`，清空 mask）。
  3. 调用 `bumpApiKeyVersion()`，确保旧进程失效并重建。

### [ ] P0-4 禁止永久改写用户 `~/.claude/settings.json`
- 现状问题：会话启动时 strip `ANTHROPIC_*` 并写回，且无恢复调用。
- 代码位置：
  - `src-tauri/src/lib.rs:746`
  - `src-tauri/src/lib.rs:1033`
  - `src-tauri/src/lib.rs:777`
- 修改方法（推荐二选一）：
  1. **推荐**：移除对 `settings.json` 的写操作，仅对 Claude 子进程做 `env_remove/env inject`。
  2. 或改为“会话级临时 strip + 进程退出时 restore”（复杂度更高，不建议本版）。

### [ ] P0-5 启动时增加 CLI 健康复验
- 现状问题：`setupCompleted` 持久化后可能跳过真实检查。
- 代码位置：
  - `src/stores/settingsStore.ts:305`
  - `src/components/chat/ChatPanel.tsx:798`
- 修改方法：
  1. App 启动时调用一次 `checkClaudeCli`（可运行判定）。
  2. 若不可运行则将 `setupCompleted` 置回 false，自动进入 Setup Wizard。

---

## 2. P1（下一版本紧跟）

### [ ] P1-1 macOS 完全自托管（对齐 Windows）
- 代码位置：`src-tauri/src/lib.rs:3202`
- 修改方法：
  1. 在 macOS 安装流程增加 git 依赖检测与自动部署分支。
  2. 目标是“前台一个按钮，后台自动完成 CLI/Node/git 可用环境”。

### [ ] P1-2 API 测试连接结果语义修正
- 代码位置：
  - `src-tauri/src/lib.rs:859`
  - `src/components/settings/SettingsPanel.tsx:355`
- 修改方法：
  1. 后端仅 2xx 视为成功。
  2. 401 归类 auth，429 归类 quota，4xx/5xx 归类请求或服务异常。
  3. 前端按类型显示明确提示，不再“非 401 即成功”。

### [ ] P1-3 测试连接前强制保存最新 Key
- 代码位置：`src/components/settings/SettingsPanel.tsx:355`
- 修改方法：
  1. 若当前为 editing 且有未落盘值，先 `saveApiKey` 再调用 `testApiConnection`。
  2. 解决 debounce 引发的“刚改 key 就测失败/误判”。

---

## 3. 回归验证清单（发版前）

### 首装/安装
- [ ] 新机无 CLI：一键安装后可进入主界面并成功发起首条消息。
- [ ] 人工放置损坏 CLI：不会显示“已安装”，会回到 Setup。
- [ ] 升级后 `setupCompleted=true` 但 CLI 被删：启动后自动回到 Setup。

### API Provider
- [ ] 清空 API Key 后立刻无效（旧 key 不再可用）。
- [ ] 自定义 API 模式下不会永久修改用户 `~/.claude/settings.json`。
- [ ] 切换 provider/key 后，旧会话可被正确淘汰并重建。

### 体验目标
- [ ] 第三方 API 用户可跳过登录阻塞，直接进入主界面。
- [ ] 使用 Claude Code CLI 的用户维持原有自动登录/已登录体验（不增加阻塞）。

---

## 4. 实施顺序建议（最小风险）
1. 先改 `P0-1/P0-2`（判定准确性，立即减少假成功）。
2. 再改 `P0-3`（避免密钥状态错觉）。
3. 再改 `P0-4`（消除全局配置副作用）。
4. 最后改 `P0-5`（启动复验闭环）。

> 这样可以先稳定”是否可用”的判断，再清理 API 侧副作用，回归成本最低。

---

## 5. API 端点排查记录（2026-02-26）

### 用户环境
- Win11 纯净，无梯子
- CLI 安装正常，软件运行正常
- yunwu.ai（云雾）正常可对话
- wcnbai.com 连接测试报 `NETWORK_ERROR: error sending request for url`

### 排查结论

**不是软件 bug，不是 Key 问题，是 API 端点网络可达性问题。**

| 排查维度 | 结果 |
|----------|------|
| 代码审查 `test_api_connection`（lib.rs:819-872） | URL 拼接正确，逻辑无 bug |
| 云雾走同一段代码 | 通过 → 排除软件问题 |
| NETWORK_ERROR 发生层级 | TCP/TLS 层，请求未到达服务器 → 排除 Key 问题 |
| P0-3（Key 清空不删除）/ P1-3（Key 未保存就测试） | 会导致 AUTH_ERROR (401)，不是 NETWORK_ERROR |

### 稳定性测试（5 分钟 4 通道并行，从有代理的 macOS 环境）

| 通道 | 目标 | 成功率 | 响应时间 | 备注 |
|------|------|--------|----------|------|
| ICMP ping 域名 | wcnbai.com | 150/150 (0%) | avg 0.75ms | |
| ICMP ping IP | 64.32.27.106 | 150/150 (0%) | avg 0.66ms | |
| HTTPS 探测 | https://wcnbai.com | 101/101 (0%) | avg ~0.87s | **稳定** |
| HTTP IP:端口 | http://64.32.27.106:3000 | 25/25 (0%) | **每次 10s 超时** | 响应体传输卡住，**不稳定** |

### 结论
- wcnbai.com 服务本身正常（有代理时全通），问题在用户端到 wcnbai.com 的网络链路（国内裸连不通）
- IP 直连 `64.32.27.106:3000` 虽 0 丢包，但每次请求打满 10s 超时，不宜作为备选
- 建议用户使用国内可达的 API 代理（如云雾 yunwu.ai）
