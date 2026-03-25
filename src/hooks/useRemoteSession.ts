/**
 * useRemoteSession — global hook for managing remote sessions (Telegram, Feishu, etc.)
 *
 * Listens for `remote:session_created` events from the Rust backend, creates session
 * entries in the stores, and sets up background stream handlers so messages accumulate
 * in the session cache. When the user clicks a remote session in the sidebar, the
 * cached messages are restored to the foreground via restoreFromCache().
 */
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { bridge, onClaudeStream, onClaudeStderr, onSessionExit, remoteBridge, type AdapterConfig, type RemoteSessionMeta } from '../lib/tauri-bridge';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useChatStore, generateMessageId, type SessionSnapshot, type TabSession } from '../stores/chatStore';
import { envFingerprint } from '../lib/api-provider';
import { parseSessionMessages } from '../lib/session-loader';

interface RemoteSessionCreatedPayload {
  session_id: string;
  platform: string;
  display_name: string;
  project_dir: string;
  source_address?: { platform: string; chat_id: string; user_id: string };
}

const PLATFORM_LABEL: Record<string, string> = {
  feishu: '飞书',
  telegram: 'Telegram',
};

function isWindowsAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(p);
}

function resolveProjectPath(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('/') || isWindowsAbsolutePath(raw)) return raw;
  if (raw.startsWith('~/') || raw === '~') return raw;
  if (/^[A-Za-z]-/.test(raw)) {
    const drive = raw[0];
    const rest = raw.slice(2);
    return `${drive}:\\${rest.replace(/-/g, '\\')}`;
  }
  return raw.replace(/-/g, '/');
}

function extractProjectPathFromRawMessages(rawMessages: any[]): string {
  for (const msg of rawMessages.slice(0, 100)) {
    const cwd = typeof msg?.cwd === 'string' ? msg.cwd.trim() : '';
    if (cwd) return cwd;
  }
  return '';
}

function inferProjectPathFromSessionPath(sessionPath: string): string {
  const parts = sessionPath.split(/[\\/]/).filter(Boolean);
  const encodedProjectDir = parts.length >= 2 ? parts[parts.length - 2] : '';
  return encodedProjectDir ? resolveProjectPath(encodedProjectDir) : '';
}

function resolveRestoredProjectPath(
  rawMessages: any[],
  meta: RemoteSessionMeta,
  sessionPath: string,
): string {
  const fromMessages = extractProjectPathFromRawMessages(rawMessages);
  if (fromMessages) return fromMessages;

  const fromMeta = typeof meta.project_dir === 'string' ? meta.project_dir.trim() : '';
  if (fromMeta) return resolveProjectPath(fromMeta);

  return inferProjectPathFromSessionPath(sessionPath);
}

/** Map of active remote session listeners: sessionId → unlisten */
const _remoteUnlisteners: Record<string, () => void> = {};

export function useRemoteSession() {
  useEffect(() => {
    let cancelled = false;
    let unlistenCreated: (() => void) | null = null;

    listen<RemoteSessionCreatedPayload>('remote:session_created', (event) => {
      // StrictMode guard: if the effect was cleaned up before this fires, skip
      if (cancelled) return;

      const { session_id, platform, display_name, project_dir, source_address } = event.payload;
      console.log('[Her:remote] session_created event:', session_id, platform, display_name, project_dir);

      const sessionStore = useSessionStore.getState();
      const platformLabel = PLATFORM_LABEL[platform] || platform;
      const previewName = display_name || platformLabel;

      // 1. Add to session list — match by source_address to update dormant entries (R-1)
      const existing = sessionStore.sessions.find((s) => s.id === session_id);
      if (!existing) {
        // Check if a dormant entry from startup restoration matches this IM user
        const dormantMatch = source_address
          ? sessionStore.sessions.find((s) => {
              const meta = sessionStore.remoteSessionMeta?.[s.id];
              if (!meta?.source_address) return false;
              return (
                meta.source_address.platform === source_address.platform &&
                meta.source_address.chat_id === source_address.chat_id &&
                meta.source_address.user_id === source_address.user_id
              );
            })
          : undefined;

        if (dormantMatch) {
          // Update the dormant entry's ID to the new gateway session ID
          useSessionStore.setState((state) => ({
            sessions: state.sessions.map((s) =>
              s.id === dormantMatch.id
                ? { ...s, id: session_id, project: project_dir || s.project, projectDir: project_dir || s.projectDir, modifiedAt: Date.now() }
                : s,
            ),
          }));
          // Migrate cache from old ID to new ID
          const chatState = useChatStore.getState();
          const oldSnap = chatState.sessionCache.get(dormantMatch.id);
          if (oldSnap) {
            const next = new Map(chatState.sessionCache);
            next.delete(dormantMatch.id);
            next.set(session_id, { ...oldSnap, sessionMeta: { ...oldSnap.sessionMeta, sessionId: session_id, stdinId: session_id } });
            useChatStore.setState({ sessionCache: next });
          }
        } else {
          useSessionStore.setState((state) => ({
            sessions: [
              {
                id: session_id,
                path: '',
                project: project_dir || '',
                projectDir: project_dir || '',
                modifiedAt: Date.now(),
                preview: previewName,
              },
              ...state.sessions,
            ],
          }));
        }
      }

      // 2. Set custom preview
      sessionStore.setCustomPreview(session_id, previewName);

      // 3. Register stdinToTab mapping (stdinId === sessionId for remote sessions)
      sessionStore.registerStdinTab(session_id, session_id);

      // 4. Mark as running
      sessionStore.setSessionRunning(session_id, true);

      // 5. Create initial cache snapshot so addMessageToCache / setMetaInCache work
      const cache = useChatStore.getState().sessionCache;
      if (!cache.has(session_id)) {
        const snapshot: SessionSnapshot = {
          messages: [],
          isStreaming: false,
          partialText: '',
          partialThinking: '',
          sessionStatus: 'running',
          sessionMeta: { sessionId: session_id, stdinId: session_id, envFingerprint: envFingerprint() },
          activityStatus: { phase: 'idle' },
          inputDraft: '',
          pendingAttachments: [],
          pendingUserMessages: [],
        };
        const next = new Map(cache);
        next.set(session_id, snapshot);
        useChatStore.setState({ sessionCache: next });
      }

      // 6. Set up stream listeners (skip if already registered)
      if (!_remoteUnlisteners[session_id]) {
        setupRemoteStreamListeners(session_id);
      }

      // 7. Reload remote session metadata
      sessionStore.loadRemoteSessionMeta();
    }).then((fn) => {
      if (cancelled) {
        // Effect was cleaned up before listen() resolved — immediately unlisten
        fn();
      } else {
        unlistenCreated = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenCreated?.();
    };
  }, []);

  // Auto-start adapters with saved credentials on app launch
  useEffect(() => {
    let cancelled = false;
    remoteBridge.getConfig().then(async (config) => {
      if (cancelled || !config.enabled || config.adapters.length === 0) return;
      // Check which adapters are already running (guards against StrictMode double-fire)
      const statuses = await remoteBridge.getStatuses().catch(() => ({} as Record<string, { status: string }>));
      const cwd = useSettingsStore.getState().workingDirectory || '';
      for (const adapter of config.adapters) {
        if (cancelled) break;
        const st = statuses[adapter.platform];
        if (st && (st.status === 'Connected' || st.status === 'Connecting')) continue;
        if (adapterHasCredentials(adapter)) {
          try {
            await remoteBridge.startAdapter(adapter, cwd);
            console.log(`[Her:remote] Auto-started ${adapter.platform}`);
          } catch (e) {
            console.warn(`[Her:remote] Auto-start ${adapter.platform} failed:`, e);
          }
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Restore previous remote sessions from disk on startup (dormant sidebar entries)
  useEffect(() => {
    const cancelRef = { current: false };
    restorePreviousRemoteSessions(cancelRef).catch(() => {});
    return () => { cancelRef.current = true; };
  }, []);
}

/** Restore previous remote sessions as dormant sidebar entries on app startup. */
async function restorePreviousRemoteSessions(cancelRef: { current: boolean }) {
  let metas: RemoteSessionMeta[];
  try {
    metas = await remoteBridge.loadRemoteSessions();
  } catch {
    return;
  }
  if (cancelRef.current || metas.length === 0) return;

  const sessionStore = useSessionStore.getState();

  for (const meta of metas) {
    if (cancelRef.current) break;
    // Skip entries without a CLI session ID (never got fully initialized)
    if (!meta.cli_session_id) continue;

    // Skip if already present in session list (e.g. from `remote:session_created` event)
    const existing = sessionStore.sessions.find(
      (s) => s.id === meta.session_id || s.id === meta.cli_session_id,
    );
    if (existing) continue;

    // Resolve the JSONL path to verify the session data still exists
    let jsonlPath: string | null = null;
    try {
      jsonlPath = await remoteBridge.resolveRemoteSessionPath(meta.cli_session_id);
    } catch {
      continue;
    }
    if (!jsonlPath) continue;

    const platformLabel = PLATFORM_LABEL[meta.platform] || meta.platform;
    const previewName = meta.source_address.display_name || platformLabel;
    let rawMessages: any[] = [];
    try {
      rawMessages = await bridge.loadSession(jsonlPath);
    } catch {
      rawMessages = [];
    }
    if (cancelRef.current) break;

    const projectPath = resolveRestoredProjectPath(rawMessages, meta, jsonlPath);

    // Add to sidebar as dormant entry (using gateway session_id as the key)
    useSessionStore.setState((state) => {
      // Double-check to prevent race with `remote:session_created`
      if (state.sessions.some((s) => s.id === meta.session_id)) return state;
      return {
        sessions: [
          ...state.sessions,
          {
            id: meta.session_id,
            path: jsonlPath!,
            project: projectPath,
            projectDir: projectPath,
            modifiedAt: meta.created_at,
            preview: previewName,
          },
        ],
      };
    });

    // Set custom preview
    sessionStore.setCustomPreview(meta.session_id, previewName);

    // Pre-load history into cache for immediate display when clicked
    try {
      const { messages } = parseSessionMessages(rawMessages);
      if (messages.length > 0) {
        const cache = useChatStore.getState().sessionCache;
        if (!cache.has(meta.session_id)) {
          const snapshot: SessionSnapshot = {
            messages,
            isStreaming: false,
            partialText: '',
            partialThinking: '',
            sessionStatus: 'idle',
            sessionMeta: { sessionId: meta.session_id, envFingerprint: envFingerprint() },
            activityStatus: { phase: 'idle' },
            inputDraft: '',
            pendingAttachments: [],
            pendingUserMessages: [],
          };
          const next = new Map(useChatStore.getState().sessionCache);
          next.set(meta.session_id, snapshot);
          useChatStore.setState({ sessionCache: next });
        }
      }
    } catch {
      // History load failed — session shows in sidebar but empty until resumed
    }
  }

  // Refresh remote session metadata in store
  sessionStore.loadRemoteSessionMeta();
}

/** Check if an adapter config has all required credentials filled. */
function adapterHasCredentials(adapter: AdapterConfig): boolean {
  switch (adapter.platform) {
    case 'telegram': return !!adapter.bot_token;
    case 'feishu': return !!adapter.app_id && !!adapter.app_secret;
    default: return false;
  }
}

/**
 * Register stream event listeners for a remote session.
 * Routes all events to the chatStore session cache (background handler).
 * When the user switches to this session's tab, restoreFromCache() loads them.
 */
function setupRemoteStreamListeners(sessionId: string) {
  // Set synchronous guard BEFORE async work to prevent double-registration.
  // React StrictMode fires useEffect twice; without this, both calls pass
  // the `!_remoteUnlisteners[sessionId]` check before Promise.all resolves,
  // creating duplicate listeners that double every stream event.
  _remoteUnlisteners[sessionId] = () => {};

  Promise.all([
    onClaudeStream(sessionId, (msg: any) => {
      handleRemoteStreamMessage(sessionId, msg);
    }),
    onClaudeStderr(sessionId, () => {
      // Stderr from remote sessions — silently ignore for now
    }),
    onSessionExit(sessionId, () => {
      handleRemoteProcessExit(sessionId);
    }),
  ]).then(([unStream, unStderr, unExit]) => {
    _remoteUnlisteners[sessionId] = () => {
      unStream();
      unStderr();
      unExit();
    };
  });
}

/**
 * Simplified stream handler for remote sessions.
 * Handles core message types needed for conversation display.
 * Remote sessions run in bypass mode, so permission handling is minimal.
 */
function handleRemoteStreamMessage(sessionId: string, msg: any) {
  if (!msg || !msg.type) return;

  const chatStore = useChatStore.getState();
  const sessionStore = useSessionStore.getState();

  // Remote sessions are NOT handled by useStreamProcessor (which only handles
  // sessions started through InputBar). This handler processes ALL event types.
  // All tab methods now take tabId, so active/background routing is unified.

  // Helper: get tab data for this session (works for both active and background)
  const getTab = (): TabSession | undefined => chatStore.getTab(sessionId);

  switch (msg.type) {
    case 'stream_event': {
      const evt = msg.event;
      if (!evt) break;

      if (evt.type === 'content_block_delta') {
        if (evt.delta?.type === 'text_delta' && evt.delta.text) {
          chatStore.updatePartialMessage(sessionId, evt.delta.text);
        } else if (evt.delta?.type === 'thinking_delta' && evt.delta.thinking) {
          chatStore.updatePartialThinking(sessionId, evt.delta.thinking);
        }
      } else if (evt.type === 'message_start') {
        chatStore.setSessionStatus(sessionId, 'running');
        chatStore.setSessionMeta(sessionId, { lastProgressAt: Date.now() });
        if (evt.message?.usage?.input_tokens) {
          const delta = evt.message.usage.input_tokens;
          const tab = getTab();
          chatStore.setSessionMeta(sessionId, {
            inputTokens: (tab?.sessionMeta.inputTokens || 0) + delta,
            totalInputTokens: (tab?.sessionMeta.totalInputTokens || 0) + delta,
          });
        }
      } else if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
        const delta = evt.usage.output_tokens;
        const tab = getTab();
        chatStore.setSessionMeta(sessionId, {
          outputTokens: (tab?.sessionMeta.outputTokens || 0) + delta,
          totalOutputTokens: (tab?.sessionMeta.totalOutputTokens || 0) + delta,
        });
      }
      break;
    }

    case 'assistant': {
      const content = msg.message?.content;
      if (!Array.isArray(content)) break;

      // Clear partial text when a full text block arrives
      const hasTextBlock = content.some((b: any) => b.type === 'text' && b.text);
      if (hasTextBlock) {
        const tab = getTab();
        if (tab) {
          const newTabs = new Map(chatStore.tabs);
          newTabs.set(sessionId, { ...tab, partialText: '', partialThinking: '', isStreaming: false });
          useChatStore.setState({ tabs: newTabs, sessionCache: newTabs });
        }
      }
      for (let i = 0; i < content.length; i++) {
        const block = content[i];
        if (block.type === 'text' && block.text) {
          chatStore.addMessage(sessionId, {
            id: msg.uuid ? `${msg.uuid}_text_${i}` : generateMessageId(),
            role: 'assistant',
            type: 'text',
            content: block.text,
            timestamp: Date.now(),
          });
        } else if (block.type === 'tool_use') {
          chatStore.addMessage(sessionId, {
            id: block.id || generateMessageId(),
            role: 'assistant',
            type: 'tool_use',
            content: '',
            toolName: block.name,
            toolInput: block.input,
            timestamp: Date.now(),
          });
        }
      }
      break;
    }

    case 'user':
    case 'human': {
      // User messages echoed by CLI stream.
      // For remote sessions: messages may come from IM (Feishu/Telegram) — not from InputBar.
      // We add them with dedup: if InputBar already added the same text, skip it.
      const userContent = msg.message?.content;
      const addUserText = (text: string) => {
        // Dedup: InputBar adds user messages locally before sending.
        // If the same text already exists as a recent user message, skip.
        const tab = getTab();
        const existing = tab?.messages ?? [];
        const isDup = existing.some(
          (m: { role: string; type: string; content: string }) => m.role === 'user' && m.type === 'text' && m.content === text,
        );
        if (!isDup) {
          chatStore.addMessage(sessionId, {
            id: msg.uuid || generateMessageId(),
            role: 'user',
            type: 'text',
            content: text,
            timestamp: Date.now(),
          });
        }
      };
      if (typeof userContent === 'string' && userContent) {
        addUserText(userContent);
      } else if (Array.isArray(userContent)) {
        for (const block of userContent) {
          if (block.type === 'text' && block.text) {
            addUserText(block.text);
          }
        }
      }
      // Handle tool_result blocks (both foreground and background)
      if (Array.isArray(userContent)) {
        for (const block of userContent) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const resultText = Array.isArray(block.content)
              ? block.content.map((b: any) => b.text || b.content || '').join('')
              : typeof block.content === 'string' ? block.content : '';
            if (resultText) {
              chatStore.updateMessageInCache(sessionId, block.tool_use_id, { toolResultContent: resultText });
            }
          }
        }
      }
      break;
    }

    case 'tool_result': {
      const resultContent = Array.isArray(msg.content)
        ? msg.content.map((b: any) => b.text || b.content || '').join('')
        : typeof msg.content === 'string' ? msg.content : msg.output || '';
      if (msg.tool_use_id && resultContent) {
        chatStore.updateMessageInCache(sessionId, msg.tool_use_id, { toolResultContent: resultContent });
      }
      break;
    }

    case 'result': {
      const resultStatus = msg.subtype === 'success' ? 'completed' : 'error';
      const resultMeta = {
        cost: msg.total_cost_usd,
        duration: msg.duration_ms,
        turns: msg.num_turns,
        turnStartTime: undefined,
        lastProgressAt: undefined,
      };

      chatStore.setSessionStatus(sessionId, resultStatus as any);
      chatStore.setSessionMeta(sessionId, resultMeta);

      // Add result text if not already delivered via 'assistant' event
      if (typeof msg.result === 'string' && msg.result) {
        const tab = getTab();
        const existingMessages = tab?.messages ?? [];
        const isDuplicate = existingMessages.some(
          (m: { role: string; type: string; content: string }) => m.role === 'assistant' && m.type === 'text' && m.content === msg.result,
        );
        if (!isDuplicate) {
          chatStore.addMessage(sessionId, {
            id: msg.uuid || generateMessageId(),
            role: 'assistant',
            type: 'text',
            content: msg.result,
            timestamp: Date.now(),
          });
        }
      }

      // Always refresh session list
      sessionStore.fetchSessions();
      break;
    }

    case 'process_exit': {
      handleRemoteProcessExit(sessionId);
      break;
    }

    case 'her_permission_request': {
      // Remote sessions run in bypass mode — permissions are auto-approved in Rust.
      // If one slips through, auto-approve it.
      if (msg.request_id) {
        import('../lib/tauri-bridge').then(({ bridge }) => {
          bridge.respondPermission(sessionId, msg.request_id, true, undefined, msg.tool_use_id, msg.input);
        });
      }
      break;
    }
  }
}

function handleRemoteProcessExit(sessionId: string) {
  const sessionStore = useSessionStore.getState();
  const chatStore = useChatStore.getState();

  sessionStore.setSessionRunning(sessionId, false);

  chatStore.setSessionStatus(sessionId, 'idle');
  chatStore.setSessionMeta(sessionId, { stdinId: undefined });

  // Clean up listeners
  if (_remoteUnlisteners[sessionId]) {
    _remoteUnlisteners[sessionId]();
    delete _remoteUnlisteners[sessionId];
  }
}
