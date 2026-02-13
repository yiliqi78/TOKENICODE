import { useState, useCallback } from 'react';
import { ChatMessage, useChatStore } from '../../stores/chatStore';
import { useFileStore } from '../../stores/fileStore';
import { useLightboxStore } from '../shared/ImageLightbox';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';

interface Props {
  message: ChatMessage;
  isFirstInGroup?: boolean;
}

export function MessageBubble({ message, isFirstInGroup = true }: Props) {
  if (message.role === 'user') return <UserMsg message={message} />;
  if (message.role === 'system' && message.commandType) return <CommandFeedbackMsg message={message} />;
  if (message.type === 'question') return <QuestionMsg message={message} />;
  if (message.type === 'todo') return <TodoMsg message={message} />;
  if (message.type === 'plan_review') return <PlanReviewMsg message={message} />;
  if (message.type === 'tool_use') return <ToolUseMsg message={message} />;
  if (message.type === 'thinking') return <ThinkingMsg message={message} />;
  if (message.type === 'tool_result') return <ToolResultMsg message={message} />;
  if (message.type === 'permission') return <PermissionMsg message={message} />;
  if (message.type === 'plan') return <PlanMsg message={message} />;
  return <AssistantMsg message={message} isFirstInGroup={isFirstInGroup} />;
}

/* ================================================================
   UserMsg — bubble on the right
   ================================================================ */
function UserMsg({ message }: Props) {
  const attachments = message.attachments;
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-br-md
        bg-bg-user-msg text-text-inverse
        text-sm leading-relaxed shadow-md">
        {message.content}
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {attachments.map((att, i) => (
              <button
                key={i}
                onClick={() => {
                  if (att.isImage) {
                    // Open images in lightbox overlay
                    useLightboxStore.getState().openFile(att.path, att.name);
                  } else {
                    // Open non-images in file preview panel
                    useFileStore.getState().selectFile(att.path);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 py-1
                  bg-white/10 hover:bg-white/20 rounded-lg
                  transition-smooth cursor-pointer text-left"
              >
                {att.isImage && att.preview ? (
                  <img src={att.preview} alt="" className="w-5 h-5 rounded object-cover" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                    stroke="currentColor" strokeWidth="1.2" className="flex-shrink-0 opacity-70">
                    <path d="M7 1H3a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1V4L7 1z" />
                    <path d="M7 1v3h3" />
                  </svg>
                )}
                <span className="text-[11px] truncate max-w-[120px] opacity-90">{att.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   CommandFeedbackMsg — rich UI for slash command results
   Renders mode switches, info cards, help lists, action feedback
   ================================================================ */
function CommandFeedbackMsg({ message }: Props) {
  const t = useT();
  const cType = message.commandType;
  const data = message.commandData || {};

  // --- Mode switch: animated pill with icon ---
  if (cType === 'mode') {
    const modeColors: Record<string, string> = {
      ask: 'from-blue-500/15 to-blue-400/5 border-blue-400/30 text-blue-400',
      plan: 'from-amber-500/15 to-amber-400/5 border-amber-400/30 text-amber-400',
      code: 'from-emerald-500/15 to-emerald-400/5 border-emerald-400/30 text-emerald-400',
    };
    const colorClass = modeColors[data.mode] || modeColors.code;
    return (
      <div className="flex justify-center my-2 animate-fade-in">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full
          bg-gradient-to-r ${colorClass} border
          shadow-sm transition-all duration-300`}>
          <span className="text-base">{data.icon}</span>
          <span className="text-xs font-medium">{message.content}</span>
        </div>
      </div>
    );
  }

  // --- Info card: structured key-value table ---
  if (cType === 'info') {
    const rows: Array<{ label: string; value: string }> = data.rows || [];
    return (
      <div className="ml-11 my-1 animate-fade-in">
        <div className="inline-block rounded-lg border border-border-subtle
          bg-bg-secondary/50 overflow-hidden max-w-xs">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-1.5
            border-b border-border-subtle/50 bg-bg-tertiary/30">
            <span className="text-xs font-semibold text-text-primary">
              {data.title || message.content}
            </span>
          </div>
          {/* Rows */}
          {rows.length > 0 ? (
            <div className="divide-y divide-border-subtle/30">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-3 py-1.5">
                  <span className="text-[11px] text-text-tertiary">{row.label}</span>
                  <span className={`text-[11px] font-mono font-medium
                    ${row.value === '—' ? 'text-text-tertiary/50' : 'text-text-primary'}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-[11px] text-text-tertiary italic">
              {t('cmd.noSessionData')}
            </div>
          )}
          {/* Hint */}
          {data.hint && (
            <div className="px-3 py-1.5 border-t border-border-subtle/50
              text-[10px] text-text-tertiary/70">
              {data.hint}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Help: formatted command list ---
  if (cType === 'help') {
    const builtins: Array<{ name: string; desc: string }> = data.builtins || [];
    return (
      <div className="ml-11 my-1 animate-fade-in">
        <div className="rounded-lg border border-border-subtle
          bg-bg-secondary/50 overflow-hidden max-w-md">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-1.5
            border-b border-border-subtle/50 bg-bg-tertiary/30">
            <span className="text-xs">📖</span>
            <span className="text-xs font-semibold text-text-primary">
              {message.content}
            </span>
          </div>
          {/* Built-in commands */}
          <div className="p-2 space-y-0.5">
            {builtins.map((cmd, i) => (
              <div key={i} className="flex items-baseline gap-2 px-1.5 py-0.5
                rounded hover:bg-bg-tertiary/40 transition-colors">
                <code className="text-[11px] font-mono text-accent font-medium w-20 flex-shrink-0">
                  {cmd.name}
                </code>
                <span className="text-[11px] text-text-muted truncate">
                  {cmd.desc}
                </span>
              </div>
            ))}
          </div>
          {/* Footer stats */}
          <div className="flex items-center gap-3 px-3 py-1.5
            border-t border-border-subtle/50 text-[10px] text-text-tertiary">
            <span>{t('cmd.helpCustom')}: {data.customCount ?? 0}</span>
            <span>•</span>
            <span>{t('cmd.helpSkills')}: {data.skillCount ?? 0}</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Action feedback: inline with icon/spinner ---
  if (cType === 'action') {
    return (
      <div className="flex justify-center my-1.5 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
          bg-bg-secondary/60 border border-border-subtle text-[11px] text-text-muted">
          {data.loading ? (
            <span className="w-3 h-3 border-2 border-accent/30 border-t-accent
              rounded-full animate-spin" />
          ) : (
            <span className="text-sm">✓</span>
          )}
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  // --- Error feedback ---
  if (cType === 'error') {
    return (
      <div className="flex justify-center my-1.5 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
          bg-red-500/5 border border-red-500/20 text-[11px] text-red-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
            <circle cx="6" cy="6" r="5" />
            <path d="M6 4v2.5M6 8v.5" />
          </svg>
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  // Fallback: render as plain text
  return (
    <div className="flex justify-center my-1 animate-fade-in">
      <span className="text-[11px] text-text-tertiary">{message.content}</span>
    </div>
  );
}

/* ================================================================
   AssistantMsg — markdown with avatar (uses shared MarkdownRenderer)
   ================================================================ */
function AssistantMsg({ message, isFirstInGroup = true }: Props) {
  return (
    <div className="flex gap-3">
      {/* Avatar: show only for the first message in a consecutive group */}
      {isFirstInGroup ? (
        <div className="w-8 h-8 rounded-xl bg-accent
          flex items-center justify-center flex-shrink-0 text-text-inverse
          text-xs font-bold shadow-md mt-0.5">C</div>
      ) : (
        <div className="w-8 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0 text-sm text-text-primary leading-relaxed">
        <MarkdownRenderer content={message.content} />
      </div>
    </div>
  );
}

/* ================================================================
   ToolUseMsg — inline collapsible, no card
   Enhanced display for Edit/Write/Read with diff stats, file icons
   ================================================================ */

/** Compute line diff stats from Edit tool input */
function computeEditDiff(input: any): { added: number; removed: number } | null {
  if (!input?.old_string || !input?.new_string) return null;
  const oldLines = input.old_string.split('\n').length;
  const newLines = input.new_string.split('\n').length;
  return {
    added: Math.max(0, newLines),
    removed: Math.max(0, oldLines),
  };
}

/** Compute lines for Write tool input */
function computeWriteLines(input: any): number | null {
  if (!input?.content) return null;
  return input.content.split('\n').length;
}

/** Get short filename from path */
function shortPath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : parts[parts.length - 1] || filePath;
}

/** Tool icon mini SVG */
function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case 'Bash':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.2" className="text-text-tertiary flex-shrink-0">
          <rect x="1" y="2" width="10" height="8" rx="1.5" />
          <path d="M3.5 5.5L5 7l-1.5 1.5M6.5 8.5h2" />
        </svg>
      );
    case 'Read':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.2" className="text-text-tertiary flex-shrink-0">
          <path d="M7 1H3a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1V4L7 1z" />
          <path d="M7 1v3h3M4 6.5h4M4 8.5h2" />
        </svg>
      );
    case 'Write':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.2" className="text-accent/70 flex-shrink-0">
          <path d="M7 1H3a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1V4L7 1z" />
          <path d="M7 1v3h3" />
          <path d="M5 7l1.5-1.5L8 7M6.5 5.5v4" strokeLinecap="round" />
        </svg>
      );
    case 'Edit':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.2" className="text-accent/70 flex-shrink-0">
          <path d="M8.5 1.5l2 2-6.5 6.5H2V8L8.5 1.5z" />
          <path d="M7 3l2 2" />
        </svg>
      );
    case 'Glob':
    case 'Grep':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.2" className="text-text-tertiary flex-shrink-0">
          <circle cx="5.5" cy="5.5" r="3" />
          <path d="M8 8l2.5 2.5" />
        </svg>
      );
    case 'Task':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.2" className="text-text-tertiary flex-shrink-0">
          <circle cx="6" cy="6" r="4.5" />
          <path d="M6 3.5v5M3.5 6h5" />
        </svg>
      );
    case 'WebFetch':
    case 'WebSearch':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.2" className="text-text-tertiary flex-shrink-0">
          <circle cx="6" cy="6" r="4.5" />
          <path d="M1.5 6h9M6 1.5c-1.5 1.5-2 3-2 4.5s.5 3 2 4.5M6 1.5c1.5 1.5 2 3 2 4.5s-.5 3-2 4.5" />
        </svg>
      );
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.2" className="text-text-tertiary flex-shrink-0">
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
          <path d="M4.5 5l1.5 1.5L7.5 5" />
        </svg>
      );
  }
}

function getToolLabel(name: string, t: (key: string) => string): string {
  switch (name) {
    case 'Bash': return t('msg.terminal');
    case 'Read': return t('msg.readFile');
    case 'Write': return t('msg.writeFile');
    case 'Edit': return t('msg.editFile');
    case 'Glob': case 'Grep': return t('msg.search');
    case 'Task': return t('msg.subAgent');
    case 'TodoWrite': return t('msg.todo');
    case 'WebFetch': case 'WebSearch': return t('msg.webFetch');
    case 'ExitPlanMode': case 'EnterPlanMode': return t('msg.planLabel');
    default: return name;
  }
}

function ToolUseMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const toolName = message.toolName || 'Tool';
  const label = getToolLabel(toolName, t);
  const input = message.toolInput;

  // Compute diff stats for Edit tool
  const editDiff = toolName === 'Edit' ? computeEditDiff(input) : null;
  // Compute line count for Write tool
  const writeLines = toolName === 'Write' ? computeWriteLines(input) : null;

  // Build preview content based on tool type
  const renderPreview = () => {
    if (toolName === 'Bash' && input?.command) {
      return (
        <span className="text-[11px] text-text-tertiary truncate
          font-mono max-w-[350px] bg-bg-secondary/60 px-1.5 py-0.5 rounded">
          {input.command.length > 80 ? input.command.slice(0, 80) + '…' : input.command}
        </span>
      );
    }

    if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') && input?.file_path) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              useFileStore.getState().selectFile(input.file_path);
            }}
            className="text-[11px] text-accent/70 hover:text-accent font-mono
              truncate max-w-[280px] hover:underline cursor-pointer transition-smooth"
            title={input.file_path}
          >
            {shortPath(input.file_path)}
          </button>
          {/* Diff stats for Edit */}
          {editDiff && (
            <span className="inline-flex items-center gap-1 ml-0.5">
              <span className="text-[10px] font-mono text-success">+{editDiff.added}</span>
              <span className="text-[10px] font-mono text-error">-{editDiff.removed}</span>
            </span>
          )}
          {/* Line count for Write */}
          {writeLines !== null && (
            <span className="text-[10px] font-mono text-success ml-0.5">
              +{writeLines} lines
            </span>
          )}
        </span>
      );
    }

    if ((toolName === 'Glob' || toolName === 'Grep') && input?.pattern) {
      return (
        <span className="text-[11px] text-text-tertiary truncate
          font-mono max-w-[300px]">
          {input.pattern}
        </span>
      );
    }

    if (toolName === 'Task' && input?.description) {
      return (
        <span className="text-[11px] text-text-tertiary truncate max-w-[300px] italic">
          {input.description}
        </span>
      );
    }

    if ((toolName === 'WebFetch' || toolName === 'WebSearch') && (input?.url || input?.query)) {
      const display = input.url || input.query;
      return (
        <span className="text-[11px] text-accent/70 truncate max-w-[300px] font-mono">
          {display}
        </span>
      );
    }

    return null;
  };

  // Determine if input has meaningful content (not empty {} or null)
  const hasInput = input && typeof input === 'object'
    ? Object.keys(input).length > 0
    : !!input;

  // Whether there's a result to show
  const resultContent = message.toolResultContent || '';
  const hasResult = resultContent.length > 0;

  // Render the expanded detail section
  const renderExpandedContent = () => {
    const sections: React.ReactNode[] = [];

    // Show tool input (if meaningful)
    if (hasInput) {
      if (toolName === 'Bash' && input?.command) {
        sections.push(
          <div key="cmd" className="flex items-start gap-1.5">
            <span className="text-text-tertiary/60 text-[11px] font-mono select-none">$</span>
            <pre className="text-[11px] text-text-muted font-mono whitespace-pre-wrap break-all">
              {input.command}
            </pre>
          </div>
        );
      } else {
        sections.push(
          <pre key="input" className="text-[11px] text-text-tertiary
            overflow-x-auto font-mono leading-relaxed
            max-h-32 overflow-y-auto whitespace-pre-wrap">
            {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
          </pre>
        );
      }
    }

    // Show result content
    if (hasResult) {
      if (hasInput) {
        // Divider between input and result
        sections.push(
          <div key="divider" className="border-t border-border-subtle/50 my-1" />
        );
      }
      sections.push(
        <pre key="result" className="text-[11px] text-text-tertiary
          overflow-x-auto font-mono leading-relaxed
          max-h-48 overflow-y-auto whitespace-pre-wrap">
          {resultContent}
        </pre>
      );
    }

    return sections.length > 0 ? sections : null;
  };

  // Determine if expand makes sense
  const canExpand = hasInput || hasResult;

  return (
    <div className="ml-11">
      <button
        onClick={() => canExpand && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 py-1 text-left group
          ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {canExpand ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className={`flex-shrink-0 text-text-tertiary transition-transform
              duration-150 ${expanded ? 'rotate-90' : ''}`}>
            <path d="M3 2l4 3-4 3" />
          </svg>
        ) : (
          <span className="w-[10px] flex-shrink-0" />
        )}
        <ToolIcon name={toolName} />
        <span className="text-xs font-medium text-text-muted">{label}</span>
        {renderPreview()}
        {/* Show a small result indicator when collapsed with result */}
        {!expanded && hasResult && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="text-success flex-shrink-0 ml-0.5">
            <path d="M2.5 6l2.5 2.5 4.5-4.5" />
          </svg>
        )}
      </button>
      {expanded && (
        <div className="ml-5 mt-0.5">
          {renderExpandedContent()}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   ToolResultMsg — inline result
   ================================================================ */
function ToolResultMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const content = message.content || '';

  // Show a short one-line preview on the same line as the "Result" label
  const preview = content.length > 0
    ? content.split('\n')[0].slice(0, 60) + (content.length > 60 ? '…' : '')
    : '';

  return (
    <div className="ml-11">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-0.5 cursor-pointer group"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className={`flex-shrink-0 text-text-tertiary transition-transform
            duration-150 ${expanded ? 'rotate-90' : ''}`}>
          <path d="M3 2l4 3-4 3" />
        </svg>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.5" className="text-success flex-shrink-0">
          <path d="M2.5 6l2.5 2.5 4.5-4.5" />
        </svg>
        <span className="text-[11px] text-text-tertiary">{t('msg.result')}</span>
        {!expanded && preview && (
          <span className="text-[11px] text-text-tertiary/60 font-mono truncate max-w-[300px]">
            {preview}
          </span>
        )}
      </button>
      {expanded && content && (
        <pre className="ml-5 mt-0.5 text-[11px] text-text-tertiary
          overflow-x-auto font-mono leading-relaxed
          max-h-48 overflow-y-auto whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  );
}

/* ================================================================
   ThinkingMsg — minimal collapsible
   ================================================================ */
function ThinkingMsg({ message }: Props) {
  const t = useT();
  return (
    <div className="ml-11">
      <details className="group">
        <summary className="flex items-center gap-1.5 py-1
          cursor-pointer text-[11px] text-text-tertiary list-none select-none">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="transition-transform duration-150 group-open:rotate-90">
            <path d="M3 2l4 3-4 3" />
          </svg>
          {t('msg.thinking')}
        </summary>
        <pre className="ml-5 mt-0.5 text-[11px] text-text-tertiary
          whitespace-pre-wrap max-h-48 overflow-y-auto
          font-mono leading-relaxed">
          {message.content}
        </pre>
      </details>
    </div>
  );
}

/* ================================================================
   PermissionMsg — inline prompt + small ghost buttons
   ================================================================ */
function PermissionMsg({ message }: Props) {
  const t = useT();

  const handleRespond = useCallback((allow: boolean) => {
    const stdinId = useChatStore.getState().sessionMeta.stdinId;
    if (!stdinId || message.resolved) return;
    bridge.sendStdin(stdinId, allow ? 'y' : 'n');
    useChatStore.getState().updateMessage(message.id, { resolved: true });
  }, [message.id, message.resolved]);

  return (
    <div className={`ml-11 ${message.resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-1.5 py-1">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className="text-warning flex-shrink-0 mt-0.5">
          <path d="M6 1l5.5 9.5H.5L6 1zM6 5v2.5M6 9v.5" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-text-muted">
              {t('msg.permissionTitle')}
            </span>
            {message.permissionTool && (
              <span className="text-[11px] text-text-tertiary font-mono">
                {message.permissionTool}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-tertiary leading-relaxed
            whitespace-pre-wrap mt-0.5">
            {message.content}
          </p>
        </div>
      </div>
      {!message.resolved && (
        <div className="flex items-center gap-2 ml-5 mt-1 mb-1">
          <button
            onClick={() => handleRespond(true)}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium
              border border-success/30 text-success
              hover:bg-success/10 transition-smooth"
          >
            {t('msg.allow')}
          </button>
          <button
            onClick={() => handleRespond(false)}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium
              border border-border-subtle text-text-muted
              hover:bg-bg-secondary transition-smooth"
          >
            {t('msg.deny')}
          </button>
        </div>
      )}
      {message.resolved && (
        <div className="flex items-center gap-1 ml-5 mt-0.5 text-[11px] text-text-tertiary">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <path d="M2.5 6l2.5 2.5 4.5-4.5" />
          </svg>
          {t('msg.responded')}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   PlanMsg — inline collapsible list (no card)
   ================================================================ */
function PlanMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const items = message.planItems || message.content.split('\n').filter(Boolean);

  return (
    <div className="ml-11">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-1 cursor-pointer"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className={`flex-shrink-0 text-text-tertiary transition-transform
            duration-150 ${expanded ? 'rotate-90' : ''}`}>
          <path d="M3 2l4 3-4 3" />
        </svg>
        <span className="text-xs font-medium text-text-muted">
          {t('msg.planTitle')}
        </span>
        <span className="text-[11px] text-text-tertiary">
          ({items.length} {t('msg.planSteps')})
        </span>
      </button>
      {expanded && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] text-text-muted">
              <span className="flex-shrink-0 text-text-tertiary font-mono w-4 text-right">
                {i + 1}.
              </span>
              <span className="leading-relaxed">
                {item.replace(/^[\d]+\.\s*/, '').replace(/^[-•]\s*/, '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   TodoMsg — tree-style with indent connector lines (Claude Code style)
   ================================================================ */
function TodoMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const items = message.todoItems || [];
  const completedCount = items.filter((i) => i.status === 'completed').length;
  const inProgressItem = items.find((i) => i.status === 'in_progress');

  return (
    <div className="ml-11">
      {/* Header — collapsible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-1 cursor-pointer text-left"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className={`flex-shrink-0 text-text-tertiary transition-transform
            duration-150 ${expanded ? 'rotate-90' : ''}`}>
          <path d="M3 2l4 3-4 3" />
        </svg>
        <span className="text-xs font-bold text-text-primary">{t('msg.todo')}</span>
        <span className="text-[10px] text-text-tertiary">
          {completedCount}/{items.length}
        </span>
        {inProgressItem && (
          <span className="text-[10px] text-accent italic ml-1 truncate max-w-[200px]">
            {inProgressItem.activeForm || inProgressItem.content}
          </span>
        )}
      </button>
      {/* Tree-style checklist with connector lines */}
      {expanded && (
        <div className="ml-[7px] mt-0.5">
          {items.map((item, i) => {
            const isLast = i === items.length - 1;
            return (
              <div key={i} className="flex items-stretch">
                {/* Connector line column */}
                <div className="flex flex-col items-center w-4 flex-shrink-0">
                  {/* Horizontal branch + vertical trunk */}
                  <div className="flex items-center h-5">
                    <div className={`w-px h-full ${isLast ? 'h-1/2 self-start' : ''}`}
                      style={{
                        background: 'var(--color-border)',
                        height: isLast ? '50%' : '100%',
                        alignSelf: isLast ? 'flex-start' : undefined,
                      }}
                    />
                    <div className="w-2 h-px" style={{ background: 'var(--color-border)' }} />
                  </div>
                  {/* Continuing trunk below (hidden for last item) */}
                  {!isLast && (
                    <div className="w-px flex-1" style={{ background: 'var(--color-border)' }} />
                  )}
                </div>
                {/* Status icon + text */}
                <div className="flex items-center gap-1.5 py-0.5 min-h-[20px]">
                  {item.status === 'completed' ? (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"
                      className="flex-shrink-0">
                      <rect x="0.5" y="0.5" width="11" height="11" rx="2"
                        fill="var(--color-success)" fillOpacity="0.15"
                        stroke="var(--color-success)" strokeWidth="1" />
                      <path d="M3 6l2 2 4-4" stroke="var(--color-success)"
                        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  ) : item.status === 'in_progress' ? (
                    <span className="w-[11px] h-[11px] flex items-center justify-center flex-shrink-0">
                      <span className="w-2.5 h-2.5 rounded-full border-2 border-accent
                        bg-accent/20 animate-pulse-soft" />
                    </span>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"
                      className="flex-shrink-0">
                      <rect x="0.5" y="0.5" width="11" height="11" rx="2"
                        fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1"
                        strokeOpacity="0.4" />
                    </svg>
                  )}
                  <span className={`text-[11px] leading-tight
                    ${item.status === 'completed'
                      ? 'text-text-tertiary line-through'
                      : item.status === 'in_progress'
                        ? 'text-text-primary font-medium'
                        : 'text-text-muted'
                    }`}>
                    {item.content}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   PlanReviewMsg — interactive card for plan approval (ExitPlanMode)
   ================================================================ */
function PlanReviewMsg({ message }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const planContent = message.planContent || message.content || '';
  const isResolved = message.resolved;

  const handleApprove = useCallback(() => {
    if (isResolved) return;
    const stdinId = useChatStore.getState().sessionMeta.stdinId;
    if (!stdinId) return;
    bridge.sendStdin(stdinId, 'y');
    useChatStore.getState().updateMessage(message.id, { resolved: true });
    useChatStore.getState().setSessionStatus('running');
    useChatStore.getState().setActivityStatus({ phase: 'thinking' });
  }, [isResolved, message.id]);

  const handleModify = useCallback(() => {
    // Focus the input bar — scroll to bottom so user can type feedback
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      textarea.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, []);

  return (
    <div className={`ml-11 ${isResolved ? 'opacity-70' : ''}`}>
      <div className={`rounded-xl border overflow-hidden transition-all duration-200
        ${isResolved
          ? 'border-border-subtle bg-bg-secondary/30'
          : 'border-accent/30 bg-accent/5 shadow-sm'
        }`}>
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer
            hover:bg-accent/5 transition-smooth"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className={`flex-shrink-0 text-accent transition-transform
              duration-150 ${expanded ? 'rotate-90' : ''}`}>
            <path d="M3 2l4 3-4 3" />
          </svg>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="text-accent flex-shrink-0">
            <path d="M2 3.5h10M2 7h8M2 10.5h5" />
          </svg>
          <span className="text-xs font-semibold text-text-primary">
            {t('msg.planReview')}
          </span>
          {isResolved && (
            <span className="flex items-center gap-1 ml-auto">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                stroke="currentColor" strokeWidth="1.5" className="text-success">
                <path d="M2.5 6l2.5 2.5 4.5-4.5" />
              </svg>
              <span className="text-[11px] text-success font-medium">
                {t('msg.planApproved')}
              </span>
            </span>
          )}
        </button>

        {/* Plan content */}
        {expanded && planContent && (
          <div className="px-3 pb-2 border-t border-border-subtle/50">
            <div className="mt-2 text-sm leading-relaxed max-h-64 overflow-y-auto">
              <MarkdownRenderer content={planContent} />
            </div>
          </div>
        )}

        {/* Action buttons — only when not resolved */}
        {!isResolved && (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border-subtle/50
            bg-bg-secondary/30">
            <button
              onClick={handleApprove}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium
                bg-accent text-text-inverse hover:bg-accent-hover
                transition-smooth cursor-pointer"
            >
              {t('msg.planApprove')}
            </button>
            <button
              onClick={handleModify}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium
                text-text-muted border border-border-subtle
                hover:bg-bg-secondary hover:text-text-primary
                transition-smooth cursor-pointer"
            >
              {t('msg.planModify')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   QuestionMsg — inline sequential questions (CLI-style)
   Shows one question at a time in the chat flow.
   ================================================================ */
function QuestionMsg({ message }: Props) {
  const t = useT();
  const questions = message.questions || [];
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedMap, setSelectedMap] = useState<Record<number, Set<number>>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [useOther, setUseOther] = useState<Record<number, boolean>>({});
  /* Track per-question resolved answers for display */
  const [answeredMap, setAnsweredMap] = useState<Record<number, string>>({});

  const currentQ = questions[currentIdx];
  const isFullyResolved = message.resolved;

  const handleToggle = useCallback((optIdx: number, multi: boolean) => {
    if (isFullyResolved) return;
    const qIdx = currentIdx;
    setSelectedMap((prev) => {
      const current = prev[qIdx] || new Set<number>();
      const next = new Set(current);
      if (multi) {
        if (next.has(optIdx)) next.delete(optIdx);
        else next.add(optIdx);
      } else {
        next.clear();
        next.add(optIdx);
      }
      setUseOther((p) => ({ ...p, [qIdx]: false }));
      return { ...prev, [qIdx]: next };
    });
  }, [isFullyResolved, currentIdx]);

  const handleOtherToggle = useCallback(() => {
    if (isFullyResolved) return;
    const qIdx = currentIdx;
    setUseOther((prev) => {
      const next = !prev[qIdx];
      if (next) {
        setSelectedMap((p) => ({ ...p, [qIdx]: new Set<number>() }));
      }
      return { ...prev, [qIdx]: next };
    });
  }, [isFullyResolved, currentIdx]);

  /* Get current question's answer text */
  const getCurrentAnswer = useCallback((): string => {
    const qIdx = currentIdx;
    const q = questions[qIdx];
    if (!q) return '';
    if (useOther[qIdx] && otherText[qIdx]?.trim()) {
      return otherText[qIdx].trim();
    }
    const selected = selectedMap[qIdx] || new Set<number>();
    return Array.from(selected)
      .map((i) => q.options[i]?.label)
      .filter(Boolean)
      .join(', ');
  }, [currentIdx, questions, selectedMap, useOther, otherText]);

  const hasCurrentSelection = useOther[currentIdx]
    ? !!otherText[currentIdx]?.trim()
    : (selectedMap[currentIdx]?.size || 0) > 0;

  /* Confirm current question answer and advance to next */
  const handleConfirm = useCallback(() => {
    if (isFullyResolved) return;
    const answerText = getCurrentAnswer();
    setAnsweredMap((prev) => ({ ...prev, [currentIdx]: answerText }));

    const isLast = currentIdx >= questions.length - 1;
    if (isLast) {
      // All questions answered — submit
      const stdinId = useChatStore.getState().sessionMeta.stdinId;
      if (!stdinId) return;
      const answers: Record<string, string> = {};
      questions.forEach((q, qIdx) => {
        const finalQIdx = qIdx === currentIdx ? currentIdx : qIdx;
        if (useOther[finalQIdx] && otherText[finalQIdx]?.trim()) {
          answers[String(qIdx)] = otherText[finalQIdx].trim();
        } else {
          const selected = selectedMap[finalQIdx] || new Set<number>();
          const labels = Array.from(selected)
            .map((i) => q.options[i]?.label)
            .filter(Boolean);
          if (labels.length > 0) {
            answers[String(qIdx)] = labels.join(', ');
          }
        }
      });
      bridge.sendStdin(stdinId, JSON.stringify({ answers }));
      useChatStore.getState().updateMessage(message.id, { resolved: true });
      // Clear any stale partial text that accumulated while question was pending
      useChatStore.setState({ partialText: '' });
    } else {
      setCurrentIdx(currentIdx + 1);
    }
  }, [isFullyResolved, currentIdx, questions, selectedMap, useOther, otherText, message.id, getCurrentAnswer]);

  const handleSkip = useCallback(() => {
    if (isFullyResolved) return;
    const stdinId = useChatStore.getState().sessionMeta.stdinId;
    if (!stdinId) return;
    bridge.sendStdin(stdinId, JSON.stringify({ answers: {} }));
    useChatStore.getState().updateMessage(message.id, { resolved: true });
    useChatStore.setState({ partialText: '' });
  }, [isFullyResolved, message.id]);

  return (
    <div className="ml-11 space-y-2">
      {/* Already answered questions — compact display */}
      {Object.entries(answeredMap).map(([idxStr, answer]) => {
        const qIdx = Number(idxStr);
        const q = questions[qIdx];
        if (!q) return null;
        return (
          <div key={qIdx} className="flex items-start gap-2 py-1 opacity-70">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5" className="text-success mt-0.5 flex-shrink-0">
              <path d="M2.5 6l2.5 2.5 4.5-4.5" />
            </svg>
            <div className="text-xs text-text-muted">
              <span className="text-text-secondary">{q.question}</span>
              {' → '}
              <span className="text-text-primary font-medium">{answer}</span>
            </div>
          </div>
        );
      })}

      {/* Resolved state — show all answers */}
      {isFullyResolved && Object.keys(answeredMap).length === 0 && (
        <div className="flex items-center gap-1.5 py-1 opacity-60">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="text-success">
            <path d="M2.5 6l2.5 2.5 4.5-4.5" />
          </svg>
          <span className="text-xs text-text-muted">{t('msg.responded')}</span>
        </div>
      )}

      {/* Current question — interactive */}
      {!isFullyResolved && currentQ && (
        <div className="animate-fade-in">
          {/* Question text with header badge */}
          <div className="flex items-start gap-2 mb-2">
            {currentQ.header && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded
                bg-accent/10 text-accent text-[10px] font-bold
                uppercase tracking-wider mt-px">
                {currentQ.header}
              </span>
            )}
            <span className="text-xs text-text-primary font-medium leading-relaxed">
              {currentQ.question}
            </span>
          </div>

          {/* Progress indicator for multi-question */}
          {questions.length > 1 && (
            <div className="text-[10px] text-text-tertiary mb-2">
              {currentIdx + 1} / {questions.length}
            </div>
          )}

          {/* Options — one per line with description always visible */}
          <div className="flex flex-col gap-1.5 mb-2">
            {currentQ.options.map((opt, optIdx) => {
              const isSelected = selectedMap[currentIdx]?.has(optIdx) || false;
              return (
                <button
                  key={optIdx}
                  onClick={() => handleToggle(optIdx, !!currentQ.multiSelect)}
                  className={`text-left px-3 py-1.5 rounded-lg text-xs
                    transition-smooth border cursor-pointer
                    ${isSelected
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border-subtle text-text-secondary hover:border-accent/30 hover:bg-bg-secondary/50'
                    }`}
                >
                  <span className="font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="text-text-tertiary ml-1.5">— {opt.description}</span>
                  )}
                </button>
              );
            })}

            {/* Other option */}
            <button
              onClick={handleOtherToggle}
              className={`text-left px-3 py-1.5 rounded-lg text-xs
                transition-smooth border cursor-pointer
                ${useOther[currentIdx]
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-subtle text-text-tertiary hover:border-accent/30 hover:bg-bg-secondary/50'
                }`}
            >
              {t('msg.questionOther')}
            </button>
          </div>

          {/* Other text input */}
          {useOther[currentIdx] && (
            <div className="mb-2">
              <input
                type="text"
                value={otherText[currentIdx] || ''}
                onChange={(e) => setOtherText((p) => ({ ...p, [currentIdx]: e.target.value }))}
                placeholder={t('msg.questionOtherPlaceholder')}
                autoFocus
                className="w-full max-w-xs px-3 py-1.5 rounded-lg text-xs
                  bg-transparent border border-border-subtle
                  focus:border-border-focus outline-none text-text-primary
                  placeholder:text-text-tertiary transition-smooth"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (hasCurrentSelection) handleConfirm();
                  }
                }}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirm}
              disabled={!hasCurrentSelection}
              className="px-3 py-1 rounded-lg text-[11px] font-medium
                bg-accent text-text-inverse hover:bg-accent-hover
                transition-smooth cursor-pointer
                disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {currentIdx >= questions.length - 1 ? t('msg.questionSubmit') : t('msg.questionNext')}
            </button>
            <button
              onClick={handleSkip}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium
                text-text-tertiary hover:text-text-primary
                hover:bg-bg-tertiary transition-smooth cursor-pointer"
            >
              {t('msg.questionSkip')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
