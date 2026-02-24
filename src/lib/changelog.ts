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
    version: '0.6.4',
    date: '2026-02-25',
    highlights: {
      zh: [
        'Windows CMD 窗口彻底消除 — 补全最后 4 处遗漏：git 操作、CLI 安装验证、VSCode 打开、Explorer 定位',
        'CLI 终端可用 — 安装后自动设置 CLAUDE_CODE_GIT_BASH_PATH 用户环境变量，PowerShell/CMD 直接运行 claude 不再报错',
        '安装流程防卡死 — 所有安装子进程添加 stdin 隔离 + 超时保护（版本检查 10s / npm 安装 5min / 解压 2min），不再出现 CMD 卡住',
      ],
      en: [
        'Windows CMD window fully eliminated — Fixed last 4 missing spots: git ops, CLI install validation, VSCode open, Explorer reveal',
        'CLI works from terminal — Auto-sets CLAUDE_CODE_GIT_BASH_PATH user env var after install, running claude from PowerShell/CMD works',
        'Install flow hang protection — All install subprocesses now have stdin isolation + timeouts (version checks 10s / npm install 5min / extraction 2min), no more stuck CMD windows',
      ],
    },
  },
  {
    version: '0.6.3',
    date: '2026-02-24',
    highlights: {
      zh: [
        '自动更新 — 每 10 分钟后台检查新版本，顶栏右上角出现更新按钮，一键下载安装重启',
        'API 设置持久化 — 凭证和 API 配置备份到 ~/.tokenicode/，Windows 更新后不再丢失',
        'Windows 命令行窗口消除 — 所有后台进程添加 CREATE_NO_WINDOW，彻底消灭闪烁的 CMD 窗口',
        '权限循环修复 — 权限响应改用原始 stdin 通道，GUI 始终跳过 CLI 权限提示',
        'CLI 路径搜索修复 — Windows 上跳过无扩展名的 JS 脚本，避免 error 193',
      ],
      en: [
        'Auto-update — Background check every 10 min, update button appears in top bar for one-click download & restart',
        'API settings persistence — Credentials and API config backed up to ~/.tokenicode/, survives Windows updates',
        'Windows CMD window elimination — All background processes use CREATE_NO_WINDOW, no more flashing CMD windows',
        'Permission loop fix — Permission responses now use raw stdin; GUI always skips CLI permission prompts',
        'CLI path search fix — Skips extensionless JS scripts on Windows, preventing error 193',
      ],
    },
  },
  {
    version: '0.6.2',
    date: '2026-02-24',
    highlights: {
      zh: [
        'Windows CLI 启动修复 — 修复 GCS 下载的 claude.exe 无效导致 error 193 的问题',
        'CLI 检测优化 — Windows 优先使用 npm 安装的 claude.cmd（更可靠），GCS 二进制作为后备',
        '自动清理机制 — 检测到无效二进制时自动删除并切换到可用版本',
      ],
      en: [
        'Windows CLI launch fix — Fixed error 193 caused by invalid GCS-downloaded claude.exe',
        'CLI detection improved — Windows now prefers npm-installed claude.cmd (more reliable), GCS binary as fallback',
        'Auto-cleanup — Automatically removes invalid binaries and switches to working alternatives',
      ],
    },
  },
  {
    version: '0.6.1',
    date: '2026-02-24',
    highlights: {
      zh: [
        'Windows Git Bash 自动安装 — 首次安装 CLI 时自动下载并部署 PortableGit，无需手动安装 Git for Windows',
        'Git 下载三源降级 — npmmirror → 华为云 → GitHub，15 秒连接超时快速切换，国内用户无感',
        '安装流程优化 — 移除手动「下载 Git」步骤，整个环境部署全自动（Git → Node.js → CLI）',
        'CLI 启动预检增强 — 自动注入 CLAUDE_CODE_GIT_BASH_PATH，找不到 Git 时给出明确错误提示',
      ],
      en: [
        'Windows Git Bash auto-install — PortableGit is automatically downloaded and deployed during CLI setup, no manual Git installation needed',
        'Git download with 3-source fallback — npmmirror → Huawei Cloud → GitHub, 15s connect timeout for fast failover',
        'Streamlined setup — Removed manual "Download Git" step, entire environment deployment is fully automatic (Git → Node.js → CLI)',
        'CLI pre-flight enhancement — Auto-injects CLAUDE_CODE_GIT_BASH_PATH, clear error message when Git is missing',
      ],
    },
  },
  {
    version: '0.6.0',
    date: '2026-02-24',
    highlights: {
      zh: [
        'Node.js 本地部署 — 首次启动若无 npm，自动下载 Node.js LTS v22 到应用目录，无需管理员权限',
        '三层 CLI 安装降级 — GCS 直接下载 → npm 安装 → 自动部署 Node.js 后 npm 安装，每层失败优雅降级',
        '国内镜像支持 — Node.js 和 npm 包自动切换 npmmirror 国内镜像，防火墙内无需 VPN',
        '防火墙错误检测 — 网络超时、DNS 失败等错误显示友好提示，建议使用代理',
        'Windows PATH 自动配置 — 安装后自动添加 cli/、node/bin、npm-global/bin 到用户 PATH',
      ],
      en: [
        'Node.js local deployment — Auto-downloads Node.js LTS v22 on first launch if npm is missing, no admin required',
        'Three-tier CLI install fallback — GCS direct download → npm install → auto-deploy Node.js + npm, graceful fallback',
        'China mirror support — Node.js and npm packages auto-switch to npmmirror when official sources are unreachable',
        'Firewall error detection — Friendly hints for network timeout, DNS failure, suggesting VPN or proxy',
        'Windows PATH auto-config — Adds cli/, node/bin, npm-global/bin to user PATH after installation',
      ],
    },
  },
  {
    version: '0.5.6',
    date: '2026-02-24',
    highlights: {
      zh: [
        'Tiptap 富文本编辑器 — 输入框升级为 Tiptap 编辑器，支持行内文件标签、更好的光标控制',
        '文件拖拽内联标签 — 拖入文件显示为可删除的行内标签，替代旧的文件列表样式',
        '默认模型切换 Sonnet 4.6 — 新安装默认使用 claude-sonnet-4-6，性价比更高',
        'Windows CLI PATH 修复 — 修复 CLI 安装后 PATH 未正确写入导致的启动失败问题',
        'Thinking 默认关闭 — 新安装默认关闭 Thinking，按需开启',
      ],
      en: [
        'Tiptap rich text editor — Input bar upgraded to Tiptap with inline file chips and better cursor control',
        'File drag-and-drop inline chips — Dragged files appear as removable inline chips instead of a list',
        'Default model switched to Sonnet 4.6 — New installs default to claude-sonnet-4-6 for better cost efficiency',
        'Windows CLI PATH fix — Fixed PATH not written correctly after CLI installation causing launch failures',
        'Thinking off by default — New installs start with Thinking disabled, enable as needed',
      ],
    },
  },
  {
    version: '0.5.5',
    date: '2026-02-24',
    highlights: {
      zh: [
        'Thinking 五档选择器 — Off / Low / Med / High / Max 替代 on/off 开关，通过 CLI 原生 effort level 控制思考深度',
        'Thinking 关闭修复 — 修复「关闭思考仍在思考」的 bug，现在显式传 alwaysThinkingEnabled:false',
        'Output Token 上限提升 — 注入 CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000，单次回复上限翻倍',
        'Token 预警 + Auto-compact — 上下文超 120K 琥珀色警告；超 160K 自动压缩，每会话至多一次',
        '会话 Token 累计计数 — 侧栏显示整个任务的总 Token 消耗，不再只显示单轮数据',
        '会话断点续传修复 — Stop 按钮泄漏、lastActiveSessionId 持久化、stall 检测、onSessionExit 备用通道等 6 项修复',
        'Plan 审批统一 — Code 模式透明处理 Plan 工具（自动恢复）；三种模式（Code/Plan/Bypass）统一审批流程',
        '权限请求修复 — 修复 ANSI 转义码导致权限弹窗不显示的问题，新增 Holding 机制：弹窗等待期间暂停生成状态',
        '对话框 UI 优化 — 用户气泡字体缩小、附件卡片化、一键复制、AI 输出路径可点击打开',
        'Agent 监控浮动面板 — 代理状态从侧边栏移至顶栏浮动按钮，活跃时脉冲徽章提示，实时追踪 thinking/writing/tool 阶段',
        'API 模块改造 — 顶栏显示当前 API 通路；API Key 用 ref 追踪遮罩状态，修复定时器泄漏',
        '文件管理器主题适配 — 变更标记（A/M/D）改用主题变量，颜色随主题切换',
      ],
      en: [
        'Thinking 5-level selector — Off / Low / Med / High / Max replaces on/off toggle, using CLI native effort level',
        'Thinking disable fix — Fixed "thinking still active when disabled" bug with explicit alwaysThinkingEnabled:false',
        'Output token cap raised — Injects CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000, doubling per-turn output limit',
        'Token warning + Auto-compact — Amber alert at 120K context; auto-compact at 160K, fires at most once per session',
        'Session token counter — Sidebar shows cumulative token usage across all turns, not just per-turn data',
        'Session resume fixes — Stop button leak, lastActiveSessionId persistence, stall detection, onSessionExit backup, and 6 total fixes',
        'Unified plan approval — Code mode transparently handles plan tools with auto-recovery; consistent approval flow across Code/Plan/Bypass modes',
        'Permission request fix — ANSI escape codes stripped before regex matching; holding mechanism pauses generation while awaiting user approval',
        'Chat UI polish — Smaller user bubbles, file attachment cards, one-click copy, clickable file paths in AI output',
        'Agent monitoring float — Agent status moved from sidebar to floating top-bar button with pulse badge, real-time phase tracking',
        'API module revamp — Top bar shows active API route; API Key uses ref-based mask tracking, timer leak fix',
        'File explorer theme sync — Change badges (A/M/D) use theme variables, colors follow theme switching',
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
