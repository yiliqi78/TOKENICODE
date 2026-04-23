import type { Locale } from '../stores/settingsStore';

export interface ChangelogCategory {
  label: Record<Locale, string>;
  items: Record<Locale, string[]>;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: Record<Locale, string[]>;
  categories?: ChangelogCategory[];
}

/**
 * Changelog entries for the "What's New" modal.
 * Only include versions with user-facing changes worth highlighting.
 * Ordered newest first. Update this when releasing a new version.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.10.6',
    date: '2026-04-18',
    highlights: {
      zh: [
        'Windows 装不上 Claude CLI 的问题修好了（「不支持的 16 位应用程序」）',
        '一批切会话、中断消息、卡「运行中」的老毛病都修了',
        '跟 CC Switch 共存时会给出友好提示',
      ],
      en: [
        'Fixed Windows Claude CLI install failure ("16-bit application not supported")',
        'Batch of fixes for workspace switching, interrupted messages, and stuck "running" sessions',
        'Friendly notice when CC Switch is installed alongside',
      ],
    },
    categories: [
      {
        label: { zh: '新增', en: 'New' },
        items: {
          zh: [
            '跟 CC Switch 共存时的友好提示 — 检测到同时装了 CC Switch，设置里会直接告诉你它俩怎么配合，不用自己琢磨',
          ],
          en: [
            'CC Switch coexistence notice — when both are installed, Settings tells you how they work together',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            'Windows 装不上 Claude CLI — 之前装完打开会弹「不支持的 16 位应用程序」完全没法用。这版改成从官方直接下载绕开问题包，遇到坏掉的 CLI 会自动识别清理；设置 → CLI 新增「修复」按钮一键清理重装；国内用户自动挑版本最新的下载源',
            '连续切换会话偶尔串流 / 丢流 — 刚切过去的会话看到别人的内容，或者自己发的消息直接没了。修好',
            '中断消息后再发，容易绑错位置 — 重发的消息会误贴到上一条被中断的记录上。修好',
            '重启后有会话卡在「运行中」 — 明明已经结束，界面上还一直转圈。修好',
            '改完设置要刷新才生效 — 现在改完立即响应',
            '标题生成偶尔卡住 — 加了 10 秒超时，不会再无限等待',
          ],
          en: [
            'Windows Claude CLI install — previously crashed with "16-bit application not supported" and was unusable. Now downloads from the official source directly, self-heals corrupt installs, and Settings → CLI has a one-click Repair button. Mainland users auto-select the most up-to-date mirror',
            'Occasional stream cross-talk / missing messages when switching sessions quickly — fixed',
            'Sending after interrupting a message could attach the new message to the wrong record — fixed',
            'Sessions stuck spinning as "running" after restart — fixed',
            'Settings changes required a refresh to take effect — now instant',
            'Title generation occasionally hung — now has a 10 s timeout',
          ],
        },
      },
    ],
  },
  {
    version: '0.10.5',
    date: '2026-04-17',
    highlights: {
      zh: [
        '紧急修复：第三方 Provider 在 v0.10.3+ 下不响应',
        '紧急修复：频繁切换工作区后界面整体冻结',
      ],
      en: [
        'Hot-fix: third-party providers unresponsive since v0.10.3',
        'Hot-fix: UI freeze after frequent workspace switches',
      ],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            '第三方 Provider 发消息不响应 — v0.10.3 对 ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN 写入空字符串让 CLI 进入 OAuth 路径触发 oauth_token_refresh 死锁；--setting-sources project,local 又让 CLI 对第三方 endpoint 构造错误请求 → 429。去掉两处后，env_remove 路径仍保留防 CCswitch 继承',
            '频繁切换工作区后 CLI 管理 / 文件树 / chat 整体冻结 — read_dir_recursive 的 sort_by closure 在比较时调 is_dir() 文件系统 syscall，CLI 同时写 SDK checkpoint 文件导致同一 entry 两次返回不同值，Rust 1.81+ 严格 total-order 检查 panic tokio worker，所有 async command 挂起。改为预先缓存 is_dir() 再排序',
          ],
          en: [
            'Third-party providers unresponsive — v0.10.3 wrote empty strings to ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN pushing the CLI onto the OAuth path which deadlocked via oauth_token_refresh; --setting-sources project,local also caused the CLI to build bad requests against third-party endpoints → 429. Both removed; env_remove path retained to still block CCswitch inheritance',
            'UI freeze after workspace switches — read_dir_recursive\'s sort_by closure called is_dir() per comparison; concurrent SDK checkpoint writes made the same entry return inconsistent values, violating Rust 1.81+\'s strict total-order check, panicking tokio worker and hanging all async tauri commands. Now caches is_dir() before sorting',
          ],
        },
      },
    ],
  },
  {
    version: '0.10.4',
    date: '2026-04-17',
    highlights: {
      zh: [
        'Opus 4.7 支持 — 默认 1M 上下文，老版本号自动迁移',
        '滚动条改成自动隐藏 — 鼠标悬停时才浮现',
      ],
      en: [
        'Opus 4.7 support — 1M context by default, legacy model IDs auto-migrated',
        'Auto-hide scrollbars — fade in on hover, invisible otherwise',
      ],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            'Claude Opus 4.7 模型支持 — 默认 1M 上下文窗口，无需额外 beta flag；老用户的 claude-opus-4-6 / -1m 设置会自动迁移到 claude-opus-4-7',
          ],
          en: [
            'Claude Opus 4.7 model support — 1M context by default, no beta flag needed; legacy claude-opus-4-6 / -1m settings auto-migrate to claude-opus-4-7',
          ],
        },
      },
      {
        label: { zh: '改进', en: 'Improved' },
        items: {
          zh: [
            '滚动条改成自动隐藏 — 默认不可见，指针移入可滚动区域时才淡入；粗细从 5px 调到 6px，视觉更轻盈',
          ],
          en: [
            'Auto-hide scrollbars — invisible by default, fade in on hover over scrollable regions; width tuned from 5px to 6px',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            '标题生成命令 401 错误 — Claude Desktop 注入的 OAuth token 通过环境变量污染第三方 Provider 的 title gen，三层防御：env 清除 + --setting-sources + args 可变声明',
          ],
          en: [
            'Title-gen 401 errors — Claude Desktop\'s OAuth token polluted title-gen for third-party providers; fixed with env cleanup + --setting-sources + mutable args declaration',
          ],
        },
      },
    ],
  },
  {
    version: '0.10.3',
    date: '2026-04-16',
    highlights: {
      zh: [
        'Cmd+F 页内文本查找',
        'CCswitch + Claude Desktop 共存 — 第三方 Provider 不再 401',
      ],
      en: [
        'Cmd+F find in page',
        'CCswitch + Claude Desktop coexistence — third-party providers no longer 401',
      ],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: ['Cmd+F / Ctrl+F 页内文本查找 — 实时高亮 + 上下跳转'],
          en: ['Cmd+F / Ctrl+F find in page — live highlighting + navigation'],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            'Claude Desktop 启动时继承的 CLAUDE_CODE_OAUTH_TOKEN 覆盖第三方 Provider API Key 导致 401 — env 清除 + 空字符串覆盖 + gateway 拦截 oauth_token_refresh',
            'hook_started/progress/response/status/api_retry 事件导致控制台大量警告 — 静默处理',
          ],
          en: [
            'CLAUDE_CODE_OAUTH_TOKEN inherited from Claude Desktop overrides third-party API Key causing 401 — env cleanup + empty string override + gateway blocks oauth_token_refresh',
            'hook_started/progress/response/status/api_retry events flooding console — silently handled',
          ],
        },
      },
    ],
  },
  {
    version: '0.10.2',
    date: '2026-04-11',
    highlights: {
      zh: [
        '新增用户反馈通道，设置里一键提交',
        '流式输出卡死大修 — 孤儿缓冲、停滞看门狗、打断保留一整套',
        '切换模型不再 400 报错',
        '/compact 在后台 tab 完成时不再卡住转圈',
        '工具调用有运行中动画，消息可排队发送',
      ],
      en: [
        'New in-app feedback channel in Settings',
        'Stream stuck fixes — orphan buffer, stall watchdog, interrupt preservation',
        'Model switching no longer hits 400 errors',
        '/compact no longer freezes when it completes on a background tab',
        'Tool calls animate while running, new messages can queue up',
      ],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            '提交反馈 — 设置里新增「反馈」tab，可以直接给开发者发问题或建议，支持粘贴截图，会自动带上应用版本、系统、Provider、Model 等诊断信息，无需打开 GitHub',
          ],
          en: [
            'Submit Feedback — a new "Feedback" tab in Settings lets you send bug reports or suggestions directly to the developer, with screenshot paste support; app version, OS, provider, and model are attached automatically — no GitHub account needed',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            '流式输出偶尔卡住、结尾漏字 — 新增孤儿缓冲队列 + 3 秒停滞看门狗，路由失效时缓冲不再被静默清空',
            '按停止按钮后已流出的文字丢失 — 现在会作为一条消息保留在对话里',
            '切换模型后 400 "invalid thinking signature" 报错 — 改为在 resume 前直接清理 JSONL 中的 thinking 块',
            '切换 Provider 后的 signature 不匹配 — 同步清理本地 thinking 历史',
            '/compact 在后台 tab 完成时卡片一直转圈 — 前后台的 pending command 状态现在都会在 result/assistant 到达时清理',
            '切换 tab 时 thinking 内容丢失 — 后台 tab 的 stream handler 现在也处理 thinking_delta',
            '子 agent 请求权限时锁住主输入框 — 权限请求现在携带 parent_tool_use_id / agent_id 以区分层级',
            '从 Finder 拖文件到输入框会同时插入文件 chip 和原始文本路径 — 新增 drop 拦截',
            'Rewind 后事件偶尔路由到错误 tab — killProcess 现在会清理 stdin → tab 映射',
            '流式缓冲区对中文字符使用字节切片导致 panic，进而杀死整个 stdout 读取任务 — 改为安全的字符边界检查',
            '"注入 PATH" 之前写的是错误的 marker 且反复点击会累积多个块（#79）— 现在会拒绝无效 CLI 候选（broken symlink / 空目录 / 非可执行文件），marker 正名为 `# Added by TOKENICODE`，每次注入前先剥离自己的历史块',
          ],
          en: [
            'Stream output occasionally stalled or dropped trailing characters — added orphan buffer queue + 3-second stall watchdog; flushes are no longer silently discarded when routing is unresolved',
            'Streamed text was lost when the Stop button was pressed — it is now preserved as a regular message in the transcript',
            '"Invalid thinking signature" 400 errors after switching model — JSONL thinking blocks are now stripped before --resume',
            'Provider switch signature mismatch — local thinking history is cleaned on provider change as well',
            '/compact command card spun forever when it completed on a background tab — pendingCommand state is now cleared from both foreground and background handlers',
            'Thinking content disappeared after tab switching — background stream handler now processes thinking_delta',
            'Sub-agent permission requests locked the main input bar — requests now carry parent_tool_use_id / agent_id to identify their layer',
            'Finder file drag inserted both a file chip and a raw text path — added drop interception',
            'Events occasionally routed to the wrong tab after Rewind — killProcess now cleans up the stdin → tab mapping',
            'Stream buffer byte-slicing panicked on Chinese characters and killed the entire stdout reader task — now uses safe char-boundary checks',
            '"Inject PATH" wrote a wrong marker and accumulated duplicate blocks on repeat clicks (#79) — now rejects invalid CLI candidates (broken symlinks, empty dirs, non-executable files), marker renamed to `# Added by TOKENICODE`, and each inject strips its own historical blocks first',
          ],
        },
      },
      {
        label: { zh: '改进', en: 'Improved' },
        items: {
          zh: [
            '工具调用运行中会显示 3 个跳动的圆点动画，长任务不再像死机',
            '当前 AI 正在回复时按 Enter 发送的新消息会进入排队队列，等回复完成后自动合并发送',
            'ModelSelector 下拉和底部按钮现在都显示实际调用的 provider 模型名（如 mimo-v2-pro），而非 Claude tier 名',
            '重连状态下 ActivityIndicator 会显示明确的"重连中"提示',
          ],
          en: [
            'Running tool calls now show a 3-dot typing animation so long tasks no longer look frozen',
            'Messages sent while AI is still replying now queue up and merge into a single follow-up when the reply finishes',
            'ModelSelector dropdown and collapsed button now both show the actual provider model name (e.g. mimo-v2-pro) instead of the Claude tier label',
            'Reconnecting state is now explicitly shown in the ActivityIndicator',
          ],
        },
      },
    ],
  },
  {
    version: '0.10.1',
    date: '2026-04-09',
    highlights: {
      zh: ['修复输出偶尔卡住的问题', '同名文件夹不再混淆'],
      en: ['Fix occasional output freeze', 'Same-name folders now distinguishable'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            '流式输出偶尔卡死 — 新增定时兜底机制，长对话时输出不再停在某个字不动',
            '不同路径的同名文件夹现在能正确区分 — 显示父级目录（如「A (桌面)」vs「A (坚果云)」）',
          ],
          en: [
            'Streaming output freeze — added timer fallback so output never gets stuck mid-response',
            'Same-name folders from different paths now show parent directory for disambiguation',
          ],
        },
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-04-05',
    highlights: {
      zh: ['CLI 管理面板 + CLI 发现机制重构'],
      en: ['CLI management panel + CLI discovery overhaul'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            'CLI 管理面板 — 扫描所有 CLI 安装，按来源分层显示，支持 Pin/删除/PATH 注入',
          ],
          en: [
            'CLI management panel — scan all CLI installations by source tier, Pin/delete/PATH inject',
          ],
        },
      },
      {
        label: { zh: '改进', en: 'Improved' },
        items: {
          zh: [
            'CLI 发现优先级重构：Official → System → 自部署 → 版本管理器 → 动态',
            'CLI 更新智能路由：检测来源选择 native 或 npm 路线，不再全走 npm',
            '重装前自动清理旧版本，防止残留干扰',
          ],
          en: [
            'CLI discovery rewritten: Official → System → AppLocal → VersionManager → Dynamic',
            'Smart CLI update routing: native binary for Official/System, npm for AppLocal',
            'Auto-cleanup of stale CLI before reinstall',
          ],
        },
      },
    ],
  },
  {
    version: '0.9.9',
    date: '2026-04-04',
    highlights: {
      zh: ['CLI 更新体验全面优化：进度条 + 版本校验 + 镜像加速'],
      en: ['CLI update UX overhaul: progress bar + version verification + mirror acceleration'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            'CLI 更新增加进度条，不再只有转圈动画',
            'npm 镜像版本过期时自动回退到官方源重试',
            '版本检查走 herear.cn 镜像 + 语义化比较，修复误报「有新版本」',
            '设置页 CLI 管理标签显示红点，一眼知道是什么要更新',
          ],
          en: [
            'CLI update now shows progress bar instead of just a spinner',
            'Stale npm mirror auto-retries with official registry',
            'Version check via herear.cn mirror + proper semver comparison, fixing false update prompts',
            'CLI tab in settings shows red dot when update is available',
          ],
        },
      },
    ],
  },
  {
    version: '0.9.7',
    date: '2026-04-04',
    highlights: {
      zh: ['CLI 一键更新 + MiMo Token Plan + 多项修复'],
      en: ['One-click CLI update + MiMo Token Plan + multiple fixes'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'Added' },
        items: {
          zh: [
            'MiMo Token Plan 预设 — 订阅用户专属接入点',
            'CLI 更新按钮 — 设置页一键升级 + 自动检测新版本（红点提醒）',
          ],
          en: [
            'MiMo Token Plan preset — dedicated endpoint for subscribers',
            'CLI update button — one-click upgrade in settings + auto-detect new versions',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            '测试连接不再误报 — MiMo 等渠道点「测试」终于能过了',
            'Opus 1M 选择修复 — 不再和 Opus 合并，重启后也不会重置',
            '暗色模式文字更清晰 — 对比度提升至 WCAG AA 标准',
          ],
          en: [
            'Connection test no longer false-fails for MiMo and similar providers',
            'Opus 1M selection preserved — no longer merged with regular Opus',
            'Dark mode text contrast improved to WCAG AA standard',
          ],
        },
      },
    ],
  },
  {
    version: '0.9.6',
    date: '2026-04-03',
    highlights: {
      zh: ['4 个核心 Bug 修复 — 消息不再丢、图片能正常拖、流式不再卡'],
      en: ['4 core bug fixes — messages no longer lost, images drag properly, streaming no longer freezes'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            'AI 回复中补发消息不再丢失 — 排队等 AI 说完再自动发送',
            '拖拽图片到对话框不再变成纯文本路径 — 现在有缩略图预览',
            '第三方渠道（中转/Bedrock/Vertex）不再报 400 错误 — 自动关闭不兼容的 beta 功能',
            '流式输出不再中途卡住 — 修复了后端读取中断和缓冲区数据丢失的问题',
          ],
          en: [
            'Messages sent during AI reply no longer silently dropped — queued and auto-sent',
            'Dragging images into chat now shows thumbnail previews instead of bare file paths',
            'Third-party providers (proxies/Bedrock/Vertex) no longer get 400 errors from beta flags',
            'Streaming output no longer freezes mid-response — fixed backend read errors and buffer data loss',
          ],
        },
      },
    ],
  },
  {
    version: '0.9.4',
    date: '2026-03-31',
    highlights: {
      zh: ['一次修了 5 个共性 Bug + 新增 Kimi Code 渠道'],
      en: ['5 shared bug fixes in one go + Kimi Code provider added'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'Added' },
        items: {
          zh: [
            'Kimi Code 预设 — 新增 Kimi Code 编程专用接入点，与 Kimi 开放平台分开配置',
          ],
          en: [
            'Kimi Code preset — dedicated coding endpoint, separate from Kimi open platform',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            '斜杠命令回车发不出 — 输入命令后按回车现在能正常发送了',
            '文件路径不再跳浏览器 — AGENTS.md 这类文件名不会被当成链接了',
            'Base64 图片能正常显示了',
            '面板边缘拖拽不再触发意外 resize',
            'Bedrock 渠道不再报 400 错误 — 自动处理兼容性问题',
            '关闭提示现在有中英文了',
          ],
          en: [
            'Slash command Enter key — now sends correctly instead of being swallowed',
            'File paths no longer open browser — AGENTS.md etc. render as code, not links',
            'Base64 images render properly in Markdown preview',
            'Panel edge drag no longer triggers accidental resize',
            'Bedrock provider 400 error — auto-disables incompatible beta flags',
            'Exit confirmation dialog now localized',
          ],
        },
      },
    ],
  },
  {
    version: '0.9.3',
    date: '2026-03-29',
    highlights: {
      zh: ['第三方渠道代理支持 — OpenRouter 等有地区限制的渠道现在能自动走代理'],
      en: ['Provider proxy support — auto-detect and route through proxy for region-restricted providers like OpenRouter'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'Added' },
        items: {
          zh: [
            'Provider 代理设置 — 在渠道配置中可设置代理地址，解决 OpenRouter 等地区限制问题',
            '自动代理检测 — 自动识别系统代理、Clash/Surge 等常见代理端口，无需手动配置',
          ],
          en: [
            'Provider proxy setting — configure proxy URL per provider to bypass region restrictions (e.g. OpenRouter)',
            'Auto proxy detection — automatically detects system proxy, Clash/Surge and common proxy ports',
          ],
        },
      },
    ],
  },
  {
    version: '0.9.2',
    date: '2026-03-28',
    highlights: {
      zh: ['流式输出卡住修复 + 字体上限提升'],
      en: ['Streaming freeze fix + font size limit raised'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            '流式输出不再卡住 — 映射丢失时自动修复，后端完成但前端不渲染的问题已解决',
          ],
          en: [
            'Streaming no longer freezes — auto-repair on mapping loss, fixes backend-complete-but-not-rendered issue',
          ],
        },
      },
      {
        label: { zh: '优化', en: 'Improved' },
        items: {
          zh: ['字体大小上限从 24 提升到 36'],
          en: ['Font size upper limit raised from 24 to 36'],
        },
      },
    ],
  },
  {
    version: '0.9.1',
    date: '2026-03-26',
    highlights: {
      zh: ['多任务完全隔离 + 37 个 Issue 修复'],
      en: ['Full multi-task isolation + 37 issue fixes'],
    },
    categories: [
      {
        label: { zh: '架构', en: 'Architecture' },
        items: {
          zh: [
            '多任务完全隔离 — 每个 tab 独立消息、streaming 状态、session meta',
            'chatStore v2 — 数据只在 tabs Map 中，结构上不可能串台',
          ],
          en: [
            'Full multi-task isolation — each tab owns independent messages, streaming state, session meta',
            'chatStore v2 — all data in tabs Map, cross-tab contamination structurally impossible',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            'Markdown 渲染崩溃白屏 — MarkdownErrorBoundary 隔离',
            '切换模型后 SESSION_ALREADY_ACTIVE 报错',
            '后台 Agent Team 切换会话后静默终止',
            '消息串台到其他对话窗口',
            '同一 API 多窗口卡「思考中」',
            'API 供应商配置中途回退 — snapshotProviderId',
            '续聊 thinking block 导致 400',
            '文件夹重命名 CLI symlink 断裂',
            'npm 安装的 CLI 检测不到',
            'MCP 配置双层嵌套报错',
            'Agent Team 副代理不显示',
          ],
          en: [
            'Markdown rendering crash — MarkdownErrorBoundary isolation',
            'SESSION_ALREADY_ACTIVE after model switch',
            'Background Agent Team silently terminated on tab switch',
            'Messages leaking to other chat windows',
            'Multi-window stuck on "thinking" with same API',
            'API provider config rollback — snapshotProviderId',
            'Thinking block causes 400 on resume',
            'Folder rename breaks CLI symlink',
            'npm-installed CLI not detected',
            'MCP double-nested config error',
            'Agent Team sub-agents not displayed',
          ],
        },
      },
      {
        label: { zh: '体验', en: 'UX' },
        items: {
          zh: [
            '退出确认弹窗中文化',
            '侧边栏横向滚动条消除',
            '文件树自动刷新',
            '任务历史时间戳修复',
            '错误提示中文化',
          ],
          en: [
            'Exit confirm dialog localized',
            'Sidebar scrollbar removed',
            'File tree auto-refresh',
            'Task history timestamps fixed',
            'Error messages localized',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.22',
    date: '2026-03-21',
    highlights: {
      zh: ['微信分享修复 + Windows 分享支持'],
      en: ['WeChat share fix + Windows share support'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            '微信分享 — 修复 Mac 端间歇性无反应，失败时 toast 提示',
            'Windows 微信分享 — 剪贴板方案，跨平台可用',
          ],
          en: [
            'WeChat share — fix intermittent failure on Mac, error toast on failure',
            'Windows WeChat share — clipboard-based, cross-platform',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.21',
    date: '2026-03-20',
    highlights: {
      zh: ['OpenRouter 预设 + 自定义模型 + CLI 搜索路径修复'],
      en: ['OpenRouter preset + custom models + CLI path fix'],
    },
    categories: [
      {
        label: { zh: '新增', en: 'Added' },
        items: {
          zh: [
            'OpenRouter 预设 — 支持 300+ 模型，自动处理认证',
            '自定义模型 — 在模型选择器直接添加和切换额外模型',
            '"添加新模型" — 单输入框，填模型名即可',
          ],
          en: [
            'OpenRouter preset — 300+ models, auto auth handling',
            'Custom models — add and switch extra models in selector',
            '"Add model" — single input, just type the model name',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            'CLI 搜索路径补全：NVM / fnm / Volta / Bun + which/where 兜底',
            'Shell PATH 超时放宽至 5 秒',
          ],
          en: [
            'CLI search: NVM / fnm / Volta / Bun + which/where fallback',
            'Shell PATH timeout extended to 5s',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.20',
    date: '2026-03-19',
    highlights: {
      zh: ['MiMo 模型映射优化：Pro 启用 1M 上下文'],
      en: ['MiMo model mapping: Pro with 1M context'],
    },
    categories: [
      {
        label: { zh: '优化', en: 'Changed' },
        items: {
          zh: [
            'mimo-v2-pro 启用 1M 上下文，haiku 默认模型改为 mimo-v2-pro',
          ],
          en: [
            'mimo-v2-pro now uses 1M context, haiku default changed to mimo-v2-pro',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.19',
    date: '2026-03-19',
    highlights: {
      zh: ['新增小米 MiMo 大模型预设'],
      en: ['Add Xiaomi MiMo model preset'],
    },
    categories: [
      {
        label: { zh: '新增', en: 'Added' },
        items: {
          zh: [
            '小米 MiMo Provider 预设 — 支持 mimo-v2-pro / mimo-v2-omni / mimo-v2-flash 三款模型',
          ],
          en: [
            'Xiaomi MiMo provider preset — supports mimo-v2-pro / mimo-v2-omni / mimo-v2-flash models',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.18',
    date: '2026-03-19',
    highlights: {
      zh: ['MiniMax 等中文 Provider 卡死修复 + MiniMax 配置升级'],
      en: ['Fix Chinese provider stream freeze + MiniMax config upgrade'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            'stdout UTF-8 切割 panic — 中文 Provider 响应导致流式输出永久中断，现已修复',
            'MiniMax 配置修正 — thinkingSupport 改为 full，默认模型升级至 M2.7，新增推荐超时',
          ],
          en: [
            'stdout UTF-8 slice panic — Chinese provider responses crashed stdout reader, now fixed',
            'MiniMax config fix — thinkingSupport set to full, default models upgraded to M2.7, timeout added',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.17',
    date: '2026-03-18',
    highlights: {
      zh: ['国产大模型接入体系 + 回车键修复 + CLI 搜索重构'],
      en: ['Domestic LLM provider system + Enter key fix + CLI search refactor'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            '5 家国产大模型预设（GLM / Kimi / MiniMax / 通义千问），一键获取 Key',
            '自定义模型映射 + Thinking 联动提示',
          ],
          en: [
            '5 domestic LLM presets (GLM / Kimi / MiniMax / Qwen) with one-click Key link',
            'Custom model mapping + Thinking support indicators',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            '回车键发不出消息（中文输入法状态卡住）',
            'GLM 模型选择器重复显示',
            'CLI 找不到时的错误处理优化',
          ],
          en: [
            'Enter key not sending (IME composing state stuck)',
            'Duplicate models in selector when using GLM',
            'Better error handling when CLI binary not found',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.16',
    date: '2026-03-18',
    highlights: {
      zh: ['智谱 GLM 模型分级映射'],
      en: ['GLM model tier mapping'],
    },
    categories: [
      {
        label: { zh: '改进', en: 'Improvements' },
        items: {
          zh: ['智谱 GLM 预设按能力分级：Opus → glm-5, Sonnet → glm-5-turbo, Haiku → glm-4.7'],
          en: ['GLM preset now maps by tier: Opus → glm-5, Sonnet → glm-5-turbo, Haiku → glm-4.7'],
        },
      },
    ],
  },
  {
    version: '0.8.15',
    date: '2026-03-17',
    highlights: {
      zh: ['6 个 Bug 修复 + CLI 全链路加固'],
      en: ['6 bug fixes + CLI lifecycle hardening'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            'AI 运行中发送的补充消息不再丢失',
            '/compact 完成后不再卡转圈',
            'Agent 运行时可以继续发消息',
            '中文输入法回车上屏不再被拦截',
            'CLI 版本检测不再误报「过旧」',
            '重装 CLI 现在真正执行安装',
          ],
          en: [
            'Messages sent during AI processing no longer lost',
            '/compact no longer leaves GUI spinning',
            'Can send messages while Agent is running',
            'Chinese IME enter key no longer intercepted',
            'CLI version check no longer falsely reports "too old"',
            'Reinstall CLI now actually performs installation',
          ],
        },
      },
      {
        label: { zh: '改进', en: 'Improvements' },
        items: {
          zh: [
            'CLI 全链路加固：登录 shell 超时保护、二进制校验、安装超时',
          ],
          en: [
            'CLI lifecycle hardening: login shell timeout, binary verification, install timeout',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.14',
    date: '2026-03-17',
    highlights: {
      zh: ['支持 Opus 4.6 (1M) 超长上下文 + 极致思考模式，修复 15 个问题'],
      en: ['Opus 4.6 (1M) ultra-long context + max thinking, 15 issues fixed'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            '模型选择器新增 Opus 4.6 (1M context) 超长上下文选项',
            '思考级别新增「极致思考」（max effort）',
            '启动时检测 CLI 版本兼容性，旧版自动引导升级',
          ],
          en: [
            'Model selector adds Opus 4.6 (1M context) ultra-long context option',
            'Thinking level adds "Max Think" (max effort)',
            'CLI version compatibility check on startup, auto-guides upgrade for old versions',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            '中文输入法回车不再被拦截为提交',
            'Markdown 加粗紧跟中文标点现在正确渲染',
            '/context 命令不再重复显示内容',
            '中转站各渠道默认配置修正（智谱/Kimi/MiniMax）',
            '隐藏 OpenAI 格式选项，默认使用 Anthropic 协议',
            '长时间运行提示不再误导用户中断任务',
          ],
          en: [
            'Chinese IME enter key no longer intercepted as form submit',
            'Markdown bold with CJK punctuation now renders correctly',
            '/context command no longer shows content twice',
            'Fixed default config for relay channels (Zhipu/Kimi/MiniMax)',
            'Hidden OpenAI format option, defaults to Anthropic protocol',
            'Long-running task prompt no longer misleads users to stop',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.13',
    date: '2026-03-14',
    highlights: {
      zh: ['新增原生二进制安装 Claude CLI，无需 Node.js'],
      en: ['Native binary CLI installation, no Node.js required'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            '支持从 GCS 直接下载 Claude Code 原生二进制，跳过 npm 安装流程',
            '中国用户自动走 herear.cn 镜像加速，安装失败自动降级到 npm',
          ],
          en: [
            'Download Claude Code native binary directly from GCS, skipping npm installation',
            'China users auto-routed to herear.cn mirror, falls back to npm on failure',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.12',
    date: '2026-03-12',
    highlights: {
      zh: ['修复运行时切换模式后权限判断不更新的问题'],
      en: ['Fixed permission mode not updating after runtime mode switch'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            '修复运行时切换权限模式（如 bypass → plan）后，后台仍按旧模式处理权限请求',
            '新增当前模式指示器，状态栏显示 bypass/code/ask/plan',
            '修复老版本升级后默认模式未正确设为 bypass 的问题',
          ],
          en: [
            'Fixed runtime permission mode switch (e.g. bypass → plan) not reflected in background permission handler',
            'Added current mode indicator to status bar showing bypass/code/ask/plan',
            'Fixed default mode not correctly set to bypass after upgrading from older versions',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.11',
    date: '2026-03-12',
    highlights: {
      zh: ['修复切标签页后聊天记录丢失的严重 Bug'],
      en: ['Fixed critical bug: chat history lost after switching tabs'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            '修复切标签页后聊天记录丢失 — 后台缓存方法不再创建空快照覆盖真实历史',
            'LRU 缓存淘汰保护正在执行的会话 — CLI 压缩上下文后切回不再只剩末尾几条',
            '空快照安全网 — 检测到空缓存快照时自动回退到磁盘加载完整历史',
          ],
          en: [
            'Fixed chat history loss on tab switch — background cache methods no longer create empty snapshots that overwrite real history',
            'LRU cache eviction protects active streaming sessions — switching back after CLI context compaction no longer shows only last few messages',
            'Empty snapshot safety net — auto-fallback to disk load when detecting empty cache snapshots',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.10',
    date: '2026-03-11',
    highlights: {
      zh: ['CLI 原生二进制检测、Windows Git 解压超时修复'],
      en: ['Native CLI binary detection, Windows Git extraction timeout fix'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            'CLI 检测优先原生二进制 — ~/.claude/local/claude 优先于 npm 路径，避免 Node.js v22 的 --sdk-url bug',
            'Windows PortableGit 解压超时 — 超时从 120 秒延长至 300 秒，低配机器不再误报失败',
            '下载内容校验 — 检测 CDN 劫持（< 1MB 自动跳到下一个镜像源）',
            '错误分类修正 — 本地解压超时不再被误判为网络错误，不再误提示「需要 VPN」',
            '通知权限 — 不再启动时弹出权限请求，改为首次需要时懒加载',
          ],
          en: [
            'CLI detection prioritizes native binary — ~/.claude/local/claude checked before npm paths, avoiding Node.js v22 --sdk-url bug',
            'Windows PortableGit extraction timeout — Extended from 120s to 300s, preventing false failures on slower machines',
            'Download content validation — Detects CDN hijacking (< 1MB auto-skips to next mirror)',
            'Error classification fix — Local extraction timeout no longer misidentified as network error',
            'Notification permission — Lazy request on first need instead of eager startup prompt',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.9',
    date: '2026-03-11',
    highlights: {
      zh: ['6 项关键 Bug 修复、3 项 UX 改进'],
      en: ['6 critical bug fixes, 3 UX improvements'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            '对话完成时推送系统通知（窗口不在前台时自动提醒）',
            '右键菜单「重命名」支持内联编辑（不再弹出系统对话框）',
          ],
          en: [
            'System notification when chat completes (while window is unfocused)',
            'Context menu rename now uses inline editing (no more browser prompt)',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            'Plan 审批后 CLI 未收到确认响应的问题',
            '交互卡片等待期间误按 Enter 发送消息的问题',
            '后台会话 stderr 漏到前台空闲标签页的问题',
            'CLI 崩溃后交互卡片永久卡住的问题',
            '文件路径标签在气泡中从中间断行的问题',
            '停滞检测误报（改为 120 秒静默检测）',
          ],
          en: [
            'Plan approval not sending CLI confirmation response',
            'Accidental Enter submission while interaction card is pending',
            'Background session stderr leaking into idle foreground tab',
            'Interaction cards stuck permanently after CLI crash',
            'File path chip breaking mid-text in message bubbles',
            'Stall detection false positives (now 120s silence-based)',
          ],
        },
      },
      {
        label: { zh: '改进', en: 'Improved' },
        items: {
          zh: [
            '技能面板按拼音排序',
            '斜杠命令选中项高亮更清晰',
          ],
          en: [
            'Skills panel sorted alphabetically with CJK awareness',
            'Slash command selected item highlight improved',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.8',
    date: '2026-03-09',
    highlights: {
      zh: ['多会话隔离加固，修复 Markdown 渲染兼容性'],
      en: ['Multi-session isolation hardening, Markdown rendering compatibility fix'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            '多会话隔离 — 修复临时 ID 污染会话列表和进程映射泄漏的问题',
            'Markdown 渲染 — 修复旧版 macOS 上打开聊天可能白屏的问题',
          ],
          en: [
            'Multi-session isolation — Fix temporary ID polluting session list and process mapping leak',
            'Markdown rendering — Fix potential white screen on older macOS when opening chats',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.7',
    date: '2026-03-08',
    highlights: {
      zh: ['新增导出纯对话功能'],
      en: ['New conversation-only export'],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            '导出纯对话 — 导出 Markdown 时可选择仅导出文字对话，跳过工具调用和空消息',
          ],
          en: [
            'Export conversation only — Export Markdown with text-only option, skipping tool calls and empty messages',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.6',
    date: '2026-03-07',
    highlights: {
      zh: ['多会话稳定性大幅提升，修复 6 个核心 Bug'],
      en: ['Major multi-session stability improvements, 6 core bug fixes'],
    },
    categories: [
      {
        label: { zh: '修复', en: 'Fixes' },
        items: {
          zh: [
            '多会话串窗口 — 修复不同标签页消息串到同一会话的问题',
            '文件监听风暴 — 后台 CLI 操作不再导致界面持续刷新',
            '会话时间显示 — 同一天内的会话显示具体时间而非全部显示「今天」',
            '聊天回退 — 修复回退后旧上下文残留的问题',
            '残留思考状态 — 切换回已完成的会话不再显示「思考中」',
            '添加 API 菜单 — 菜单被底部裁切时自动向上弹出',
          ],
          en: [
            'Multi-session cross-talk — fix messages leaking between tabs',
            'File watcher storm — background CLI no longer causes UI refresh flood',
            'Session timestamps — show HH:mm for same-day sessions instead of all "today"',
            'Rewind failure — fix old context persisting after rewind',
            'Stale thinking state — switching to completed sessions no longer shows "thinking"',
            'AddProvider menu — auto-flip upward when clipped at viewport bottom',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.5',
    date: '2026-03-06',
    highlights: {
      zh: [],
      en: [],
    },
    categories: [
      {
        label: { zh: '新功能', en: 'New' },
        items: {
          zh: [
            '文件右键分享 — macOS 右键菜单新增「分享…」和「分享到微信」',
            '用户头像与昵称 — 设置中自定义头像和显示名，聊天气泡右侧展示',
            '自部署 CLI 注入 shell PATH — macOS/Linux 安装后自动写入 ~/.zshrc 等，终端可直接用 claude',
            '隐藏文件开关 — 文件树标题栏新增眼睛按钮，一键切换隐藏/显示 dotfiles',
            '更新日志分类 — 「更新说明」弹窗按新功能/修复/改进分组展示',
          ],
          en: [
            'File sharing — "Share..." and "Share to WeChat" added to macOS file context menu',
            'User avatar & display name — Customize in Settings, shown next to chat bubbles',
            'Self-deployed CLI injects shell PATH — macOS/Linux auto-writes to ~/.zshrc etc., claude works from terminal',
            'Hidden files toggle — Eye button in file tree header to show/hide dotfiles',
            'Categorized changelog — "What\'s New" modal groups entries by type',
          ],
        },
      },
      {
        label: { zh: '修复', en: 'Fixed' },
        items: {
          zh: [
            'CLI 发现优先级 — 系统已安装的 CLI 优先于自部署版本，登录状态正确共享',
            '第三方 API 模型拦截 — 未配置模型映射时阻止发送并提示，不再把原始模型名发给第三方报错',
            '继承配置修复 — 不再意外清除系统环境变量，继承模式正常使用系统 API Key',
            '标题生成适配第三方 — 使用 provider 映射的 haiku 模型，无映射时静默跳过',
            '多窗口串消息 — 切换对话窗口后，后台会话的回复不再串到前台窗口',
            'Windows 安装修复 — 缺少 git-bash 时重装不再被"已检测到 CLI"短路，正确走修复路径',
            'Windows CLI 调用统一 — run_claude_command 和 check_claude_auth 统一 cmd /C 包装，.cmd/.bat 不再启动失败',
            'Windows timeout 回退 — CLI 超时后正确回退到 PATH / Claude Desktop / scoop / nvm 等候选',
            'Unix 终端可用 — 自部署 Node 安装后自动写入 shell PATH，终端里 claude 命令不再找不到',
            '终端登录路径安全 — open_terminal_login 对 CLI 路径做 shell quoting，带空格路径不再报错',
          ],
          en: [
            'CLI discovery priority — System-installed CLI takes precedence over self-deployed, login state shared correctly',
            'Third-party API model interception — Blocks send when model mapping is missing, prevents raw model name errors',
            'Inherit config fix — No longer clears system env vars, inherited mode correctly uses system API Key',
            'Title generation adapts to providers — Uses provider-mapped haiku model, silently skips when unmapped',
            'Cross-tab message leaking — Background session responses no longer bleed into the active tab',
            'Windows install fix — Missing git-bash no longer short-circuits reinstall when CLI is already detected',
            'Windows CLI invocation — run_claude_command and check_claude_auth now consistently use cmd /C wrapper for .cmd/.bat',
            'Windows timeout fallback — CLI timeout correctly falls back to PATH / Claude Desktop / scoop / nvm candidates',
            'Unix terminal CLI — Self-deployed Node install now writes shell PATH, claude command works from terminal',
            'Terminal login path safety — open_terminal_login applies shell quoting, paths with spaces no longer break',
          ],
        },
      },
      {
        label: { zh: '改进', en: 'Improved' },
        items: {
          zh: [
            '连接测试三步走 — 分步检测连通性、Key 有效性、模型可用性，精准定位问题',
            '文件夹图标主题色 — 更容易区分文件和文件夹',
            '简化模式选择 — 默认 Bypass 模式，高级用户可通过 /ask /plan /code /bypass 切换',
          ],
          en: [
            'Three-step connection test — Separately checks connectivity, auth, and model availability for precise diagnostics',
            'Folder icons use accent color — Better distinction between files and folders',
            'Simplified mode selection — Defaults to Bypass mode, power users switch via /ask /plan /code /bypass commands',
          ],
        },
      },
    ],
  },
  {
    version: '0.8.2',
    date: '2026-03-04',
    highlights: {
      zh: [
        '修复长对话卡死 — 超过 5 轮对话后流式输出不再卡住，重大性能优化',
        '修复权限弹窗反复弹出 — 点过「稍后」后不会再次弹出',
        '修复内存泄漏 — 面板拖拽时事件监听器不再累积（感谢 @qs858053851-wq 反馈）',
        '切换对话时输入框内容正确跟随切换',
        '修复中文输入法偶发丢失焦点',
        '新增/导入 API 后自动生效，无需手动选择',
        'VPN 关闭后 API 自动切换直连，无需手动操作',
        '双版本体系 — 一套代码支持 TCAlpha 内测版和 TOKENICODE 稳定版',
      ],
      en: [
        'Fix long conversation freeze — Streaming no longer stalls after 5+ turns, major performance improvement',
        'Fix permission dialog re-appearing — Dismissal is now persisted',
        'Fix memory leak — Panel resize listeners no longer accumulate (thanks @qs858053851-wq)',
        'Input content follows tab switch correctly',
        'Fix CJK IME occasionally losing focus',
        'New/imported API providers auto-activate',
        'Auto-switch to direct connection when VPN is off',
        'Dual-edition system — One codebase supports TCAlpha and TOKENICODE',
      ],
    },
  },
  {
    version: '0.8.1',
    date: '2026-03-02',
    highlights: {
      zh: [
        'AI 头像自定义 — 设置里可以换 AI 聊天头像了，支持裁剪和缩放',
        '安全加固 — 修复路径穿越、权限默认值、进程清理、XSS 等 8 项安全问题',
        '稳定性提升 — 流消息错误兜底、事件监听器泄漏清理、缓存 LRU 淘汰',
        '自动压缩不再卡死 — /compact 处理卡片现在能正确完成，超时也有兜底',
        '系统消息不再丢失 — CLI 发的错误通知现在会显示在聊天里',
        'CLI 检测更可靠 — 统一验证可执行文件有效性，设置页面状态与安装向导对齐',
        '文件路径识别更精准 — 不再把 API 路径等普通文字错认成文件链接',
        '长时间思考不再卡住 — 修复了 AI 深度思考时消息重复堆积、文字回复被淹没的问题',
        '无限制模式不再卡死 — 修复了无限制模式下 AI 偶尔发消息后没有回复的问题',
        '首句回复更快 — 跳过不必要的 MCP 服务器加载，冷启动速度大幅提升',
      ],
      en: [
        'Custom AI avatar — Set a custom chat avatar in Settings with crop & zoom support',
        'Security hardening — Fixed 8 security issues: path traversal, permission defaults, XSS, and more',
        'Stability improvements — Stream error boundary, event listener leak cleanup, cache LRU eviction',
        'Auto-compact no longer gets stuck — /compact processing card now completes properly with timeout fallback',
        'System messages no longer silently dropped — CLI error notifications now appear in chat',
        'More reliable CLI detection — Validates executable integrity across all discovery paths',
        'Smarter file path detection — API endpoints and other non-file text no longer turn into clickable chips',
        'Extended thinking no longer gets stuck — Fixed duplicate thinking messages that buried text responses during long reasoning sessions',
        'Bypass mode no longer hangs — Fixed intermittent "thinking forever" bug where the CLI would freeze waiting for a response that never came',
        'Faster first response — Skip unnecessary MCP server loading for significantly faster cold start',
      ],
    },
  },
  {
    version: '0.8.0',
    date: '2026-03-01',
    highlights: {
      zh: [
        '全模块重构 — 底层架构全面升级，运行更稳定、响应更快',
        '权限交互升级 — 用 Claude 原生控制协议替代旧方案，权限弹窗更可靠',
        '会话列表大改 — 支持置顶、归档、撤销删除、批量操作、日期分组、运行中筛选',
        '设置面板重做 — 分标签页布局，API 提供商管理更直观，预设一键添加',
        '文件回退改用 CLI 检查点 — 不再依赖自建快照，回退更准确',
        '修复代理环境变量丢失 — 安装版应用现在能正确走代理连接 API',
        '更新检测优先走 GitHub — 国内不可达时自动降级到 Gitee',
      ],
      en: [
        'Full module refactor — Complete architecture overhaul for better stability and responsiveness',
        'Permission handling upgrade — Native SDK control protocol replaces old regex-based approach',
        'Session list revamp — Pin, archive, undo delete, batch ops, date groups, running filter',
        'Settings panel redesign — Tabbed layout, intuitive provider management, one-click presets',
        'File rewind uses CLI checkpoints — More accurate rollback without custom snapshot system',
        'Fix proxy env vars not inherited — Installed app now correctly uses proxy to reach API',
        'Updater checks GitHub first — Auto-falls back to Gitee when GitHub is unreachable',
      ],
    },
  },
  {
    version: '0.6.16',
    date: '2026-02-27',
    highlights: {
      zh: [
        '修复快速新建任务路径解析 — + 按钮和右键「新建任务」不再因 ~ 路径未展开而报错',
        '自动更新改为用户确认制 — 检测到新版本后仅显示提示，用户点击后才下载更新',
      ],
      en: [
        'Fix quick new session path resolution — "+" button and "New Task" no longer fail due to unexpanded ~ path',
        'Auto-update requires user confirmation — Updates are detected but only downloaded after user clicks',
      ],
    },
  },
  {
    version: '0.6.15',
    date: '2026-02-27',
    highlights: {
      zh: [
        '修复流式响应卡在「思考中」(TK-322) — 中间消息不再意外清空流式文本状态，解决偶发的 UI 卡死问题',
        '项目名样式优化 — 更大更粗的字体 + accent 色箭头，项目与会话层级一目了然',
        '技能面板右键菜单 (TK-312) — 右键技能卡片直接弹出操作菜单',
        '最近项目列表自动淘汰 (TK-321) — 只保留最近 4 个项目，旧条目自动替换',
        '项目级右键菜单 — 右键项目标题可新建任务或删除全部任务，hover 时有 + 按钮快捷创建',
      ],
      en: [
        'Fix streaming stuck in "thinking" (TK-322) — Intermediate messages no longer wipe streaming text state, fixing intermittent UI freeze',
        'Project header styling — Larger bold text + accent chevrons for clear visual hierarchy',
        'Skill panel right-click menu (TK-312) — Right-click skill cards to open context menu',
        'Recent projects auto-limit (TK-321) — Keeps only 4 most recent projects, auto-replacing older entries',
        'Project-level context menu — Right-click project header for new task / delete all, plus hover + button',
      ],
    },
  },
  {
    version: '0.6.14',
    date: '2026-02-26',
    highlights: {
      zh: [
        '修复会话重载技能内容泄露 — 重新加载历史会话时，技能内容不再被误显示为用户消息',
        '修复 Windows 图标模糊 — 重新生成多层 ICO（16-256px），任务栏图标清晰显示',
        '修复 API Key 清空未删除 — 清空 Key 后真正从磁盘删除密钥文件',
        '文件树深度 3→8 + 忽略列表 6→15 项 — 深层文件可见，常见构建目录自动忽略',
        '文件引用统一胶囊样式 — 助手消息和用户气泡中的文件路径均为可点击胶囊标签',
        '裸文件名识别 — CLAUDE.md、package.json 等常见文件名也能被识别为可点击文件',
        '修复 URL 被误识别为文件路径的问题',
      ],
      en: [
        'Fix session reload skill content leak — Skill content no longer appears as user bubbles on reload',
        'Fix Windows icon blurry — Regenerated multi-layer ICO (16-256px) for crisp taskbar display',
        'Fix API Key not deleted on clear — Clearing key now actually removes it from disk',
        'File tree depth 3→8 + ignore list 6→15 — Deep files visible, common build dirs auto-ignored',
        'Unified file reference chip style — File paths in both assistant and user messages are clickable chips',
        'Bare filename detection — CLAUDE.md, package.json etc. now recognized as clickable files',
        'Fix URLs being misidentified as file paths',
      ],
    },
  },
  {
    version: '0.6.13',
    date: '2026-02-26',
    highlights: {
      zh: [
        '修复应用图标白边 — 重新生成全平台图标，消除 Dock/任务栏中的白色边框',
        'Release 构建开启 DevTools — 正式版可通过 Cmd+Option+I / Ctrl+Shift+I 打开开发者工具',
        '仓库清理 — 移除过时的开发文件，精简仓库体积',
      ],
      en: [
        'Fix app icon white border — Regenerated all platform icons, eliminating white borders in Dock/taskbar',
        'DevTools in release builds — Open Chrome DevTools via Cmd+Option+I / Ctrl+Shift+I in production',
        'Repo cleanup — Removed obsolete development files, reduced repository size',
      ],
    },
  },
  {
    version: '0.6.12',
    date: '2026-02-26',
    highlights: {
      zh: [
        '修复文件树深度 — 三级、四级文件/文件夹现在能正确显示（递归深度 3→5）',
        '修复拖拽误关闭 — 设置面板和更新日志弹窗不再因拖拽鼠标到外部而关闭',
        '构建脚本安全加固 — 移除硬编码凭证，改用 .env 环境变量',
        '文件变更标记统一绿色 — 所有变更指示器使用一致的绿色样式',
        '文件树工具栏简化 — 清理标记和刷新合并为一个按钮',
      ],
      en: [
        'Fix file tree depth — 3rd/4th level files now display correctly (depth 3→5)',
        'Fix drag-close bug — Settings panel and changelog modal no longer close on drag outside',
        'Build script security — Removed hardcoded credentials, now uses .env variables',
        'File change indicators unified green — All change markers use consistent success green',
        'File tree toolbar simplified — Clear markers and refresh merged into one button',
      ],
    },
  },
  {
    version: '0.6.11',
    date: '2026-02-26',
    highlights: {
      zh: [
        '修复 Windows npm EPERM — 使用应用内缓存目录，避免杀毒软件锁定导致安装失败',
        '修复 Windows PowerShell 找不到 claude — 始终安装到受控目录，确保 PATH 生效',
        '修复 macOS Xcode CLT 弹窗 — 无 CLT 时不再触发安装对话框，自动扫描 Homebrew/MacPorts',
        '修复误导性错误提示 — EPERM 错误不再显示「需要 VPN」，改为正确的权限提示',
      ],
      en: [
        'Fix Windows npm EPERM — Uses app-local cache dir, avoids antivirus-locked cache failures',
        'Fix Windows PowerShell can\'t find claude — Always installs to controlled dir, ensures PATH works',
        'Fix macOS Xcode CLT popup — No longer triggers install dialog without CLT, scans Homebrew/MacPorts',
        'Fix misleading error hint — EPERM errors now show "permission denied" instead of "need VPN"',
      ],
    },
  },
  {
    version: '0.6.10',
    date: '2026-02-26',
    highlights: {
      zh: [
        'API 配置导入导出 — 第三方 API 配置一键 JSON 导入导出，面向培训场景：讲师导出，学员一键导入',
        '静默后台更新 — 检测到新版本自动后台下载，完成后显示「重启」按钮',
        'Gitee 下载源 — 更新下载现在走 Gitee，国内用户无梯子也能完整更新',
        'Node.js 检测增强 — 检测 nvm/volta/fnm 安装的 Node.js，避免重复下载',
      ],
      en: [
        'API config import/export — One-click JSON import/export for third-party API settings, designed for onboarding',
        'Silent background updates — Automatically downloads updates in the background, shows restart button when ready',
        'Gitee download source — Updates now download from Gitee, domestic users can update without VPN',
        'Node.js detection — Detects nvm/volta/fnm-installed Node.js on all platforms, prevents unnecessary downloads',
      ],
    },
  },
  {
    version: '0.6.9',
    date: '2026-02-25',
    highlights: {
      zh: [
        '国内网络优化 — 移除 GCS 下载路径（GFW 屏蔽），自动检测网络环境，国内镜像优先（npmmirror CDN、华为云）',
        'Node.js 镜像地址修复 — 修复导致国内用户 CLI 安装失败的 404 镜像地址',
        'Gitee 更新检测 — 新增 Gitee 作为首选更新检测端点，国内用户无需梯子即可检测更新',
        '响应超时检测 3 分钟 → 5 分钟 — 避免接入 API 时的误报',
      ],
      en: [
        'China network optimization — Removed GCS download path (blocked by GFW), auto-detects network environment, China mirrors prioritized (npmmirror CDN, Huawei Cloud)',
        'Node.js mirror URL fix — Fixed 404 mirror URL that caused CLI installation failures for domestic users',
        'Gitee updater endpoint — Added Gitee as primary update detection source, domestic users can check updates without VPN',
        'Stall detection timeout 3min → 5min — Prevents false positives for API-connected users',
      ],
    },
  },
  {
    version: '0.6.8',
    date: '2026-02-25',
    highlights: {
      zh: [
        'macOS/Linux CLI 二进制损坏修复 — 检测到 Mach-O 魔术字节无效时自动删除坏文件并重试，GCS 下载后增加 --version 验证',
        '操作确认弹窗 — 重新安装 CLI 和关闭窗口现在需要用户确认，防止误操作',
      ],
      en: [
        'macOS/Linux malformed binary fix — Auto-deletes corrupt CLI binaries (invalid Mach-O magic bytes) and retries, GCS downloads now validated with --version',
        'Confirmation dialogs — Reinstall CLI and window close now require user confirmation to prevent accidental operations',
      ],
    },
  },
  {
    version: '0.6.7',
    date: '2026-02-25',
    highlights: {
      zh: [
        'macOS/Linux CLI 权限修复 — 执行权限丢失时自动 chmod +x 并重试',
        'API Key 切换生效 — 换 Key 后正确终止旧进程并用新 Key 重建会话',
        'CLI 配置覆盖修复 — 阻止 ~/.claude/settings.json 静默覆盖应用注入的 API 端点',
        '损坏凭证自动清理 — 无法解密的 credentials.enc 自动删除，用户可重新输入',
      ],
      en: [
        'macOS/Linux CLI permission fix — Auto chmod +x and retry on execute permission loss',
        'API Key switch fix — Changing keys now correctly kills old process and rebuilds session',
        'CLI config override fix — Prevents ~/.claude/settings.json from silently overriding injected API endpoints',
        'Corrupted credentials auto-cleanup — Unreadable credentials.enc auto-deleted for clean re-entry',
      ],
    },
  },
  {
    version: '0.6.6',
    date: '2026-02-25',
    highlights: {
      zh: [
        '会话中模型热切换 — 切换模型后自动终止旧进程并用新模型 resume 重启，不再静默忽略',
        '模型切换标签 — 切换时对话流立即显示居中标签（如 Sonnet 4.6 → Opus 4.6）',
      ],
      en: [
        'Mid-session model hot-swap — Switching models now kills the old process and resumes with the new model automatically',
        'Model switch indicator — A centered pill tag appears instantly in the chat flow when switching models',
      ],
    },
  },
  {
    version: '0.6.5',
    date: '2026-02-25',
    highlights: {
      zh: [
        '文件拖拽统一 — 文件树拖拽和系统拖入文件统一走对话框内联 chip，不再有两个触发区域',
        '默认工作模式改为 Bypass — 新安装默认使用 bypass 模式，减少权限弹窗干扰',
        '默认思考改为中等 — 新安装默认 Medium 思考深度，平衡速度与质量',
        '子代理渲染崩溃修复 — 修复子代理启动时 React error #31（content block 对象泄漏到 JSX），涉及 4 处渲染路径',
        'macOS 代码签名 — 重新启用 CI 签名 + 公证，新增 entitlements.plist，安装不再报「文件已损坏」',
      ],
      en: [
        'Unified file drag-drop — Tree drag and OS file drop both use inline chips in dialog, no more dual trigger zones',
        'Default mode: Bypass — New installs default to bypass mode, fewer permission popups',
        'Default thinking: Medium — New installs use medium thinking depth, balancing speed and quality',
        'Sub-agent render crash fix — Fixed React error #31 when sub-agent starts (content block objects leaking into JSX), 4 render paths patched',
        'macOS code signing — Re-enabled CI signing + notarization with entitlements.plist, no more "file is damaged" on install',
      ],
    },
  },
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
  {
    version: '0.4.3',
    date: '2026-02-19',
    highlights: {
      zh: [
        '历史附件显示修复 — 历史对话中的附加文件显示为卡片样式，不再是原始路径文本',
      ],
      en: [
        'History attachment display fix — File attachments in historical sessions render as styled chips instead of raw paths',
      ],
    },
  },
  {
    version: '0.4.2',
    date: '2026-02-19',
    highlights: {
      zh: [
        '会话切换缓存修复 — 修复运行中会话点击「新任务」后聊天记录丢失',
        '长消息折叠 — 超过 12 行的用户消息默认折叠，可点击展开',
        '输入框自动增高 — 随内容自动增高，最大到窗口高度的一半',
      ],
      en: [
        'Session switch cache fix — Fixed chat history disappearing when clicking "New Task" during active session',
        'Long message collapse — User messages longer than 12 lines collapse by default with expand toggle',
        'Auto-expanding input — Chat input grows up to 50% of window height',
      ],
    },
  },
  {
    version: '0.4.1',
    date: '2026-02-19',
    highlights: {
      zh: [
        '中文路径解码修复 — 修复包含中文字符的项目路径被错误解码，导致文件树为空和会话分组异常',
      ],
      en: [
        'CJK path decoding fix — Fixed project paths with Chinese characters being corrupted, causing empty file tree',
      ],
    },
  },
  {
    version: '0.4.0',
    date: '2026-02-19',
    highlights: {
      zh: [
        '文件右键菜单 — 复制路径、拷贝文件、粘贴、重命名、删除、插入到聊天',
        '文件树拖拽到聊天 — 从文件树拖拽文件直接附加到对话输入框',
        '模式选择器下拉 — Code/Ask/Plan/Bypass 模式紧凑下拉菜单',
        '编辑器自动折行 — 长行自动换行，编辑和只读模式均生效',
        '性能优化 — MessageBubble/MarkdownRenderer memo 化，流式更新从 3 次 set 合并为 1 次',
      ],
      en: [
        'File context menu — Copy Path, Copy File, Paste, Rename, Delete, Insert to Chat',
        'File tree drag to chat — Drag files from file tree directly into chat input',
        'Mode selector dropdown — Compact dropdown for Code/Ask/Plan/Bypass modes',
        'Editor word wrap — Long lines auto-wrap in both edit and read-only mode',
        'Performance — MessageBubble/MarkdownRenderer memoized, streaming updates merged from 3 to 1 set() call',
      ],
    },
  },
  {
    version: '0.3.0',
    date: '2026-02-19',
    highlights: {
      zh: [
        '应用内更新 — 设置面板检查更新、下载进度条、一键重启，Ed25519 签名安全分发',
        '深度思考开关 — 输入工具栏新增 Think 按钮，启用后进入深度思考模式',
        'Windows 平台适配 — 快捷键提示、文件管理器名称、路径格式全面适配 Windows',
        '四套新主题 — 黑/蓝/橙/绿，移除毛玻璃效果，采用 Apple Squircle 圆角',
      ],
      en: [
        'In-app update — Check, download with progress bar, one-click restart, Ed25519 signed distribution',
        'Extended thinking toggle — Think button in input toolbar for deep reasoning mode',
        'Windows adaptation — Keyboard hints, file manager names, path formats adapted for Windows',
        'Four new themes — Black/Blue/Orange/Green, removed glass effects, Apple squircle corners',
      ],
    },
  },
  {
    version: '0.2.1',
    date: '2026-02-19',
    highlights: {
      zh: [
        '模型 ID 更新 — claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 + localStorage 自动迁移',
        '新建任务流程优化 — 侧栏按钮导航至 WelcomeScreen，每次启动从欢迎页开始',
        '会话分组修复 — 修复同一文件夹出现两个分组的问题',
        '标题栏拖拽 — 原生 data-tauri-drag-region 替代 JS hack，支持双击最大化',
      ],
      en: [
        'Model ID update — claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 + auto localStorage migration',
        'New task flow — Sidebar button navigates to WelcomeScreen, app starts fresh each launch',
        'Session grouping fix — Fixed duplicate project groups in sidebar',
        'Titlebar drag — Native data-tauri-drag-region replaces JS hacks, double-click maximize works',
      ],
    },
  },
  {
    version: '0.2.0',
    date: '2026-02-16',
    highlights: {
      zh: [
        'CLI 自动检测与安装引导 — 首次启动自动检测 Claude CLI，未安装时分步向导引导，无需终端',
        '术语变更「对话」→「任务」 — 全部用户界面文案统一为面向目标的任务概念',
        '主题色彩全面改版 — 四套新配色，移除毛玻璃效果，Apple Squircle 圆角',
        '斜杠命令过滤修复 — 输入字母后优先匹配名称开头，不再显示所有命令',
      ],
      en: [
        'CLI auto-detect & setup wizard — First-launch detection with step-by-step guide, no terminal needed',
        'Terminology: Chat → Task — All UI text updated to goal-oriented "Task" concept',
        'Theme color overhaul — Four new palettes, removed glass effects, Apple squircle corners',
        'Slash command filter fix — Typing a letter now prioritizes name-prefix matches',
      ],
    },
  },
  {
    version: '0.1.1',
    date: '2025-12-01',
    highlights: {
      zh: [
        '修复 rewind 删除项目文件',
        '新增错误边界',
      ],
      en: [
        'Fixed rewind deleting project files',
        'Added error boundary',
      ],
    },
  },
  {
    version: '0.1.0',
    date: '2025-12-01',
    highlights: {
      zh: [
        'TOKENICODE 首发 — Claude Code 桌面 GUI 客户端',
        'NDJSON 流式聊天 + 文件浏览器 + 会话管理 + 快照回退',
        '中英双语界面 + macOS 透明标题栏原生集成',
      ],
      en: [
        'TOKENICODE initial release — Desktop GUI for Claude Code',
        'NDJSON streaming chat + file explorer + session management + snapshot/rewind',
        'Chinese/English bilingual UI + macOS transparent titlebar integration',
      ],
    },
  },
];

export function getChangelog(version: string): ChangelogEntry | null {
  return CHANGELOG.find((e) => e.version === version) || null;
}
