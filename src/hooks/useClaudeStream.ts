import { useEffect, useRef } from 'react';
import { UnlistenFn } from '@tauri-apps/api/event';
import { onClaudeStream, onClaudeStderr, onSessionExit } from '../lib/tauri-bridge';
import { useChatStore, generateMessageId, ChatMessage } from '../stores/chatStore';

/**
 * Listens to Tauri events for a Claude session and dispatches
 * parsed messages into the chatStore.
 *
 * SDKMessage types handled:
 *   - system        → system init message
 *   - assistant      → text / tool_use / thinking blocks
 *   - stream_event   → partial streaming text
 *   - result         → final result with cost/duration
 *   - process_exit   → session ended
 */
export function useClaudeStream(sessionId: string | null) {
  const addMessage = useChatStore((s) => s.addMessage);
  const updatePartialMessage = useChatStore((s) => s.updatePartialMessage);
  const setSessionStatus = useChatStore((s) => s.setSessionStatus);
  const setSessionMeta = useChatStore((s) => s.setSessionMeta);

  const unlistenersRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    async function subscribe() {
      const unlisteners: UnlistenFn[] = [];

      // --- Main stream listener ---
      const unStream = await onClaudeStream(sessionId!, (payload) => {
        if (cancelled) return;
        handleStreamPayload(payload);
      });
      unlisteners.push(unStream);

      // --- Stderr listener (debug / logs) ---
      const unStderr = await onClaudeStderr(sessionId!, (line) => {
        if (cancelled) return;
        // Stderr lines are added as system messages for debugging
        addMessage({
          id: generateMessageId(),
          role: 'system',
          type: 'text',
          content: line,
          timestamp: Date.now(),
        });
      });
      unlisteners.push(unStderr);

      // --- Exit listener ---
      const unExit = await onSessionExit(sessionId!, (code) => {
        if (cancelled) return;
        const status = code === 0 ? 'completed' : 'error';
        setSessionStatus(status);
      });
      unlisteners.push(unExit);

      unlistenersRef.current = unlisteners;
    }

    function handleStreamPayload(payload: any) {
      const msgType: string = payload?.type;

      switch (msgType) {
        // --- System init ---
        case 'system': {
          setSessionStatus('running');
          if (payload.session_id) {
            setSessionMeta({ sessionId: payload.session_id });
          }
          if (payload.model) {
            setSessionMeta({ model: payload.model });
          }
          addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: payload.message ?? 'Session started',
            timestamp: Date.now(),
          });
          break;
        }

        // --- Assistant message (complete block) ---
        case 'assistant': {
          const blocks: any[] = payload.content ?? [];
          for (const block of blocks) {
            const msg = blockToMessage(block);
            if (msg) addMessage(msg);
          }
          break;
        }

        // --- Streaming partial text ---
        case 'stream_event': {
          const text: string = payload.text ?? payload.delta ?? '';
          if (text) {
            updatePartialMessage(text);
          }
          break;
        }

        // --- Tool result ---
        case 'tool_result': {
          addMessage({
            id: generateMessageId(),
            role: 'assistant',
            type: 'tool_result',
            content: payload.output ?? '',
            toolName: payload.tool_name,
            toolResult: payload.output,
            timestamp: Date.now(),
          });
          break;
        }

        // --- Final result ---
        case 'result': {
          setSessionMeta({
            cost: payload.cost_usd ?? payload.cost,
            duration: payload.duration_ms ?? payload.duration,
            turns: payload.num_turns ?? payload.turns,
          });
          if (payload.result) {
            addMessage({
              id: generateMessageId(),
              role: 'assistant',
              type: 'text',
              content: payload.result,
              timestamp: Date.now(),
            });
          }
          setSessionStatus('completed');
          break;
        }

        // --- Process exit ---
        case 'process_exit': {
          const code = payload.code ?? null;
          setSessionStatus(code === 0 ? 'completed' : 'error');
          break;
        }

        default:
          // Unknown message type -- ignore silently
          break;
      }
    }

    subscribe();

    return () => {
      cancelled = true;
      for (const unlisten of unlistenersRef.current) {
        unlisten();
      }
      unlistenersRef.current = [];
    };
  }, [sessionId, addMessage, updatePartialMessage, setSessionStatus, setSessionMeta]);
}

// --- Helpers ---

function blockToMessage(block: any): ChatMessage | null {
  if (!block) return null;

  switch (block.type) {
    case 'text':
      return {
        id: generateMessageId(),
        role: 'assistant',
        type: 'text',
        content: block.text ?? '',
        timestamp: Date.now(),
      };

    case 'tool_use':
      return {
        id: generateMessageId(),
        role: 'assistant',
        type: 'tool_use',
        content: block.name ?? 'tool',
        toolName: block.name,
        toolInput: block.input,
        timestamp: Date.now(),
      };

    case 'thinking':
      return {
        id: generateMessageId(),
        role: 'assistant',
        type: 'thinking',
        content: block.thinking ?? block.text ?? '',
        timestamp: Date.now(),
      };

    default:
      return null;
  }
}
