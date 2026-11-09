/**
 * 前端日志转发。
 *
 * 生产包里 WebView 的 console 输出不落盘，排查「内存暴涨」「无响应」这类问题时拿不到前端线索。
 * 这里把 console.warn / console.error、带 `[TOKENICODE]` 前缀的 console.log/info/debug，
 * 以及 window 级未捕获错误，经 @tauri-apps/plugin-log 写进 Rust 侧同一份轮转日志文件
 * （macOS: ~/Library/Logs/com.tinyzhuang.tokenicode/tokenicode.log）。
 *
 * 写入前先做一次脱敏（API key / Bearer / token 参数 / URL userinfo / JWT），
 * Rust 侧 format 还会再脱敏一遍，两道保险。
 */
import { invoke } from '@tauri-apps/api/core';
import { LogLevel } from '@tauri-apps/plugin-log';

export type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';
export type ForwardLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志出口。`origin` 是来源标记（如 console.warn），落到文件里是 `[webview::console.warn]`。 */
export interface LogSink {
  debug(message: string, origin: string): Promise<void>;
  info(message: string, origin: string): Promise<void>;
  warn(message: string, origin: string): Promise<void>;
  error(message: string, origin: string): Promise<void>;
}

const PLUGIN_LEVEL: Record<ForwardLevel, LogLevel> = {
  debug: LogLevel.Debug,
  info: LogLevel.Info,
  warn: LogLevel.Warn,
  error: LogLevel.Error,
};

/**
 * 默认出口：直接调 tauri-plugin-log 的 `log` 命令。
 * 不用包里的 warn()/error() 封装，是因为它们从调用栈猜 location，猜到的永远是本文件的
 * forward()，每行都带一串无用的 `forward@…log-forwarder.ts:71:23`；这里把 location 换成
 * 可读的来源标记。命令签名见 tauri-plugin-log/src/commands.rs。
 */
function pluginSinkCall(level: ForwardLevel) {
  return (message: string, origin: string) =>
    invoke<void>('plugin:log|log', {
      level: PLUGIN_LEVEL[level],
      message,
      location: origin,
    });
}

export const pluginSink: LogSink = {
  debug: pluginSinkCall('debug'),
  info: pluginSinkCall('info'),
  warn: pluginSinkCall('warn'),
  error: pluginSinkCall('error'),
};

/** 这些前缀的普通 console.log 也转发（应用自己的诊断日志），其他 log/info/debug 只留在 DevTools。 */
const FORWARD_PREFIXES = ['[TOKENICODE', '[ErrorBoundary'];

/** 单条消息上限，防止把整个流式响应对象 stringify 进日志。 */
export const MAX_MESSAGE_CHARS = 4000;

const REDACTIONS: Array<[RegExp, string]> = [
  // sk-ant-api03-xxxx / sk-xxxx
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  // Bearer <token>
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***'],
  // JWT
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'eyJ***'],
  // URL userinfo
  [/(https?:\/\/[^/\s:@]+):([^/\s@]+)@/gi, '$1:***@'],
  // URL 查询参数
  [/([?&](?:key|api_key|apikey|token|access_token|secret|password|sig|signature)=)[^&\s"']+/gi, '$1***'],
  // 键值对；`token` 必须整词，避免误伤 input_tokens / tokenicode
  // 键名后允许一个闭引号（JSON 形式 "auth_token": "xxx"）
  [
    /\b([a-z0-9_-]*(?:api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|passwd)[a-z0-9_-]*|token)(["']?\s*[=:]\s*["']?)([^\s"',;&\]}]{4,})/gi,
    '$1$2***',
  ],
];

/** 把文本里的凭据替换成 `***`。 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function firstLines(text: string, n: number): string {
  return text.split('\n').slice(0, n).join('\n');
}

/** 把 console 的参数列表拼成一行可读文本；Error 带前几行堆栈，对象 JSON 化，超长截断。 */
export function formatConsoleArgs(args: unknown[]): string {
  const parts = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) {
      // JSC（WebKit）的 stack 不含首行 message，所以 message 单独放前面
      const head = `${a.name}: ${a.message}`;
      return a.stack ? `${head}\n${firstLines(a.stack, 5)}` : head;
    }
    if (a === undefined) return 'undefined';
    if (typeof a === 'object' && a !== null) {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  });
  const joined = parts.join(' ');
  if (joined.length <= MAX_MESSAGE_CHARS) return joined;
  return `${joined.slice(0, MAX_MESSAGE_CHARS)}…(+${joined.length - MAX_MESSAGE_CHARS} chars)`;
}

/** 决定某次 console 调用要不要转发、以什么级别转发；null 表示不转发。 */
export function levelFor(method: ConsoleMethod, message: string): ForwardLevel | null {
  if (method === 'error') return 'error';
  if (method === 'warn') return 'warn';
  if (FORWARD_PREFIXES.some((p) => message.startsWith(p))) {
    return method === 'debug' ? 'debug' : 'info';
  }
  return null;
}

/** 是否运行在 Tauri WebView 里（纯浏览器 / 单测环境下不转发）。 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const CONSOLE_METHODS: ConsoleMethod[] = ['log', 'info', 'debug', 'warn', 'error'];

/**
 * 给 console 打补丁并挂上 window error / unhandledrejection 监听。
 * 返回卸载函数。原 console 行为不变，只是多了一份落盘。
 */
export function installConsoleForwarder(sink: LogSink = pluginSink): () => void {
  const originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  // 防止 sink 内部同步调用 console 造成递归
  let forwarding = false;

  const forward = (level: ForwardLevel, message: string, origin: string) => {
    if (forwarding) return;
    forwarding = true;
    try {
      void sink[level](redactSecrets(message), origin).catch(() => {});
    } catch {
      // 转发失败不影响应用
    } finally {
      forwarding = false;
    }
  };

  for (const method of CONSOLE_METHODS) {
    const original = console[method] as (...args: unknown[]) => void;
    originals[method] = original;
    console[method] = (...args: unknown[]) => {
      original.apply(console, args);
      const message = formatConsoleArgs(args);
      const level = levelFor(method, message);
      if (level) forward(level, message, `console.${method}`);
    };
  }

  const onError = (event: ErrorEvent) => {
    const detail = event.error instanceof Error
      ? formatConsoleArgs([event.error])
      : `${event.message} (${event.filename}:${event.lineno}:${event.colno})`;
    forward('error', detail, 'window.onerror');
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    forward('error', formatConsoleArgs([event.reason]), 'unhandledrejection');
  };
  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (hasWindow) {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  }

  return () => {
    for (const method of CONSOLE_METHODS) {
      const original = originals[method];
      if (original) console[method] = original as typeof console.log;
    }
    if (hasWindow) {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    }
  };
}
