import { useState, useEffect } from 'react';
import { type ChatMessage } from '../../stores/chatStore';
import { useT } from '../../lib/i18n';

interface Props {
  message: ChatMessage;
}

/** Format elapsed ms into "Xs" or "Xm Ys" */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

/**
 * CommandProcessingCard — shown when a CLI slash command (e.g. /compact, /doctor)
 * is sent to the CLI. Two visual states:
 *
 * 1. **Processing**: spinner + command name + live elapsed timer + indeterminate progress bar
 * 2. **Completed**: checkmark + command name + frozen elapsed time + collapsible output
 */
export function CommandProcessingCard({ message }: Props) {
  const t = useT();
  const data = message.commandData || {};
  const commandName = data.command || '';
  const isCompleted = message.commandCompleted === true;
  const startTime = message.commandStartTime || message.timestamp;
  const costSummary = data.costSummary as { cost: string; duration: string; turns: string; input: string; output: string } | undefined;

  // Live elapsed timer (only ticks while processing)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (isCompleted) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [isCompleted]);

  const elapsed = formatElapsed((isCompleted ? (data.completedAt || Date.now()) : now) - startTime);

  // Collapsible output
  const [showOutput, setShowOutput] = useState(false);
  const outputText = data.output || '';

  return (
    <div className="flex justify-center my-2 animate-scale-in">
      <div className={`w-full max-w-md rounded-xl border overflow-hidden transition-all duration-200
        ${isCompleted
          ? 'border-border-subtle bg-bg-secondary/30'
          : 'border-accent/20 bg-accent/5 shadow-sm'
        }`}>
        {/* Main row: icon + command + elapsed */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Status icon */}
          {isCompleted ? (
            <div className="w-6 h-6 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7l3 3 5-5" />
              </svg>
            </div>
          ) : (
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
              <span className="w-5 h-5 border-2 border-accent/30 border-t-accent
                rounded-full animate-spin" />
            </div>
          )}

          {/* Command name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono font-semibold text-text-primary">
                {commandName}
              </code>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium
                ${isCompleted
                  ? 'bg-success/10 text-success'
                  : 'bg-accent/10 text-accent'
                }`}>
                {isCompleted ? t('cmd.processingDone') : t('cmd.processing')}
              </span>
            </div>
          </div>

          {/* Elapsed timer */}
          <span className="text-xs font-mono text-text-tertiary flex-shrink-0">
            {elapsed}
          </span>
        </div>

        {/* Indeterminate progress bar (only while processing) */}
        {!isCompleted && (
          <div className="h-[2px] bg-accent/10 overflow-hidden">
            <div className="h-full w-1/4 bg-accent/40 rounded-full animate-progress" />
          </div>
        )}

        {/* Cost summary (injected from result event) */}
        {isCompleted && costSummary && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2
            border-t border-border-subtle/50 text-[11px] font-mono text-text-tertiary">
            <span>Cost: ${costSummary.cost}</span>
            <span className="text-border-subtle">|</span>
            <span>Duration: {costSummary.duration}</span>
            <span className="text-border-subtle">|</span>
            <span>Turns: {costSummary.turns}</span>
            {(costSummary.input || costSummary.output) && (
              <>
                <span className="text-border-subtle">|</span>
                <span>Tokens: {costSummary.input} in / {costSummary.output} out</span>
              </>
            )}
          </div>
        )}

        {/* Collapsible output section (only when completed + has output) */}
        {isCompleted && outputText && (
          <>
            <button
              onClick={() => setShowOutput(!showOutput)}
              className="w-full flex items-center gap-1.5 px-4 py-1.5
                border-t border-border-subtle/50 text-[11px] text-text-tertiary
                hover:text-text-secondary hover:bg-bg-tertiary/30 transition-smooth"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.5"
                className={`flex-shrink-0 transition-transform duration-150
                  ${showOutput ? 'rotate-90' : ''}`}>
                <path d="M3 2l4 3-4 3" />
              </svg>
              <span>{showOutput ? t('cmd.hideOutput') : t('cmd.showOutput')}</span>
            </button>
            {showOutput && (
              <pre className="px-4 py-2 text-[11px] font-mono text-text-muted
                whitespace-pre-wrap break-words overflow-x-auto max-h-48 overflow-y-auto
                border-t border-border-subtle/30 bg-bg-secondary/20 selectable">
                {outputText}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
