import { useState, useRef, useCallback, useEffect } from 'react';
import { useChatStore, generateMessageId } from '../../stores/chatStore';
import { useSettingsStore, MODEL_OPTIONS, mapSessionModeToPermissionMode, type ThinkingLevel } from '../../stores/settingsStore';
import { bridge, onClaudeStream, onClaudeStderr, onSessionExit, onPermissionRequest, type UnifiedCommand, type PermissionRequest } from '../../lib/tauri-bridge';
import { ModelSelector } from './ModelSelector';
import { ModeSelector } from './ModeSelector';
import { FileUploadChips } from './FileUploadChips';
import { RewindPanel } from './RewindPanel';
import { useFileAttachments } from '../../hooks/useFileAttachments';
import { useRewind } from '../../hooks/useRewind';
import { useStreamProcessor } from '../../hooks/useStreamProcessor';
import { useAgentStore } from '../../stores/agentStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useT } from '../../lib/i18n';
import { SlashCommandPopover, getFilteredCommandList } from './SlashCommandPopover';
import { useCommandStore } from '../../stores/commandStore';
import { envFingerprint, resolveModelForProvider } from '../../lib/api-provider';
import { useProviderStore } from '../../stores/providerStore';
import { stripAnsi } from '../../lib/strip-ansi';
import { usePlanPanelStore } from './ChatPanel';
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
  const activityPhase = useChatStore((s) => s.activityStatus.phase);
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
  const { showRewind, canRewind } = useRewind();
  const lastEscTime = useRef(0);

  // Listen for rewind event from /rewind command
  useEffect(() => {
    const handler = () => {
      if (canRewind) {
        setShowRewindPanel(true);
      } else {
        useChatStore.getState().addMessage({
          id: generateMessageId(), role: 'system', type: 'text',
          content: t('rewind.disabled'), commandType: 'error', timestamp: Date.now(),
        });
      }
    };
    window.addEventListener('tokenicode:rewind', handler);
    return () => window.removeEventListener('tokenicode:rewind', handler);
  }, [canRewind, t]);

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
        if (canRewind) {
          setShowRewindPanel(true);
        } else {
          useChatStore.getState().addMessage({
            id: generateMessageId(), role: 'system', type: 'text',
            content: t('rewind.disabled'), commandType: 'error', timestamp: Date.now(),
          });
        }
      } else {
        lastEscTime.current = now;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canRewind, showRewindPanel, t]);

  // Drag state (file drop)
  const [isDragging, setIsDragging] = useState(false);

  // Fetch slash commands when working directory changes
  useEffect(() => {
    useCommandStore.getState().fetchCommands(workingDirectory || undefined);
  }, [workingDirectory]);

  const isRunning = sessionStatus === 'running';
  const isAwaiting = isRunning && activityPhase === 'awaiting';

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
  /** Last non-empty stderr line — shown to user if process exits without response */
  const lastStderrRef = useRef('');
  /** Tracks whether auto-compact has been triggered in this session to avoid repeat fires */
  const autoCompactFiredRef = useRef(false);
  /** Tracks ExitPlanMode in current turn for Code mode auto-restart */
  const exitPlanModeSeenRef = useRef(false);
  /** When true, next handleSubmit skips creating user message bubble (Code mode silent restart) */
  const silentRestartRef = useRef(false);

  // Stream processing hook — handles foreground + background stream messages
  const { handleStreamMessage } = useStreamProcessor({
    exitPlanModeSeenRef,
    autoCompactFiredRef,
    silentRestartRef,
    handleSubmitRef,
    handleStderrLineRef,
    lastStderrRef,
    setInputSync,
  });

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


      case 'usage': {
        const meta = useChatStore.getState().sessionMeta;
        const isOfficialProvider = useProviderStore.getState().activeProviderId === null;

        if (isOfficialProvider) {
          // Official Anthropic account: quota data is only available in the CLI REPL TUI.
          // Show local session data + a hint to use the terminal.
          const hasData = meta.cost != null || meta.turns != null
            || meta.inputTokens != null || meta.outputTokens != null;
          const totalInput = meta.totalInputTokens ?? 0;
          const totalOutput = meta.totalOutputTokens ?? 0;
          feedback('info', hasData ? t('cmd.usageTitle') : t('cmd.noSessionData'), {
            command: '/usage',
            title: t('cmd.usageTitle'),
            rows: [
              { label: t('cmd.costModel'), value: modelLabel(meta.model || useSettingsStore.getState().selectedModel) },
              { label: t('cmd.costTurns'), value: meta.turns != null ? String(meta.turns) : '—' },
              { label: t('cmd.usageTotalSession'), value: totalInput || totalOutput
                ? `${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out`
                : '—' },
            ],
            hasData,
            hint: t('cmd.usageOfficialHint'),
          });
        } else {
          // Third-party API provider: show detailed token breakdown.
          const hasData = meta.inputTokens != null || meta.outputTokens != null
            || meta.totalInputTokens != null || meta.totalOutputTokens != null;
          const turnInput = meta.inputTokens ?? 0;
          const turnOutput = meta.outputTokens ?? 0;
          const totalInput = meta.totalInputTokens ?? 0;
          const totalOutput = meta.totalOutputTokens ?? 0;
          feedback('info', hasData ? t('cmd.usageTitle') : t('cmd.noSessionData'), {
            command: '/usage',
            title: t('cmd.usageTitle'),
            rows: [
              { label: t('cmd.costModel'), value: modelLabel(meta.model || useSettingsStore.getState().selectedModel) },
              { label: `${t('cmd.usageCurrentTurn')} — ${t('cmd.usageInput')}`, value: turnInput.toLocaleString() },
              { label: `${t('cmd.usageCurrentTurn')} — ${t('cmd.usageOutput')}`, value: turnOutput.toLocaleString() },
              { label: `${t('cmd.usageTotalSession')} — ${t('cmd.usageInput')}`, value: totalInput.toLocaleString() },
              { label: `${t('cmd.usageTotalSession')} — ${t('cmd.usageOutput')}`, value: totalOutput.toLocaleString() },
              { label: t('cmd.usageTotal'), value: (totalInput + totalOutput).toLocaleString() },
              { label: t('cmd.costAmount'), value: meta.cost != null ? `$${meta.cost.toFixed(4)}` : '—' },
            ],
            hasData,
          });
        }
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
    lastStderrRef.current = ''; // Clear stale stderr before new turn

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
          provider_id: useProviderStore.getState().activeProviderId || undefined,
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

  // handleStreamMessage and handleBackgroundStreamMessage are provided by
  // useStreamProcessor hook (see src/hooks/useStreamProcessor.ts).

  // Handle stderr lines — detect permission prompts and other interactive requests
  const handleStderrLine = useCallback((line: string, sid: string) => {
    // Route: only process stderr for the currently active session
    const currentStdinId = useChatStore.getState().sessionMeta.stdinId;
    if (sid && currentStdinId && sid !== currentStdinId) return;

    // Strip ANSI escape codes so regex matching works on raw text
    const clean = stripAnsi(line).trim();
    console.log('[TOKENICODE:stderr]', clean);

    // Track last non-trivial stderr line for error reporting on unexpected exit
    if (clean && !/^\s*$/.test(clean)) {
      lastStderrRef.current = clean;
    }

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
            disabled={isAwaiting || (!input.trim() && !activePrefix)}
            className={`flex-shrink-0 self-end w-8 h-8 rounded-[10px]
              flex items-center justify-center transition-smooth
              disabled:opacity-30 disabled:cursor-not-allowed
              ${isAwaiting
                ? 'bg-warning/15 text-warning cursor-not-allowed'
                : 'bg-accent hover:bg-accent-hover text-text-inverse hover:shadow-glow cursor-pointer'
              }`}
            title={isAwaiting ? t('input.awaitingInteraction') : undefined}
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

          {/* Rewind button */}
          {showRewind && (
            <button
              onClick={() => { if (canRewind) setShowRewindPanel(!showRewindPanel); }}
              disabled={!canRewind}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-smooth
                ${canRewind
                  ? 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary cursor-pointer'
                  : 'text-text-muted cursor-not-allowed opacity-50'
                }`}
              title={canRewind ? `${t('rewind.title')} (Esc×2)` : t('rewind.disabled')}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"
                stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
                <path d="M2 7a5 5 0 019.33-2.5M12 7a5 5 0 01-9.33 2.5"
                  strokeLinecap="round" />
                <path d="M11 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 12V9h3" strokeLinecap="round" strokeLinejoin="round" />
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
