import { useCallback, type MutableRefObject } from 'react';
import { useChatStore, generateMessageId, generateInterruptedId, type ChatMessage } from '../stores/chatStore';
import { useSettingsStore, mapSessionModeToPermissionMode, getEffectiveMode } from '../stores/settingsStore';
import { useSessionStore, setOrphanDrainCallback } from '../stores/sessionStore';
import { useAgentStore, resolveAgentId, getAgentDepth } from '../stores/agentStore';
import { useFileStore } from '../stores/fileStore';
import { bridge, onClaudeStream, onClaudeStderr } from '../lib/tauri-bridge';
import { envFingerprint, resolveModelForProvider } from '../lib/api-provider';
import { useProviderStore } from '../stores/providerStore';
import { t } from '../lib/i18n';

// --- Error classification for user-facing messages ---
// Each pattern maps to a friendly i18n key. Matched errors show the friendly
// message as primary text with raw error in a collapsible details block.
// Unmatched errors get a generic fallback + raw details.
const ERROR_CATEGORIES: ReadonlyArray<{ pattern: RegExp; i18nKey: string }> = [
  { pattern: /40[13]|unauthorized|invalid.*key|api.key.*invalid/i, i18nKey: 'error.invalidKey' },
  { pattern: /429|rate.limit|too.many.request/i, i18nKey: 'error.rateLimit' },
  { pattern: /quota|insufficient.*balance|credit|billing/i, i18nKey: 'error.quotaExceeded' },
  { pattern: /model.*not.found|invalid.*model|not_found.*model/i, i18nKey: 'error.modelNotFound' },
  { pattern: /timeout|timed?.out|ECONNREFUSED|ECONNRESET|ENOTFOUND/i, i18nKey: 'error.networkError' },
  { pattern: /network|fetch.failed|dns/i, i18nKey: 'error.networkError' },
  { pattern: /permission.denied|operation.not.permitted|access.denied|forbidden/i, i18nKey: 'error.permissionDenied' },
  { pattern: /overloaded|capacity|503|service.unavailable/i, i18nKey: 'error.serviceUnavailable' },
  { pattern: /not.installed|command.not.found/i, i18nKey: 'error.cliNotInstalled' },
  { pattern: /token.*limit|context.*length|too.long/i, i18nKey: 'error.tokenLimit' },
];

export function formatErrorForUser(raw: string): string {
  if (!raw || raw.length < 10) return raw;
  const match = ERROR_CATEGORIES.find((c) => c.pattern.test(raw));
  const friendly = match ? t(match.i18nKey) : t('error.genericFallback');
  return `${friendly}\n\n<details>\n<summary>${t('error.showDetails')}</summary>\n\n\`\`\`\n${raw}\n\`\`\`\n\n</details>`;
}

// --- Streaming text buffer ---
// Ownership of the rAF buffer, orphan queue, and completion guard lives in
// StreamController (src/stream/StreamController.ts). This module is now a
// thin call-site for the singleton. See roadmap §4.3.1.
import { streamController, DEFAULT_CONFIG as _STREAM_CONFIG } from '../stream/instance';

/** Drain any orphan buffer for the given stdinId into its newly known tab.
 *  Called by sessionStore.registerStdinTab via the registered callback. */
export function drainOrphanBuffer(stdinId: string, tabId: string) {
  streamController.drainOrphan(stdinId, tabId);
}

/** Test-only seam for orphan-queue regression coverage. Not part of the
 *  runtime API surface — do not import from production code. */
export const __orphanTesting = {
  stash: (stdinId: string, text: string, thinking: string) =>
    streamController.stashOrphan(stdinId, text, thinking),
  expire: () => streamController.expireOrphans(),
  size: (): number => streamController.__testing.orphansSize(),
  has: (stdinId: string): boolean => streamController.__testing.hasOrphan(stdinId),
  get: (stdinId: string) => streamController.__testing.getOrphan(stdinId),
  clear: () => streamController.__testing.clear(),
  totalChars: (): number => streamController.__testing.orphanTotalChars(),
  TTL_MS: _STREAM_CONFIG.ttlMs,
  PER_STDIN_CAP: _STREAM_CONFIG.perStdinCapChars,
  TOTAL_CAP: _STREAM_CONFIG.totalCapChars,
};

// Register the drain callback so sessionStore.registerStdinTab can flush
// orphaned buffers without creating a circular import dependency.
setOrphanDrainCallback(drainOrphanBuffer);

// --- Shared pendingCommand completion helper (#27) ---
// Both foreground and background handlers must clear pendingCommandMsgId when
// a result or assistant event arrives. Without this, slash commands like /compact
// that complete on a background tab leave the spinner stuck forever.
interface CompletePendingCommandOpts {
  output?: string;
  costSummary?: { cost: string; duration: string; turns: string | number; input: string; output: string; };
}

export function completePendingCommand(tabId: string, opts: CompletePendingCommandOpts = {}) {
  const store = useChatStore.getState();
  const tab = store.getTab(tabId);
  const pendingCmdMsgId = tab?.sessionMeta.pendingCommandMsgId;
  if (!pendingCmdMsgId) return;
  const cmdMsg = (tab?.messages ?? []).find((m) => m.id === pendingCmdMsgId);
  store.updateMessage(tabId, pendingCmdMsgId, {
    commandCompleted: true,
    commandData: {
      ...cmdMsg?.commandData,
      ...(opts.output !== undefined ? { output: opts.output } : {}),
      ...(opts.costSummary ? { costSummary: opts.costSummary } : {}),
      completedAt: Date.now(),
    },
  });
  store.setSessionMeta(tabId, { pendingCommandMsgId: undefined });
}

/** Flush any buffered streaming text immediately (call before clearPartial).
 *  If stdinId is provided, flush only that session's buffer.
 *  If omitted, flush ALL buffers (backward compat). */
export function flushStreamBuffer(stdinId?: string) {
  streamController.flush(stdinId);
}

// --- File tree auto-refresh on file-mutating tool completions ---
// Tools that may create/modify/delete files in the working directory.
const FILE_MUTATING_TOOLS = new Set([
  'Write', 'Edit', 'MultiEdit', 'Bash', 'BatchTool',
]);

// Debounce tree refresh to batch rapid tool completions (e.g. parallel agents).
let _fileRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function _scheduleFileTreeRefresh() {
  if (_fileRefreshTimer) return; // already scheduled
  _fileRefreshTimer = setTimeout(() => {
    _fileRefreshTimer = null;
    useFileStore.getState().refreshTree();
  }, 300);
}

/**
 * If the tool_result's parent tool_use was a file-mutating tool,
 * schedule a debounced file tree refresh.
 */
function _maybeRefreshFileTree(tabId: string, toolUseId?: string, toolName?: string) {
  // Fast path: tool_name available directly on the message
  if (toolName && FILE_MUTATING_TOOLS.has(toolName)) {
    _scheduleFileTreeRefresh();
    return;
  }
  // Fallback: look up parent tool_use message
  if (toolUseId) {
    const messages = useChatStore.getState().getTab(tabId)?.messages ?? [];
    const parent = messages.find((m) => m.id === toolUseId);
    if (parent?.toolName && FILE_MUTATING_TOOLS.has(parent.toolName)) {
      _scheduleFileTreeRefresh();
    }
  }
}

/**
 * Configuration refs and callbacks that the stream processor needs
 * from the parent InputBar component.
 */
export interface StreamProcessorConfig {
  exitPlanModeSeenRef: MutableRefObject<boolean>;
  autoCompactFiredRef: MutableRefObject<boolean>;
  silentRestartRef: MutableRefObject<boolean>;
  handleSubmitRef: MutableRefObject<() => void>;
  handleStderrLineRef: MutableRefObject<(line: string, sid: string) => void>;
  /** Last stderr error line — displayed to user if process exits without response */
  lastStderrRef: MutableRefObject<string>;
  setInputSync: (text: string) => void;
}

/**
 * useStreamProcessor — extracts stream message handling from InputBar.
 *
 * Returns handleStreamMessage (foreground) and handleBackgroundStreamMessage
 * (background tab routing) as stable callbacks.
 */
export function useStreamProcessor(config: StreamProcessorConfig) {
  const {
    exitPlanModeSeenRef,
    autoCompactFiredRef,
    silentRestartRef,
    handleSubmitRef,
    handleStderrLineRef,
    lastStderrRef,
    setInputSync,
  } = config;

  /**
   * Handle stream messages for a background (non-active) tab — route to cache.
   */
  const handleBackgroundStreamMessage = useCallback((msg: any, tabId: string) => {
    const store = useChatStore.getState();

    // Update lastProgressAt for stall detection on background tabs
    store.setSessionMeta(tabId, { lastProgressAt: Date.now() });

    switch (msg.type) {
      case 'tokenicode_permission_request': {
        // ExitPlanMode: auto-approve in non-plan modes; add plan_review card in plan mode
        if (msg.tool_name === 'ExitPlanMode') {
          const bgMeta = store.getTab(tabId)?.sessionMeta;
          if (getEffectiveMode(bgMeta) !== 'plan') {
            const stdinId = msg.__stdinId;
            if (stdinId) {
              bridge.respondPermission(stdinId, msg.request_id, true, undefined, msg.tool_use_id, msg.input);
            }
            return;
          }
          const bgTab = store.getTab(tabId);
          const bgExisting = bgTab?.messages.find((m) => m.id === 'plan_review_current' && !m.resolved);
          if (!bgExisting) {
            let bgPlanContent = '';
            if (bgTab) {
              for (let i = bgTab.messages.length - 1; i >= 0; i--) {
                if (bgTab.messages[i].role === 'assistant' && bgTab.messages[i].type === 'text' && bgTab.messages[i].content) {
                  bgPlanContent = bgTab.messages[i].content;
                  break;
                }
              }
            }
            store.addMessage(tabId, {
              id: 'plan_review_current',
              role: 'assistant', type: 'plan_review',
              content: bgPlanContent, planContent: bgPlanContent,
              resolved: false, timestamp: Date.now(),
              permissionData: {
                requestId: msg.request_id,
                toolName: msg.tool_name,
                input: msg.input,
                toolUseId: msg.tool_use_id,
              },
            });
          } else {
            store.updateMessage(tabId, 'plan_review_current', {
              permissionData: {
                requestId: msg.request_id,
                toolName: msg.tool_name,
                input: msg.input,
                toolUseId: msg.tool_use_id,
              },
            });
          }
          store.setActivityStatus(tabId, { phase: 'awaiting' });
          return;
        }
        // AskUserQuestion: add question card to tab
        if (msg.tool_name === 'AskUserQuestion') {
          const bgTab = store.getTab(tabId);
          const questionId = msg.tool_use_id || 'ask_question_current';
          const existing = bgTab?.messages.find((m) => m.id === questionId && m.type === 'question')
            || bgTab?.messages.find((m) => m.type === 'question' && !m.resolved && m.toolName === 'AskUserQuestion');
          if (existing) {
            store.updateMessage(tabId, existing.id, {
              permissionData: {
                requestId: msg.request_id,
                toolName: msg.tool_name,
                input: msg.input,
                toolUseId: msg.tool_use_id,
              },
              toolInput: msg.input,
            });
            return;
          }
          const questions = msg.input?.questions;
          store.addMessage(tabId, {
            id: questionId,
            role: 'assistant', type: 'question',
            content: '', toolName: 'AskUserQuestion',
            toolInput: msg.input,
            questions: Array.isArray(questions) ? questions : [],
            resolved: false, timestamp: Date.now(),
            permissionData: {
              requestId: msg.request_id,
              toolName: msg.tool_name,
              input: msg.input,
              toolUseId: msg.tool_use_id,
            },
          });
          store.setActivityStatus(tabId, { phase: 'awaiting' });
          return;
        }
        // Regular permission: add permission card to tab
        const bgTab = store.getTab(tabId);
        const existingPerm = bgTab?.messages.find(
          (m) => m.type === 'permission'
            && m.permissionData?.requestId === msg.request_id
            && m.interactionState !== 'failed'
        );
        if (existingPerm) return;
        store.addMessage(tabId, {
          id: generateMessageId(),
          role: 'assistant', type: 'permission',
          content: msg.description || `${msg.tool_name} wants to execute`,
          permissionTool: msg.tool_name,
          permissionDescription: msg.description || '',
          timestamp: Date.now(),
          interactionState: 'pending',
          permissionData: {
            requestId: msg.request_id,
            toolName: msg.tool_name,
            input: msg.input,
            description: msg.description,
            toolUseId: msg.tool_use_id,
          },
        });
        store.setActivityStatus(tabId, { phase: 'awaiting' });
        break;
      }
      case 'stream_event': {
        const evt = msg.event;
        if (!evt) break;
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text) store.updatePartialMessage(tabId, text);
        } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
          // F1 (#57): background tabs must handle thinking_delta too,
          // otherwise thinking content is silently lost on tab switch.
          const thinking = evt.delta.thinking || '';
          if (thinking) store.updatePartialThinking(tabId, thinking);
        }
        // Early detection: create plan_review card for background tab (Plan mode only).
        // Bypass auto-approves via Rust backend — no UI card needed.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode'
            && getEffectiveMode(store.getTab(tabId)?.sessionMeta) === 'plan') {
          const bgTab = store.getTab(tabId);
          const bgExisting = bgTab?.messages.find((m) => m.id === 'plan_review_current');
          if (!bgExisting || !bgExisting.resolved) {
            let bgPlanContent = '';
            if (bgTab) {
              for (let i = bgTab.messages.length - 1; i >= 0; i--) {
                const m = bgTab.messages[i];
                if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                  bgPlanContent = m.toolInput.content;
                  break;
                }
              }
            }
            store.addMessage(tabId, {
              id: 'plan_review_current',
              role: 'assistant', type: 'plan_review',
              content: bgPlanContent, planContent: bgPlanContent,
              resolved: false, timestamp: Date.now(),
            });
            store.setActivityStatus(tabId, { phase: 'awaiting' });
          }
        }
        // Track tokens in background sessions (per-turn + cumulative total)
        if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
          const bgTab = store.getTab(tabId);
          const delta = evt.message.usage.input_tokens;
          store.setSessionMeta(tabId, {
            inputTokens: (bgTab?.sessionMeta.inputTokens || 0) + delta,
            totalInputTokens: (bgTab?.sessionMeta.totalInputTokens || 0) + delta,
          });
        }
        if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
          const bgTab = store.getTab(tabId);
          const delta = evt.usage.output_tokens;
          store.setSessionMeta(tabId, {
            outputTokens: (bgTab?.sessionMeta.outputTokens || 0) + delta,
            totalOutputTokens: (bgTab?.sessionMeta.totalOutputTokens || 0) + delta,
          });
        }
        break;
      }
      case 'assistant': {
        // Clear pending command on assistant event (same as foreground)
        completePendingCommand(tabId);
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;
        // Selectively clear partial in tab — only wipe partialText if a text
        // block is present (which supersedes streaming text). Otherwise, preserve
        // it to avoid intermediate thinking-only messages destroying streaming text.
        const bgHasTextBlock = content.some((b: any) => b.type === 'text' && b.text);
        const bgTab = store.getTab(tabId);
        if (bgTab) {
          const newTabs = new Map(store.tabs);
          if (bgHasTextBlock) {
            newTabs.set(tabId, { ...bgTab, partialText: '', partialThinking: '', isStreaming: false });
          } else if (bgTab.partialThinking) {
            newTabs.set(tabId, { ...bgTab, partialThinking: '' });
          }
          useChatStore.setState({ tabs: newTabs, sessionCache: newTabs });
        }
        // Skip text blocks when AskUserQuestion is present — the
        // interactive question UI makes them redundant.
        const bgHasAskUserQuestion = content.some(
          (b: any) => b.type === 'tool_use' && b.name === 'AskUserQuestion',
        );
        for (let blockIdx = 0; blockIdx < content.length; blockIdx++) {
          const block = content[blockIdx];
          if (block.type === 'text') {
            if (bgHasAskUserQuestion) continue;
            const textId = msg.uuid ? `${msg.uuid}_text_${blockIdx}` : generateMessageId();
            store.addMessage(tabId, {
              id: textId,
              role: 'assistant', type: 'text',
              content: block.text, timestamp: Date.now(),
            });
          } else if (block.type === 'tool_use') {
            // Code mode: suppress EnterPlanMode/ExitPlanMode (transparent to user)
            if (getEffectiveMode(store.getTab(tabId)?.sessionMeta) === 'code'
                && (block.name === 'EnterPlanMode' || block.name === 'ExitPlanMode')) {
              if (block.name === 'ExitPlanMode') exitPlanModeSeenRef.current = true;
              continue;
            }
            if (block.name === 'AskUserQuestion') {
              const questions = block.input?.questions;
              const bgQuestionId = block.id || generateMessageId();
              // Guard: skip if question already exists in background tab (resolved or not)
              const bgSnap = store.getTab(tabId);
              const bgExisting = bgSnap?.messages.find(
                (m) => m.id === bgQuestionId && m.type === 'question',
              );
              if (bgExisting) break;

              store.addMessage(tabId, {
                id: bgQuestionId,
                role: 'assistant', type: 'question',
                content: '', toolName: block.name,
                toolInput: block.input,
                questions: Array.isArray(questions) ? questions : [],
                resolved: false, timestamp: Date.now(),
              });
            } else if (block.name === 'TodoWrite' && block.input?.todos) {
              store.addMessage(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'todo',
                content: '', toolName: block.name,
                toolInput: block.input,
                todoItems: block.input.todos,
                timestamp: Date.now(),
              });
            } else if (block.name === 'ExitPlanMode') {
              // Show as regular tool_use in plan/bypass modes
              store.addMessage(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'tool_use',
                content: '', toolName: block.name,
                toolInput: block.input, timestamp: Date.now(),
              });
              // Only create plan_review card in Plan mode.
              // Bypass auto-approves via Rust backend — no UI card needed.
              if (getEffectiveMode(store.getTab(tabId)?.sessionMeta) === 'plan') {
                const bgSnap2 = store.getTab(tabId);
                let bgPlanContent = '';
                if (bgSnap2) {
                  for (let i = bgSnap2.messages.length - 1; i >= 0; i--) {
                    const m = bgSnap2.messages[i];
                    if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                      bgPlanContent = m.toolInput.content;
                      break;
                    }
                  }
                }
                const bgToolExists = block.id && bgSnap2?.messages.some(
                  (m) => m.id === block.id && m.toolName === 'ExitPlanMode',
                );
                const bgResolvedReview = bgSnap2?.messages.find(
                  (m) => m.type === 'plan_review' && m.resolved,
                );
                if (!(bgToolExists && bgResolvedReview)) {
                  store.addMessage(tabId, {
                    id: 'plan_review_current',
                    role: 'assistant', type: 'plan_review',
                    content: bgPlanContent, planContent: bgPlanContent,
                    resolved: false, timestamp: Date.now(),
                  });
                  store.setActivityStatus(tabId, { phase: 'awaiting' });
                }
              }
            } else {
              store.addMessage(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'tool_use',
                content: '', toolName: block.name,
                toolInput: block.input, timestamp: Date.now(),
              });
            }
          }
        }
        break;
      }
      case 'user':
      case 'human': {
        const userContent = msg.message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === 'tool_result') {
              const resultText = Array.isArray(block.content)
                ? block.content.map((b: any) => typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '').join('')
                : typeof block.content === 'string' ? block.content : '';
              if (block.tool_use_id && resultText) {
                store.updateMessage(tabId, block.tool_use_id, { toolResultContent: resultText });
              }
            }
          }
        }
        break;
      }
      case 'tool_result': {
        const resultContent = Array.isArray(msg.content)
          ? msg.content.map((b: any) => typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '').join('')
          : typeof msg.content === 'string' ? msg.content : msg.output || '';
        if (msg.tool_use_id) {
          // Backfill AskUserQuestion type/questions in background tab
          const bgTab = store.getTab(tabId);
          const parentMsg = bgTab?.messages.find((m) => m.id === msg.tool_use_id);
          const bgUpdates: Partial<ChatMessage> = { toolResultContent: resultContent };
          if (parentMsg?.toolName === 'AskUserQuestion') {
            if (parentMsg.type !== 'question') {
              bgUpdates.type = 'question';
              bgUpdates.resolved = false;
            }
            if (!parentMsg.questions || parentMsg.questions.length === 0) {
              const qs = parentMsg.toolInput?.questions;
              if (Array.isArray(qs) && qs.length > 0) {
                bgUpdates.questions = qs;
              }
            }
          }
          store.updateMessage(tabId, msg.tool_use_id, bgUpdates);
          // Auto-refresh file tree when file-mutating tools complete
          _maybeRefreshFileTree(tabId, msg.tool_use_id, msg.tool_name);
        }
        break;
      }
      case 'result': {
        // Clear pending command on result (e.g. /compact completing on background tab)
        completePendingCommand(tabId, {
          costSummary: msg.total_cost_usd != null ? {
            cost: `$${msg.total_cost_usd?.toFixed(4) || '0'}`,
            duration: msg.duration_ms ? `${(msg.duration_ms / 1000).toFixed(1)}s` : '',
            turns: msg.num_turns ?? '',
            input: msg.usage?.input_tokens?.toLocaleString() ?? '',
            output: msg.usage?.output_tokens?.toLocaleString() ?? '',
          } : undefined,
        });
        store.setSessionStatus(tabId, msg.subtype === 'success' ? 'completed' : 'error');
        {
          const bgTab = store.getTab(tabId);
          const prevMeta = bgTab?.sessionMeta;
          const resultInput = msg.usage?.input_tokens || 0;
          const resultOutput = msg.usage?.output_tokens || 0;
          const streamedInput = prevMeta?.inputTokens || 0;
          const streamedOutput = prevMeta?.outputTokens || 0;
          store.setSessionMeta(tabId, {
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
            turns: msg.num_turns,
            inputTokens: resultInput,
            outputTokens: resultOutput,
            totalInputTokens: (prevMeta?.totalInputTokens || 0) + (resultInput - streamedInput),
            totalOutputTokens: (prevMeta?.totalOutputTokens || 0) + (resultOutput - streamedOutput),
            turnStartTime: undefined,
            lastProgressAt: undefined,
          });
        }
        if (typeof msg.result === 'string' && msg.result) {
          // Only add if not already delivered via 'assistant' event
          const bgTab = store.getTab(tabId);
          const bgIsDuplicate = bgTab?.messages.some(
            (m) => m.role === 'assistant' && m.type === 'text'
              && m.content === msg.result,
          );
          if (!bgIsDuplicate) {
            store.addMessage(tabId, {
              id: msg.uuid || generateMessageId(),
              role: 'assistant', type: 'text',
              content: msg.result, timestamp: Date.now(),
            });
          }
        }
        // BATCH drain for background tabs: same as foreground — combine
        // ALL pending messages into a single user turn.
        {
          const bgDrainTab = store.getTab(tabId);
          const bgAllPending = bgDrainTab?.pendingUserMessages ?? [];
          const bgFlushStdinId = bgDrainTab?.sessionMeta.stdinId;
          if (bgAllPending.length > 0 && bgFlushStdinId) {
            const bgCombined = bgAllPending.join('\n\n');
            store.clearPendingMessages(tabId);
            store.addMessage(tabId, {
              id: generateMessageId(),
              role: 'user',
              type: 'text',
              content: bgCombined,
              timestamp: Date.now(),
            });
            store.setSessionStatus(tabId, 'running');
            store.setSessionMeta(tabId, { turnStartTime: Date.now(), lastProgressAt: Date.now(), inputTokens: 0, outputTokens: 0 });
            store.setActivityStatus(tabId, { phase: 'thinking' });
            bridge.sendStdin(bgFlushStdinId, bgCombined).catch((err) => {
              console.error('[TC:bg] Failed to send pending messages:', err);
              const bgDraft = store.getTab(tabId)?.inputDraft ?? '';
              store.setInputDraft(tabId, bgDraft ? `${bgDraft}\n\n${bgCombined}` : bgCombined);
              store.setSessionStatus(tabId, 'error');
            });
          }
        }

        useSessionStore.getState().fetchSessions();

        // AI Title Generation for background tabs (same 3rd-turn logic)
        if (msg.subtype === 'success') {
          const customPreviews = useSessionStore.getState().customPreviews;
          if (!customPreviews[tabId]) {
            const bgTab = store.getTab(tabId);
            const bgUserMsgs = bgTab?.messages.filter(
              (m) => m.role === 'user' && m.type === 'text' && m.content,
            ) || [];
            const bgAssistantMsgs = bgTab?.messages.filter(
              (m) => m.role === 'assistant' && m.type === 'text' && m.content,
            ) || [];
            if (bgUserMsgs.length >= 3 && bgAssistantMsgs.length >= 3) {
              const userMsg = bgUserMsgs.map((m) => m.content).join('\n').slice(0, 500);
              const assistantMsg = bgAssistantMsgs.map((m) => m.content).join('\n').slice(0, 500);
              bridge.generateSessionTitle(userMsg, assistantMsg, useProviderStore.getState().activeProviderId || undefined)
                .then((title) => {
                  if (title) {
                    useSessionStore.getState().setCustomPreview(tabId, title);
                  }
                })
                .catch((e) => {
                  // Silently ignore SKIP errors (e.g. no haiku mapping for provider)
                  if (!String(e).includes('SKIP:')) console.warn('Title gen failed:', e);
                });
            }
          }
        }
        break;
      }
      case 'rate_limit_event': {
        const bgRli = msg.rate_limit_info;
        if (bgRli && bgRli.rateLimitType) {
          const bgTab = store.getTab(tabId);
          const prevLimits = bgTab?.sessionMeta?.rateLimits || {};
          store.setSessionMeta(tabId, {
            rateLimits: {
              ...prevLimits,
              [bgRli.rateLimitType]: {
                rateLimitType: bgRli.rateLimitType,
                resetsAt: bgRli.resetsAt,
                isUsingOverage: bgRli.isUsingOverage,
                overageStatus: bgRli.overageStatus,
                overageDisabledReason: bgRli.overageDisabledReason,
              },
            },
          });
        }
        break;
      }
      case 'process_exit': {
        // Flush any remaining stream buffer before cleanup (#64)
        flushStreamBuffer(msg.__stdinId);

        // Flush mid-stream content to final messages BEFORE setSessionStatus('idle')
        // wipes partialText/partialThinking. Same rationale as the foreground
        // handler: preserve interrupted content so the user doesn't lose it.
        {
          const bgTab = store.getTab(tabId);
          const bgThinking = bgTab?.partialThinking ?? '';
          const bgText = bgTab?.partialText ?? '';
          if (bgThinking.trim().length > 0) {
            store.addMessage(tabId, {
              id: generateInterruptedId('thinking'),
              role: 'assistant',
              type: 'thinking',
              content: bgThinking,
              timestamp: Date.now(),
            });
          }
          if (bgText.trim().length > 0) {
            store.addMessage(tabId, {
              id: generateInterruptedId('text'),
              role: 'assistant',
              type: 'text',
              content: bgText,
              timestamp: Date.now(),
            });
          }
        }

        // P0-5: Clean up Tauri event listeners for background tab.
        // __claudeUnlisteners is keyed by stdinId (desk_xxx), NOT tabId (session uuid).
        // Use msg.__stdinId (tagged by the listener closure) to find the correct entry.
        const bgStdinId = msg.__stdinId;
        if (bgStdinId && (window as any).__claudeUnlisteners?.[bgStdinId]) {
          (window as any).__claudeUnlisteners[bgStdinId]();
          delete (window as any).__claudeUnlisteners[bgStdinId];
        }
        store.setSessionStatus(tabId, 'idle');
        store.setSessionMeta(tabId, { stdinId: undefined });
        // Clean up stdinToTab mapping to prevent memory leak
        if (bgStdinId) {
          useSessionStore.getState().unregisterStdinTab(bgStdinId);
        }
        // Restore pending messages to input draft (#142/#70)
        const bgExitPending = store.getTab(tabId)?.pendingUserMessages ?? [];
        if (bgExitPending.length > 0) {
          const bgExitDraft = store.getTab(tabId)?.inputDraft ?? '';
          const bgPendingText = bgExitPending.join('\n\n');
          store.setInputDraft(tabId, bgExitDraft ? `${bgExitDraft}\n\n${bgPendingText}` : bgPendingText);
          store.clearPendingMessages(tabId);
        }
        useSessionStore.getState().fetchSessions();
        break;
      }
      case 'system':
        if (msg.subtype === 'init') {
          store.setSessionMeta(tabId, { model: msg.model });
        } else if (msg.subtype === 'error') {
          // FI-3: Surface system errors in background tabs too
          store.addMessage(tabId, {
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: formatErrorForUser(msg.message || msg.error || 'System error'),
            timestamp: Date.now(),
          });
        }
        break;
    }
  }, [exitPlanModeSeenRef]);

  /**
   * Handle stream messages for the foreground (active) tab.
   */
  const handleStreamMessage = useCallback((msg: any) => {
    if (!msg || !msg.type) return;

    try { // P1-4: error boundary — prevent uncaught exceptions from crashing the stream pipeline

    // Diagnostic: log first message and unrecognized types
    const KNOWN_TYPES = new Set([
      'tokenicode_permission_request', 'stream_event', 'system', 'assistant',
      'user', 'human', 'tool_result', 'tool_use_summary', 'result', 'process_exit',
      'content_block_delta', 'rate_limit_event',
    ]);
    if (msg.type === 'system' || msg.type === 'process_exit') {
      console.log('[TOKENICODE:stream]', msg.type, msg.subtype || '', msg.__stdinId || '');
    }
    if (!KNOWN_TYPES.has(msg.type)) {
      console.warn('[TOKENICODE:stream] unhandled message type:', msg.type, msg);
    }

    // --- Background routing: detect if this stream belongs to a non-active tab ---
    // MUST run before tokenicode_permission_request and all other handlers
    // to prevent messages from background sessions leaking into the active tab.
    const msgStdinId = msg.__stdinId;
    const ownerTabId = msgStdinId
      ? useSessionStore.getState().getTabForStdin(msgStdinId)
      : undefined;
    const activeTabId = useSessionStore.getState().selectedSessionId;
    const isBackground = ownerTabId && ownerTabId !== activeTabId;

    // If stream belongs to a background tab, route key events to cache and return
    if (isBackground) {
      // Diagnostic: log background routing for non-trivial message types
      if (msg.type !== 'stream_event') {
        console.log('[TOKENICODE:route] background:', msg.type, 'owner:', ownerTabId, 'active:', activeTabId);
      }
      handleBackgroundStreamMessage(msg, ownerTabId);
      return;
    }

    // Resolve tabId once for all foreground store calls
    const tabId = ownerTabId || activeTabId;
    if (!tabId) return;

    // Update lastProgressAt on every foreground stream event for stall detection
    useChatStore.getState().setSessionMeta(tabId, { lastProgressAt: Date.now() });

    // --- SDK Permission Request (routed through stream channel for reliability) ---
    if (msg.type === 'tokenicode_permission_request') {

      // ExitPlanMode: only show PlanReviewCard in Plan mode.
      // In other modes, auto-approve so the CLI continues without blocking.
      if (msg.tool_name === 'ExitPlanMode') {
        const tabState = useChatStore.getState().getTab(tabId);
        if (getEffectiveMode(tabState?.sessionMeta) !== 'plan') {
          // Auto-approve: CLI doesn't need user confirmation outside Plan mode
          const stdinId = tabState?.sessionMeta.stdinId;
          if (stdinId) {
            bridge.respondPermission(stdinId, msg.request_id, true, undefined, msg.tool_use_id, msg.input);
          }
          return;
        }
        const chatStore = useChatStore.getState();
        const messages = tabState?.messages ?? [];
        const permData = {
          requestId: msg.request_id,
          toolName: msg.tool_name,
          input: msg.input,
          description: msg.description,
          toolUseId: msg.tool_use_id,
        };
        const planReview = messages.find((m) => m.id === 'plan_review_current' && !m.resolved);
        if (planReview) {
          chatStore.updateMessage(tabId, 'plan_review_current', { permissionData: permData });
        } else {
          // PlanReviewCard not yet created — create one with permission data
          let planContent = '';
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].type === 'text' && messages[i].content) {
              planContent = messages[i].content;
              break;
            }
          }
          chatStore.addMessage(tabId, {
            id: 'plan_review_current',
            role: 'assistant',
            type: 'plan_review',
            content: planContent,
            planContent: planContent,
            resolved: false,
            permissionData: permData,
            timestamp: Date.now(),
          });
          chatStore.setActivityStatus(tabId, { phase: 'awaiting' });
        }
        return;
      }

      // AskUserQuestion: create QuestionCard instead of PermissionCard.
      // User answers are sent back via respondPermission(updatedInput) — NOT sendStdin.
      if (msg.tool_name === 'AskUserQuestion') {
        const chatStore = useChatStore.getState();
        const messages = chatStore.getTab(tabId)?.messages ?? [];
        const questionId = msg.tool_use_id || 'ask_question_current';
        // Search by exact ID first, then fall back to any unresolved AskUserQuestion.
        // This handles the race condition where the assistant message arrives first
        // with block.id (e.g. "toolu_01abc") and the control_request arrives later
        // with a different or missing tool_use_id.
        const existing = messages.find((m) => m.id === questionId && m.type === 'question')
          || messages.find((m) => m.type === 'question' && !m.resolved && m.toolName === 'AskUserQuestion');
        if (existing) {
          // Patch permissionData so QuestionCard uses respondPermission (SDK path)
          // instead of sendStdin (legacy path). Always update — even if permissionData
          // exists — because a new control_request supersedes a stale one.
          chatStore.updateMessage(tabId, existing.id, {
            permissionData: {
              requestId: msg.request_id,
              toolName: msg.tool_name,
              input: msg.input,
              toolUseId: msg.tool_use_id,
            },
            toolInput: msg.input,
          });
          return;
        }
        const questions = msg.input?.questions;
        chatStore.addMessage(tabId, {
          id: questionId,
          role: 'assistant',
          type: 'question',
          content: '',
          toolName: 'AskUserQuestion',
          toolInput: msg.input,
          questions: Array.isArray(questions) ? questions : [],
          resolved: false,
          timestamp: Date.now(),
          // Attach permission data so QuestionCard uses respondPermission instead of sendStdin
          permissionData: {
            requestId: msg.request_id,
            toolName: msg.tool_name,
            input: msg.input,
            toolUseId: msg.tool_use_id,
          },
        });
        chatStore.setActivityStatus(tabId, { phase: 'awaiting' });
        return;
      }

      // Dedup: skip if we already have a non-failed PermissionCard for this request_id
      const chatStore = useChatStore.getState();
      const messages = chatStore.getTab(tabId)?.messages ?? [];
      const existingPerm = messages.find(
        (m) => m.type === 'permission'
          && m.permissionData?.requestId === msg.request_id
          && m.interactionState !== 'failed'
      );
      if (existingPerm) {
        return;
      }
      chatStore.addMessage(tabId, {
        id: generateMessageId(),
        role: 'assistant',
        type: 'permission',
        content: msg.description || `${msg.tool_name} wants to execute`,
        permissionTool: msg.tool_name,
        permissionDescription: msg.description || '',
        timestamp: Date.now(),
        interactionState: 'pending',
        permissionData: {
          requestId: msg.request_id,
          toolName: msg.tool_name,
          input: msg.input,
          description: msg.description,
          toolUseId: msg.tool_use_id,
        },
      });
      chatStore.setActivityStatus(tabId, { phase: 'awaiting' });
      return;
    }

    const cs = useChatStore.getState();
    const addMessage = (message: ChatMessage) => cs.addMessage(tabId, message);
    const setSessionStatus = (status: import('../stores/chatStore').SessionStatus) => cs.setSessionStatus(tabId, status);
    const setSessionMeta = (meta: Partial<import('../stores/chatStore').SessionMeta>) => cs.setSessionMeta(tabId, meta);
    const setActivityStatus = (status: import('../stores/chatStore').ActivityStatus) => cs.setActivityStatus(tabId, status);
    const agentActions = useAgentStore.getState();
    const agentId = resolveAgentId(msg.parent_tool_use_id, agentActions.agents);
    const agentDepth = getAgentDepth(agentId, agentActions.agents);

    // Capture the CLI's own session ID from stream events (used for --resume)
    const cliSessionId = msg.session_id || msg.sessionId;
    if (cliSessionId) {
      const currentId = useChatStore.getState().getTab(tabId)?.sessionMeta.sessionId;
      if (currentId !== cliSessionId) {
        setSessionMeta({ sessionId: cliSessionId });
        // Also store in sessionStore for hadRealExchange-guarded resume
        useSessionStore.getState().setCliResumeId(tabId, cliSessionId);
        bridge.trackSession(cliSessionId).catch(() => {});

        // Promote draft tab to real session ID so it merges with disk session
        if (tabId.startsWith('draft_')) {
          // Migrate tab data under old draft key to new real key
          const chatState = useChatStore.getState();
          const tabData = chatState.getTab(tabId);
          if (tabData) {
            const newTabs = new Map(chatState.tabs);
            newTabs.set(cliSessionId, { ...tabData, tabId: cliSessionId });
            newTabs.delete(tabId);
            useChatStore.setState({ tabs: newTabs, sessionCache: newTabs });
          }
          useSessionStore.getState().promoteDraft(tabId, cliSessionId);
        }

        useSessionStore.getState().fetchSessions();
      }
    }

    // Helper: clear accumulated partial text for THIS tab only.
    // B1: flush must be scoped to msgStdinId — calling flushStreamBuffer() with
    //     no args previously wiped every active session's rAF buffer, causing
    //     cross-tab data loss when one tab's turn completed while another was
    //     streaming. B2: buffer drop happens inside flushStreamBuffer (delete
    //     from _streamBuffers) so no late rAF can repopulate this tab's partial
    //     after we clear it below — flush → clear is atomic w.r.t. this tab.
    const clearPartial = () => {
      if (msgStdinId) flushStreamBuffer(msgStdinId);
      const tabData = useChatStore.getState().getTab(tabId);
      if (tabData && (tabData.isStreaming || tabData.partialText || tabData.partialThinking)) {
        const newTabs = new Map(useChatStore.getState().tabs);
        newTabs.set(tabId, { ...tabData, partialText: '', partialThinking: '', isStreaming: false });
        useChatStore.setState({ tabs: newTabs, sessionCache: newTabs });
      }
    };

    switch (msg.type) {
      // --- stream_event: wrapper for real-time streaming events from --include-partial-messages ---
      case 'stream_event': {
        const evt = msg.event;
        if (!evt) break;

        // Diagnostic: log tool_use starts for debugging plan mode flow
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          console.log('[TOKENICODE:stream] tool_use start:', evt.content_block.name);

          // UX: immediately surface that a tool is running. Without this, the
          // user sees no feedback during long tool input streams (e.g. Write
          // streaming a 2000-word article takes ~50s, during which the
          // ActivityIndicator stays in 'thinking' phase and no card appears).
          // We add a placeholder tool_use card keyed by the content_block.id;
          // when case 'assistant' arrives with the full message, addMessage's
          // id-based dedup will merge the actual toolInput into this card.
          // Skip ExitPlanMode (handled by plan_review path) and Task/Agent/
          // TaskCreate/SendMessage (handled by agent registration below).
          const toolName = evt.content_block.name;
          if (toolName !== 'ExitPlanMode'
              && toolName !== 'Task'
              && toolName !== 'Agent'
              && toolName !== 'TaskCreate'
              && toolName !== 'SendMessage') {
            setActivityStatus({ phase: 'tool', toolName });
            agentActions.updatePhase(agentId, 'tool', toolName);
            addMessage({
              id: evt.content_block.id || `tool_placeholder_${Date.now()}`,
              role: 'assistant',
              type: 'tool_use',
              content: '',
              toolName,
              toolInput: {},
              subAgentDepth: agentDepth,
              timestamp: Date.now(),
            });
          }
        }

        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text && msgStdinId) {
            streamController.appendText(msgStdinId, text);
            agentActions.updatePhase(agentId, 'writing');
          }
        } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
          const thinkingText = evt.delta.thinking || '';
          if (thinkingText && msgStdinId) {
            streamController.appendThinking(msgStdinId, thinkingText);
            agentActions.updatePhase(agentId, 'thinking');
          } else {
            setActivityStatus({ phase: 'thinking' });
            agentActions.updatePhase(agentId, 'thinking');
          }
        }

        // Early agent creation: register sub-agent as soon as Agent/Task tool_use
        // starts streaming, so subsequent events resolve to the correct agent.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && (evt.content_block?.name === 'Task' || evt.content_block?.name === 'Agent')) {
          agentActions.upsertAgent({
            id: evt.content_block.id || `task_${Date.now()}`,
            parentId: agentId,
            description: '',
            phase: 'spawning',
            startTime: Date.now(),
            isMain: false,
          });
        }
        // Agent Team tools (TaskCreate, SendMessage): register as visible agents
        // so the agent panel shows team activity. These run in separate CLI processes
        // so we won't get real-time progress, but visibility is the goal.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && (evt.content_block?.name === 'TaskCreate' || evt.content_block?.name === 'SendMessage')) {
          agentActions.upsertAgent({
            id: evt.content_block.id || `team_${Date.now()}`,
            parentId: agentId,
            description: '',
            phase: 'tool',
            startTime: Date.now(),
            isMain: false,
          });
        }
        // Early detection: create plan_review card ONLY in explicit Plan mode.
        // In Code mode the CLI handles ExitPlanMode natively.
        // In Bypass mode the Rust backend auto-approves — no UI card needed.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode'
            && getEffectiveMode(useChatStore.getState().getTab(tabId)?.sessionMeta) === 'plan') {
          const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);

          // Guard: if plan_review_current already exists and was resolved,
          // this is a replay after plan approval — don't create a new card.
          const existingReview = currentMessages.find((m) => m.id === 'plan_review_current');
          if (!existingReview || !existingReview.resolved) {
            let planContent = '';
            for (let i = currentMessages.length - 1; i >= 0; i--) {
              const m = currentMessages[i];
              if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                planContent = m.toolInput.content;
                break;
              }
            }

            addMessage({
              id: 'plan_review_current',
              role: 'assistant',
              type: 'plan_review',
              content: planContent,
              planContent: planContent,
              resolved: false,
              timestamp: Date.now(),
            });
            setActivityStatus({ phase: 'awaiting' });
          }
        }

        // Track input tokens from message_start (per-turn + cumulative total)
        if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
          const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
          const delta = evt.message.usage.input_tokens;
          setSessionMeta({
            inputTokens: (meta.inputTokens || 0) + delta,
            totalInputTokens: (meta.totalInputTokens || 0) + delta,
          });
        }

        // Track output tokens from message_delta (per-turn + cumulative total)
        if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
          const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
          const delta = evt.usage.output_tokens;
          setSessionMeta({
            outputTokens: (meta.outputTokens || 0) + delta,
            totalOutputTokens: (meta.totalOutputTokens || 0) + delta,
          });
        }
        break;
      }

      case 'system':
        if (msg.subtype === 'init') {
          setSessionMeta({ model: msg.model });
        } else if (msg.subtype === 'error') {
          // FI-3: Surface system-level errors instead of silently dropping them
          const rawError = msg.message || msg.error || 'System error';
          addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: formatErrorForUser(rawError),
            timestamp: Date.now(),
          });
        } else if (
          msg.subtype === 'hook_started' ||
          msg.subtype === 'hook_progress' ||
          msg.subtype === 'hook_response' ||
          msg.subtype === 'status' ||
          msg.subtype === 'api_retry'
        ) {
          // Hook lifecycle + status events — silently ignore (no UI for these in TC)
        } else {
          // FI-3: Log unknown subtypes so we know what we're missing
          console.warn('[TOKENICODE] Unhandled system subtype:', msg.subtype, msg);
        }
        break;

      case 'assistant': {
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;

        // With --include-partial-messages, intermediate assistant messages arrive
        // frequently. We must NOT aggressively wipe streaming text state when the
        // message only contains a thinking block (no text block yet).
        const hasTextBlock = content.some((b: any) => b.type === 'text' && b.text);

        if (hasTextBlock) {
          // Full clear — the text block supersedes streaming partial text
          clearPartial();
        } else {
          // Only clear thinking partial — preserve streaming text
          {
            const td = useChatStore.getState().getTab(tabId);
            if (td?.partialThinking) {
              const nt = new Map(useChatStore.getState().tabs);
              nt.set(tabId, { ...td, partialThinking: '' });
              useChatStore.setState({ tabs: nt, sessionCache: nt });
            }
          }
        }

        // If there's a pending slash command processing card, mark it as
        // completed now — the assistant response means the CLI has responded.
        // Some commands (e.g. /compact) may not emit a 'result' event.
        const pendingCmd = useChatStore.getState().getTab(tabId)?.sessionMeta.pendingCommandMsgId;
        if (pendingCmd) {
          useChatStore.getState().updateMessage(tabId, pendingCmd, {
            commandCompleted: true,
            commandData: {
              ...(useChatStore.getState().getTab(tabId)?.messages ?? []).find((m) => m.id === pendingCmd)?.commandData,
              completedAt: Date.now(),
            },
          });
          useChatStore.getState().setSessionMeta(tabId, { pendingCommandMsgId: undefined });
        }

        // If this message contains AskUserQuestion, skip text blocks —
        // the interactive question UI makes them redundant and avoids
        // showing raw question descriptions alongside the rich UI.
        const hasAskUserQuestion = content.some(
          (b: any) => b.type === 'tool_use' && b.name === 'AskUserQuestion',
        );

        for (let blockIdx = 0; blockIdx < content.length; blockIdx++) {
          const block = content[blockIdx];
          if (block.type === 'text') {
            if (hasAskUserQuestion) continue;
            setActivityStatus({ phase: 'writing' });
            agentActions.updatePhase(agentId, 'writing');
            // Use msg.uuid + block index as stable ID so re-delivered
            // messages de-duplicate correctly in the store.
            const textId = msg.uuid ? `${msg.uuid}_text_${blockIdx}` : generateMessageId();
            addMessage({
              id: textId,
              role: 'assistant',
              type: 'text',
              content: block.text,
              subAgentDepth: agentDepth,
              timestamp: Date.now(),
            });
          } else if (block.type === 'tool_use') {
            // Code mode: EnterPlanMode/ExitPlanMode are transparent — CLI handles internally.
            // Don't show tool cards; track ExitPlanMode for auto-restart if CLI exits.
            if (getEffectiveMode(useChatStore.getState().getTab(tabId)?.sessionMeta) === 'code'
                && (block.name === 'EnterPlanMode' || block.name === 'ExitPlanMode')) {
              if (block.name === 'ExitPlanMode') exitPlanModeSeenRef.current = true;
              continue;
            }
            setActivityStatus({ phase: 'tool', toolName: block.name });
            if (block.name === 'Task' || block.name === 'Agent') {
              agentActions.upsertAgent({
                id: block.id || generateMessageId(),
                parentId: agentId,
                description: block.input?.description || block.input?.prompt || '',
                phase: 'spawning',
                startTime: Date.now(),
                isMain: false,
              });
            } else if (block.name === 'TaskCreate' || block.name === 'SendMessage') {
              // Agent Team tasks/messages: register as visible agents in the tree.
              // These run in separate CLI processes so we won't get progress events,
              // but showing them makes the team activity visible in the agent panel.
              agentActions.upsertAgent({
                id: block.id || `team_${Date.now()}`,
                parentId: agentId,
                description: block.input?.subject || block.input?.description || block.input?.recipient || '',
                phase: 'tool',
                startTime: Date.now(),
                isMain: false,
              });
            } else {
              agentActions.updatePhase(agentId, 'tool', block.name);
            }

            if (block.name === 'AskUserQuestion') {
              // Use a stable sentinel ID so re-delivered blocks de-duplicate
              // instead of creating duplicate question cards (TK-103).
              const questionId = block.id || 'ask_question_current';

              // Guard: skip if question already exists (resolved or not).
              // Search by exact ID first, then by any AskUserQuestion card —
              // the control_request handler may have already created one with
              // a different ID (e.g. 'ask_question_current' vs 'toolu_01abc').
              const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);
              const existingQuestion = currentMessages.find(
                (m) => m.id === questionId && m.type === 'question',
              ) || currentMessages.find(
                (m) => m.type === 'question' && !m.resolved && m.toolName === 'AskUserQuestion',
              );
              if (existingQuestion) {
                // Already exists — just ensure awaiting state if unresolved
                if (!existingQuestion.resolved) {
                  setActivityStatus({ phase: 'awaiting' });
                }
                break;
              }

              const questions = block.input?.questions;
              addMessage({
                id: questionId,
                role: 'assistant',
                type: 'question',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                questions: Array.isArray(questions) ? questions : [],
                resolved: false,
                subAgentDepth: agentDepth,
                timestamp: Date.now(),
              });
              // Mark as awaiting user input (consistent with ExitPlanMode)
              setActivityStatus({ phase: 'awaiting' });
            } else if (block.name === 'TodoWrite' && block.input?.todos) {
              addMessage({
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'todo',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                todoItems: block.input.todos,
                subAgentDepth: agentDepth,
                timestamp: Date.now(),
              });
            } else if (block.name === 'ExitPlanMode') {
              // Show ExitPlanMode as a collapsible tool_use (like other tools)
              addMessage({
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'tool_use',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                subAgentDepth: agentDepth,
                timestamp: Date.now(),
              });

              // Only create plan_review card in Plan mode.
              // In Code mode the CLI handles ExitPlanMode natively.
              // In Bypass mode the Rust backend auto-approves — no UI card needed.
              if (getEffectiveMode(useChatStore.getState().getTab(tabId)?.sessionMeta) === 'plan') {
                const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);

                // Guard: skip if already approved (replay)
                const toolAlreadyExisted = block.id && currentMessages.some(
                  (m) => m.id === block.id && m.toolName === 'ExitPlanMode',
                );
                const existingReview = currentMessages.find(
                  (m) => m.type === 'plan_review' && m.resolved,
                );
                if (!(toolAlreadyExisted && existingReview)) {
                  let planContent = '';
                  for (let i = currentMessages.length - 1; i >= 0; i--) {
                    const m = currentMessages[i];
                    if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                      planContent = m.toolInput.content;
                      break;
                    }
                  }

                  addMessage({
                    id: 'plan_review_current',
                    role: 'assistant',
                    type: 'plan_review',
                    content: planContent,
                    planContent: planContent,
                    resolved: false,
                    timestamp: Date.now(),
                  });
                  setActivityStatus({ phase: 'awaiting' });
                }
              }
            } else {
              addMessage({
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'tool_use',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                subAgentDepth: agentDepth,
                timestamp: Date.now(),
              });

            }
          } else if (block.type === 'thinking') {
            // Complete thinking block arrived — clear streaming thinking text.
            // DON'T override activityStatus here: if text is currently streaming,
            // the phase should remain 'writing'. The streaming events (thinking_delta,
            // text_delta) are the source of truth for activity phase.
            {
            const td = useChatStore.getState().getTab(tabId);
            if (td?.partialThinking) {
              const nt = new Map(useChatStore.getState().tabs);
              nt.set(tabId, { ...td, partialThinking: '' });
              useChatStore.setState({ tabs: nt, sessionCache: nt });
            }
          }
            agentActions.updatePhase(agentId, 'thinking');
            addMessage({
              id: msg.uuid ? `${msg.uuid}_thinking_${blockIdx}` : generateMessageId(),
              role: 'assistant',
              type: 'thinking',
              content: block.thinking || '',
              subAgentDepth: agentDepth,
              timestamp: Date.now(),
            });
          }
        }

        // NOTE: No save/restore hack needed here. addMessage no longer clears
        // partialText/isStreaming as a side effect (TK-322 fix), so intermediate
        // assistant messages with only thinking/tool_use blocks won't wipe
        // streaming text state.
        break;
      }

      case 'user':
      case 'human': {
        // Store CLI checkpoint UUID on the most recent user message (for rewind).
        // Only store from genuine user-input messages, NOT tool-result messages.
        // Tool-result user messages have content with tool_result blocks and their
        // UUIDs don't match the file-history-snapshot messageId used by --rewind-files.
        {
          const content = msg.message?.content;
          const isToolResult = Array.isArray(content)
            && content.some((b: any) => b.type === 'tool_result');
          if (msg.uuid && !isToolResult) {
            const allMsgs = useChatStore.getState().getTab(tabId)?.messages ?? [];
            for (let i = allMsgs.length - 1; i >= 0; i--) {
              if (allMsgs[i].role === 'user') {
                console.log('[stream] Storing checkpointUuid:', msg.uuid, 'on msg:', allMsgs[i].id);
                useChatStore.getState().updateMessage(tabId, allMsgs[i].id, { checkpointUuid: msg.uuid });
                break;
              }
            }
          }
        }

        const userContent = msg.message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === 'tool_result') {
              const resultText = Array.isArray(block.content)
                ? block.content.map((b: any) => typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '').join('')
                : typeof block.content === 'string'
                  ? block.content
                  : '';
              const tuId = block.tool_use_id;
              if (tuId && resultText) {
                const msgs = useChatStore.getState().getTab(tabId)?.messages ?? [];
                const parent = msgs.find((m) => m.id === tuId);
                if (parent) {
                  useChatStore.getState().updateMessage(tabId, tuId, { toolResultContent: resultText });
                }
              }
            }
          }
        }
        if (msg.tool_use_result) {
          const tur = msg.tool_use_result;
          const resultText = typeof tur === 'string' ? tur
            : typeof tur.stdout === 'string' ? tur.stdout
            : typeof tur.content === 'string' ? tur.content
            : Array.isArray(tur.content) ? tur.content.map((b: any) => typeof b.text === 'string' ? b.text : '').join('')
            : typeof tur.content === 'object' && tur.content?.text ? String(tur.content.text)
            : '';
          if (Array.isArray(userContent)) {
            for (const block of userContent) {
              if (block.tool_use_id && resultText) {
                const msgs = useChatStore.getState().getTab(tabId)?.messages ?? [];
                const parent = msgs.find((m) => m.id === block.tool_use_id);
                if (parent) {
                  useChatStore.getState().updateMessage(tabId, block.tool_use_id, { toolResultContent: resultText });
                }
              }
            }
          }
        }
        break;
      }

      case 'tool_result': {
        const resultContent = Array.isArray(msg.content)
          ? msg.content.map((b: any) => typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '').join('')
          : typeof msg.content === 'string'
            ? msg.content
            : msg.output || '';

        const toolUseId = msg.tool_use_id;
        // Auto-refresh file tree when file-mutating tools complete
        _maybeRefreshFileTree(tabId, toolUseId, msg.tool_name);

        if (toolUseId) {
          const currentMessages = useChatStore.getState().getTab(tabId)?.messages ?? [];
          const parentMsg = currentMessages.find((m) => m.id === toolUseId);
          if (parentMsg) {
            const updates: Partial<ChatMessage> = { toolResultContent: resultContent };

            // Backfill: if parent is AskUserQuestion created with empty questions
            // (due to streaming), or was mis-typed as tool_use, fix it now.
            if (parentMsg.toolName === 'AskUserQuestion') {
              if (parentMsg.type !== 'question') {
                updates.type = 'question';
                updates.resolved = false;
              }
              if (!parentMsg.questions || parentMsg.questions.length === 0) {
                // Try to extract questions from toolInput (may have been populated
                // by a later assistant message with complete content)
                const qs = parentMsg.toolInput?.questions;
                if (Array.isArray(qs) && qs.length > 0) {
                  updates.questions = qs;
                }
              }
            }

            useChatStore.getState().updateMessage(tabId, toolUseId, updates);
            break;
          }
        }
        // Complete Agent Team agents when their tool result arrives
        if (toolUseId && agentActions.agents.has(toolUseId)) {
          agentActions.completeAgent(toolUseId, 'completed');
        }
        addMessage({
          id: msg.uuid || generateMessageId(),
          role: 'assistant',
          type: 'tool_result',
          content: resultContent,
          toolName: msg.tool_name,
          subAgentDepth: agentDepth,
          timestamp: Date.now(),
        });
        break;
      }

      case 'tool_use_summary':
        break;

      case 'result': {

        // Sub-agent results carry parent_tool_use_id — they must NOT terminate the
        // main session. Only the main agent's result (no parent_tool_use_id) ends the
        // session. Without this guard, the first parallel sub-agent to complete would
        // call setSessionStatus('completed') and freeze the UI mid-run.
        if (msg.parent_tool_use_id) {
          agentActions.completeAgent(
            resolveAgentId(msg.parent_tool_use_id, agentActions.agents),
            msg.subtype === 'success' ? 'completed' : 'error',
          );
          break;
        }

        // Clear any remaining partial text before marking turn complete
        clearPartial();

        // --- TK-303: Auto-retry on thinking signature error after provider/model switch ---
        // When user switches API provider or model mid-conversation, we attempt to resume
        // the session. If the new provider/model rejects the old thinking block signatures,
        // we automatically retry without resume to preserve UX continuity.
        if (msg.subtype !== 'success') {
          const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
          // Build a combined error string from all possible error fields
          const errorText = [msg.result, msg.error, msg.content]
            .filter(Boolean)
            .map(String)
            .join(' ');
          const isThinkingSignatureError = /invalid.*signature.*thinking|thinking.*invalid.*signature/i.test(errorText);

          const switchedFlag = meta.providerSwitched || meta.modelSwitched;
          const pendingText = meta.providerSwitchPendingText || meta.modelSwitchPendingText;
          // Find last user message as fallback retry text when no pendingText is set
          const lastUserMsg = !pendingText
            ? [...(useChatStore.getState().getTab(tabId)?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content
            : undefined;
          const retryCandidate = pendingText || (typeof lastUserMsg === 'string' ? lastUserMsg : undefined);
          if (isThinkingSignatureError && retryCandidate) {
            const switchType = switchedFlag ? (meta.modelSwitched ? '模型' : 'API 提供商') : '会话';
            console.warn(`[TOKENICODE] Thinking signature error after ${switchType} switch — auto-retrying without resume`);
            const retryText = retryCandidate;

            // Kill the current (failed) process
            const failedStdinId = meta.stdinId;
            if (failedStdinId) {
              bridge.killSession(failedStdinId).catch(() => {});
              if ((window as any).__claudeUnlisteners?.[failedStdinId]) {
                (window as any).__claudeUnlisteners[failedStdinId]();
                delete (window as any).__claudeUnlisteners[failedStdinId];
              }
            }

            // Clear sessionId (abandon resume) and switch flags
            setSessionMeta({
              sessionId: undefined,
              stdinId: undefined,
              providerSwitched: false,
              providerSwitchPendingText: undefined,
              modelSwitched: false,
              modelSwitchPendingText: undefined,
            });
            // Also clear cliResumeId in sessionStore
            const retryTabId = useSessionStore.getState().selectedSessionId;
            if (retryTabId) useSessionStore.getState().setCliResumeId(retryTabId, null);

            // Show system notice
            addMessage({
              id: generateMessageId(),
              role: 'system',
              type: 'text',
              content: `已切换${switchType}，正在重新发送…`,
              commandType: 'info',
              timestamp: Date.now(),
            });

            // Re-send: spawn a fresh process without resume_session_id
            (async () => {
              // P0-5: Declare retryId outside try so catch can clean up listeners on failure
              const retryId = `desk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              try {
                const cwd = useSettingsStore.getState().workingDirectory;
                if (!cwd) return;
                const selectedModel = useSettingsStore.getState().selectedModel;
                const sessionMode = useSettingsStore.getState().sessionMode;

                const retryTurnStartedAt = Date.now();
                setSessionStatus('running');
                setSessionMeta({
                  turnStartTime: retryTurnStartedAt,
                  lastProgressAt: retryTurnStartedAt,
                  inputTokens: 0,
                  outputTokens: 0,
                });
                setActivityStatus({ phase: 'thinking' });
                agentActions.clearAgents();
                agentActions.upsertAgent({
                  id: 'main', parentId: null,
                  description: retryText.slice(0, 100),
                  phase: 'spawning', startTime: Date.now(), isMain: true,
                });
                const retryUnlisten = await onClaudeStream(retryId, (m: any) => {
                  m.__stdinId = retryId;
                  handleStreamMessage(m);
                });
                const retryUnlistenStderr = await onClaudeStderr(retryId, (line: string) => {
                  handleStderrLineRef.current(line, retryId);
                });
                if (!(window as any).__claudeUnlisteners) (window as any).__claudeUnlisteners = {};
                (window as any).__claudeUnlisteners[retryId] = () => { retryUnlisten(); retryUnlistenStderr(); };
                (window as any).__claudeUnlisten = (window as any).__claudeUnlisteners[retryId];

                const session = await bridge.startSession({
                  prompt: retryText,
                  cwd,
                  model: resolveModelForProvider(selectedModel),
                  session_id: retryId,
                  // No resume_session_id — fresh start to avoid thinking signature issue
                  thinking_level: useSettingsStore.getState().thinkingLevel,
                  session_mode: (sessionMode === 'ask' || sessionMode === 'plan') ? sessionMode : undefined,
                  provider_id: useProviderStore.getState().activeProviderId || undefined,
                  permission_mode: mapSessionModeToPermissionMode(sessionMode),
                });

                setSessionMeta({ sessionId: session.stdin_id, stdinId: retryId, envFingerprint: envFingerprint(), spawnedModel: resolveModelForProvider(selectedModel) });
                const tabId = useSessionStore.getState().selectedSessionId;
                if (tabId) {
                  useSessionStore.getState().registerStdinTab(retryId, tabId);
                  if (session.cli_session_id) {
                    useSessionStore.getState().setCliResumeId(tabId, session.cli_session_id);
                  }
                }
                if (session.cli_session_id) bridge.trackSession(session.cli_session_id).catch(() => {});
              } catch (retryErr) {
                console.error('[TOKENICODE] Provider-switch auto-retry failed:', retryErr);
                // P0-5: Clean up the retry listeners on failure
                if ((window as any).__claudeUnlisteners?.[retryId]) {
                  (window as any).__claudeUnlisteners[retryId]();
                  delete (window as any).__claudeUnlisteners[retryId];
                }
                setSessionStatus('error');
                addMessage({
                  id: generateMessageId(),
                  role: 'system', type: 'text',
                  content: `重试失败: ${retryErr}`,
                  timestamp: Date.now(),
                });
              }
            })();
            break; // Exit the result case — retry flow takes over
          }
        }

        // Code mode: Auto-restart when ExitPlanMode caused CLI exit.
        // In stream-json mode, ExitPlanMode is treated as a permission denial,
        // causing the CLI to exit. Silently restart with --resume to continue.
        if (exitPlanModeSeenRef.current && getEffectiveMode(useChatStore.getState().getTab(tabId)?.sessionMeta) === 'code'
            && msg.subtype !== 'success') {
          exitPlanModeSeenRef.current = false;
          console.log('[TOKENICODE] Code mode ExitPlanMode exit detected — auto-restarting with --resume');
          // Clean up dead process
          const oldStdinId = useChatStore.getState().getTab(tabId)?.sessionMeta.stdinId;
          if (oldStdinId) {
            useChatStore.getState().setSessionMeta(tabId, { stdinId: undefined });
            bridge.killSession(oldStdinId).catch(() => {});
            if ((window as any).__claudeUnlisteners?.[oldStdinId]) {
              (window as any).__claudeUnlisteners[oldStdinId]();
              delete (window as any).__claudeUnlisteners[oldStdinId];
            }
          }
          // Silently restart — no user message bubble
          silentRestartRef.current = true;
          setInputSync('Continue.');
          useChatStore.getState().setActivityStatus(tabId, { phase: 'thinking' });
          requestAnimationFrame(() => handleSubmitRef.current());
          break;
        }
        exitPlanModeSeenRef.current = false;

        // Mark pending processing card (CLI slash command) as completed
        const pendingCmdMsgId = useChatStore.getState().getTab(tabId)?.sessionMeta.pendingCommandMsgId;
        if (pendingCmdMsgId) {
          const resultOutput = typeof msg.result === 'string' ? msg.result : '';
          useChatStore.getState().updateMessage(tabId, pendingCmdMsgId, {
            commandCompleted: true,
            commandData: {
              ...(useChatStore.getState().getTab(tabId)?.messages ?? []).find((m) => m.id === pendingCmdMsgId)?.commandData,
              output: resultOutput,
              completedAt: Date.now(),
            },
          });
          useChatStore.getState().setSessionMeta(tabId, { pendingCommandMsgId: undefined });
        }

        // Extract result text for display (e.g., slash command output)
        let resultDisplayText = '';
        if (typeof msg.result === 'string' && msg.result) {
          resultDisplayText = msg.result;
        } else if (typeof msg.content === 'string' && msg.content) {
          resultDisplayText = msg.content;
        }

        // If we have cost metadata AND a pending slash command (e.g., /compact, /cost),
        // inject cost summary into the processing card instead of creating a separate message.
        if (msg.total_cost_usd != null && pendingCmdMsgId) {
          const cost = msg.total_cost_usd?.toFixed(4) ?? '—';
          const duration = msg.duration_ms
            ? `${(msg.duration_ms / 1000).toFixed(1)}s`
            : '—';
          const turns = msg.num_turns ?? '—';
          const input = msg.usage?.input_tokens
            ? msg.usage.input_tokens.toLocaleString()
            : '';
          const output = msg.usage?.output_tokens
            ? msg.usage.output_tokens.toLocaleString()
            : '';
          const cmdMsg = (useChatStore.getState().getTab(tabId)?.messages ?? []).find((m) => m.id === pendingCmdMsgId);
          if (cmdMsg) {
            useChatStore.getState().updateMessage(tabId, pendingCmdMsgId, {
              commandData: {
                ...cmdMsg.commandData,
                costSummary: { cost, duration, turns, input, output },
              },
            });
          }
          // If there's also explicit result text, still add it as a message
          if (!resultDisplayText) resultDisplayText = '';
        }

        // Only add result text if it wasn't already delivered via an
        // 'assistant' event (which is the normal case for stream-json output)
        // AND there's no pending command card (which already displays the output).
        if (resultDisplayText && !pendingCmdMsgId) {
          const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);
          const isDuplicate = currentMessages.some(
            (m) => m.role === 'assistant' && m.type === 'text'
              && m.content === resultDisplayText,
          );
          if (!isDuplicate) {
            addMessage({
              id: msg.uuid || generateMessageId(),
              role: 'assistant',
              type: 'text',
              content: resultDisplayText,
              subAgentDepth: agentDepth,
              timestamp: Date.now(),
            });
          }
        }

        setSessionStatus(
          msg.subtype === 'success' ? 'completed' : 'error'
        );
        {
          // Correct cumulative totals for any drift between streaming
          // accumulation and the authoritative result values.
          const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
          const resultInput = msg.usage?.input_tokens || 0;
          const resultOutput = msg.usage?.output_tokens || 0;
          const streamedInput = meta.inputTokens || 0;
          const streamedOutput = meta.outputTokens || 0;
          setSessionMeta({
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
            turns: msg.num_turns,
            inputTokens: resultInput,
            outputTokens: resultOutput,
            totalInputTokens: (meta.totalInputTokens || 0) + (resultInput - streamedInput),
            totalOutputTokens: (meta.totalOutputTokens || 0) + (resultOutput - streamedOutput),
            turnStartTime: undefined,
            lastProgressAt: undefined,
          });
        }
        agentActions.completeAll(
          msg.subtype === 'success' ? 'completed' : 'error'
        );
        useSessionStore.getState().fetchSessions();
        setTimeout(() => useSessionStore.getState().fetchSessions(), 1000);

        // --- AI Title Generation (TK-001): on 3rd successful turn, generate a title ---
        if (msg.subtype === 'success') {
          const sessionId = useChatStore.getState().getTab(tabId)?.sessionMeta.sessionId;
          if (sessionId) {
            const customPreviews = useSessionStore.getState().customPreviews;
            if (!customPreviews[sessionId]) {
              const currentMessages = (useChatStore.getState().getTab(tabId)?.messages ?? []);
              const userTextMsgs = currentMessages.filter(
                (m) => m.role === 'user' && m.type === 'text' && m.content,
              );
              if (userTextMsgs.length >= 3) {
                const assistantTextMsgs = currentMessages.filter(
                  (m) => m.role === 'assistant' && m.type === 'text' && m.content,
                );
                if (assistantTextMsgs.length >= 3) {
                  const userMsg = userTextMsgs.map((m) => m.content).join('\n').slice(0, 500);
                  const assistantMsg = assistantTextMsgs.map((m) => m.content).join('\n').slice(0, 500);
                  bridge.generateSessionTitle(userMsg, assistantMsg, useProviderStore.getState().activeProviderId || undefined)
                    .then((title) => {
                      if (title) {
                        useSessionStore.getState().setCustomPreview(sessionId, title);
                      }
                    })
                    .catch((e) => {
                      if (!String(e).includes('SKIP:')) console.warn('Title gen failed:', e);
                    });
                }
              }
            }
          }
        }

        // --- Auto-compact: when input tokens exceed 160K (80% of 200K context),
        // automatically send /compact to prevent context overflow on the next turn.
        // Fires at most once per session to avoid infinite loops.
        const resultInputTokens = msg.usage?.input_tokens || 0;
        const compactStdinId = useChatStore.getState().getTab(tabId)?.sessionMeta.stdinId;
        if (resultInputTokens > 160_000 && !autoCompactFiredRef.current && compactStdinId && msg.subtype === 'success') {
          autoCompactFiredRef.current = true;
          console.log('[TOKENICODE] Auto-compact triggered: inputTokens =', resultInputTokens);
          const compactMsgId = generateMessageId();
          addMessage({
            id: compactMsgId,
            role: 'system',
            type: 'text',
            content: t('chat.autoCompacting'),
            commandType: 'processing',
            commandData: { command: '/compact' },
            commandStartTime: Date.now(),
            commandCompleted: false,
            timestamp: Date.now(),
          });
          // FI-4: Register pendingCommandMsgId so result handler can mark it completed
          setSessionMeta({ pendingCommandMsgId: compactMsgId });
          setSessionStatus('running');
          setActivityStatus({ phase: 'thinking' });
          bridge.sendStdin(compactStdinId, '/compact').catch((err) => {
            console.error('[TOKENICODE] Auto-compact failed:', err);
          });
          // FI-4: Timeout fallback — if compact doesn't complete within 90s, auto-complete
          setTimeout(() => {
            const meta = useChatStore.getState().getTab(tabId)?.sessionMeta ?? {};
            if (meta.pendingCommandMsgId === compactMsgId) {
              useChatStore.getState().updateMessage(tabId, compactMsgId, {
                commandCompleted: true,
                commandData: {
                  ...(useChatStore.getState().getTab(tabId)?.messages ?? []).find((m) => m.id === compactMsgId)?.commandData,
                  output: 'Compact timed out',
                  completedAt: Date.now(),
                },
              });
              useChatStore.getState().setSessionMeta(tabId, { pendingCommandMsgId: undefined });
              if (useChatStore.getState().getTab(tabId)?.sessionStatus === 'running') {
                useChatStore.getState().setSessionStatus(tabId, 'idle');
              }
            }
          }, 15_000); // Bug C fix (#27): reduced from 90s to 15s
          break; // Skip pending message flush — compact takes priority
        }

        // BATCH drain: combine ALL pending messages into a single user turn
        // and send at once. The user's mental model is "I'm adding more
        // context to the current task" — sending them one-by-one would
        // make the AI handle each separately, which is rarely what the
        // user wants. Combine them so the AI processes everything in one go.
        {
          const drainTab = useChatStore.getState().getTab(tabId);
          const allPending = drainTab?.pendingUserMessages ?? [];
          const flushStdinId = drainTab?.sessionMeta.stdinId;
          if (allPending.length > 0 && flushStdinId) {
            const nextMsg = allPending.join('\n\n');
            useChatStore.getState().clearPendingMessages(tabId);

            // Add as a single user message — InputBar deliberately did NOT
            // addMessage when enqueueing, because ChatPanel renders pending
            // messages after the streaming bubble. Now they merge into one turn.
            addMessage({
              id: generateMessageId(),
              role: 'user',
              type: 'text',
              content: nextMsg,
              timestamp: Date.now(),
            });
            const nextTurnStartedAt = Date.now();
            setSessionStatus('running');
            setSessionMeta({
              turnStartTime: nextTurnStartedAt,
              lastProgressAt: nextTurnStartedAt,
              inputTokens: 0,
              outputTokens: 0,
            });
            setActivityStatus({ phase: 'thinking' });
            agentActions.clearAgents();
            agentActions.upsertAgent({
              id: 'main',
              parentId: null,
              description: nextMsg.slice(0, 100),
              phase: 'spawning',
              startTime: Date.now(),
              isMain: true,
            });
            bridge.sendStdin(flushStdinId, nextMsg).catch((err) => {
              console.error('[TC] Failed to send pending messages:', err);
              const draft = useChatStore.getState().getTab(tabId)?.inputDraft ?? '';
              useChatStore.getState().setInputDraft(tabId, draft ? `${draft}\n\n${nextMsg}` : nextMsg);
              setSessionStatus('error');
            });
          }
        }

        break;
      }

      case 'rate_limit_event': {
        const rli = msg.rate_limit_info;
        if (rli && rli.rateLimitType) {
          const prev = useChatStore.getState().getTab(tabId)?.sessionMeta.rateLimits || {};
          setSessionMeta({
            rateLimits: {
              ...prev,
              [rli.rateLimitType]: {
                rateLimitType: rli.rateLimitType,
                resetsAt: rli.resetsAt,
                isUsingOverage: rli.isUsingOverage,
                overageStatus: rli.overageStatus,
                overageDisabledReason: rli.overageDisabledReason,
              },
            },
          });
        }
        break;
      }

      case 'process_exit': {
        // STEP 1: Force-flush the per-stdinId rAF stream buffer into
        // chatStore.partialText / partialThinking BEFORE reading them.
        // Otherwise the last few text_delta tokens that arrived just
        // before Stop was pressed will still be sitting in the in-memory
        // buffer (rAF scheduled, not yet committed to store) and we'd
        // miss them.
        flushStreamBuffer(msg.__stdinId);

        // STEP 2: Flush any mid-stream content to final messages so it
        // survives the Stop button / kill_session path.
        {
          const exitTabData = useChatStore.getState().getTab(tabId);
          const pThinking = exitTabData?.partialThinking ?? '';
          const pText = exitTabData?.partialText ?? '';
          console.log('[TOKENICODE:session] process_exit flush check', {
            stdinId: msg.__stdinId,
            hasText: pText.length > 0,
            hasThinking: pThinking.length > 0,
            textPreview: pText.slice(0, 40),
          });
          if (pThinking.trim().length > 0) {
            addMessage({
              id: generateInterruptedId('thinking'),
              role: 'assistant',
              type: 'thinking',
              content: pThinking,
              timestamp: Date.now(),
            });
          }
          if (pText.trim().length > 0) {
            addMessage({
              id: generateInterruptedId('text'),
              role: 'assistant',
              type: 'text',
              content: pText,
              timestamp: Date.now(),
            });
          }
        }

        // The CLI process has exited — clear the stdin handle but keep sessionId for resume
        clearPartial();
        console.log('[TOKENICODE:session] process_exit received', { stdinId: msg.__stdinId });

        // Bug C fix (#27): Clear stuck pendingCommandMsgId (e.g., /compact without result)
        const exitPendingCmd = useChatStore.getState().getTab(tabId)?.sessionMeta.pendingCommandMsgId;
        if (exitPendingCmd) {
          useChatStore.getState().updateMessage(tabId, exitPendingCmd, { commandCompleted: true });
          useChatStore.getState().setSessionMeta(tabId, { pendingCommandMsgId: undefined });
        }

        // If the session was running and no assistant messages were received,
        // the process failed at startup. Show the last stderr error to the user.
        const exitTabData = useChatStore.getState().getTab(tabId);
        const exitStatus = exitTabData?.sessionStatus;
        const exitMsgs = exitTabData?.messages ?? [];
        if (exitStatus === 'running') {
          const hasAssistantReply = exitMsgs.some(
            (m: ChatMessage) => m.role === 'assistant' && (m.type === 'text' || m.type === 'tool_use'),
          );
          if (!hasAssistantReply) {
            if (lastStderrRef.current) {
              // Detect macOS TCC permission errors and provide actionable guidance
              const stderr = lastStderrRef.current;
              const isTccError = /unexpected|operation not permitted|permission denied/i.test(stderr);
              const cwd = useSettingsStore.getState().workingDirectory || '';
              const isProtectedDir = /\/(Desktop|Downloads|Documents)\//i.test(cwd);
              const hint = isTccError && isProtectedDir
                ? '\n\n此目录可能受 macOS 隐私保护限制。请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中授权，或选择其他目录。'
                : '';
              addMessage({
                id: generateMessageId(),
                role: 'system',
                type: 'text',
                content: formatErrorForUser(`CLI error: ${stderr}${hint}`),
                timestamp: Date.now(),
              });
            } else {
              // No stderr captured — CLI exited silently. Show a generic error
              // so the user knows something went wrong (previously this was silent).
              addMessage({
                id: generateMessageId(),
                role: 'system',
                type: 'text',
                content: t('error.cliExitedSilently'),
                timestamp: Date.now(),
              });
            }
          }
        }

        // P0-5: Clean up Tauri event listeners for this session to prevent leaks
        const exitingStdinId = msg.__stdinId || useChatStore.getState().getTab(tabId)?.sessionMeta.stdinId;
        if (exitingStdinId && (window as any).__claudeUnlisteners?.[exitingStdinId]) {
          (window as any).__claudeUnlisteners[exitingStdinId]();
          delete (window as any).__claudeUnlisteners[exitingStdinId];
        }
        if ((window as any).__claudeUnlisten) {
          (window as any).__claudeUnlisten = null;
        }

        {
          const exitMessages = useChatStore.getState().getTab(tabId)?.messages ?? [];
          for (const m of exitMessages) {
            if (['permission', 'question', 'plan_review'].includes(m.type) && !m.resolved) {
              useChatStore.getState().updateMessage(tabId, m.id, {
                interactionState: 'failed',
                interactionError: 'CLI process exited',
              });
            }
          }
        }

        setSessionStatus('idle');
        if (!document.hasFocus() && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('TOKENICODE', { body: t('notification.chatComplete') });
          } else if (Notification.permission === 'default') {
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') {
                new Notification('TOKENICODE', { body: t('notification.chatComplete') });
              }
            }).catch(() => {});
          }
        }

        setSessionMeta({ stdinId: undefined, lastProgressAt: undefined });
        // Clean up stdinId → tabId mapping to prevent memory leak
        if (exitingStdinId) {
          useSessionStore.getState().unregisterStdinTab(exitingStdinId);
        }
        // Bug B fix (#28): Don't discard pending messages — restore to input draft
        const remainingPending = useChatStore.getState().getTab(tabId)?.pendingUserMessages ?? [];
        if (remainingPending.length > 0) {
          const draft = useChatStore.getState().getTab(tabId)?.inputDraft ?? '';
          const pendingText = remainingPending.join('\n\n');
          useChatStore.getState().setInputDraft(tabId,
            draft ? `${draft}\n\n${pendingText}` : pendingText
          );
          useChatStore.getState().clearPendingMessages(tabId);
        }

        agentActions.completeAll();
        useSessionStore.getState().fetchSessions();
        break;
      }

      default:
        // Fallback: handle content_block_delta at top level (without stream_event wrapper)
        if (msg.type === 'content_block_delta') {
          const text = msg.delta?.text || '';
          if (text && msgStdinId) {
            streamController.appendText(msgStdinId, text);
          }
        }
        break;
    }

    } catch (err) {
      // P1-4: catch-all for unexpected errors in stream message processing
      console.error('[TOKENICODE] handleStreamMessage error:', err, 'msg:', msg?.type, msg?.subtype);
      const errTabId = useSessionStore.getState().selectedSessionId;
      if (errTabId) {
        useChatStore.getState().addMessage(errTabId, {
          id: generateMessageId(),
          role: 'system',
          type: 'text',
          content: formatErrorForUser(`Internal error processing stream message: ${err}`),
          timestamp: Date.now(),
        });
      }
    }
  }, [handleBackgroundStreamMessage, exitPlanModeSeenRef, autoCompactFiredRef, silentRestartRef, handleSubmitRef, handleStderrLineRef, setInputSync]);

  return { handleStreamMessage, handleBackgroundStreamMessage };
}
