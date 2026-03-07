import { useCallback, type MutableRefObject } from 'react';
import { useChatStore, generateMessageId, type ChatMessage } from '../stores/chatStore';
import { useSettingsStore, mapSessionModeToPermissionMode } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useAgentStore, resolveAgentId, getAgentDepth } from '../stores/agentStore';
import { bridge, onClaudeStream, onClaudeStderr } from '../lib/tauri-bridge';
import { envFingerprint, resolveModelForProvider } from '../lib/api-provider';
import { useProviderStore } from '../stores/providerStore';

// --- Streaming text buffer (rAF-throttled, per-stdinId) ---
// Coalesces rapid text_delta / thinking_delta events into a single state update
// per animation frame (~60/s), preventing JS main thread starvation from
// excessive React re-renders when the message list is large.
// TK-329 fix: each session gets its own buffer to prevent cross-contamination
// when multiple sessions stream concurrently.
interface _StreamBuffer {
  text: string;
  thinking: string;
  raf: number;
}
const _streamBuffers = new Map<string, _StreamBuffer>();

function _getBuffer(stdinId: string): _StreamBuffer {
  let buf = _streamBuffers.get(stdinId);
  if (!buf) {
    buf = { text: '', thinking: '', raf: 0 };
    _streamBuffers.set(stdinId, buf);
  }
  return buf;
}

function _scheduleStreamFlush(stdinId: string) {
  const buf = _getBuffer(stdinId);
  if (buf.raf) return;
  buf.raf = requestAnimationFrame(() => {
    buf.raf = 0;

    // Check if the buffer's owner session is still the active foreground tab.
    // If the user switched tabs between buffer accumulation and rAF flush,
    // route the buffered text to the background cache instead.
    const ownerTab = useSessionStore.getState().getTabForStdin(stdinId);
    const activeTab = useSessionStore.getState().selectedSessionId;
    const isStale = ownerTab && ownerTab !== activeTab;

    if (isStale) {
      // Route to background cache
      if (buf.text && ownerTab) {
        useChatStore.getState().updatePartialInCache(ownerTab, buf.text);
      }
      buf.text = '';
      buf.thinking = '';
      return;
    }

    const { updatePartialMessage, updatePartialThinking } = useChatStore.getState();
    if (buf.text) {
      updatePartialMessage(buf.text);
      buf.text = '';
    }
    if (buf.thinking) {
      updatePartialThinking(buf.thinking);
      buf.thinking = '';
    }
  });
}

/** Flush any buffered streaming text immediately (call before clearPartial).
 *  If stdinId is provided, flush only that session's buffer.
 *  If omitted, flush ALL buffers (backward compat). */
export function flushStreamBuffer(stdinId?: string) {
  const ids = stdinId ? [stdinId] : Array.from(_streamBuffers.keys());
  const activeTab = useSessionStore.getState().selectedSessionId;

  for (const id of ids) {
    const buf = _streamBuffers.get(id);
    if (!buf) continue;

    if (buf.raf) {
      cancelAnimationFrame(buf.raf);
      buf.raf = 0;
    }
    if (!buf.text && !buf.thinking) continue;

    const ownerTab = useSessionStore.getState().getTabForStdin(id);
    if (ownerTab && ownerTab !== activeTab) {
      if (buf.text) {
        useChatStore.getState().updatePartialInCache(ownerTab, buf.text);
      }
      buf.text = '';
      buf.thinking = '';
      continue;
    }
    if (buf.text) {
      useChatStore.getState().updatePartialMessage(buf.text);
      buf.text = '';
    }
    if (buf.thinking) {
      useChatStore.getState().updatePartialThinking(buf.thinking);
      buf.thinking = '';
    }
  }

  // Clean up empty buffers
  if (!stdinId) {
    _streamBuffers.clear();
  } else {
    _streamBuffers.delete(stdinId);
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
    const cache = useChatStore.getState();

    switch (msg.type) {
      case 'tokenicode_permission_request': {
        // ExitPlanMode: auto-approve in non-plan modes; add plan_review card in plan mode
        if (msg.tool_name === 'ExitPlanMode') {
          if (useSettingsStore.getState().sessionMode !== 'plan') {
            const stdinId = msg.__stdinId;
            if (stdinId) {
              bridge.respondPermission(stdinId, msg.request_id, true, undefined, msg.tool_use_id, msg.input);
            }
            return;
          }
          const bgSnapshot = cache.sessionCache.get(tabId);
          const bgExisting = bgSnapshot?.messages.find((m) => m.id === 'plan_review_current' && !m.resolved);
          if (!bgExisting) {
            let bgPlanContent = '';
            if (bgSnapshot) {
              for (let i = bgSnapshot.messages.length - 1; i >= 0; i--) {
                if (bgSnapshot.messages[i].role === 'assistant' && bgSnapshot.messages[i].type === 'text' && bgSnapshot.messages[i].content) {
                  bgPlanContent = bgSnapshot.messages[i].content;
                  break;
                }
              }
            }
            cache.addMessageToCache(tabId, {
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
            cache.updateMessageInCache(tabId, 'plan_review_current', {
              permissionData: {
                requestId: msg.request_id,
                toolName: msg.tool_name,
                input: msg.input,
                toolUseId: msg.tool_use_id,
              },
            });
          }
          cache.setActivityInCache(tabId, { phase: 'awaiting' });
          return;
        }
        // AskUserQuestion: add question card to cache
        if (msg.tool_name === 'AskUserQuestion') {
          const bgSnapshot = cache.sessionCache.get(tabId);
          const questionId = msg.tool_use_id || 'ask_question_current';
          const existing = bgSnapshot?.messages.find((m) => m.id === questionId && m.type === 'question')
            || bgSnapshot?.messages.find((m) => m.type === 'question' && !m.resolved && m.toolName === 'AskUserQuestion');
          if (existing) {
            cache.updateMessageInCache(tabId, existing.id, {
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
          cache.addMessageToCache(tabId, {
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
          cache.setActivityInCache(tabId, { phase: 'awaiting' });
          return;
        }
        // Regular permission: add permission card to cache
        const bgSnapshot = cache.sessionCache.get(tabId);
        const existingPerm = bgSnapshot?.messages.find(
          (m) => m.type === 'permission'
            && m.permissionData?.requestId === msg.request_id
            && m.interactionState !== 'failed'
        );
        if (existingPerm) return;
        cache.addMessageToCache(tabId, {
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
        cache.setActivityInCache(tabId, { phase: 'awaiting' });
        break;
      }
      case 'stream_event': {
        const evt = msg.event;
        if (!evt) break;
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text) cache.updatePartialInCache(tabId, text);
        }
        // Early detection: create plan_review card for background tab (Plan mode only).
        // Bypass auto-approves via Rust backend — no UI card needed.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode'
            && useSettingsStore.getState().sessionMode === 'plan') {
          const bgSnapshot = cache.sessionCache.get(tabId);
          const bgExisting = bgSnapshot?.messages.find((m) => m.id === 'plan_review_current');
          if (!bgExisting || !bgExisting.resolved) {
            let bgPlanContent = '';
            if (bgSnapshot) {
              for (let i = bgSnapshot.messages.length - 1; i >= 0; i--) {
                const m = bgSnapshot.messages[i];
                if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                  bgPlanContent = m.toolInput.content;
                  break;
                }
              }
            }
            cache.addMessageToCache(tabId, {
              id: 'plan_review_current',
              role: 'assistant', type: 'plan_review',
              content: bgPlanContent, planContent: bgPlanContent,
              resolved: false, timestamp: Date.now(),
            });
            cache.setActivityInCache(tabId, { phase: 'awaiting' });
          }
        }
        // Track tokens in background sessions (per-turn + cumulative total)
        if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
          const snapshot = cache.sessionCache.get(tabId);
          const delta = evt.message.usage.input_tokens;
          cache.setMetaInCache(tabId, {
            inputTokens: (snapshot?.sessionMeta.inputTokens || 0) + delta,
            totalInputTokens: (snapshot?.sessionMeta.totalInputTokens || 0) + delta,
          });
        }
        if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
          const snapshot = cache.sessionCache.get(tabId);
          const delta = evt.usage.output_tokens;
          cache.setMetaInCache(tabId, {
            outputTokens: (snapshot?.sessionMeta.outputTokens || 0) + delta,
            totalOutputTokens: (snapshot?.sessionMeta.totalOutputTokens || 0) + delta,
          });
        }
        break;
      }
      case 'assistant': {
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;
        // Selectively clear partial in cache — only wipe partialText if a text
        // block is present (which supersedes streaming text). Otherwise, preserve
        // it to avoid intermediate thinking-only messages destroying streaming text.
        const bgHasTextBlock = content.some((b: any) => b.type === 'text' && b.text);
        const snapshot = cache.sessionCache.get(tabId);
        if (snapshot) {
          const next = new Map(cache.sessionCache);
          if (bgHasTextBlock) {
            next.set(tabId, { ...snapshot, partialText: '', partialThinking: '', isStreaming: false });
          } else if (snapshot.partialThinking) {
            next.set(tabId, { ...snapshot, partialThinking: '' });
          }
          useChatStore.setState({ sessionCache: next });
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
            cache.addMessageToCache(tabId, {
              id: textId,
              role: 'assistant', type: 'text',
              content: block.text, timestamp: Date.now(),
            });
          } else if (block.type === 'tool_use') {
            // Code mode: suppress EnterPlanMode/ExitPlanMode (transparent to user)
            if (useSettingsStore.getState().sessionMode === 'code'
                && (block.name === 'EnterPlanMode' || block.name === 'ExitPlanMode')) {
              if (block.name === 'ExitPlanMode') exitPlanModeSeenRef.current = true;
              continue;
            }
            if (block.name === 'AskUserQuestion') {
              const questions = block.input?.questions;
              const bgQuestionId = block.id || generateMessageId();
              // Guard: skip if question already exists in background cache (resolved or not)
              const bgSnap = cache.sessionCache.get(tabId);
              const bgExisting = bgSnap?.messages.find(
                (m) => m.id === bgQuestionId && m.type === 'question',
              );
              if (bgExisting) break;

              cache.addMessageToCache(tabId, {
                id: bgQuestionId,
                role: 'assistant', type: 'question',
                content: '', toolName: block.name,
                toolInput: block.input,
                questions: Array.isArray(questions) ? questions : [],
                resolved: false, timestamp: Date.now(),
              });
            } else if (block.name === 'TodoWrite' && block.input?.todos) {
              cache.addMessageToCache(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'todo',
                content: '', toolName: block.name,
                toolInput: block.input,
                todoItems: block.input.todos,
                timestamp: Date.now(),
              });
            } else if (block.name === 'ExitPlanMode') {
              // Show as regular tool_use in plan/bypass modes
              cache.addMessageToCache(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'tool_use',
                content: '', toolName: block.name,
                toolInput: block.input, timestamp: Date.now(),
              });
              // Only create plan_review card in Plan mode.
              // Bypass auto-approves via Rust backend — no UI card needed.
              if (useSettingsStore.getState().sessionMode === 'plan') {
                const bgSnapshot = cache.sessionCache.get(tabId);
                let bgPlanContent = '';
                if (bgSnapshot) {
                  for (let i = bgSnapshot.messages.length - 1; i >= 0; i--) {
                    const m = bgSnapshot.messages[i];
                    if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                      bgPlanContent = m.toolInput.content;
                      break;
                    }
                  }
                }
                const bgToolExists = block.id && bgSnapshot?.messages.some(
                  (m) => m.id === block.id && m.toolName === 'ExitPlanMode',
                );
                const bgResolvedReview = bgSnapshot?.messages.find(
                  (m) => m.type === 'plan_review' && m.resolved,
                );
                if (!(bgToolExists && bgResolvedReview)) {
                  cache.addMessageToCache(tabId, {
                    id: 'plan_review_current',
                    role: 'assistant', type: 'plan_review',
                    content: bgPlanContent, planContent: bgPlanContent,
                    resolved: false, timestamp: Date.now(),
                  });
                  cache.setActivityInCache(tabId, { phase: 'awaiting' });
                }
              }
            } else {
              cache.addMessageToCache(tabId, {
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
                cache.updateMessageInCache(tabId, block.tool_use_id, { toolResultContent: resultText });
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
          // Backfill AskUserQuestion type/questions in background cache
          const snapshot = cache.sessionCache.get(tabId);
          const parentMsg = snapshot?.messages.find((m) => m.id === msg.tool_use_id);
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
          cache.updateMessageInCache(tabId, msg.tool_use_id, bgUpdates);
        }
        break;
      }
      case 'result': {
        cache.setStatusInCache(tabId, msg.subtype === 'success' ? 'completed' : 'error');
        {
          const snapshot = cache.sessionCache.get(tabId);
          const prevMeta = snapshot?.sessionMeta;
          const resultInput = msg.usage?.input_tokens || 0;
          const resultOutput = msg.usage?.output_tokens || 0;
          const streamedInput = prevMeta?.inputTokens || 0;
          const streamedOutput = prevMeta?.outputTokens || 0;
          cache.setMetaInCache(tabId, {
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
            turns: msg.num_turns,
            inputTokens: resultInput,
            outputTokens: resultOutput,
            totalInputTokens: (prevMeta?.totalInputTokens || 0) + (resultInput - streamedInput),
            totalOutputTokens: (prevMeta?.totalOutputTokens || 0) + (resultOutput - streamedOutput),
            turnStartTime: undefined,
          });
        }
        if (typeof msg.result === 'string' && msg.result) {
          // Only add if not already delivered via 'assistant' event
          const bgSnapshot = cache.sessionCache.get(tabId);
          const bgIsDuplicate = bgSnapshot?.messages.some(
            (m) => m.role === 'assistant' && m.type === 'text'
              && m.content === msg.result,
          );
          if (!bgIsDuplicate) {
            cache.addMessageToCache(tabId, {
              id: msg.uuid || generateMessageId(),
              role: 'assistant', type: 'text',
              content: msg.result, timestamp: Date.now(),
            });
          }
        }
        useSessionStore.getState().fetchSessions();

        // AI Title Generation for background tabs (same 3rd-turn logic)
        if (msg.subtype === 'success') {
          const customPreviews = useSessionStore.getState().customPreviews;
          if (!customPreviews[tabId]) {
            const bgSnap = cache.sessionCache.get(tabId);
            const bgUserMsgs = bgSnap?.messages.filter(
              (m) => m.role === 'user' && m.type === 'text' && m.content,
            ) || [];
            const bgAssistantMsgs = bgSnap?.messages.filter(
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
      case 'process_exit': {
        // P0-5: Clean up Tauri event listeners for background tab.
        // __claudeUnlisteners is keyed by stdinId (desk_xxx), NOT tabId (session uuid).
        // Use msg.__stdinId (tagged by the listener closure) to find the correct entry.
        const bgStdinId = msg.__stdinId;
        if (bgStdinId && (window as any).__claudeUnlisteners?.[bgStdinId]) {
          (window as any).__claudeUnlisteners[bgStdinId]();
          delete (window as any).__claudeUnlisteners[bgStdinId];
        }
        cache.setStatusInCache(tabId, 'idle');
        cache.setMetaInCache(tabId, { stdinId: undefined });
        useSessionStore.getState().fetchSessions();
        break;
      }
      case 'system':
        if (msg.subtype === 'init') {
          cache.setMetaInCache(tabId, { model: msg.model });
        } else if (msg.subtype === 'error') {
          // FI-3: Surface system errors in background tabs too
          cache.addMessageToCache(tabId, {
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: msg.message || msg.error || 'System error',
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
      'content_block_delta',
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

    // --- SDK Permission Request (routed through stream channel for reliability) ---
    if (msg.type === 'tokenicode_permission_request') {

      // ExitPlanMode: only show PlanReviewCard in Plan mode.
      // In other modes, auto-approve so the CLI continues without blocking.
      if (msg.tool_name === 'ExitPlanMode') {
        if (useSettingsStore.getState().sessionMode !== 'plan') {
          // Auto-approve: CLI doesn't need user confirmation outside Plan mode
          const stdinId = useChatStore.getState().sessionMeta.stdinId;
          if (stdinId) {
            bridge.respondPermission(stdinId, msg.request_id, true, undefined, msg.tool_use_id, msg.input);
          }
          return;
        }
        const { messages, updateMessage, addMessage, setActivityStatus } = useChatStore.getState();
        const permData = {
          requestId: msg.request_id,
          toolName: msg.tool_name,
          input: msg.input,
          description: msg.description,
          toolUseId: msg.tool_use_id,
        };
        const planReview = messages.find((m) => m.id === 'plan_review_current' && !m.resolved);
        if (planReview) {
          updateMessage('plan_review_current', { permissionData: permData });
        } else {
          // PlanReviewCard not yet created — create one with permission data
          let planContent = '';
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].type === 'text' && messages[i].content) {
              planContent = messages[i].content;
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
            permissionData: permData,
            timestamp: Date.now(),
          });
          setActivityStatus({ phase: 'awaiting' });
        }
        return;
      }

      // AskUserQuestion: create QuestionCard instead of PermissionCard.
      // User answers are sent back via respondPermission(updatedInput) — NOT sendStdin.
      if (msg.tool_name === 'AskUserQuestion') {
        const { messages, addMessage, updateMessage, setActivityStatus } = useChatStore.getState();
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
          updateMessage(existing.id, {
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
        addMessage({
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
        setActivityStatus({ phase: 'awaiting' });
        return;
      }

      // Dedup: skip if we already have a non-failed PermissionCard for this request_id
      const { messages, addMessage, setActivityStatus } = useChatStore.getState();
      const existingPerm = messages.find(
        (m) => m.type === 'permission'
          && m.permissionData?.requestId === msg.request_id
          && m.interactionState !== 'failed'
      );
      if (existingPerm) {
        return;
      }
      addMessage({
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
      setActivityStatus({ phase: 'awaiting' });
      return;
    }

    const { addMessage,
      setSessionStatus, setSessionMeta, setActivityStatus } = useChatStore.getState();
    const agentActions = useAgentStore.getState();
    const agentId = resolveAgentId(msg.parent_tool_use_id, agentActions.agents);
    const agentDepth = getAgentDepth(agentId, agentActions.agents);

    // Capture the CLI's own session ID from stream events (used for --resume)
    const cliSessionId = msg.session_id || msg.sessionId;
    if (cliSessionId) {
      const currentId = useChatStore.getState().sessionMeta.sessionId;
      if (currentId !== cliSessionId) {
        setSessionMeta({ sessionId: cliSessionId });
        bridge.trackSession(cliSessionId).catch(() => {});

        // Promote draft tab to real session ID so it merges with disk session
        const currentTabId = useSessionStore.getState().selectedSessionId;
        if (currentTabId && currentTabId.startsWith('draft_')) {
          // Migrate cache under old draft key to new real key
          const chatState = useChatStore.getState();
          if (chatState.sessionCache.has(currentTabId)) {
            const snapshot = chatState.sessionCache.get(currentTabId)!;
            const next = new Map(chatState.sessionCache);
            next.set(cliSessionId, snapshot);
            next.delete(currentTabId);
            useChatStore.setState({ sessionCache: next });
          }
          useSessionStore.getState().promoteDraft(currentTabId, cliSessionId);
        }

        useSessionStore.getState().fetchSessions();
      }
    }

    // Helper: clear accumulated partial text (it will be replaced by the full message)
    const clearPartial = () => {
      // Flush any buffered text so the final tokens aren't lost
      flushStreamBuffer();
      const store = useChatStore.getState();
      if (store.isStreaming || store.partialText || store.partialThinking) {
        useChatStore.setState({ partialText: '', partialThinking: '', isStreaming: false });
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
        }

        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text && msgStdinId) {
            // Buffer text and flush via rAF to avoid excessive re-renders
            // TK-329: per-stdinId buffer prevents cross-session contamination
            const buf = _getBuffer(msgStdinId);
            buf.text += text;
            _scheduleStreamFlush(msgStdinId);
            agentActions.updatePhase(agentId, 'writing');
          }
        } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
          const thinkingText = evt.delta.thinking || '';
          if (thinkingText && msgStdinId) {
            const buf = _getBuffer(msgStdinId);
            buf.thinking += thinkingText;
            _scheduleStreamFlush(msgStdinId);
            agentActions.updatePhase(agentId, 'thinking');
          } else {
            setActivityStatus({ phase: 'thinking' });
            agentActions.updatePhase(agentId, 'thinking');
          }
        }

        // Early agent creation: register sub-agent as soon as Task tool_use
        // starts streaming, so subsequent events resolve to the correct agent.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'Task') {
          agentActions.upsertAgent({
            id: evt.content_block.id || `task_${Date.now()}`,
            parentId: agentId,
            description: '',
            phase: 'spawning',
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
            && useSettingsStore.getState().sessionMode === 'plan') {
          const currentMessages = useChatStore.getState().messages;

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
          const meta = useChatStore.getState().sessionMeta;
          const delta = evt.message.usage.input_tokens;
          setSessionMeta({
            inputTokens: (meta.inputTokens || 0) + delta,
            totalInputTokens: (meta.totalInputTokens || 0) + delta,
          });
        }

        // Track output tokens from message_delta (per-turn + cumulative total)
        if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
          const meta = useChatStore.getState().sessionMeta;
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
          addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: msg.message || msg.error || 'System error',
            timestamp: Date.now(),
          });
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
          useChatStore.setState({ partialThinking: '' });
        }

        // If there's a pending slash command processing card, mark it as
        // completed now — the assistant response means the CLI has responded.
        // Some commands (e.g. /compact) may not emit a 'result' event.
        const pendingCmd = useChatStore.getState().sessionMeta.pendingCommandMsgId;
        if (pendingCmd) {
          useChatStore.getState().updateMessage(pendingCmd, {
            commandCompleted: true,
            commandData: {
              ...useChatStore.getState().messages.find((m) => m.id === pendingCmd)?.commandData,
              completedAt: Date.now(),
            },
          });
          useChatStore.getState().setSessionMeta({ pendingCommandMsgId: undefined });
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
            if (useSettingsStore.getState().sessionMode === 'code'
                && (block.name === 'EnterPlanMode' || block.name === 'ExitPlanMode')) {
              if (block.name === 'ExitPlanMode') exitPlanModeSeenRef.current = true;
              continue;
            }
            setActivityStatus({ phase: 'tool', toolName: block.name });
            if (block.name === 'Task') {
              agentActions.upsertAgent({
                id: block.id || generateMessageId(),
                parentId: agentId,
                description: block.input?.description || block.input?.prompt || '',
                phase: 'spawning',
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
              const currentMessages = useChatStore.getState().messages;
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
              if (useSettingsStore.getState().sessionMode === 'plan') {
                const currentMessages = useChatStore.getState().messages;

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
            useChatStore.setState({ partialThinking: '' });
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
            const { messages: allMsgs, updateMessage: um2 } = useChatStore.getState();
            for (let i = allMsgs.length - 1; i >= 0; i--) {
              if (allMsgs[i].role === 'user') {
                console.log('[stream] Storing checkpointUuid:', msg.uuid, 'on msg:', allMsgs[i].id);
                um2(allMsgs[i].id, { checkpointUuid: msg.uuid });
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
                const { messages: msgs, updateMessage: um } = useChatStore.getState();
                const parent = msgs.find((m) => m.id === tuId);
                if (parent) {
                  um(tuId, { toolResultContent: resultText });
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
                const { messages: msgs, updateMessage: um } = useChatStore.getState();
                const parent = msgs.find((m) => m.id === block.tool_use_id);
                if (parent) {
                  um(block.tool_use_id, { toolResultContent: resultText });
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
        if (toolUseId) {
          const { messages: currentMessages, updateMessage } = useChatStore.getState();
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

            updateMessage(toolUseId, updates);
            break;
          }
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
          const meta = useChatStore.getState().sessionMeta;
          // Build a combined error string from all possible error fields
          const errorText = [msg.result, msg.error, msg.content]
            .filter(Boolean)
            .map(String)
            .join(' ');
          const isThinkingSignatureError = /invalid.*signature.*thinking|thinking.*invalid.*signature/i.test(errorText);

          const switchedFlag = meta.providerSwitched || meta.modelSwitched;
          const pendingText = meta.providerSwitchPendingText || meta.modelSwitchPendingText;
          if (switchedFlag && isThinkingSignatureError && pendingText) {
            const switchType = meta.modelSwitched ? '模型' : 'API 提供商';
            console.warn(`[TOKENICODE] Thinking signature error after ${switchType} switch — auto-retrying without resume`);
            const retryText = pendingText;

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

                setSessionStatus('running');
                setSessionMeta({ turnStartTime: Date.now(), inputTokens: 0, outputTokens: 0 });
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

                setSessionMeta({ sessionId: session.session_id, stdinId: retryId, envFingerprint: envFingerprint(), spawnedModel: resolveModelForProvider(selectedModel) });
                const tabId = useSessionStore.getState().selectedSessionId;
                if (tabId) useSessionStore.getState().registerStdinTab(retryId, tabId);
                bridge.trackSession(session.session_id).catch(() => {});
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
        if (exitPlanModeSeenRef.current && useSettingsStore.getState().sessionMode === 'code'
            && msg.subtype !== 'success') {
          exitPlanModeSeenRef.current = false;
          console.log('[TOKENICODE] Code mode ExitPlanMode exit detected — auto-restarting with --resume');
          // Clean up dead process
          const oldStdinId = useChatStore.getState().sessionMeta.stdinId;
          if (oldStdinId) {
            useChatStore.getState().setSessionMeta({ stdinId: undefined });
            bridge.killSession(oldStdinId).catch(() => {});
            if ((window as any).__claudeUnlisteners?.[oldStdinId]) {
              (window as any).__claudeUnlisteners[oldStdinId]();
              delete (window as any).__claudeUnlisteners[oldStdinId];
            }
          }
          // Silently restart — no user message bubble
          silentRestartRef.current = true;
          setInputSync('Continue.');
          useChatStore.getState().setActivityStatus({ phase: 'thinking' });
          requestAnimationFrame(() => handleSubmitRef.current());
          break;
        }
        exitPlanModeSeenRef.current = false;

        // Mark pending processing card (CLI slash command) as completed
        const pendingCmdMsgId = useChatStore.getState().sessionMeta.pendingCommandMsgId;
        if (pendingCmdMsgId) {
          const resultOutput = typeof msg.result === 'string' ? msg.result : '';
          useChatStore.getState().updateMessage(pendingCmdMsgId, {
            commandCompleted: true,
            commandData: {
              ...useChatStore.getState().messages.find((m) => m.id === pendingCmdMsgId)?.commandData,
              output: resultOutput,
              completedAt: Date.now(),
            },
          });
          useChatStore.getState().setSessionMeta({ pendingCommandMsgId: undefined });
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
          const cmdMsg = useChatStore.getState().messages.find((m) => m.id === pendingCmdMsgId);
          if (cmdMsg) {
            useChatStore.getState().updateMessage(pendingCmdMsgId, {
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
        // 'assistant' event (which is the normal case for stream-json output).
        // This prevents duplicate messages on first output.
        if (resultDisplayText) {
          const currentMessages = useChatStore.getState().messages;
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
          const meta = useChatStore.getState().sessionMeta;
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
          });
        }
        agentActions.completeAll(
          msg.subtype === 'success' ? 'completed' : 'error'
        );
        useSessionStore.getState().fetchSessions();
        setTimeout(() => useSessionStore.getState().fetchSessions(), 1000);

        // --- AI Title Generation (TK-001): on 3rd successful turn, generate a title ---
        if (msg.subtype === 'success') {
          const sessionId = useChatStore.getState().sessionMeta.sessionId;
          if (sessionId) {
            const customPreviews = useSessionStore.getState().customPreviews;
            if (!customPreviews[sessionId]) {
              const currentMessages = useChatStore.getState().messages;
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
        const compactStdinId = useChatStore.getState().sessionMeta.stdinId;
        if (resultInputTokens > 160_000 && !autoCompactFiredRef.current && compactStdinId && msg.subtype === 'success') {
          autoCompactFiredRef.current = true;
          console.log('[TOKENICODE] Auto-compact triggered: inputTokens =', resultInputTokens);
          const compactMsgId = generateMessageId();
          addMessage({
            id: compactMsgId,
            role: 'system',
            type: 'text',
            content: '',
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
            const meta = useChatStore.getState().sessionMeta;
            if (meta.pendingCommandMsgId === compactMsgId) {
              useChatStore.getState().updateMessage(compactMsgId, {
                commandCompleted: true,
                commandData: {
                  ...useChatStore.getState().messages.find((m) => m.id === compactMsgId)?.commandData,
                  output: 'Compact timed out',
                  completedAt: Date.now(),
                },
              });
              useChatStore.getState().setSessionMeta({ pendingCommandMsgId: undefined });
              if (useChatStore.getState().sessionStatus === 'running') {
                useChatStore.getState().setSessionStatus('idle');
              }
            }
          }, 90_000);
          break; // Skip pending message flush — compact takes priority
        }

        // Flush any user messages that were queued while AI was processing.
        // These follow-up messages were held to prevent them from being
        // consumed as answers to AskUserQuestion / PlanReview interactions.
        const pendingMsgs = useChatStore.getState().flushPendingMessages();
        const flushStdinId = useChatStore.getState().sessionMeta.stdinId;
        if (pendingMsgs.length > 0 && flushStdinId) {
          const combinedText = pendingMsgs.join('\n\n');
          setSessionStatus('running');
          setSessionMeta({ turnStartTime: Date.now(), inputTokens: 0, outputTokens: 0 });
          setActivityStatus({ phase: 'thinking' });
          agentActions.clearAgents();
          agentActions.upsertAgent({
            id: 'main',
            parentId: null,
            description: combinedText.slice(0, 100),
            phase: 'spawning',
            startTime: Date.now(),
            isMain: true,
          });
          bridge.sendStdin(flushStdinId, combinedText).catch((err) => {
            console.error('[TOKENICODE] Failed to send pending messages:', err);
            setSessionStatus('error');
          });
        }

        break;
      }

      case 'process_exit': {
        // The CLI process has exited — clear the stdin handle but keep sessionId for resume
        clearPartial();
        console.log('[TOKENICODE:session] process_exit received', { stdinId: msg.__stdinId });

        // If the session was running and no assistant messages were received,
        // the process failed at startup. Show the last stderr error to the user.
        const { sessionStatus: exitStatus, messages: exitMsgs } = useChatStore.getState();
        if (exitStatus === 'running') {
          const hasAssistantReply = exitMsgs.some(
            (m) => m.role === 'assistant' && (m.type === 'text' || m.type === 'tool_use'),
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
                content: `CLI error: ${stderr}${hint}`,
                timestamp: Date.now(),
              });
            } else {
              // No stderr captured — CLI exited silently. Show a generic error
              // so the user knows something went wrong (previously this was silent).
              addMessage({
                id: generateMessageId(),
                role: 'system',
                type: 'text',
                content: 'CLI process exited unexpectedly without producing output. '
                  + 'Please check that Claude CLI is installed correctly (Settings → CLI) '
                  + 'and that your API provider is configured.',
                timestamp: Date.now(),
              });
            }
          }
        }

        // P0-5: Clean up Tauri event listeners for this session to prevent leaks
        const exitingStdinId = msg.__stdinId || useChatStore.getState().sessionMeta.stdinId;
        if (exitingStdinId && (window as any).__claudeUnlisteners?.[exitingStdinId]) {
          (window as any).__claudeUnlisteners[exitingStdinId]();
          delete (window as any).__claudeUnlisteners[exitingStdinId];
        }
        if ((window as any).__claudeUnlisten) {
          (window as any).__claudeUnlisten = null;
        }

        setSessionStatus('idle');
        setSessionMeta({ stdinId: undefined });
        useChatStore.getState().clearPendingMessages();
        agentActions.completeAll();
        useSessionStore.getState().fetchSessions();
        break;
      }

      default:
        // Fallback: handle content_block_delta at top level (without stream_event wrapper)
        if (msg.type === 'content_block_delta') {
          const text = msg.delta?.text || '';
          if (text && msgStdinId) {
            const buf = _getBuffer(msgStdinId);
            buf.text += text;
            _scheduleStreamFlush(msgStdinId);
          }
        }
        break;
    }

    } catch (err) {
      // P1-4: catch-all for unexpected errors in stream message processing
      console.error('[TOKENICODE] handleStreamMessage error:', err, 'msg:', msg?.type, msg?.subtype);
      const { addMessage } = useChatStore.getState();
      addMessage({
        id: generateMessageId(),
        role: 'system',
        type: 'text',
        content: `Internal error processing stream message: ${err}`,
        timestamp: Date.now(),
      });
    }
  }, [handleBackgroundStreamMessage, exitPlanModeSeenRef, autoCompactFiredRef, silentRestartRef, handleSubmitRef, handleStderrLineRef, setInputSync]);

  return { handleStreamMessage, handleBackgroundStreamMessage };
}
