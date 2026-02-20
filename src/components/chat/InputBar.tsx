import { useState, useRef, useCallback, useEffect } from 'react';
import { useChatStore, generateMessageId, type ChatMessage } from '../../stores/chatStore';
import { useSettingsStore, MODEL_OPTIONS } from '../../stores/settingsStore';
import { bridge, onClaudeStream, onClaudeStderr, type UnifiedCommand } from '../../lib/tauri-bridge';
import { ModelSelector } from './ModelSelector';
import { ModeSelector } from './ModeSelector';
import { FileUploadChips } from './FileUploadChips';
import { RewindPanel } from './RewindPanel';
import { useFileAttachments } from '../../hooks/useFileAttachments';
import { useRewind } from '../../hooks/useRewind';
import { useAgentStore, resolveAgentId } from '../../stores/agentStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useT } from '../../lib/i18n';
import { SlashCommandPopover, getFilteredCommandList } from './SlashCommandPopover';
import { useCommandStore } from '../../stores/commandStore';
import { usePlanPanelStore } from './ChatPanel';
import { useSnapshotStore } from '../../stores/snapshotStore';
// drag-state import removed — tree drag handled by ChatPanel

/** Think mode toggle button for the toolbar */
function ThinkToggle({ disabled }: { disabled: boolean }) {
  const thinkingEnabled = useSettingsStore((s) => s.thinkingEnabled);
  const toggleThinking = useSettingsStore((s) => s.toggleThinking);
  const t = useT();

  return (
    <button
      onClick={toggleThinking}
      disabled={disabled}
      className={`p-1.5 rounded-lg transition-smooth flex items-center gap-1
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${thinkingEnabled
          ? 'bg-amber-500/10 text-amber-500'
          : 'text-text-tertiary hover:text-text-primary hover:bg-bg-secondary'
        }`}
      title={thinkingEnabled ? t('input.thinkOn') : t('input.thinkOff')}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="6" r="4" />
        <path d="M5.5 9.5C5.5 11.5 6 13 8 13s2.5-1.5 2.5-3.5" />
        <path d="M6.5 14h3" />
      </svg>
      <span className="text-[10px]">Think</span>
    </button>
  );
}

function PlanToggleButton() {
  const t = useT();
  const isOpen = usePlanPanelStore((s) => s.open);
  const toggle = usePlanPanelStore((s) => s.toggle);
  const hasPlanMessages = useChatStore((s) =>
    s.messages.some((m) => m.type === 'plan_review' || m.type === 'plan' || m.planContent),
  );
  const inPlanMode = useSettingsStore((s) => s.sessionMode) === 'plan';

  // Only show when in plan mode or there are plan-related messages
  if (!inPlanMode && !hasPlanMessages) return null;

  return (
    <button
      onClick={toggle}
      className={`p-1.5 rounded-lg transition-smooth flex items-center gap-1
        ${isOpen
          ? 'bg-accent/10 text-accent'
          : 'text-text-tertiary hover:text-text-primary hover:bg-bg-secondary'
        }`}
      title={t('msg.viewPlan')}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M3 4h10M3 8h8M3 12h5" />
      </svg>
      <span className="text-[10px]">Plan</span>
    </button>
  );
}

export function InputBar() {
  const t = useT();
  const inputDraft = useChatStore((s) => s.inputDraft);
  const setInputDraft = useChatStore((s) => s.setInputDraft);
  // Local alias for the store-backed draft
  const input = inputDraft;
  const setInput = setInputDraft;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionStatus = useChatStore((s) => s.sessionStatus);
  const addMessage = useChatStore((s) => s.addMessage);
  const setSessionStatus = useChatStore((s) => s.setSessionStatus);
  const setSessionMeta = useChatStore((s) => s.setSessionMeta);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const sessionMode = useSettingsStore((s) => s.sessionMode);

  const { files, setFiles, isProcessing, addFiles, removeFile, clearFiles } = useFileAttachments();

  // Sync files → store.pendingAttachments so tab switch can persist them
  const setPendingAttachments = useChatStore((s) => s.setPendingAttachments);
  useEffect(() => {
    setPendingAttachments(files);
  }, [files, setPendingAttachments]);

  // Restore files from store when tab switches back (pendingAttachments → local files)
  const pendingAttachments = useChatStore((s) => s.pendingAttachments);
  const prevAttachmentsRef = useRef(pendingAttachments);
  useEffect(() => {
    // Only restore when store value changes externally (e.g. restoreFromCache)
    // and differs from current files
    if (prevAttachmentsRef.current !== pendingAttachments && pendingAttachments !== files) {
      setFiles(pendingAttachments);
    }
    prevAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments, setFiles]); // intentionally exclude `files` to avoid loop

  // Auto-resize textarea whenever input changes (covers programmatic clears like send/cancel)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxH = Math.max(128, Math.floor(window.innerHeight * 0.5));
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, [input]);

  // Slash command state
  const [slashQuery, setSlashQuery] = useState('');
  const [slashVisible, setSlashVisible] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashCommands = useCommandStore((s) => s.commands);
  const activePrefix = useCommandStore((s) => s.activePrefix);

  // Rewind state
  const [showRewindPanel, setShowRewindPanel] = useState(false);
  const { showRewind, canRewind } = useRewind();
  const lastEscTime = useRef(0);

  // Listen for rewind event from /rewind command
  useEffect(() => {
    const handler = () => {
      if (canRewind) setShowRewindPanel(true);
    };
    window.addEventListener('tokenicode:rewind', handler);
    return () => window.removeEventListener('tokenicode:rewind', handler);
  }, [canRewind]);

  // Double-Esc detection (global — works even when textarea is not focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // If rewind panel is open, single Esc closes it (handled by RewindPanel itself)
      if (showRewindPanel) return;

      const now = Date.now();
      if (now - lastEscTime.current < 400) {
        // Double Esc within 400ms → toggle rewind
        lastEscTime.current = 0;
        if (canRewind) setShowRewindPanel(true);
      } else {
        lastEscTime.current = now;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canRewind, showRewindPanel]);

  // Drag state (file drop)
  const [isDragging, setIsDragging] = useState(false);

  // Fetch slash commands when working directory changes
  useEffect(() => {
    useCommandStore.getState().fetchCommands(workingDirectory || undefined);
  }, [workingDirectory]);

  const isRunning = sessionStatus === 'running';

  // Whether this is a follow-up (session already has a CLI session ID)
  const hasActiveSession = sessionStatus !== 'idle';

  // --- Slash command detection ---
  // Relaxed: detect "/" at start of first line, keep popover open even after spaces
  const detectSlashCommand = useCallback((text: string) => {
    const firstLine = text.split('\n')[0];
    if (firstLine.startsWith('/') && !activePrefix) {
      const query = firstLine.slice(1); // strip leading "/"
      setSlashQuery(query);
      setSlashVisible(true);
      setSlashIndex(0);
    } else {
      setSlashVisible(false);
    }
  }, [activePrefix]);

  // Ref to always point to the latest handleSubmit (avoids stale closure)
  const handleSubmitRef = useRef<() => void>(() => {});

  // --- Immediate command execution ---
  // All built-in commands are handled in the UI layer because they don't work
  // via stdin in stream-json mode (CLI treats them as normal text, not commands).
  const executeImmediateCommand = useCallback(async (cmdName: string, args?: string) => {
    const cmd = cmdName.toLowerCase().replace(/^\//, '');
    const { addMessage } = useChatStore.getState();

    // Always clear the input box first
    setInput('');

    // Helper: resolve model ID to display name
    const modelLabel = (id: string | undefined): string => {
      if (!id) return '—';
      return MODEL_OPTIONS.find((m) => m.id === id)?.label || id;
    };

    // Helper: add a structured command feedback message
    const feedback = (
      commandType: 'mode' | 'info' | 'help' | 'action' | 'error',
      content: string,
      commandData?: Record<string, any>,
    ) => {
      addMessage({
        id: generateMessageId(),
        role: 'system',
        type: 'text',
        content,
        commandType,
        commandData,
        timestamp: Date.now(),
      });
    };

    switch (cmd) {
      // --- Mode switching ---
      case 'ask':
        useSettingsStore.getState().setSessionMode('ask');
        feedback('mode', t('cmd.switchedToAsk'), { mode: 'ask', icon: '💬' });
        return;
      case 'plan':
        useSettingsStore.getState().setSessionMode('plan');
        feedback('mode', t('cmd.switchedToPlan'), { mode: 'plan', icon: '📋' });
        return;
      case 'code':
        useSettingsStore.getState().setSessionMode('code');
        feedback('mode', t('cmd.switchedToCode'), { mode: 'code', icon: '⚡' });
        return;

      // --- Session management ---
      case 'clear':
        useChatStore.getState().clearMessages();
        return;

      case 'rewind':
        window.dispatchEvent(new CustomEvent('tokenicode:rewind'));
        return;

      // /compact is handled in the session stdin commands group below

      // --- Info commands ---
      case 'cost': {
        const meta = useChatStore.getState().sessionMeta;
        const hasData = meta.cost != null || meta.duration != null || meta.turns != null
          || meta.inputTokens != null || meta.outputTokens != null;
        const tokenValue = (meta.inputTokens != null || meta.outputTokens != null)
          ? `${(meta.inputTokens ?? 0).toLocaleString()} input / ${(meta.outputTokens ?? 0).toLocaleString()} output`
          : '—';
        feedback('info', hasData ? t('cmd.costTitle') : t('cmd.noSessionData'), {
          command: '/cost',
          title: t('cmd.costTitle'),
          rows: [
            { label: t('cmd.costModel'), value: modelLabel(meta.model || useSettingsStore.getState().selectedModel) },
            { label: t('cmd.costAmount'), value: meta.cost != null ? `$${meta.cost.toFixed(4)}` : '—' },
            { label: t('cmd.costDuration'), value: meta.duration != null ? `${(meta.duration / 1000).toFixed(1)}s` : '—' },
            { label: t('cmd.costTurns'), value: meta.turns != null ? String(meta.turns) : '—' },
            { label: t('cmd.costTokens'), value: tokenValue },
          ],
          hasData,
        });
        return;
      }

      case 'status': {
        const status = useChatStore.getState().sessionStatus;
        const meta = useChatStore.getState().sessionMeta;
        feedback('info', t('cmd.statusTitle'), {
          command: '/status',
          title: t('cmd.statusTitle'),
          rows: [
            { label: t('cmd.statusState'), value: status },
            { label: t('cmd.statusMode'), value: useSettingsStore.getState().sessionMode },
            { label: t('cmd.costModel'), value: modelLabel(meta.model || useSettingsStore.getState().selectedModel) },
            { label: t('cmd.statusProcess'), value: meta.stdinId ? '✓' : '✗' },
          ],
          hasData: true,
        });
        return;
      }

      case 'model': {
        feedback('info', t('cmd.currentModel'), {
          command: '/model',
          title: t('cmd.currentModel'),
          rows: [
            { label: t('cmd.costModel'), value: modelLabel(useSettingsStore.getState().selectedModel) },
          ],
          hint: t('cmd.modelHint'),
          hasData: true,
        });
        return;
      }

      case 'help': {
        const cmds = useCommandStore.getState().commands;
        const builtins = cmds.filter((c) => c.category === 'builtin')
          .map((c) => ({ name: c.name, desc: c.description }));
        const customCount = cmds.filter((c) => c.category === 'command').length;
        const skillCount = cmds.filter((c) => c.category === 'skill').length;
        feedback('help', t('cmd.helpTitle'), {
          builtins,
          customCount,
          skillCount,
        });
        return;
      }

      // --- External commands ---
      case 'bug':
        feedback('action', t('cmd.bugReport'), { action: 'bug', url: 'https://github.com/anthropics/claude-code/issues' });
        return;

      // --- UI-handled commands ---
      case 'config':
        useSettingsStore.getState().toggleSettings();
        feedback('action', t('cmd.configOpened'));
        return;

      case 'exit': {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        getCurrentWindow().close();
        return;
      }

      case 'theme': {
        useSettingsStore.getState().toggleTheme();
        const newTheme = useSettingsStore.getState().theme;
        const themeIcons: Record<string, string> = { light: '☀️', dark: '🌙', system: '💻' };
        feedback('mode', newTheme, { mode: newTheme, icon: themeIcons[newTheme] || '🎨' });
        return;
      }

      case 'rename': {
        if (!args) {
          feedback('error', t('cmd.renameNoArgs'));
          return;
        }
        const sessionId = useSessionStore.getState().selectedSessionId;
        if (sessionId) {
          useSessionStore.getState().setCustomPreview(sessionId, args);
          feedback('action', t('cmd.renamed').replace('{name}', args));
        }
        return;
      }

      case 'export': {
        const meta = useChatStore.getState().sessionMeta;
        const sessions = useSessionStore.getState().sessions;
        const session = sessions.find((s: any) => s.id === meta.sessionId);
        const sessionPath = session?.path;
        if (!sessionPath) {
          feedback('error', t('cmd.exportNoPath'));
          return;
        }
        const outputPath = args || sessionPath.replace(/\.jsonl$/, '.md');
        await bridge.exportSessionMarkdown(sessionPath, outputPath);
        feedback('action', `${t('export.success')} ${outputPath}`);
        return;
      }

      case 'resume': {
        if (!args) {
          // No args: open sidebar to show session list
          if (!useSettingsStore.getState().sidebarOpen) {
            useSettingsStore.getState().toggleSidebar();
          }
          feedback('action', t('cmd.resumeList'));
          return;
        }
        const allSessions = useSessionStore.getState().sessions;
        const target = allSessions.find(
          (s: any) => s.id === args || s.id?.startsWith(args) ||
            (s.preview && s.preview.toLowerCase().includes(args.toLowerCase()))
        );
        if (target) {
          useSessionStore.getState().setSelectedSession(target.id);
          feedback('action', t('cmd.resumed').replace('{name}', target.preview || target.id));
        } else {
          feedback('error', t('cmd.resumeNotFound').replace('{query}', args));
        }
        return;
      }

      // --- All CLI commands: pass through to active session via stdin ---
      // TOKENICODE is a GUI wrapper — all slash commands are handled by Claude Code CLI.
      default: {
        const stdinId = useChatStore.getState().sessionMeta.stdinId;
        if (stdinId) {
          // Emit a processing card immediately so user sees feedback
          const processingMsgId = generateMessageId();
          addMessage({
            id: processingMsgId,
            role: 'system',
            type: 'text',
            content: '',
            commandType: 'processing',
            commandData: { command: `/${cmd}${args ? ' ' + args : ''}` },
            commandStartTime: Date.now(),
            commandCompleted: false,
            timestamp: Date.now(),
          });
          useChatStore.getState().setSessionMeta({ pendingCommandMsgId: processingMsgId });
          useChatStore.getState().setSessionStatus('running');
          useChatStore.getState().setActivityStatus({ phase: 'thinking' });
          await bridge.sendStdin(stdinId, `/${cmd}${args ? ' ' + args : ''}`);
        } else {
          feedback('error', `/${cmd}: ${t('cmd.noActiveSession')}`, { command: `/${cmd}` });
        }
        return;
      }
    }
  }, [t, workingDirectory]);

  // --- Slash command selection ---
  const handleSlashSelect = useCallback((cmd: UnifiedCommand) => {
    setSlashVisible(false);
    setInput('');

    if (cmd.immediate) {
      if (cmd.has_args) {
        // Immediate + has_args: show prefix chip so user can type the argument
        useCommandStore.getState().setActivePrefix(cmd);
        textareaRef.current?.focus();
      } else {
        // Immediate execution: send command via stdin or as first message
        executeImmediateCommand(cmd.name);
      }
    } else {
      // Deferred: set as immutable prefix chip
      useCommandStore.getState().setActivePrefix(cmd);
      textareaRef.current?.focus();
    }
  }, [executeImmediateCommand]);

  // --- Submit ---
  const handleSubmit = useCallback(async () => {
    let text = input.trim();

    // Plan approval shortcut: empty Enter approves a pending plan_review
    const pendingPlanReview = useChatStore.getState().messages.find(
      (m) => m.type === 'plan_review' && !m.resolved,
    );
    if (pendingPlanReview && !text && !useCommandStore.getState().activePrefix) {
      const stdinId = useChatStore.getState().sessionMeta.stdinId;
      if (stdinId) {
        try {
          await bridge.sendStdin(stdinId, 'y');
          useChatStore.getState().updateMessage(pendingPlanReview.id, { resolved: true });
          setSessionStatus('running');
          useChatStore.getState().setActivityStatus({ phase: 'thinking' });
        } catch (err) {
          console.error('[TOKENICODE] Plan approval stdin failed:', err);
        }
      } else {
        console.warn('[TOKENICODE] Plan approval: no stdinId available');
      }
      return;
    }

    // Prefix mode: prepend the command/skill name
    const prefix = useCommandStore.getState().activePrefix;
    if (prefix) {
      text = text ? `${prefix.name} ${text}` : prefix.name;
      useCommandStore.getState().clearPrefix();
    }

    if (!text) return;

    // Intercept immediate (built-in) commands even when submitted directly
    // (e.g. user types "/help" and presses Enter without using the popover)
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      const cmdPart = parts[0].toLowerCase();
      const restText = parts.slice(1).join(' ').trim();

      // Mode-switching commands: /ask, /plan, /code
      // If followed by text, switch mode then submit the text normally
      const modeMap: Record<string, 'ask' | 'plan' | 'code'> = {
        '/ask': 'ask', '/plan': 'plan', '/code': 'code',
      };
      if (modeMap[cmdPart]) {
        useSettingsStore.getState().setSessionMode(modeMap[cmdPart]);
        if (restText) {
          // Directly apply the mode prefix and continue with submission
          text = `${cmdPart} ${restText}`;
        } else {
          setInput('');
          const modeVal = modeMap[cmdPart];
          const modeKey = `cmd.switchedTo${modeVal.charAt(0).toUpperCase() + modeVal.slice(1)}` as any;
          const iconMap: Record<string, string> = { ask: '💬', plan: '📋', code: '⚡' };
          addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: t(modeKey),
            commandType: 'mode',
            commandData: { mode: modeVal, icon: iconMap[modeVal] },
            timestamp: Date.now(),
          });
          return;
        }
      } else {
        // Other immediate commands (e.g. /clear, /help, /compact)
        const cmds = useCommandStore.getState().commands;
        const match = cmds.find(
          (c) => c.immediate && c.name.toLowerCase() === cmdPart
        );
        if (match) {
          setInput('');
          executeImmediateCommand(match.name, restText || undefined);
          return;
        }
      }
    }

    // Append file paths if there are attachments
    if (files.length > 0) {
      const filePaths = files.map((f) => f.path).join('\n');
      text = `${text}\n\n${t('input.attachedFiles')}\n${filePaths}`;
    }

    setInput('');

    // Add user message (show original text, not with prefix)
    addMessage({
      id: generateMessageId(),
      role: 'user',
      type: 'text',
      content: input.trim(),
      timestamp: Date.now(),
      attachments: files.length > 0
        ? files.map((f) => ({ name: f.name, path: f.path, isImage: f.isImage, preview: f.preview }))
        : undefined,
    });

    clearFiles();

    // Gate: if AI is actively processing (running but not awaiting user input),
    // queue this follow-up message instead of sending it to stdin immediately.
    // This prevents the follow-up from being consumed as an answer to an
    // upcoming AskUserQuestion or PlanReview interaction.
    const existingStdinId = useChatStore.getState().sessionMeta.stdinId;
    const { sessionStatus: currentStatus, activityStatus: currentActivity } = useChatStore.getState();
    const isActivelyProcessing = existingStdinId
      && currentStatus === 'running'
      && currentActivity.phase !== 'awaiting';

    if (isActivelyProcessing) {
      useChatStore.getState().addPendingMessage(text);
      return;
    }

    setSessionStatus('running');
    setSessionMeta({ turnStartTime: Date.now(), inputTokens: 0, outputTokens: 0 });
    useChatStore.getState().setActivityStatus({ phase: 'thinking' });

    // Capture file snapshot for code restore (non-blocking — don't await)
    const userMsgId = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]?.id;
    if (workingDirectory && userMsgId) {
      useSnapshotStore.getState().captureSnapshot(userMsgId, workingDirectory);
    }

    // Initialize agent tracking — clear previous turn's agents (they may be from a
    // different project/session) and create a fresh main agent for this turn.
    useAgentStore.getState().clearAgents();
    useAgentStore.getState().upsertAgent({
      id: 'main',
      parentId: null,
      description: input.trim(),
      phase: 'spawning',
      startTime: Date.now(),
      isMain: true,
    });

    try {
      if (!workingDirectory) return;

      // Use stdinId (desk-generated) for stdin communication, not CLI's own sessionId.
      // stdinId exists when: (a) a pre-warmed process is waiting, or (b) follow-up in active session.
      let stdinId = useChatStore.getState().sessionMeta.stdinId;
      let sentViaStdin = false;

      if (stdinId) {
        // ===== Send via stdin to existing persistent process (pre-warmed or follow-up) =====
        try {
          await bridge.sendStdin(stdinId, text);
          sentViaStdin = true;
        } catch (stdinErr) {
          // stdin write failed (broken pipe — process already exited).
          // Clear the dead stdinId and fall through to spawn a new process.
          console.warn('[TOKENICODE] sendStdin failed, spawning new process:', stdinErr);
          setSessionMeta({ stdinId: undefined });
          stdinId = undefined;
        }
      }

      if (!sentViaStdin) {
        // ===== No running process: spawn a new persistent stream-json process =====

        // Mode is now passed via --mode CLI arg in startSession, not text prefix.
        // Text prefix (/ask, /plan) caused "Unknown skill" errors in stream-json mode.

        // If we have an existing sessionId (loaded historical session), resume it.
        // Only use it as resume_session_id if it looks like a real CLI session ID (UUID),
        // not a desk-generated ID like "desk_xxx".
        const rawSessionId = useChatStore.getState().sessionMeta.sessionId;
        const existingSessionId = rawSessionId && !rawSessionId.startsWith('desk_')
          ? rawSessionId
          : undefined;

        // Clean up previous stream listeners
        if ((window as any).__claudeUnlisten) {
          (window as any).__claudeUnlisten();
          (window as any).__claudeUnlisten = null;
        }

        const cwd = workingDirectory;

        // Generate the desk-side session ID FIRST so we can register
        // event listeners BEFORE spawning the process.
        const preGeneratedId = `desk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Register listeners BEFORE starting the session
        const unlisten = await onClaudeStream(
          preGeneratedId,
          (msg: any) => {
            msg.__stdinId = preGeneratedId;
            handleStreamMessage(msg);
          }
        );

        const unlistenStderr = await onClaudeStderr(
          preGeneratedId,
          (line: string) => {
            handleStderrLine(line, preGeneratedId);
          }
        );

        // Store unlisten per stdinId for multi-session support
        if (!(window as any).__claudeUnlisteners) {
          (window as any).__claudeUnlisteners = {};
        }
        (window as any).__claudeUnlisteners[preGeneratedId] = () => {
          unlisten();
          unlistenStderr();
        };
        (window as any).__claudeUnlisten = (window as any).__claudeUnlisteners[preGeneratedId];

        // Spawn persistent process (first message sent via stdin inside Rust)
        // If resuming a historical session, pass resume_session_id so the CLI
        // picks up the existing conversation context.
        const session = await bridge.startSession({
          prompt: text,
          cwd,
          model: selectedModel,
          session_id: preGeneratedId,
          dangerously_skip_permissions: sessionMode === 'bypass',
          resume_session_id: existingSessionId || undefined,
          thinking_enabled: useSettingsStore.getState().thinkingEnabled,
          session_mode: (sessionMode === 'ask' || sessionMode === 'plan') ? sessionMode : undefined,
        });

        // Store both: session_id for tracking, stdinId (preGeneratedId) for stdin communication
        setSessionMeta({ sessionId: session.session_id, stdinId: preGeneratedId });

        // Register stdinId → tabId mapping for background stream routing
        const tabId = useSessionStore.getState().selectedSessionId;
        if (tabId) {
          useSessionStore.getState().registerStdinTab(preGeneratedId, tabId);
        }

        // Track the session and refresh conversation list
        bridge.trackSession(session.session_id).catch(() => {});
        useSessionStore.getState().fetchSessions();
        // Delayed retry in case JSONL file isn't written yet
        setTimeout(() => useSessionStore.getState().fetchSessions(), 1500);
      }
    } catch (err: any) {
      setSessionStatus('error');
      addMessage({
        id: generateMessageId(),
        role: 'system',
        type: 'text',
        content: `Error: ${err}`,
        timestamp: Date.now(),
      });
    }
  }, [input, hasActiveSession, workingDirectory, selectedModel, sessionMode, files, clearFiles]);

  // Keep ref in sync so executeImmediateCommand can call latest handleSubmit
  handleSubmitRef.current = handleSubmit;

  // Handle stream messages for a background (non-active) tab — route to cache
  const handleBackgroundStreamMessage = useCallback((msg: any, tabId: string) => {
    const cache = useChatStore.getState();

    switch (msg.type) {
      case 'stream_event': {
        const evt = msg.event;
        if (!evt) break;
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text) cache.updatePartialInCache(tabId, text);
        }
        // Early detection: create plan_review card for background tab
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode') {
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
          cache.addMessageToCache(tabId, {
            id: 'plan_review_current',
            role: 'assistant', type: 'plan_review',
            content: bgPlanContent, planContent: bgPlanContent,
            resolved: false, timestamp: Date.now(),
          });
          cache.setActivityInCache(tabId, { phase: 'awaiting' });
        }
        // Track tokens in background sessions
        if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
          const snapshot = cache.sessionCache.get(tabId);
          const current = snapshot?.sessionMeta.inputTokens || 0;
          cache.setMetaInCache(tabId, { inputTokens: current + evt.message.usage.input_tokens });
        }
        if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
          const snapshot = cache.sessionCache.get(tabId);
          const current = snapshot?.sessionMeta.outputTokens || 0;
          cache.setMetaInCache(tabId, { outputTokens: current + evt.usage.output_tokens });
        }
        break;
      }
      case 'assistant': {
        // Clear partial in cache
        const snapshot = cache.sessionCache.get(tabId);
        if (snapshot && (snapshot.isStreaming || snapshot.partialText)) {
          const next = new Map(cache.sessionCache);
          next.set(tabId, { ...snapshot, partialText: '', partialThinking: '', isStreaming: false });
          useChatStore.setState({ sessionCache: next });
        }
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;
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
            if (block.name === 'AskUserQuestion') {
              const questions = block.input?.questions;
              cache.addMessageToCache(tabId, {
                id: block.id || generateMessageId(),
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
              // Find plan content from background session's cached messages
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
              cache.addMessageToCache(tabId, {
                id: block.id || generateMessageId(),
                role: 'assistant', type: 'tool_use',
                content: '', toolName: block.name,
                toolInput: block.input, timestamp: Date.now(),
              });
              // Guard: skip re-delivered ExitPlanMode if already approved
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
                ? block.content.map((b: any) => b.text || b.content || '').join('')
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
          ? msg.content.map((b: any) => b.text || b.content || '').join('')
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
        cache.setMetaInCache(tabId, {
          cost: msg.total_cost_usd,
          duration: msg.duration_ms,
          turns: msg.num_turns,
          inputTokens: msg.usage?.input_tokens,
          outputTokens: msg.usage?.output_tokens,
          turnStartTime: undefined,
        });
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
        break;
      }
      case 'process_exit':
        cache.setStatusInCache(tabId, 'idle');
        cache.setMetaInCache(tabId, { stdinId: undefined });
        useSessionStore.getState().fetchSessions();
        break;
      case 'system':
        if (msg.subtype === 'init') {
          cache.setMetaInCache(tabId, { model: msg.model });
        }
        break;
    }
  }, []);

  const handleStreamMessage = useCallback((msg: any) => {
    console.log('[TOKENICODE] stream msg:', msg?.type, msg?.subtype, msg);

    if (!msg || !msg.type) return;

    // --- Background routing: detect if this stream belongs to a non-active tab ---
    // Each stream message is tagged with __stdinId by the listener closure.
    // Look up which tabId owns this stdinId and compare with active tab.
    const msgStdinId = msg.__stdinId;
    const ownerTabId = msgStdinId
      ? useSessionStore.getState().getTabForStdin(msgStdinId)
      : undefined;
    const activeTabId = useSessionStore.getState().selectedSessionId;
    const isBackground = ownerTabId && ownerTabId !== activeTabId;

    // If stream belongs to a background tab, route key events to cache and return
    if (isBackground) {
      handleBackgroundStreamMessage(msg, ownerTabId);
      return;
    }

    const { addMessage, updatePartialMessage, updatePartialThinking,
      setSessionStatus, setSessionMeta, setActivityStatus } = useChatStore.getState();
    const agentActions = useAgentStore.getState();
    const agentId = resolveAgentId(msg.parent_tool_use_id, agentActions.agents);

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

        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text) {
            // updatePartialMessage now also sets activityStatus to 'writing'
            updatePartialMessage(text);
          }
        } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
          const thinkingText = evt.delta.thinking || '';
          if (thinkingText) {
            updatePartialThinking(thinkingText);
          } else {
            setActivityStatus({ phase: 'thinking' });
          }
        }
        // Early detection: create plan_review card as soon as ExitPlanMode
        // starts streaming, before the full assistant message arrives.
        // This breaks the deadlock where the CLI waits for stdin approval
        // but the frontend waits for the full assistant message to show the card.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode') {
          const currentMessages = useChatStore.getState().messages;
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

        // Track input tokens from message_start
        if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
          const current = useChatStore.getState().sessionMeta.inputTokens || 0;
          setSessionMeta({ inputTokens: current + evt.message.usage.input_tokens });
        }

        // Track output tokens from message_delta (final event per message)
        if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
          const current = useChatStore.getState().sessionMeta.outputTokens || 0;
          setSessionMeta({ outputTokens: current + evt.usage.output_tokens });
        }
        break;
      }

      case 'system':
        if (msg.subtype === 'init') {
          setSessionMeta({ model: msg.model });
        }
        break;

      case 'assistant': {
        // Full assistant message arrives — clear partial streaming text first
        // (the complete text will be added as a proper message below)
        clearPartial();

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

        const content = msg.message?.content;
        if (!Array.isArray(content)) break;

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
              timestamp: Date.now(),
            });
          } else if (block.type === 'tool_use') {
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
              console.log('[TOKENICODE] AskUserQuestion block:', JSON.stringify(block));
              // Use a stable sentinel ID so re-delivered blocks de-duplicate
              // instead of creating duplicate question cards (TK-103).
              const questionId = block.id || 'ask_question_current';
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
                timestamp: Date.now(),
              });
            } else if (block.name === 'ExitPlanMode') {
              // Find plan content from the most recent Write tool_use message
              const currentMessages = useChatStore.getState().messages;
              let planContent = '';
              for (let i = currentMessages.length - 1; i >= 0; i--) {
                const m = currentMessages[i];
                if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
                  planContent = m.toolInput.content;
                  break;
                }
              }

              // Show ExitPlanMode as a collapsible tool_use (like other tools)
              const exitPlanToolId = block.id || generateMessageId();
              addMessage({
                id: exitPlanToolId,
                role: 'assistant',
                type: 'tool_use',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                timestamp: Date.now(),
              });

              // Guard against re-delivered ExitPlanMode after user already approved:
              // If this exact tool_use already existed AND the plan review was resolved,
              // this is a replay — don't create a new unresolved card.
              const toolAlreadyExisted = block.id && currentMessages.some(
                (m) => m.id === block.id && m.toolName === 'ExitPlanMode',
              );
              const existingReview = currentMessages.find(
                (m) => m.type === 'plan_review' && m.resolved,
              );
              if (toolAlreadyExisted && existingReview) {
                // Re-delivery of already-approved plan — skip creating new card
                break;
              }

              // Use a FIXED stable ID for the plan review card so that
              // multiple ExitPlanMode deliveries (from --include-partial-messages)
              // always update the same card instead of creating duplicates.
              const unresolvedReview = currentMessages.find(
                (m) => m.id === 'plan_review_current' && m.type === 'plan_review' && !m.resolved,
              );
              const reviewId = unresolvedReview
                ? 'plan_review_current'  // Update existing unresolved card
                : 'plan_review_current'; // First card — use stable ID

              addMessage({
                id: reviewId,
                role: 'assistant',
                type: 'plan_review',
                content: planContent,
                planContent: planContent,
                resolved: false,
                timestamp: Date.now(),
              });

              // Set awaiting status
              setActivityStatus({ phase: 'awaiting' });
            } else {
              addMessage({
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'tool_use',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                timestamp: Date.now(),
              });

              // Track file creation for snapshot-based code restore
              if (block.name === 'Write' && block.input?.file_path) {
                useSnapshotStore.getState().recordCreatedFile(block.input.file_path);
              }
            }
          } else if (block.type === 'thinking') {
            // Complete thinking block arrived — clear streaming thinking text
            useChatStore.setState({ partialThinking: '' });
            setActivityStatus({ phase: 'thinking' });
            agentActions.updatePhase(agentId, 'thinking');
            addMessage({
              id: generateMessageId(),
              role: 'assistant',
              type: 'thinking',
              content: block.thinking || '',
              timestamp: Date.now(),
            });
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
                ? block.content.map((b: any) => b.text || b.content || '').join('')
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
            : tur.stdout || tur.content || '';
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
          ? msg.content.map((b: any) => b.text || b.content || '').join('')
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
          timestamp: Date.now(),
        });
        break;
      }

      case 'tool_use_summary':
        break;

      case 'result': {
        console.log('[TOKENICODE] result event full:', JSON.stringify(msg));
        // Clear any remaining partial text before marking turn complete
        clearPartial();

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
              timestamp: Date.now(),
            });
          }
        }

        setSessionStatus(
          msg.subtype === 'success' ? 'completed' : 'error'
        );
        setSessionMeta({
          cost: msg.total_cost_usd,
          duration: msg.duration_ms,
          turns: msg.num_turns,
          inputTokens: msg.usage?.input_tokens,
          outputTokens: msg.usage?.output_tokens,
          turnStartTime: undefined,
        });
        agentActions.completeAll(
          msg.subtype === 'success' ? 'completed' : 'error'
        );
        useSessionStore.getState().fetchSessions();
        setTimeout(() => useSessionStore.getState().fetchSessions(), 1000);

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
          if (text) {
            // updatePartialMessage now also sets activityStatus to 'writing'
            updatePartialMessage(text);
          }
        }
        break;
    }
  }, []);

  // Handle stderr lines — detect permission prompts and other interactive requests
  const handleStderrLine = useCallback((line: string, _sid: string) => {
    const { addMessage } = useChatStore.getState();

    // Detect ExitPlanMode prompt — create plan_review card as fallback
    // if the stream_event early detection didn't fire
    if (/(?:Exit|Leave)\s+plan\s+mode/i.test(line)) {
      const store = useChatStore.getState();
      const pendingReview = store.messages.find(
        (m) => m.id === 'plan_review_current' && m.type === 'plan_review' && !m.resolved,
      );
      if (!pendingReview) {
        let planContent = '';
        for (let i = store.messages.length - 1; i >= 0; i--) {
          const m = store.messages[i];
          if (m.type === 'tool_use' && m.toolName === 'Write' && m.toolInput?.content) {
            planContent = m.toolInput.content;
            break;
          }
        }
        addMessage({
          id: 'plan_review_current',
          role: 'assistant', type: 'plan_review',
          content: planContent, planContent: planContent,
          resolved: false, timestamp: Date.now(),
        });
        store.setActivityStatus({ phase: 'awaiting' });
      }
      return;
    }

    // Detect permission prompts from Claude CLI stderr
    // Common patterns: "Allow <tool>?", "Do you want to allow", "Permission requested"
    const permissionPatterns = [
      /(?:Allow|Permit|Approve)\s+(.+?)\s*\?/i,
      /(?:Do you want to (?:allow|permit|run))\s+(.+?)\s*\?/i,
      /Permission (?:requested|required)(?:\s+for)?\s*(.*)/i,
      /(?:Press|Type)\s+[Yy]\s+to\s+(?:allow|approve|continue)/i,
    ];

    for (const pattern of permissionPatterns) {
      const match = line.match(pattern);
      if (match) {
        addMessage({
          id: generateMessageId(),
          role: 'system',
          type: 'permission',
          content: line.trim(),
          permissionTool: match[1]?.trim() || '',
          permissionDescription: line.trim(),
          resolved: false,
          timestamp: Date.now(),
        });
        return;
      }
    }
  }, []);

  // Register global stream handler on mount so pre-warm events (system:init,
  // process_exit) are processed immediately — not deferred until user sends.
  // Without this, a pre-warm process_exit would be silently dropped and stdinId
  // would remain set, causing sendStdin to write to a dead process.
  useEffect(() => {
    (window as any).__claudeStreamHandler = handleStreamMessage;
    return () => {
      // Only clear if it's still our handler (avoid clobbering a newer one)
      if ((window as any).__claudeStreamHandler === handleStreamMessage) {
        (window as any).__claudeStreamHandler = null;
      }
    };
  }, [handleStreamMessage]);

  // --- Keyboard handler ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash command navigation
    if (slashVisible) {
      const filtered = getFilteredCommandList(slashCommands, slashQuery);
      const count = filtered.length;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((prev) => (prev - 1 + count) % count);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % count);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        if (filtered[slashIndex]) {
          handleSlashSelect(filtered[slashIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashVisible(false);
        return;
      }
    }

    // Backspace at position 0 with empty input removes active prefix
    if (e.key === 'Backspace' && activePrefix && input === '') {
      e.preventDefault();
      useCommandStore.getState().clearPrefix();
      return;
    }

    if (e.key !== 'Enter') return;

    // Skip if IME composition is in progress (e.g. Chinese/Japanese input method
    // confirming a candidate with Enter — should NOT send the message)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.metaKey || e.ctrlKey) {
      // Cmd+Enter / Ctrl+Enter → insert newline
      e.preventDefault();
      const textarea = textareaRef.current;
      if (textarea) {
        const { selectionStart, selectionEnd } = textarea;
        const val = textarea.value;
        const newVal = val.slice(0, selectionStart) + '\n' + val.slice(selectionEnd);
        // Update React state + restore cursor position
        setInput(newVal);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
        });
      }
    } else if (!e.shiftKey) {
      // Plain Enter → send message
      e.preventDefault();
      handleSubmit();
    }
    // Shift+Enter → default browser behavior (inserts newline in textarea)
  };

  // --- File handling ---
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      // Reset the input so the same file can be selected again
      e.target.value = '';
    }
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.files;
    if (items && items.length > 0) {
      e.preventDefault();
      addFiles(items);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Internal file tree drag uses mouse events (not HTML5 drag), so won't reach here.
    // OS file drops are handled by Tauri onDragDropEvent in useFileAttachments.
  }, []);

  return (
    <div className="p-4 relative">
      <div className="max-w-3xl mx-auto">
        {/* Rewind Panel — positioned above the input area */}
        {showRewindPanel && (
          <RewindPanel onClose={() => setShowRewindPanel(false)} />
        )}

        {/* File upload chips */}
        {(files.length > 0 || isProcessing) && (
          <div className="mb-2">
            <FileUploadChips files={files} onRemove={removeFile} isProcessing={isProcessing} />
          </div>
        )}

        {/* Active prefix description — shown above textarea when a command is selected */}
        {activePrefix && (
          <div className="mb-1 px-1">
            <span className="text-[10px] text-text-tertiary">{activePrefix.description}</span>
          </div>
        )}

        {/* Main input area */}
        <div className="relative">
          <SlashCommandPopover
            query={slashQuery}
            visible={slashVisible}
            selectedIndex={slashIndex}
            onSelect={handleSlashSelect}
            onClose={() => setSlashVisible(false)}
          />
          <div
            className={`flex items-center gap-2 bg-bg-input border rounded-2xl px-4 py-2.5
              focus-within:border-border-focus focus-within:shadow-glow
              transition-smooth group/input
              ${isDragging
                ? 'border-accent bg-accent/5 shadow-glow'
                : 'border-border-subtle'
              }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
          {/* Prefix chip + textarea inline */}
          <div className="flex-1 flex items-start gap-0 min-w-0">
            {activePrefix && (
              <div className="flex-shrink-0 flex items-center h-[24px] mt-[2px]">
                <span className="inline-flex items-center gap-1 px-2 py-0.5
                  bg-accent/10 border border-accent/20 rounded-md
                  text-xs text-accent font-medium font-mono whitespace-nowrap mr-1.5">
                  {activePrefix.name}
                  <button
                    onClick={() => useCommandStore.getState().clearPrefix()}
                    className="hover:text-red-400 transition-smooth ml-0.5"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                      stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </span>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                // Detect slash command
                detectSlashCommand(val);
                // Auto-shrink when text is deleted (onInput may not catch React state updates)
                const el = e.target;
                el.style.height = 'auto';
                const maxH = Math.max(128, Math.floor(window.innerHeight * 0.5));
                el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={activePrefix
                ? t('input.prefixPlaceholder')
                : isRunning
                  ? t('input.followUp')
                  : t('input.placeholder')}
              rows={1}
              className="flex-1 bg-transparent text-sm text-text-primary
                placeholder:text-text-tertiary resize-none outline-none
                leading-normal overflow-y-auto min-w-0 py-0.5"
              style={{
                height: 'auto',
                minHeight: '24px',
                maxHeight: '50vh',
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                const maxH = Math.max(128, Math.floor(window.innerHeight * 0.5));
                el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
              }}
            />
          </div>
          {/* Shortcut hint — visible when input area is not focused and input is empty */}
          {!input && !activePrefix && !isRunning && (
            <span className="flex-shrink-0 text-[10px] text-text-tertiary/50
              group-focus-within/input:hidden select-none whitespace-nowrap
              self-center mr-1">
              {t('input.shortcutHint')}
            </span>
          )}
          {/* Stop button — visible only while running */}
          {isRunning && (
            <button
              onClick={async () => {
                const sid = useChatStore.getState().sessionMeta.stdinId;
                if (sid) {
                  await bridge.killSession(sid).catch(() => {});
                }
                if ((window as any).__claudeUnlisten) {
                  (window as any).__claudeUnlisten();
                  (window as any).__claudeUnlisten = null;
                }
                useChatStore.getState().setSessionStatus('completed');
                useChatStore.getState().setActivityStatus({ phase: 'completed' });
                useChatStore.getState().setSessionMeta({});
              }}
              className="flex-shrink-0 self-end w-8 h-8 rounded-[10px]
                bg-red-500/15 text-red-500
                flex items-center justify-center
                hover:bg-red-500/25 transition-smooth"
              title={t('input.stop')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16"
                fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="2" />
              </svg>
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!input.trim() && !activePrefix}
            className="flex-shrink-0 self-end w-8 h-8 rounded-[10px]
              bg-accent hover:bg-accent-hover text-text-inverse
              flex items-center justify-center
              hover:shadow-glow transition-smooth
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 16 16"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
          </div>
        </div>

        {/* Tool row: upload, mode, model */}
        <div className="flex items-center gap-2 mt-2 px-1">
          {/* Upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-lg text-text-tertiary
              hover:text-text-primary hover:bg-bg-secondary
              transition-smooth"
            title={t('input.attachFiles')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M14 8.5l-5.5 5.5a3.5 3.5 0 01-5-5l6-6a2.5 2.5 0 013.5 3.5l-6 6a1.5 1.5 0 01-2-2l5.5-5.5" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Mode selector */}
          <ModeSelector disabled={isRunning} />

          {/* Think toggle */}
          <ThinkToggle disabled={isRunning} />

          {/* Rewind button */}
          {showRewind && (
            <button
              onClick={() => {
                if (!canRewind) return;
                setShowRewindPanel(!showRewindPanel);
              }}
              disabled={!canRewind}
              className={`p-1.5 rounded-lg transition-smooth flex items-center gap-1
                ${!canRewind
                  ? 'opacity-30 cursor-not-allowed text-text-tertiary'
                  : showRewindPanel
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'text-text-tertiary hover:text-text-primary hover:bg-bg-secondary'
                }`}
              title={canRewind
                ? `${t('rewind.title')} (Esc×2)`
                : t('rewind.disabled')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 8a6 6 0 0110.97-3.35M14 8a6 6 0 01-10.97 3.35" />
                <path d="M13 2v3h-3" strokeLinejoin="round" />
                <path d="M3 14v-3h3" strokeLinejoin="round" />
              </svg>
              <span className="text-[10px]">{t('rewind.title')}</span>
            </button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Plan view button */}
          <PlanToggleButton />

          {/* Model selector */}
          <ModelSelector disabled={isRunning} />
        </div>
      </div>
    </div>
  );
}
