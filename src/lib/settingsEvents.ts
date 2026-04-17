/**
 * Settings event bus (Phase B · B10).
 *
 * Why this exists:
 *   settingsStore.setSelectedModel / setThinkingLevel / setSessionMode used to
 *   be pure state writes. Running streams that captured a snapshot at turn
 *   start would continue to use the old value even after the user changed it
 *   in the UI. Without a pub/sub channel there is no way for the stream layer
 *   (or any other consumer) to know it should re-snapshot.
 *
 *   See Her v0.5.2 roadmap §4.3.5 — "settingsStore 事件化".
 *
 * Design:
 *   A minimal typed emitter with no runtime dependency. Subscribers are kept
 *   in a Set so `off()` is O(1). Handler errors are isolated so one bad
 *   listener cannot break the others.
 */

export type SettingsEventMap = {
  'model-changed': { old: string; next: string };
  'thinking-changed': { old: string; next: string };
  'session-mode-changed': { old: string; next: string };
};

type EventName = keyof SettingsEventMap;
type Handler<T extends EventName> = (payload: SettingsEventMap[T]) => void;

class SettingsEmitter {
  private handlers: { [K in EventName]: Set<Handler<K>> } = {
    'model-changed': new Set(),
    'thinking-changed': new Set(),
    'session-mode-changed': new Set(),
  };

  on<T extends EventName>(event: T, handler: Handler<T>): () => void {
    this.handlers[event].add(handler);
    return () => this.handlers[event].delete(handler);
  }

  off<T extends EventName>(event: T, handler: Handler<T>): void {
    this.handlers[event].delete(handler);
  }

  emit<T extends EventName>(event: T, payload: SettingsEventMap[T]): void {
    for (const handler of this.handlers[event]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[settingsEvents] handler for "${event}" threw:`, err);
      }
    }
  }

  /** Test-only: drop all subscribers. */
  _reset(): void {
    for (const key of Object.keys(this.handlers) as EventName[]) {
      this.handlers[key].clear();
    }
  }
}

export const settingsEvents = new SettingsEmitter();
