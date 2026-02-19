import { memo, useState } from 'react';
import { type ChatMessage } from '../../stores/chatStore';
import { useFileStore } from '../../stores/fileStore';
import { useLightboxStore } from '../shared/ImageLightbox';
import { useT } from '../../lib/i18n';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { CommandProcessingCard } from './CommandProcessingCard';
import { PlanReviewCard } from './PlanReviewCard';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';

interface Props {
  message: ChatMessage;
  isFirstInGroup?: boolean;
}

export const MessageBubble = memo(function MessageBubble({ message, isFirstInGroup = true }: Props) {
  if (message.role === 'user') return <UserMsg message={message} />;
  if (message.role === 'system' && message.commandType === 'processing') return <CommandProcessingCard message={message} />;
  if (message.role === 'system' && message.commandType) return <CommandFeedbackMsg message={message} />;
  if (message.type === 'question') return <QuestionCard message={message} />;
  if (message.type === 'todo') return <TodoMsg message={message} />;
  if (message.type === 'plan_review') return <PlanReviewCard message={message} />;
  if (message.type === 'tool_use') return <ToolUseMsg message={message} />;
  if (message.type === 'thinking') return <ThinkingMsg message={message} />;
  if (message.type === 'tool_result') return <ToolResultMsg message={message} />;
  if (message.type === 'permission') return <PermissionCard message={message} />;
  if (message.type === 'plan') return <PlanMsg message={message} />;
  return <AssistantMsg message={message} isFirstInGroup={isFirstInGroup} />;
});

/* ================================================================
   UserMsg — bubble on the right
   ================================================================ */
/** Collapse threshold: messages longer than this are collapsed by default */
const USER_MSG_COLLAPSE_LINES = 12;

function UserMsg({ message }: Props) {
  const [expanded, setExpanded] = useState(false);
  const attachments = message.attachments;
  const content = message.content || '';
  const lines = content.split('\n');
  const isLong = lines.length > USER_MSG_COLLAPSE_LINES || content.length > 600;
  const displayContent = (!expanded && isLong)
    ? lines.slice(0, USER_MSG_COLLAPSE_LINES).join('\n')
    : content;

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-br-md
        bg-bg-user-msg text-text-inverse
        text-base leading-relaxed shadow-md whitespace-pre-wrap">
        {displayContent}
        {!expanded && isLong && (
          <span className="text-white/60">…</span>
        )}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="block mt-1.5 text-xs text-white/60 hover:text-white/90
              transition-smooth"
          >
            {expanded ? '▲ 收起' : '▼ 展开全部'}
          </button>
        )}
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

  // --- Info card: structured key-value table or preformatted text ---
  if (cType === 'info') {
    const rows: Array<{ label: string; value: string }> = data.rows || [];

    // Preformatted output (e.g. CLI command results)
    if (data.preformatted) {
      return (
        <div className="ml-11 my-1 animate-fade-in">
          <div className="rounded-lg border border-border-subtle
            bg-bg-secondary/50 overflow-hidden max-w-md">
            <div className="flex items-center gap-2 px-3 py-1.5
              border-b border-border-subtle/50 bg-bg-tertiary/30">
              <span className="text-[10px] font-mono text-text-tertiary">{data.command}</span>
            </div>
            <pre className="px-3 py-2 text-[11px] font-mono text-text-primary
              whitespace-pre-wrap break-words overflow-x-auto max-h-60 overflow-y-auto">
              {message.content}
            </pre>
          </div>
        </div>
      );
    }

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
        <div className="w-8 h-8 rounded-[10px] bg-accent
          flex items-center justify-center flex-shrink-0 text-text-inverse
          text-xs font-bold shadow-md mt-0.5">C</div>
      ) : (
        <div className="w-8 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0 text-base text-text-primary leading-relaxed">
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
  const parts = filePath.split(/[\\/]/);
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

export const ToolUseMsg = memo(function ToolUseMsg({ message }: Props) {
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
});

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

/* PermissionMsg — extracted to PermissionCard.tsx */

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

/* PlanReviewMsg — extracted to PlanReviewCard.tsx */

/* QuestionMsg — extracted to QuestionCard.tsx */
