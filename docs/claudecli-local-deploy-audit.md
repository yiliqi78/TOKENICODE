# TOKENICODE 本地 ClaudeCodeCLI 环境与自部署审计（Windows 已通 / macOS 风险评估）

> 创建日期：2026-02-25  
> 目标：审计 ClaudeCodeCLI 在 TOKENICODE 的安装、检测、登录、发布自部署链路，重点识别 macOS 端潜在问题与优化空间。

## 1) 本机环境快照（本次审计采样）

采样结果（2026-02-25）：

- OS：macOS 26.3 (arm64)
- Claude CLI：`/Users/tinyzhuang/.local/bin/claude`，版本 `2.1.52 (Claude Code)`
- Node/NPM：`v22.14.0` / `10.9.2`
- Tauri CLI：`2.10.0`
- Xcode CLI / notarytool：已安装
- 本机存在 Claude Desktop 自带旧版本目录：`~/Library/Application Support/Claude/claude-code/2.1.49`
- TOKENICODE app-local 目录当前仅见凭据文件：`~/Library/Application Support/com.tinyzhuang.tokenicode`

结论：**本机目前主要依赖系统/用户级 Claude CLI，不是 app-local CLI**。因此「app-local 安装路径」在 mac 上仍需重点验证。

## 2) 当前实现链路（代码层）

- CLI 检测：`find_claude_binary()` + `check_claude_cli()`  
  参考：`src-tauri/src/lib.rs:143`、`src-tauri/src/lib.rs:2566`
- CLI 安装：GCS 直下 → npm fallback → 本地 Node fallback  
  参考：`src-tauri/src/lib.rs:2935`
- Setup 向导：仅覆盖安装，不覆盖登录认证  
  参考：`src/components/setup/SetupWizard.tsx:21`
- 自部署：GitHub Action + 本地 `scripts/build-macos-local.sh`

## 3) 关键问题（按优先级）

## P0（优先修）

1. **Unix 可执行校验过宽，可能把坏文件判定为“已安装”**  
   - Unix 下 `is_valid_executable()` 只要文件存在就返回 true：`src-tauri/src/lib.rs:93`  
   - `find_claude_binary()` 优先命中 app-local `cli/claude`：`src-tauri/src/lib.rs:158`  
   - `check_claude_cli()` 即使执行失败，也仍返回 `installed: true`（仅 version 置空）：`src-tauri/src/lib.rs:2606`、`src-tauri/src/lib.rs:2647`  
   - SetupWizard 检测到 installed 就直接完成 setup：`src/components/setup/SetupWizard.tsx:43`、`src/components/setup/SetupWizard.tsx:45`  
   - 风险：mac 上若出现半下载/损坏二进制，会“假安装成功”，后续会话启动才报错。

2. **macOS 终端登录命令未正确 shell quoting，路径含空格时易失败**  
   - AppleScript 直接拼接 `"{} login"`：`src-tauri/src/lib.rs:3781`  
   - 当路径来自 `~/Library/Application Support/.../claude` 时包含空格，存在执行失败风险。

3. **本地构建脚本存在明文敏感信息（严重安全风险）**  
   - `APPLE_ID`、`APPLE_PASSWORD`、签名密码硬编码在仓库脚本：`scripts/build-macos-local.sh:23`、`scripts/build-macos-local.sh:24`、`scripts/build-macos-local.sh:28`。

4. **发布链路“文档声明”与“CI 实际配置”不一致**  
   - Changelog 声称已启用 Apple 签名与公证：`CHANGELOG.md:399`  
   - 但 release workflow 里 Apple 相关 secrets 仍被注释：`.github/workflows/release.yml:66`  
   - 风险：mac 发布是否已签名/公证依赖人工流程，不稳定且难审计。

## P1（体验与可靠性）

5. **setup 仅做“安装完成”布尔持久化，缺少启动时健康复验**  
   - `setupCompleted` 持久化后直接跳过向导：`src/stores/settingsStore.ts:132`、`src/components/chat/ChatPanel.tsx:808`  
   - 且支持用户直接 Skip：`src/components/setup/SetupWizard.tsx:95`  
   - 风险：CLI 后续被删/损坏时，用户仍进入主界面再遇运行时错误。

6. **登录/认证能力在后端已实现，但前端未接入（链路断层）**  
   - Bridge 暴露了 `startClaudeLogin/checkClaudeAuth/openTerminalLogin`：`src/lib/tauri-bridge.ts:283`  
   - 但现有组件未实际调用（仅有 i18n 文案与注释保留）。

7. **安装进度逻辑分散在两个 UI 实现，维护成本高**  
   - SetupWizard 与 SettingsPanel 各自处理 phase 映射：`src/components/setup/SetupWizard.tsx:99`、`src/components/settings/SettingsPanel.tsx:668`。

8. **本地 mac 构建脚本仅上传 dmg/tar.gz/sig，未显式处理 updater manifest**  
   - 当前只 copy/upload `dmg`、`tar.gz`、`sig`：`scripts/build-macos-local.sh:69`、`scripts/build-macos-local.sh:73`、`scripts/build-macos-local.sh:89`  
   - 若发布依赖 `latest.json` 聚合，建议在脚本中显式检查与上传，避免“构建成功但自动更新不可用”。

## 4) macOS 专项改造清单（vNext）

### A. 安装与检测收敛（先做）

1. 把 CLI 检测改为“可执行 + 可运行”双校验：  
   - Unix 校验 `metadata.permissions().mode() & 0o111 != 0`；  
   - 再执行 `claude --version` 成功才标记 installed。  
2. `find_claude_binary()` 采用“候选列表 + 首个可运行项”策略，避免坏 app-local CLI 阻塞 fallback。  
3. SetupWizard 完成前增加一次“启动会话级 smoke check”（例如干跑 `claude --version` + `doctor` 快速检查）。

### B. 登录链路修复

4. 修复 mac `open_terminal_login` 的 quoting（对路径做 shell-escape），或改为直接执行二进制路径参数而不是字符串拼接。  
5. 将 `checkClaudeAuth`/`startClaudeLogin` 正式接入 UI（Setup 或 Settings），形成安装→登录→ready 的闭环。

### C. 发布与安全治理

6. 立即移除仓库内明文密钥，改为本地 `.env` + CI Secrets 注入。  
7. 统一“唯一发布路径”：  
   - 要么完全走 GitHub Action；  
   - 要么本地脚本产物上传前做 manifest 完整性检查。  
8. 修正文档与流程状态：若 CI 未启用 Apple 签名，就不要在 changelog 声称“已完成”。

## 5) 明天可直接执行的 mac 验证清单（最小集）

1. 清空 app-local CLI 后，执行一键安装：验证 GCS 直装路径可用。  
2. 人工制造坏 `cli/claude`（无执行权限）后重启：验证不会再误判 installed。  
3. 将 CLI 路径指向含空格路径后触发 terminal login：验证登录命令可正常拉起。  
4. 验证 release 产物：签名、公证、updater manifest 三项都可被脚本/CI 自动检查。  
5. 删除系统 CLI，仅保留 app-local CLI：验证 TOKENICODE 在 mac 的完全自托管可运行。

---

一句话结论：**Windows 路径这次已经明显收敛；mac 当前最大风险在“假安装成功（检测过宽）+ 发布安全与流程不一致”。先修 P0，再做体验层优化。**
