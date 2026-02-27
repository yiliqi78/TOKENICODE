import { useState, useRef, useCallback, useEffect } from 'react';
import { useChatStore, generateMessageId, type ChatMessage } from '../../stores/chatStore';
import { useSettingsStore, MODEL_OPTIONS, mapSessionModeToPermissionMode, type ThinkingLevel } from '../../stores/settingsStore';
import { bridge, onClaudeStream, onClaudeStderr, onSessionExit, onPermissionRequest, type UnifiedCommand, type PermissionRequest } from '../../lib/tauri-bridge';
import { ModelSelector } from './ModelSelector';
import { ModeSelector } from './ModeSelector';
import { FileUploadChips } from './FileUploadChips';
import { RewindPanel } from './RewindPanel';
import { useFileAttachments } from '../../hooks/useFileAttachments';
import { useRewind } from '../../hooks/useRewind';
import { useAgentStore, resolveAgentId, getAgentDepth } from '../../stores/agentStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useT } from '../../lib/i18n';
import { SlashCommandPopover, getFilteredCommandList } from './SlashCommandPopover';
import { useCommandStore } from '../../stores/commandStore';
import { buildCustomEnvVars, envFingerprint, resolveModelForProvider } from '../../lib/api-provider';
import { stripAnsi } from '../../lib/strip-ansi';
import { usePlanPanelStore } from './ChatPanel';
import { useSnapshotStore } from '../../stores/snapshotStore';
import { PlanReviewCard } from './PlanReviewCard';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';
import { TiptapEditor, type TiptapEditorHandle } from './TiptapEditor';
// drag-state import removed — tree drag handled by ChatPanel

/** Thinking effort level configuration data */
const THINK_LEVELS: { id: ThinkingLevel; labelKey: string }[] = [
  { id: 'off', labelKey: 'think.off' },
  { id: 'low', labelKey: 'think.low' },
  { id: 'medium', labelKey: 'think.medium' },
  { id: 'high', labelKey: 'think.high' },
];

/** Thinking effort level selector dropdown for the toolbar */
function ThinkLevelSelector({ disabled = false }: { disabled?: boolean }) {
  const t = useT();
  const thinkingLevel = useSettingsStore((s) => s.thinkingLevel);
  const setThinkingLevel = useSettingsStore((s) => s.setThinkingLevel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isOff = thinkingLevel === 'off';
  const current = THINK_LEVELS.find((l) => l.id === thinkingLevel) || THINK_LEVELS[3];

  return (
    <div ref={ref} className={`relative ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs
          border transition-smooth cursor-pointer
          ${isOff
            ? 'border-border-subtle bg-bg-secondary/50 text-text-muted hover:text-text-primary hover:bg-bg-secondary'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
          }`}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="6" r="4" />
          <path d="M5.5 9.5C5.5 11.5 6 13 8 13s2.5-1.5 2.5-3.5" />
          <path d="M6.5 14h3" />
        </svg>
        <span className="font-medium">{t(current.labelKey)}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>
          <path d="M1.5 3L4 5.5 6.5 3" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[140px]
          bg-bg-card border border-border-subtle rounded-lg shadow-lg
          py-1 z-50 animate-fade-in">
          {THINK_LEVELS.map((level) => {
            const isActive = level.id === thinkingLevel;
            return (
              <button
                key={level.id}
                onClick={() => { setThinkingLevel(level.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs
                  transition-smooth cursor-pointer
                  ${isActive
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
                  }`}
              >
                {t(level.labelKey)}
                {isActive && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                    stroke="currentColor" strokeWidth="1.5" className="ml-auto">
                    <path d="M2.5 6l2.5 2.5 4.5-4.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
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

/* PlanApprovalBar removed — PlanReviewCard (triggered by ExitPlanMode detection)
   is the proper plan approval UI. The fallback bar was too broad: it appeared on
   every completed session in plan/bypass mode, even without a real plan. */

export function InputBar() {
  const t = useT();
  const inputDraft = useChatStore((s) => s.inputDraft);
  const setInputDraft = useChatStore((s) => s.setInputDraft);
  // Local alias for the store-backed draft
  const input = inputDraft;
  const setInput = setInputDraft;
  const textareaRef = useRef<TiptapEditorHandle>(null);
  /** Sync both the Zustand store and the tiptap editor.
   *  Use this for all programmatic input changes (clear, set, etc.).
   *  The editor's onUpdate callback uses setInput directly to avoid circular updates. */
  const setInputSync = useCallback((text: string) => {
    setInput(text);
    textareaRef.current?.setText(text);
  }, [setInput]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionStatus = useChatStore((s) => s.sessionStatus);
  const addMessage = useChatStore((s) => s.addMessage);
  const setSessionStatus = useChatStore((s) => s.setSessionStatus);
  const setSessionMeta = useChatStore((s) => s.setSessionMeta);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const sessionMode = useSettingsStore((s) => s.sessionMode);

  const handlePlanApprove = useCallback(async () => {
    const currentMode = useSettingsStore.getState().sessionMode;
    const meta = useChatStore.getState().sessionMeta;
    const status = useChatStore.getState().sessionStatus;

    // If CLI is still alive (e.g., Bypass auto-accepted ExitPlanMode),
    // just dismiss the card — no restart needed.
    if (meta.stdinId && status === 'running') {
      useChatStore.getState().setActivityStatus({ phase: 'thinking' });
      return;
    }

    // CLI exited after ExitPlanMode (permission denied in stream-json mode).
    // Plan mode: switch to Code mode for execution.
    // Bypass mode: stay in Bypass (no mode switch needed).
    if (currentMode === 'plan') {
      useSettingsStore.getState().setSessionMode('code');
    }

    // Clean up dead CLI process
    if (meta.stdinId) {
      useChatStore.getState().setSessionMeta({ stdinId: undefined });
      bridge.killSession(meta.stdinId).catch(() => {});
      if ((window as any).__claudeUnlisteners?.[meta.stdinId]) {
        (window as any).__claudeUnlisteners[meta.stdinId]();
        delete (window as any).__claudeUnlisteners[meta.stdinId];
      }
    }

    // Restart with --resume <sessionId>
    useChatStore.getState().setActivityStatus({ phase: 'thinking' });
    setInputSync('Execute the plan above.');
    requestAnimationFrame(() => {
      handleSubmitRef.current();
    });
  }, [setInputSync]);

  // Listen for plan-execute events from PlanReviewCard and Enter shortcut
  useEffect(() => {
    const handler = () => handlePlanApprove();
    window.addEventListener('tokenicode:plan-execute', handler);
    return () => window.removeEventListener('tokenicode:plan-execute', handler);
  }, [handlePlanApprove]);

  // Floating approval cards — unresolved plan_review / question messages
  // are rendered above the input instead of inline in the chat flow.
  const floatingCard = useChatStore((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const m = s.messages[i];
      if ((m.type === 'plan_review' || m.type === 'question' || m.type === 'permission') && !m.resolved) return m;
    }
    return null;
  });

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

  // Inline file insertion: drop or drag → insert a file chip at cursor
  useEffect(() => {
    const onTreeFileInline = (e: Event) => {
      const fullPath = (e as CustomEvent<string>).detail;
      if (!fullPath || !textareaRef.current) return;

      // Convert to path relative to working directory for readability
      const cwd = useSettingsStore.getState().workingDirectory;
      let displayPath = fullPath;
      if (cwd && fullPath.startsWith(cwd)) {
        displayPath = fullPath.slice(cwd.length).replace(/^[\\/]/, '');
      }

      textareaRef.current.insertFileChip({ fullPath, label: displayPath });
    };
    window.addEventListener('tokenicode:tree-file-inline', onTreeFileInline);
    return () => window.removeEventListener('tokenicode:tree-file-inline', onTreeFileInline);
  }, []);

  // Slash command state
  const [slashQuery, setSlashQuery] = useState('');
  const [slashVisible, setSlashVisible] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashCommands = useCommandStore((s) => s.commands);
  const activePrefix = useCommandStore((s) => s.activePrefix);

  // Rewind state
  const [showRewindPanel, setShowRewindPanel] = useState(false);
  const { canRewind } = useRewind();
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
  // Ref to always point to the latest handleStderrLine (used by retry logic in handleStreamMessage)
  const handleStderrLineRef = useRef<(line: string, sid: string) => void>(() => {});
  /** Tracks whether auto-compact has been triggered in this session to avoid repeat fires */
  const autoCompactFiredRef = useRef(false);
  /** Tracks ExitPlanMode in current turn for Code mode auto-restart */
  const exitPlanModeSeenRef = useRef(false);
  /** When true, next handleSubmit skips creating user message bubble (Code mode silent restart) */
  const silentRestartRef = useRef(false);

  // --- Immediate command execution ---
  // All built-in commands are handled in the UI layer because they don't work
  // via stdin in stream-json mode (CLI treats them as normal text, not commands).
  const executeImmediateCommand = useCallback(async (cmdName: string, args?: string) => {
    const cmd = cmdName.toLowerCase().replace(/^\//, '');
    const { addMessage } = useChatStore.getState();

    // Always clear the input box first
    setInputSync('');

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
        useChatStore.getState().resetSession();
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
    setInputSync('');

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
    // Read input from store directly (not closure) so that async callers
    // like handlePlanApprove (setInput + rAF) always see the latest value.
    const rawInput = useChatStore.getState().inputDraft || '';
    let text = rawInput.trim();

    // Plan approval shortcut: empty Enter triggers approve & execute flow
    const pendingPlanReview = useChatStore.getState().messages.find(
      (m) => m.type === 'plan_review' && !m.resolved,
    );
    if (pendingPlanReview && !text && !useCommandStore.getState().activePrefix) {
      useChatStore.getState().updateMessage(pendingPlanReview.id, { resolved: true });
      window.dispatchEvent(new CustomEvent('tokenicode:plan-execute'));
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
          setInputSync('');
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
          setInputSync('');
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

    setInputSync('');

    // Silent restart: skip user message bubble (Code mode ExitPlanMode auto-recovery)
    if (silentRestartRef.current) {
      silentRestartRef.current = false;
    } else {
      // Add user message (show original text, not with prefix)
      addMessage({
        id: generateMessageId(),
        role: 'user',
        type: 'text',
        content: rawInput.trim(),
        timestamp: Date.now(),
        attachments: files.length > 0
          ? files.map((f) => ({ name: f.name, path: f.path, isImage: f.isImage, preview: f.preview }))
          : undefined,
      });
    }

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
      description: rawInput.trim(),
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
        // Check if API provider config changed since this process was spawned (TK-303).
        // If so, the pre-warmed process has stale env vars — kill it and spawn fresh.
        const currentFp = envFingerprint();
        const sessionFp = useChatStore.getState().sessionMeta.envFingerprint;
        if (currentFp !== sessionFp) {
          console.warn('[TOKENICODE] API provider config changed, killing stale session');
          bridge.killSession(stdinId).catch(() => {});
          if ((window as any).__claudeUnlisteners?.[stdinId]) {
            (window as any).__claudeUnlisteners[stdinId]();
            delete (window as any).__claudeUnlisteners[stdinId];
          }
          // Keep sessionId so we attempt resume (preserving context).
          // If the resume fails due to thinking signature mismatch, the
          // stream error handler will auto-retry without resume.
          setSessionMeta({ stdinId: undefined, envFingerprint: undefined, providerSwitched: true, providerSwitchPendingText: text });
          stdinId = undefined;
        } else {
          // Check if model changed since this process was spawned.
          // If so, kill the stale process and fall through to spawn a new one with --resume.
          const currentModel = resolveModelForProvider(selectedModel);
          const spawnedModel = useChatStore.getState().sessionMeta.spawnedModel;
          if (spawnedModel && currentModel !== spawnedModel) {
            const oldShort = MODEL_OPTIONS.find((m) => m.id === spawnedModel)?.short ?? spawnedModel;
            const newShort = MODEL_OPTIONS.find((m) => m.id === currentModel)?.short ?? currentModel;
            console.warn(`[TOKENICODE] Model changed (${oldShort} → ${newShort}), killing stale session`);
            bridge.killSession(stdinId).catch(() => {});
            if ((window as any).__claudeUnlisteners?.[stdinId]) {
              (window as any).__claudeUnlisteners[stdinId]();
              delete (window as any).__claudeUnlisteners[stdinId];
            }
            // System message already inserted by ModelSelector — no duplicate here.
            // Keep sessionId so we attempt resume (preserving context).
            setSessionMeta({ stdinId: undefined, spawnedModel: undefined, modelSwitched: true, modelSwitchPendingText: text });
            stdinId = undefined;
          } else {
          // ===== Send via stdin to existing persistent process (pre-warmed or follow-up) =====
          try {
            await bridge.sendStdin(stdinId, text);
            sentViaStdin = true;
            // Defensive: ensure spawnedModel is always recorded after first successful stdin send
            if (!useChatStore.getState().sessionMeta.spawnedModel) {
              setSessionMeta({ spawnedModel: resolveModelForProvider(selectedModel) });
            }
          } catch (stdinErr) {
            // stdin write failed (broken pipe — process already exited).
            // Clear the dead stdinId and fall through to spawn a new process.
            console.warn('[TOKENICODE] sendStdin failed, spawning new process:', stdinErr);
            setSessionMeta({ stdinId: undefined });
            stdinId = undefined;
          }
          }
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

        // Reset guards for the new session
        autoCompactFiredRef.current = false;
        exitPlanModeSeenRef.current = false;

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

        // SDK control protocol: listen for structured permission requests
        const unlistenPermission = await onPermissionRequest(
          preGeneratedId,
          (req: PermissionRequest) => {
            const { addMessage, setActivityStatus } = useChatStore.getState();
            addMessage({
              id: generateMessageId(),
              role: 'assistant',
              type: 'permission',
              content: req.description || `${req.tool_name} wants to execute`,
              permissionTool: req.tool_name,
              permissionDescription: req.description || '',
              timestamp: Date.now(),
              interactionState: 'pending',
              permissionData: {
                requestId: req.request_id,
                toolName: req.tool_name,
                input: req.input,
                description: req.description,
                toolUseId: req.tool_use_id,
              },
            });
            setActivityStatus({ phase: 'awaiting' });
          }
        );

        // Backup exit detection: if process_exit from stdout stream is missed
        // (e.g., listener was removed), this fires as a safety net.
        const unlistenExit = await onSessionExit(preGeneratedId, () => {
          console.log('[TOKENICODE] onSessionExit fired for', preGeneratedId);
          const meta = useChatStore.getState().sessionMeta;
          // Only act if this is still the active stdinId (avoid stale cleanup)
          if (meta.stdinId === preGeneratedId) {
            useChatStore.getState().setSessionMeta({ stdinId: undefined });
            const status = useChatStore.getState().sessionStatus;
            if (status === 'running') {
              useChatStore.getState().setSessionStatus('idle');
            }
          }
        });

        // Store unlisten per stdinId for multi-session support
        if (!(window as any).__claudeUnlisteners) {
          (window as any).__claudeUnlisteners = {};
        }
        (window as any).__claudeUnlisteners[preGeneratedId] = () => {
          unlisten();
          unlistenStderr();
          unlistenPermission();
          unlistenExit();
        };
        (window as any).__claudeUnlisten = (window as any).__claudeUnlisteners[preGeneratedId];

        // Spawn persistent process (first message sent via stdin inside Rust)
        // If resuming a historical session, pass resume_session_id so the CLI
        // picks up the existing conversation context.
        // Read sessionMode from store (not closure) so plan-approve → code
        // mode switch is visible even when called via rAF.
        const liveSessionMode = useSettingsStore.getState().sessionMode;
        const session = await bridge.startSession({
          prompt: text,
          cwd,
          model: resolveModelForProvider(selectedModel),
          session_id: preGeneratedId,
          dangerously_skip_permissions: liveSessionMode === 'bypass',
          resume_session_id: existingSessionId || undefined,
          thinking_level: useSettingsStore.getState().thinkingLevel,
          session_mode: (liveSessionMode === 'ask' || liveSessionMode === 'plan') ? liveSessionMode : undefined,
          custom_env: buildCustomEnvVars(),
          permission_mode: mapSessionModeToPermissionMode(liveSessionMode),
        });

        // Store both: session_id for tracking, stdinId (preGeneratedId) for stdin communication
        setSessionMeta({ sessionId: session.session_id, stdinId: preGeneratedId, envFingerprint: envFingerprint(), spawnedModel: resolveModelForProvider(selectedModel) });

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
  }, [hasActiveSession, workingDirectory, selectedModel, sessionMode, files, clearFiles]);

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
        // Early detection: create plan_review card for background tab (Plan mode only)
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode'
            && ['plan', 'bypass'].includes(useSettingsStore.getState().sessionMode)) {
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
              // Only create plan_review card in Plan or Bypass mode
              if (['plan', 'bypass'].includes(useSettingsStore.getState().sessionMode)) {
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
          if (text) {
            // updatePartialMessage now also sets activityStatus to 'writing'
            updatePartialMessage(text);
            agentActions.updatePhase(agentId, 'writing');
          }
        } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'thinking_delta') {
          const thinkingText = evt.delta.thinking || '';
          if (thinkingText) {
            updatePartialThinking(thinkingText);
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
        // In Code/Bypass modes the CLI handles ExitPlanMode natively — no UI card needed.
        if (evt.type === 'content_block_start'
            && evt.content_block?.type === 'tool_use'
            && evt.content_block?.name === 'ExitPlanMode'
            && ['plan', 'bypass'].includes(useSettingsStore.getState().sessionMode)) {
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
              console.log('[TOKENICODE] AskUserQuestion block:', JSON.stringify(block));
              // Use a stable sentinel ID so re-delivered blocks de-duplicate
              // instead of creating duplicate question cards (TK-103).
              const questionId = block.id || 'ask_question_current';

              // Guard: skip if question already exists (resolved or not)
              const currentMessages = useChatStore.getState().messages;
              const existingQuestion = currentMessages.find(
                (m) => m.id === questionId && m.type === 'question',
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

              // Only create plan_review card in Plan or Bypass mode.
              // In Code mode the CLI handles ExitPlanMode natively.
              if (['plan', 'bypass'].includes(useSettingsStore.getState().sessionMode)) {
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

              // Track file creation for snapshot-based code restore
              if (block.name === 'Write' && block.input?.file_path) {
                useSnapshotStore.getState().recordCreatedFile(block.input.file_path);
              }
            }
          } else if (block.type === 'thinking') {
            // Complete thinking block arrived — clear streaming thinking text.
            // DON'T override activityStatus here: if text is currently streaming,
            // the phase should remain 'writing'. The streaming events (thinking_delta,
            // text_delta) are the source of truth for activity phase.
            useChatStore.setState({ partialThinking: '' });
            agentActions.updatePhase(agentId, 'thinking');
            addMessage({
              id: generateMessageId(),
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
        console.log('[TOKENICODE] result event full:', JSON.stringify(msg));

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

                const retryId = `desk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
                  dangerously_skip_permissions: sessionMode === 'bypass',
                  // No resume_session_id — fresh start to avoid thinking signature issue
                  thinking_level: useSettingsStore.getState().thinkingLevel,
                  session_mode: (sessionMode === 'ask' || sessionMode === 'plan') ? sessionMode : undefined,
                  custom_env: buildCustomEnvVars(),
                  permission_mode: mapSessionModeToPermissionMode(sessionMode),
                });

                setSessionMeta({ sessionId: session.session_id, stdinId: retryId, envFingerprint: envFingerprint(), spawnedModel: resolveModelForProvider(selectedModel) });
                const tabId = useSessionStore.getState().selectedSessionId;
                if (tabId) useSessionStore.getState().registerStdinTab(retryId, tabId);
                bridge.trackSession(session.session_id).catch(() => {});
              } catch (retryErr) {
                console.error('[TOKENICODE] Provider-switch auto-retry failed:', retryErr);
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

        // --- Auto-compact: when input tokens exceed 160K (80% of 200K context),
        // automatically send /compact to prevent context overflow on the next turn.
        // Fires at most once per session to avoid infinite loops.
        const resultInputTokens = msg.usage?.input_tokens || 0;
        const compactStdinId = useChatStore.getState().sessionMeta.stdinId;
        if (resultInputTokens > 160_000 && !autoCompactFiredRef.current && compactStdinId && msg.subtype === 'success') {
          autoCompactFiredRef.current = true;
          console.log('[TOKENICODE] Auto-compact triggered: inputTokens =', resultInputTokens);
          addMessage({
            id: generateMessageId(),
            role: 'system',
            type: 'text',
            content: '',
            commandType: 'processing',
            commandData: { command: '/compact' },
            commandStartTime: Date.now(),
            commandCompleted: false,
            timestamp: Date.now(),
          });
          setSessionStatus('running');
          setActivityStatus({ phase: 'thinking' });
          bridge.sendStdin(compactStdinId, '/compact').catch((err) => {
            console.error('[TOKENICODE] Auto-compact failed:', err);
          });
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
    // Strip ANSI escape codes so regex matching works on raw text
    const clean = stripAnsi(line).trim();
    console.log('[TOKENICODE:stderr]', clean);
    const { addMessage } = useChatStore.getState();

    // Detect ExitPlanMode prompt — create plan_review card as fallback (Plan mode only).
    // In Code mode the CLI handles this natively.
    if (/(?:Exit|Leave)\s+plan\s+mode/i.test(clean)
        && ['plan', 'bypass'].includes(useSettingsStore.getState().sessionMode)) {
      const store = useChatStore.getState();
      const existingReview = store.messages.find(
        (m) => m.id === 'plan_review_current' && m.type === 'plan_review',
      );
      if (!existingReview || existingReview.resolved) {
        if (existingReview?.resolved) return;
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

    // Permission prompts are now handled via SDK control protocol (P1-03/P1-04).
    // The Rust backend intercepts control_request messages from stdout and emits
    // them on the claude:permission_request channel, which is handled by
    // onPermissionRequest above. Stderr is now purely for diagnostic logging.
  }, []);

  // Keep stderr ref in sync so auto-retry logic in handleStreamMessage can call it
  handleStderrLineRef.current = handleStderrLine;

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
  /** Keyboard handler for the tiptap editor.
   *  Receives a native KeyboardEvent (not React.KeyboardEvent).
   *  Return true to prevent tiptap default handling. */
  const handleKeyDown = (e: KeyboardEvent): boolean | void => {
    // Slash command navigation
    if (slashVisible) {
      const filtered = getFilteredCommandList(slashCommands, slashQuery);
      const count = filtered.length;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((prev) => (prev - 1 + count) % count);
        return true;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % count);
        return true;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        if (filtered[slashIndex]) {
          handleSlashSelect(filtered[slashIndex]);
        }
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashVisible(false);
        return true;
      }
    }

    // Backspace at position 0 with empty input removes active prefix
    if (e.key === 'Backspace' && activePrefix && (textareaRef.current?.isEmpty() ?? true)) {
      e.preventDefault();
      useCommandStore.getState().clearPrefix();
      return true;
    }

    if (e.key !== 'Enter') return;

    // Skip if IME composition is in progress (e.g. Chinese/Japanese input method
    // confirming a candidate with Enter — should NOT send the message)
    if (e.isComposing || e.keyCode === 229) return;

    if (e.metaKey || e.ctrlKey) {
      // Cmd+Enter / Ctrl+Enter → let tiptap insert newline (default behavior)
      return false;
    } else if (!e.shiftKey) {
      // Plain Enter → send message
      e.preventDefault();
      handleSubmit();
      return true;
    }
    // Shift+Enter → let tiptap handle (inserts hard break / new paragraph)
    return false;
  };

  // --- File handling ---
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      // Reset the input so the same file can be selected again
      e.target.value = '';
    }
  }, [addFiles]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = (e as any).clipboardData?.files as FileList | undefined;
    if (items && items.length > 0) {
      e.preventDefault();
      addFiles(items);
      return true;
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

        {/* Floating approval card — plan_review, question, or permission awaiting user response */}
        {floatingCard && (
          <div className="mb-3 animate-scale-in">
            {floatingCard.type === 'plan_review'
              ? <PlanReviewCard message={floatingCard} floating />
              : floatingCard.type === 'permission'
                ? <PermissionCard message={floatingCard} />
                : <QuestionCard message={floatingCard} floating />}
          </div>
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
            <TiptapEditor
              ref={textareaRef}
              data-chat-input
              onUpdate={(text) => {
                setInput(text);
                detectSlashCommand(text);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={activePrefix
                ? t('input.prefixPlaceholder')
                : isRunning
                  ? t('input.followUp')
                  : t('input.placeholder')}
              className="flex-1 bg-transparent text-sm text-text-primary
                placeholder:text-text-tertiary resize-none outline-none
                leading-normal overflow-y-auto min-w-0 py-0.5"
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
                // Immediately clear stdinId so no further messages are sent to the dead process
                useChatStore.getState().setSessionMeta({ stdinId: undefined });
                useChatStore.getState().setSessionStatus('completed');
                useChatStore.getState().setActivityStatus({ phase: 'completed' });
                if (sid) {
                  await bridge.killSession(sid).catch(() => {});
                  // Don't unlisten immediately — let process_exit fire naturally to clean up.
                  // The listener will be replaced when a new session spawns (line ~788).
                  // As a safety net, force-clean after 3s if process_exit hasn't arrived.
                  setTimeout(() => {
                    if ((window as any).__claudeUnlisteners?.[sid]) {
                      (window as any).__claudeUnlisteners[sid]();
                      delete (window as any).__claudeUnlisteners[sid];
                    }
                  }, 3000);
                }
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
          <ThinkLevelSelector disabled={isRunning} />

          {/* Rewind button — temporarily hidden (TK-TODO: refactor rewind UX) */}

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
