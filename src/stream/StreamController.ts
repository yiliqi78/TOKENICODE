/**
 * StreamController · §4.3.1 单点源
 *
 * 统一持有流式状态的三处来源（rAF 缓冲 / orphan 队列 / 完成标记），
 * 代替之前散落在 useStreamProcessor.ts 中的三地管理。
 *
 * 设计原则：
 *   - 纯类，通过 DI 接 router + sink + scheduler（便于 jsdom 下 fake timer 测试）
 *   - 所有 state 只能通过本类方法变更
 *   - `completeStream` 原子：先 flush，再清理，再 emit `completed`；对同一 stdinId 幂等
 *   - `clearPartial(stdinId)` 精准清理，不触其他会话
 */

export type StdinId = string;
export type TabId = string;

export interface StreamRouter {
  getTabIdForStdin(stdinId: StdinId): TabId | null;
}

export interface StreamSink {
  updatePartialText(tabId: TabId, text: string): void;
  updatePartialThinking(tabId: TabId, text: string, stdinId?: StdinId): void;
}

export interface Scheduler {
  raf(cb: () => void): number;
  cancelRaf(handle: number): void;
  setInterval(cb: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  now(): number;
}

export const defaultScheduler: Scheduler = {
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (h) => cancelAnimationFrame(h),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h),
  now: () => Date.now(),
};

export interface StreamControllerConfig {
  ttlMs: number;
  perStdinCapChars: number;
  totalCapChars: number;
  intervalMs: number;
}

export const DEFAULT_CONFIG: StreamControllerConfig = {
  ttlMs: 5_000,
  perStdinCapChars: 1 * 1024 * 1024,
  totalCapChars: 10 * 1024 * 1024,
  // Keep the fallback flush responsive so background/slow tabs do not batch
  // visible updates into 200ms-sized jumps.
  intervalMs: 50,
};

export type StreamEvent =
  | { type: 'partial-flushed'; stdinId: StdinId; tabId: TabId; textLen: number; thinkingLen: number }
  | { type: 'orphan-stashed'; stdinId: StdinId; totalChars: number }
  | { type: 'orphan-dropped'; stdinId: StdinId; reason: 'per-cap' | 'total-cap' | 'ttl' }
  | { type: 'orphan-drained'; stdinId: StdinId; tabId: TabId }
  | { type: 'completed'; stdinId: StdinId; tabId: TabId | null };

type Listener = (evt: StreamEvent) => void;

interface Buffer { text: string; thinking: string; raf: number }
interface Orphan {
  text: string;
  thinking: string;
  events: unknown[];
  eventBytes: number;
  expiresAt: number;
}

export class StreamController {
  private readonly buffers = new Map<StdinId, Buffer>();
  private readonly orphans = new Map<StdinId, Orphan>();
  private readonly completedOnce = new Set<StdinId>();
  private readonly eagerThinkingFlushed = new Set<StdinId>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly router: StreamRouter,
    private readonly sink: StreamSink,
    private readonly scheduler: Scheduler = defaultScheduler,
    private readonly config: StreamControllerConfig = DEFAULT_CONFIG,
  ) {}

  // --- Ingress ---

  appendText(stdinId: StdinId, text: string): void {
    if (!text) return;
    if (this.completedOnce.has(stdinId)) return;
    const buf = this.getOrCreateBuffer(stdinId);
    buf.text += text;
    this.schedule(stdinId, buf);
  }

  appendThinking(stdinId: StdinId, text: string): void {
    if (!text) return;
    if (this.completedOnce.has(stdinId)) return;
    const buf = this.getOrCreateBuffer(stdinId);
    const shouldFlushImmediately = !this.eagerThinkingFlushed.has(stdinId)
      && !buf.text
      && !buf.thinking
      && !buf.raf;
    buf.thinking += text;
    if (shouldFlushImmediately) {
      this.eagerThinkingFlushed.add(stdinId);
      this.doFlush(stdinId, buf);
      if (!buf.text && !buf.thinking) this.buffers.delete(stdinId);
      if (this.buffers.size === 0) this.stopInterval();
      return;
    }
    this.schedule(stdinId, buf);
  }

  // --- Read-only peeks (for consumers that need in-flight buffer snapshots,
  // e.g. TTS detector needs the fully accumulated text including not-yet-flushed
  // delta, without breaking the controller's ownership of mutation).

  peekBufferedText(stdinId: StdinId): string {
    return this.buffers.get(stdinId)?.text ?? '';
  }

  peekBufferedThinking(stdinId: StdinId): string {
    return this.buffers.get(stdinId)?.thinking ?? '';
  }

  // --- Flush ---

  flush(stdinId?: StdinId): void {
    const ids = stdinId !== undefined ? [stdinId] : Array.from(this.buffers.keys());
    for (const id of ids) {
      const buf = this.buffers.get(id);
      if (!buf) continue;
      if (buf.raf) { this.scheduler.cancelRaf(buf.raf); buf.raf = 0; }
      this.doFlush(id, buf);
      // Drop empty entries so flush() is idempotent w.r.t. buffer size.
      if (!buf.text && !buf.thinking) this.buffers.delete(id);
    }
    if (this.buffers.size === 0) this.stopInterval();
  }

  // --- Lifecycle ---

  /** Precisely drop buffered + partial state for one stdinId. */
  clearPartial(stdinId: StdinId): void {
    const buf = this.buffers.get(stdinId);
    if (buf?.raf) this.scheduler.cancelRaf(buf.raf);
    this.buffers.delete(stdinId);
    this.eagerThinkingFlushed.delete(stdinId);
    if (this.buffers.size === 0) this.stopInterval();
  }

  /** Drop only buffered thinking for one stdinId, preserving pending text. */
  clearThinking(stdinId: StdinId): void {
    const buf = this.buffers.get(stdinId);
    this.eagerThinkingFlushed.delete(stdinId);
    if (!buf) return;

    buf.thinking = '';
    if (buf.text) return;

    if (buf.raf) this.scheduler.cancelRaf(buf.raf);
    this.buffers.delete(stdinId);
    if (this.buffers.size === 0) this.stopInterval();
  }

  /**
   * Atomically finalize a stream: flush any pending buffer, clear state, and
   * emit `completed` exactly once. Duplicate calls for the same stdinId are
   * no-ops — guards against Rust-side dual-path process_exit races (§4.3.2).
   */
  completeStream(stdinId: StdinId): void {
    if (this.completedOnce.has(stdinId)) return;
    this.completedOnce.add(stdinId);
    this.eagerThinkingFlushed.delete(stdinId);
    const buf = this.buffers.get(stdinId);
    if (buf) {
      if (buf.raf) { this.scheduler.cancelRaf(buf.raf); buf.raf = 0; }
      this.doFlush(stdinId, buf);
      this.buffers.delete(stdinId);
    }
    if (this.buffers.size === 0) this.stopInterval();
    const tabId = this.router.getTabIdForStdin(stdinId);
    this.emit({ type: 'completed', stdinId, tabId });
  }

  /** Test/cleanup hook: reset completion guard (e.g., stdinId reused). */
  forgetCompletion(stdinId: StdinId): void {
    this.completedOnce.delete(stdinId);
    this.eagerThinkingFlushed.delete(stdinId);
  }

  // --- Orphan queue ---

  stashOrphan(stdinId: StdinId, text: string, thinking: string): void {
    if (!text && !thinking) return;
    this.expireOrphans();
    const existing = this.orphans.get(stdinId);
    const expiresAt = this.scheduler.now() + this.config.ttlMs;
    const merged: Orphan = existing
      ? {
        text: existing.text + text,
        thinking: existing.thinking + thinking,
        events: existing.events,
        eventBytes: existing.eventBytes,
        expiresAt,
      }
      : { text, thinking, events: [], eventBytes: 0, expiresAt };
    this.commitOrphan(stdinId, merged);
  }

  stashOrphanEvent(stdinId: StdinId, event: unknown): void {
    this.expireOrphans();
    const existing = this.orphans.get(stdinId);
    const expiresAt = this.scheduler.now() + this.config.ttlMs;
    const eventBytes = this.estimateEventBytes(event);
    const merged: Orphan = existing
      ? {
        text: existing.text,
        thinking: existing.thinking,
        events: [...existing.events, event],
        eventBytes: existing.eventBytes + eventBytes,
        expiresAt,
      }
      : { text: '', thinking: '', events: [event], eventBytes, expiresAt };
    this.commitOrphan(stdinId, merged);
  }

  drainOrphan(
    stdinId: StdinId,
    tabId: TabId,
    replayEvent?: (event: unknown) => void,
  ): void {
    this.expireOrphans();
    const entry = this.orphans.get(stdinId);
    if (!entry) return;
    if (entry.text) this.sink.updatePartialText(tabId, entry.text);
    if (entry.thinking) this.sink.updatePartialThinking(tabId, entry.thinking, stdinId);
    this.orphans.delete(stdinId);
    this.emit({ type: 'orphan-drained', stdinId, tabId });
    if (replayEvent) {
      for (const event of entry.events) {
        replayEvent(event);
      }
    }
  }

  expireOrphans(): void {
    const now = this.scheduler.now();
    for (const [id, entry] of this.orphans.entries()) {
      if (entry.expiresAt <= now) {
        this.orphans.delete(id);
        this.emit({ type: 'orphan-dropped', stdinId: id, reason: 'ttl' });
      }
    }
  }

  orphanTotalChars(): number {
    let total = 0;
    for (const e of this.orphans.values()) {
      total += e.text.length + e.thinking.length + e.eventBytes;
    }
    return total;
  }

  // --- Subscriptions ---

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Internals ---

  private getOrCreateBuffer(stdinId: StdinId): Buffer {
    let buf = this.buffers.get(stdinId);
    if (!buf) {
      buf = { text: '', thinking: '', raf: 0 };
      this.buffers.set(stdinId, buf);
    }
    return buf;
  }

  private schedule(stdinId: StdinId, buf: Buffer): void {
    this.ensureInterval();
    if (buf.raf) return;
    buf.raf = this.scheduler.raf(() => {
      buf.raf = 0;
      this.doFlush(stdinId, buf);
      if (!buf.text && !buf.thinking) this.buffers.delete(stdinId);
      if (this.buffers.size === 0) this.stopInterval();
    });
  }

  private ensureInterval(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = this.scheduler.setInterval(() => {
      for (const [id, buf] of this.buffers) {
        if (buf.text || buf.thinking) this.doFlush(id, buf);
      }
      if (this.buffers.size === 0) this.stopInterval();
    }, this.config.intervalMs);
  }

  private stopInterval(): void {
    if (!this.intervalHandle) return;
    this.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  private doFlush(stdinId: StdinId, buf: Buffer): void {
    if (!buf.text && !buf.thinking) return;
    const tabId = this.router.getTabIdForStdin(stdinId);
    if (!tabId) {
      this.stashOrphan(stdinId, buf.text, buf.thinking);
      buf.text = '';
      buf.thinking = '';
      return;
    }
    const textLen = buf.text.length;
    const thinkingLen = buf.thinking.length;
    if (buf.text) {
      this.sink.updatePartialText(tabId, buf.text);
      buf.text = '';
    }
    if (buf.thinking) {
      this.sink.updatePartialThinking(tabId, buf.thinking, stdinId);
      buf.thinking = '';
    }
    this.emit({ type: 'partial-flushed', stdinId, tabId, textLen, thinkingLen });
  }

  private estimateEventBytes(event: unknown): number {
    try {
      const serialized = JSON.stringify(event);
      return serialized ? serialized.length : 1;
    } catch {
      return 1;
    }
  }

  private commitOrphan(stdinId: StdinId, entry: Orphan): void {
    const totalBytes = entry.text.length + entry.thinking.length + entry.eventBytes;
    if (totalBytes > this.config.perStdinCapChars) {
      this.orphans.delete(stdinId);
      this.emit({ type: 'orphan-dropped', stdinId, reason: 'per-cap' });
      return;
    }
    this.orphans.set(stdinId, entry);
    while (this.orphanTotalChars() > this.config.totalCapChars) {
      const oldest = this.orphans.keys().next().value;
      if (!oldest) break;
      this.orphans.delete(oldest);
      this.emit({ type: 'orphan-dropped', stdinId: oldest, reason: 'total-cap' });
    }
    this.emit({ type: 'orphan-stashed', stdinId, totalChars: this.orphanTotalChars() });
  }

  private emit(evt: StreamEvent): void {
    for (const l of this.listeners) {
      try { l(evt); } catch (e) { console.error('[StreamController] listener threw', e); }
    }
  }

  // --- Test seams ---

  readonly __testing = {
    getBuffer: (stdinId: StdinId) => this.buffers.get(stdinId),
    getOrphan: (stdinId: StdinId) => this.orphans.get(stdinId),
    hasBuffer: (stdinId: StdinId) => this.buffers.has(stdinId),
    hasOrphan: (stdinId: StdinId) => this.orphans.has(stdinId),
    buffersSize: () => this.buffers.size,
    orphansSize: () => this.orphans.size,
    orphanTotalChars: () => this.orphanTotalChars(),
    isCompleted: (stdinId: StdinId) => this.completedOnce.has(stdinId),
    forceExpire: () => this.expireOrphans(),
    clear: () => {
      for (const b of this.buffers.values()) if (b.raf) this.scheduler.cancelRaf(b.raf);
      this.buffers.clear();
      this.orphans.clear();
      this.completedOnce.clear();
      this.stopInterval();
    },
    config: this.config,
  };
}
