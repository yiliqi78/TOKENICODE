/**
 * Singleton StreamController wired to TOKENICODE's live stores.
 *
 * The controller is the single owner of streaming state (rAF buffer, orphan
 * queue, completion guard). This module binds it to sessionStore (for
 * stdinId → tabId routing) and chatStore (as partial-text / partial-thinking
 * sink), using default rAF + setInterval scheduling.
 *
 * §4.6 note: unlike the legacy useStreamProcessor path, this router does NOT
 * fall back to `selectedSessionId` when the stdin→tab mapping is missing.
 * Unmapped flushes are stashed in the orphan queue and drained on bind.
 */
import { useChatStore } from '../stores/chatStore';
import { useSessionStore } from '../stores/sessionStore';
import {
  StreamController,
  DEFAULT_CONFIG,
  type StreamRouter,
  type StreamSink,
} from './StreamController';

const router: StreamRouter = {
  getTabIdForStdin: (stdinId) =>
    useSessionStore.getState().getTabForStdin(stdinId) ?? null,
};

const sink: StreamSink = {
  updatePartialText: (tabId, text) =>
    useChatStore.getState().updatePartialMessage(tabId, text),
  updatePartialThinking: (tabId, text) =>
    useChatStore.getState().updatePartialThinking(tabId, text),
};

export const streamController = new StreamController(router, sink);

export { DEFAULT_CONFIG };
