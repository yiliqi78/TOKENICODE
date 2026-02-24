import { useState, useCallback, useMemo } from 'react';
import { type ChatMessage, useChatStore } from '../../stores/chatStore';
import { useT } from '../../lib/i18n';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';

interface Props {
  message: ChatMessage;
  /** When true, card renders in floating overlay mode (no left margin). */
  floating?: boolean;
}

/** Extract numbered steps from plan markdown for a preview badge */
function extractStepCount(content: string): number {
  // Match markdown numbered lists like "1. ", "2. ", etc.
  const steps = content.match(/^\d+\.\s/gm);
  return steps?.length || 0;
}

/** Extract first N numbered steps for collapsed preview */
function extractStepPreview(content: string, maxSteps: number = 3): string[] {
  const lines = content.split('\n');
  const steps: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) {
      steps.push(match[1].trim());
      if (steps.length >= maxSteps) break;
    }
  }
  return steps;
}

/**
 * PlanReviewCard — interactive card for plan approval (ExitPlanMode).
 *
 * Enhancements over the inline version:
 * - Step count badge in the header
 * - First 3 step preview when collapsed after approval
 * - Accent left border + gradient bg when unresolved
 * - Larger approve button with "(Enter)" keyboard hint
 * - Auto-collapses to summary after approval
 */
export function PlanReviewCard({ message, floating }: Props) {
  const t = useT();
  const planContent = message.planContent || message.content || '';
  const isResolved = message.resolved;
  // Start expanded when unresolved, collapsed after approval
  const [expanded, setExpanded] = useState(!isResolved);

  const stepCount = useMemo(() => extractStepCount(planContent), [planContent]);
  const stepPreview = useMemo(() => extractStepPreview(planContent), [planContent]);

  const [approving, setApproving] = useState(false);

  const handleApprove = useCallback(async () => {
    if (isResolved || approving) return;
    setApproving(true);
    // Mark as resolved and dispatch event for InputBar to handle
    // the kill → restart → execute flow (mode-aware TK-306).
    useChatStore.getState().updateMessage(message.id, { resolved: true });
    window.dispatchEvent(new CustomEvent('tokenicode:plan-execute'));
  }, [isResolved, approving, message.id]);

  const handleModify = useCallback(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      textarea.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, []);

  return (
    <div className={`${floating ? '' : 'ml-11'} ${isResolved ? 'opacity-80' : ''} animate-scale-in`}>
      <div className={`rounded-xl border overflow-hidden transition-all duration-200
        ${isResolved
          ? 'border-border-subtle bg-bg-secondary/30'
          : 'border-l-[3px] border-l-accent border-r border-t border-b border-r-accent/20 border-t-accent/20 border-b-accent/20 bg-gradient-to-r from-accent/5 to-transparent shadow-sm'
        }`}>
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer
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
          {/* Step count badge */}
          {stepCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full
              bg-accent/10 text-accent font-medium">
              {t('msg.planStepCount').replace('{n}', String(stepCount))}
            </span>
          )}
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

        {/* Collapsed step preview (after approval) */}
        {!expanded && isResolved && stepPreview.length > 0 && (
          <div className="px-4 py-2 border-t border-border-subtle/30">
            <div className="space-y-0.5">
              {stepPreview.map((step, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-text-tertiary">
                  <span className="font-mono text-text-tertiary/60 flex-shrink-0 w-4 text-right">
                    {i + 1}.
                  </span>
                  <span className="truncate">{step}</span>
                </div>
              ))}
              {stepCount > stepPreview.length && (
                <div className="text-[10px] text-text-tertiary/50 ml-5.5">
                  +{stepCount - stepPreview.length} more...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Full plan content */}
        {expanded && planContent && (
          <div className="px-3 pb-2 border-t border-border-subtle/50">
            <div className="mt-2 text-sm leading-relaxed max-h-64 overflow-y-auto">
              <MarkdownRenderer content={planContent} />
            </div>
          </div>
        )}

        {/* Action buttons — only when not resolved */}
        {!isResolved && (
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border-subtle/50
            bg-bg-secondary/30">
            <button
              onClick={handleApprove}
              disabled={approving}
              className={`px-4 py-2 rounded-lg text-xs font-semibold
                bg-accent text-text-inverse hover:bg-accent-hover
                transition-smooth cursor-pointer shadow-sm
                flex items-center gap-1.5
                ${approving ? 'opacity-60 cursor-wait' : ''}`}
            >
              {approving ? (
                <span className="animate-pulse-soft">{t('msg.planApproving') || 'Approving...'}</span>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6l2.5 2.5 4.5-4.5" />
                  </svg>
                  {t('msg.planApproveAndExecute')}
                </>
              )}
            </button>
            <button
              onClick={handleModify}
              className="px-3 py-2 rounded-lg text-xs font-medium
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
