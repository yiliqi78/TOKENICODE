import type { Locale } from '../stores/settingsStore';

export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: Record<Locale, string[]>;
}

/**
 * Changelog entries for the "What's New" modal.
 * Only include versions with user-facing changes worth highlighting.
 * Ordered newest first. Update this when releasing a new version.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.5.5',
    date: '2026-02-23',
    highlights: {
      zh: [
        'Thinking 五档选择器 — Off / Low / Med / High / Max 替代 on/off 开关，通过 CLI 原生 effort level 控制思考深度',
        'Thinking 关闭修复 — 修复「关闭思考仍在思考」的 bug，现在显式传 alwaysThinkingEnabled:false',
        'Output Token 上限提升 — 注入 CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000，单次回复上限翻倍',
        'Token 预警 + Auto-compact — 上下文超 120K 琥珀色警告；超 160K 自动压缩，每会话至多一次',
        '会话断点续传修复 — Stop 按钮泄漏、lastActiveSessionId 持久化、stall 检测、onSessionExit 备用通道等 6 项修复',
        'Plan 审批统一 — Bypass 模式不再自动跳过计划审批，所有模式统一为「批准并执行」一键流程',
        '对话框 UI 优化 — 用户气泡字体缩小、附件卡片化、一键复制、AI 输出路径可点击打开',
        'Agent 监控浮动面板 — 代理状态从侧边栏移至顶栏浮动按钮，活跃时脉冲徽章提示，实时追踪 thinking/writing/tool 阶段',
        'API 模块改造 — 顶栏显示当前 API 通路（CLI / API · 提供商名）；Base URL 输入后显示「已保存」；API Key 输入即保存，Eye 图标可查看已存储的真实 Key',
      ],
      en: [
        'Thinking 5-level selector — Off / Low / Med / High / Max replaces on/off toggle, using CLI native effort level',
        'Thinking disable fix — Fixed "thinking still active when disabled" bug with explicit alwaysThinkingEnabled:false',
        'Output token cap raised — Injects CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000, doubling per-turn output limit',
        'Token warning + Auto-compact — Amber alert at 120K context; auto-compact at 160K, fires at most once per session',
        'Session resume fixes — Stop button leak, lastActiveSessionId persistence, stall detection, onSessionExit backup, and 6 total fixes',
        'Unified plan approval — Bypass mode no longer auto-skips plan review; all modes use single "Approve & Execute" flow',
        'Chat UI polish — Smaller user bubbles, file attachment cards, one-click copy, clickable file paths in AI output',
        'Agent monitoring float — Agent status moved from sidebar to floating top-bar button with pulse badge, real-time phase tracking',
        'API module revamp — Top bar shows active API route (CLI / API · provider); Base URL shows "Saved" feedback; API Key auto-saves on input, Eye icon reveals stored key',
      ],
    },
  },
  {
    version: '0.5.4',
    date: '2026-02-21',
    highlights: {
      zh: [
        '第三方 API 切换 (TK-303) — 设置面板三种模式：继承系统配置 / 官方 API / 自定义端点 + 加密密钥 + 模型映射',
        '连接测试 & Thinking 签名自动重试 — 一键测试连通性，切换提供商后自动重发',
        '一键回到底部按钮 + 设置面板 CLI 管理 + 过期预热会话检测',
        'ANSI 转义码过滤、子代理缩进、删除到回收站等 9 项修复',
      ],
      en: [
        'Third-party API switching (TK-303) — 3 modes: Inherit / Official / Custom endpoint + encrypted key + model mapping',
        'Connection test & thinking signature auto-retry — One-click test, auto re-send on provider switch',
        'Scroll-to-bottom button + CLI management in Settings + stale pre-warm detection',
        'ANSI escape stripping, sub-agent indentation, trash-based delete, and 9 other fixes',
      ],
    },
  },
  {
    version: '0.5.3',
    date: '2026-02-21',
    highlights: {
      zh: [
        'Plan 模式退出修复 (TK-306) — 批准后自动切换 code 模式重启会话，Claude 能正常执行工具',
        '新增 sendRawStdin 原始输入通道 — 交互式审批不再用 NDJSON 包装',
        'AskUserQuestion 表单去重 — 修复重新投递导致的重复问题',
      ],
      en: [
        'Plan mode exit fix (TK-306) — Approve & Execute now restarts session in code mode, Claude can execute tools',
        'Raw stdin for interactive approvals — No NDJSON wrapping for y/n prompts',
        'AskUserQuestion dedup — Fixed re-delivery causing duplicate forms',
      ],
    },
  },
  {
    version: '0.5.1',
    date: '2026-02-20',
    highlights: {
      zh: [
        '代码语法高亮配色优化 — 独立 --syntax-* 变量，8 套主题专属配色，不再与语义色撞色',
        'CLI 直接下载安装 — Rust HTTP 从 Anthropic CDN 流式下载，无需 npm/curl/PowerShell',
        'Plan 面板磨砂玻璃浮动 — 背景模糊 + 圆角 + 阴影，不再挤压主聊天区',
        'Windows CLI 启动修复 — 修复 npm 安装时错误 193（claude.cmd 回退）',
      ],
      en: [
        'Syntax highlighting — Dedicated --syntax-* variables, 8 theme-specific palettes',
        'CLI direct download — Rust HTTP streaming from Anthropic CDN, no npm/curl/PowerShell needed',
        'Plan panel glassmorphism — Floating overlay with backdrop blur, rounded corners, shadow',
        'Windows CLI fix — Error 193 resolved with claude.cmd fallback for npm installs',
      ],
    },
  },
  {
    version: '0.5.0',
    date: '2026-02-20',
    highlights: {
      zh: [
        'Markdown 图片预览修复 — 本地文件通过 Rust 桥接加载，支持点击放大',
        'Plan Mode 退出修复 — 修复用户确认后面板卡死的问题',
        '/compact 成本信息内置 — Cost/Duration/Turns 显示在命令卡片内',
        '计划面板重构 — 从顶部弹出改为右侧栏，按钮移至输入工具栏',
        'Thinking 流式输出 — 实时显示 AI 思考过程',
        'AskUserQuestion 修复 — 表单去重、Unicode 渲染、跳过状态修复',
        '设置面板新增「查看更新内容」入口',
        '18 项 Bug 修复与体验优化',
      ],
      en: [
        'Markdown image preview fix — Local files loaded via Rust bridge with zoom support',
        'Plan Mode exit fix — Resolved stuck panel after user confirmation',
        '/compact cost info — Cost/Duration/Turns shown inside command card',
        'Plan panel redesign — Right sidebar with toggle in input toolbar',
        'Thinking streaming — Real-time AI thinking process display',
        'AskUserQuestion fixes — Form dedup, Unicode rendering, skip state',
        'Settings panel: "What\'s New" button to view release notes',
        '18 bug fixes and UX improvements',
      ],
    },
  },
  {
    version: '0.4.5',
    date: '2026-02-20',
    highlights: {
      zh: [
        '启动时自动检测更新，有新版本时设置按钮显示绿点提示',
        '更新后首次启动展示更新内容弹窗',
      ],
      en: [
        'Auto-check for updates on startup with green dot notification',
        'Show changelog modal after updating to a new version',
      ],
    },
  },
  {
    version: '0.4.4',
    date: '2026-02-20',
    highlights: {
      zh: [
        'Windows CLI 检测 — 自动检测 Windows 上的 Claude CLI 安装路径',
        '跨平台路径处理 — 兼容 / 和 \\ 分隔符',
        'Token 用量显示 — 侧栏显示输入/输出 token 数量',
        'YAML Frontmatter 渲染 — 文件预览中以独立样式块展示',
        '滚动条样式优化 — 统一细滚动条，主题色适配',
      ],
      en: [
        'Windows CLI Detection — Auto-detect Claude CLI on Windows',
        'Cross-platform Path Handling — Support both / and \\\\ separators',
        'Token Usage Display — Sidebar shows input/output token counts',
        'YAML Frontmatter Preview — Styled metadata block in file preview',
        'Scrollbar Styling — Thin theme-aware scrollbars',
      ],
    },
  },
];

export function getChangelog(version: string): ChangelogEntry | null {
  return CHANGELOG.find((e) => e.version === version) || null;
}
