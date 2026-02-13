<div align="center">

<img src="icon/图标.svg" alt="TOKENICODE Logo" width="120" />

# TOKENICODE

### Claude Code 原生桌面客户端

[![Version](https://img.shields.io/badge/版本-0.1.0-blue?style=flat-square)](https://github.com/tinyzhuang/tokenicode/releases)
[![License](https://img.shields.io/badge/许可证-Apache%202.0-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/平台-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)](#安装)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust&logoColor=black)](https://www.rust-lang.org)

**TOKENICODE** 将强大的 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 封装在精美的原生桌面界面中 — 集成文件浏览、会话管理、快照回退、斜杠命令等丰富功能。

[**下载**](#安装) | [**功能**](#-功能特性) | [**开发**](#-开发指南) | [**贡献**](#-参与贡献)

---

**[English](README.md)** | **[中文](README_zh.md)** | **[日本語](README_ja.md)**

</div>

## 功能特性

| | | | |
|:---:|:---:|:---:|:---:|
| **流式对话** | **文件浏览器** | **会话管理** | **快照与回退** |
| 基于 NDJSON 的实时流式输出，支持思考、输出和工具执行状态显示 | 浏览、预览和编辑项目文件，支持语法高亮 | 持久化会话，支持搜索、重命名、导出和恢复 | 在 Claude 修改文件前自动创建快照，可回退到任意对话轮次 |
| **斜杠命令** | **命令面板** | **国际化** | **主题** |
| 完整支持 Claude Code 斜杠命令，带自动补全 | `Cmd+K` 快速访问面板，一键执行各种操作 | 中英双语，可扩展的翻译系统 | 浅色、深色和跟随系统主题，多种强调色可选 |

## 截图预览

<div align="center">

> 截图将在首次公开发布后添加。
>
> 应用采用三栏布局：左侧为会话列表侧栏，中间为聊天面板，右侧为文件/代理/设置等辅助面板。

</div>

## 快速开始

### 前置条件

- 已安装并认证 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- macOS 12+、Windows 10+ 或 Linux（需要 WebKit2GTK）

### 安装

#### macOS

从 [Releases](https://github.com/tinyzhuang/tokenicode/releases) 下载最新的 `.dmg` 文件，打开后将 **TOKENICODE** 拖入应用程序文件夹。

#### Windows

从 [Releases](https://github.com/tinyzhuang/tokenicode/releases) 下载最新的 `.msi` 安装包并运行。

#### Linux

从 [Releases](https://github.com/tinyzhuang/tokenicode/releases) 下载 `.AppImage` 或 `.deb` 安装包。

### 首次启动

1. 打开 TOKENICODE
2. 在欢迎界面或输入栏选择一个项目文件夹
3. 开始对话 — Claude CLI 会话在后台无缝运行

## 开发指南

### 系统要求

| 工具 | 版本 | 用途 |
|------|------|------|
| [Node.js](https://nodejs.org) | 18+ | JavaScript 运行时 |
| [pnpm](https://pnpm.io) | 9+ | 包管理器 |
| [Rust](https://rustup.rs) | 1.75+ | 后端编译 |
| [Tauri CLI](https://tauri.app) | 2.x | 应用打包与开发服务器 |

### 搭建开发环境

```bash
# 克隆仓库
git clone https://github.com/tinyzhuang/tokenicode.git
cd tokenicode

# 安装依赖
pnpm install

# 启动开发模式（同时启动 Vite + Tauri）
pnpm tauri dev
```

### 命令速查

| 命令 | 说明 |
|------|------|
| `pnpm tauri dev` | 开发模式（Vite 开发服务器 + Tauri 应用） |
| `pnpm tauri build` | 构建生产版本 |
| `pnpm dev` | 仅前端开发（Vite，端口 1420） |
| `pnpm build` | 类型检查 + Vite 构建（前端） |
| `cargo check` | Rust 类型检查（在 `src-tauri/` 目录下） |
| `cargo clippy` | Rust 代码检查（在 `src-tauri/` 目录下） |

### 项目结构

```
tokenicode/
├── src/                          # 前端（React + TypeScript）
│   ├── components/
│   │   ├── chat/                 # 聊天面板、消息气泡、输入栏、回退、斜杠命令
│   │   ├── layout/               # 应用外壳、侧栏、辅助面板
│   │   ├── files/                # 文件浏览器、预览、项目选择器
│   │   ├── conversations/        # 会话列表、导出
│   │   ├── commands/             # 命令面板（Command Palette）
│   │   ├── agents/               # 代理活动面板
│   │   ├── skills/               # 技能管理面板
│   │   ├── mcp/                  # MCP 服务器管理
│   │   ├── settings/             # 设置面板
│   │   └── shared/               # Markdown 渲染器、图片灯箱
│   ├── stores/                   # Zustand 状态管理（8 个独立 Store）
│   ├── hooks/                    # useClaudeStream、useFileAttachments、useRewind
│   └── lib/                      # tauri-bridge.ts、i18n.ts、turns.ts
├── src-tauri/                    # 后端（Rust）
│   ├── src/
│   │   ├── lib.rs                # 所有 Tauri 命令处理器
│   │   └── commands/             # Claude CLI 进程管理
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/                       # 静态资源
└── icon/                         # 应用图标 SVG
```

## 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                        TOKENICODE                            │
├──────────────┬───────────────────┬───────────────────────────┤
│   侧栏       │    聊天面板        │     辅助面板               │
│              │                   │  （文件/代理/设置）          │
│ 会话列表      │  消息流            │                           │
│ 项目选择器    │  输入栏            │  文件浏览器                 │
│ 主题切换      │  斜杠命令          │  文件预览（CodeMirror）     │
│              │  回退面板          │  代理活动                   │
│              │  模式选择器        │  技能管理                   │
│              │  模型选择器        │  MCP 服务器                 │
│              │                   │  设置                      │
├──────────────┴───────────────────┴───────────────────────────┤
│                    Zustand Stores（8个）                       │
│  chatStore · sessionStore · fileStore · settingsStore         │
│  snapshotStore · agentStore · skillStore · commandStore       │
├──────────────────────────────────────────────────────────────┤
│                  tauri-bridge.ts（IPC 桥接）                   │
├──────────────────────────────────────────────────────────────┤
│                   Tauri invoke() / events                     │
├──────────────────────────────────────────────────────────────┤
│                  Rust 后端（lib.rs）                           │
│  会话管理 · 文件操作 · Git · 技能 · 代理 · 文件监控             │
├──────────────────────────────────────────────────────────────┤
│               Claude Code CLI（子进程）                        │
│            --output-format stream-json                        │
└──────────────────────────────────────────────────────────────┘
```

### 设计决策

| 决策 | 原因 |
|------|------|
| 单一 IPC 桥接（`tauri-bridge.ts`） | 所有前后端调用通过一个文件 — 便于审计和维护 |
| NDJSON 流式传输 | Claude CLI 输出换行分隔的 JSON，逐行解析实现实时更新 |
| 8 个独立 Zustand Store | 每个关注点独立隔离 — 没有庞大的单体状态，易于理解 |
| 透明标题栏 | 原生 macOS 外观，保留红绿灯窗口控制按钮 |
| 修改前创建快照 | 在 Claude 编辑文件前捕获文件内容，实现安全回退 |
| 通过 `--resume` 恢复会话 | 每次追加消息都启动新 CLI 进程，传入会话 ID 继续对话 |

## 技术栈

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| ![React](https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black) | 19.1 | UI 框架 |
| ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) | 5.8 | 类型安全 |
| ![Tailwind](https://img.shields.io/badge/-Tailwind%20CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) | 4.1 | 原子化样式 |
| ![Zustand](https://img.shields.io/badge/-Zustand-433E38?style=flat-square) | 5.0 | 状态管理 |
| ![CodeMirror](https://img.shields.io/badge/-CodeMirror-D30707?style=flat-square) | 6.x | 代码编辑与预览 |
| ![Vite](https://img.shields.io/badge/-Vite-646CFF?style=flat-square&logo=vite&logoColor=white) | 7.0 | 构建工具与开发服务器 |

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| ![Rust](https://img.shields.io/badge/-Rust-DEA584?style=flat-square&logo=rust&logoColor=black) | 2021 | 原生后端 |
| ![Tauri](https://img.shields.io/badge/-Tauri-FFC131?style=flat-square&logo=tauri&logoColor=white) | 2.0 | 桌面应用框架 |
| ![Tokio](https://img.shields.io/badge/-Tokio-232323?style=flat-square) | 1.x | 异步运行时 |
| ![Serde](https://img.shields.io/badge/-Serde-DEA584?style=flat-square) | 1.x | 序列化 |

## 功能详解

### 流式对话

通过 NDJSON 流式传输与 Claude Code 实时对话。界面清晰展示不同阶段 — 思考中、输出中、工具执行中 — 每个阶段都有动画指示器。

### 文件浏览器

浏览完整项目目录树，支持展开/折叠。被 Claude 修改的文件会高亮标记。双击在 VS Code 中打开，或直接在内置 CodeMirror 编辑器中预览，支持完整的语法高亮。

### 快照与回退

每次 Claude 修改文件前，都会自动创建快照。通过回退面板（Rewind Panel）可以回到任意对话轮次 — 独立恢复代码、对话或同时恢复两者。

### 会话管理

所有 Claude Code 会话持久保存且可搜索。可以恢复之前的任意会话、重命名、导出为 Markdown/JSON，或在 Finder 中显示会话文件。

### 斜杠命令

完整支持所有 Claude Code 斜杠命令（`/ask`、`/plan`、`/compact`、`/model` 等），带自动补全弹出窗口，显示内置命令、项目命令和技能。

### 命令面板（Command Palette）

按 `Cmd+K` 打开快速访问命令面板，可用于新建对话、切换面板、切换主题等操作。

### 代理活动

实时监控 Claude 的子代理（Sub-agent）活动。查看各个代理的启动、思考、工具执行和完成状态。

### 技能与 MCP

直接在界面中管理 Claude Code 技能（创建、编辑、启用/禁用）和 MCP 服务器连接。

### 文件编辑

在内置 CodeMirror 编辑器中直接编辑文件，支持 12+ 种语言的语法高亮。无需离开应用即可保存更改。

### 国际化

完整的中英双语支持。所有用户界面字符串通过统一的 i18n 系统管理。可在设置中切换语言。

## 键盘快捷键

| 快捷键 | 操作 |
|--------|------|
| `Cmd+K` | 打开命令面板 |
| `Cmd+N` | 新建对话 |
| `Cmd+B` | 切换侧栏 |
| `Cmd+.` | 切换文件面板 |
| `Cmd+,` | 打开设置 |
| `Cmd+Enter` | 发送消息 |
| `Cmd++` / `Cmd+-` | 调整字体大小 |
| `Cmd+0` | 重置字体大小 |
| `Escape` | 关闭弹出层 / 取消 |

## 参与贡献

欢迎贡献代码！以下是参与方式：

### 工作流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/my-feature`
3. 按照下方代码规范进行开发
4. 使用规范化提交格式：`feat: 添加新功能`
5. 推送并创建 Pull Request

### 代码规范

- **前端**：TypeScript 严格模式，Tailwind CSS 样式，Zustand 状态管理
- **后端**：标准 Rust 格式化（`cargo fmt`），Clippy 警告视为错误
- **提交**：使用约定式提交（`feat:`、`fix:`、`refactor:`、`docs:`、`chore:`）

### Bug 报告

请在 Issue 中提供以下信息：
- 复现步骤
- 预期行为与实际行为
- 操作系统和应用版本
- 控制台输出（如有）

## 许可证

本项目采用 **Apache License 2.0** 许可证 — 详见 [LICENSE](LICENSE) 文件。

## 致谢

- [Anthropic](https://anthropic.com) — Claude Code CLI
- [Tauri](https://tauri.app) — 原生桌面应用框架
- [React](https://react.dev) 及开源社区

---

<div align="center">

**如果你觉得 TOKENICODE 有用，请给个 Star 支持一下！**

</div>
