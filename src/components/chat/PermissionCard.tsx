import { useCallback, useState } from 'react';
import { type ChatMessage, useChatStore } from '../../stores/chatStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

interface Props {
  message: ChatMessage;
}

/**
 * PermissionCard — displays structured permission requests from the SDK control protocol.
 *
 * Uses the `permissionData` field (from control_request/can_use_tool) for rich display
 * and `bridge.respondPermission` for typed allow/deny responses.
 *
 * Interaction state machine:
 *   pending  → user sees Allow/Deny buttons
 *   sending  → spinner while response is being sent to CLI
 *   resolved → checkmark, card fades
 *   failed   → error message + Retry button
 */
export function PermissionCard({ message }: Props) {
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  const interactionState = message.interactionState ?? (message.resolved ? 'resolved' : 'pending');
  const permData = message.permissionData;

  // Determine display values — prefer structured permissionData, fallback to legacy fields
  const toolName = permData?.toolName ?? message.permissionTool ?? '';
  const description = permData?.description ?? '';
  const inputPreview = permData?.input
    ? formatInput(permData.toolName, permData.input)
    : (typeof message.content === 'string' ? message.content : '');

  const handleRespond = useCallback(async (allow: boolean) => {
    const { sessionMeta, setInteractionState, setSessionStatus, setActivityStatus } = useChatStore.getState();
    const stdinId = sessionMeta.stdinId;
    if (!stdinId) return;

    // If we have structured permissionData, use SDK control protocol
    if (permData?.requestId) {
      setInteractionState(message.id, 'sending');
      try {
        await bridge.respondPermission(
          stdinId,
          permData.requestId,
          allow,
          allow ? undefined : 'User denied this operation',
        );
        setInteractionState(message.id, 'resolved');
        setSessionStatus('running');
        setActivityStatus({ phase: 'thinking' });
      } catch (err) {
        setInteractionState(message.id, 'failed', String(err));
      }
    } else {
      // Legacy fallback: send raw y/n to stdin (for bypass/old-style)
      bridge.sendRawStdin(stdinId, allow ? 'y' : 'n');
      useChatStore.getState().updateMessage(message.id, { resolved: true });
      setSessionStatus('running');
      setActivityStatus({ phase: 'thinking' });
    }
    setRetrying(false);
  }, [message.id, permData]);

  const handleRetry = useCallback(() => {
    setRetrying(true);
    // Reset to pending state, then let user choose again
    useChatStore.getState().setInteractionState(message.id, 'pending');
    setRetrying(false);
  }, [message.id]);

  const isResolved = interactionState === 'resolved';
  const isSending = interactionState === 'sending';
  const isFailed = interactionState === 'failed';
  const isPending = interactionState === 'pending';

  return (
    <div className={`ml-11 animate-scale-in ${isResolved ? 'opacity-60' : ''}`}>
      <div className={`rounded-xl border overflow-hidden transition-all duration-200
        ${isResolved
          ? 'border-border-subtle bg-bg-secondary/30'
          : isFailed
            ? 'border-l-[3px] border-l-error border-r border-t border-b border-r-error/20 border-t-error/20 border-b-error/20 bg-gradient-to-r from-error/5 to-transparent shadow-sm'
            : 'border-l-[3px] border-l-warning border-r border-t border-b border-r-warning/20 border-t-warning/20 border-b-warning/20 bg-gradient-to-r from-warning/5 to-transparent shadow-sm'
        }`}>
        {/* Header row */}
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="text-warning flex-shrink-0 mt-0.5">
            <path d="M7 1.5l6 10.5H1L7 1.5zM7 6v3M7 10.5v.5" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-text-primary">
                {t('msg.permissionTitle')}
              </span>
              {toolName && (
                <code className="text-[10px] px-1.5 py-0.5 rounded
                  bg-warning/10 text-warning font-mono font-medium">
                  {toolName}
                </code>
              )}
            </div>
            {description && (
              <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {/* Status indicator */}
          {isResolved && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                stroke="currentColor" strokeWidth="1.5" className="text-success">
                <path d="M2.5 6l2.5 2.5 4.5-4.5" />
              </svg>
              <span className="text-[11px] text-success font-medium">
                {t('msg.responded')}
              </span>
            </span>
          )}
          {isSending && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                className="text-text-muted animate-spin">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"
                  strokeDasharray="14 14" />
              </svg>
              <span className="text-[11px] text-text-muted">
                Sending...
              </span>
            </span>
          )}
        </div>

        {/* Input preview */}
        {inputPreview && (
          <div className="px-3 pb-2">
            <pre className="text-[11px] text-text-muted font-mono leading-relaxed
              whitespace-pre-wrap break-words bg-bg-secondary/50 rounded-lg px-2.5 py-2
              border border-border-subtle/30 max-h-32 overflow-y-auto">
              {inputPreview}
            </pre>
          </div>
        )}

        {/* Error state */}
        {isFailed && (
          <div className="px-3 pb-2">
            <div className="text-[11px] text-error bg-error/5 rounded-lg px-2.5 py-2
              border border-error/20">
              {message.interactionError || 'Failed to send response'}
            </div>
          </div>
        )}

        {/* Action buttons */}
        {(isPending || isFailed) && (
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border-subtle/50
            bg-bg-secondary/20">
            {isPending && (
              <>
                <button
                  onClick={() => handleRespond(true)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold
                    border-2 border-success/40 text-success bg-success/5
                    hover:bg-success/15 transition-smooth cursor-pointer
                    flex items-center gap-1.5"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6l2.5 2.5 4.5-4.5" />
                  </svg>
                  {t('msg.permissionAllowHint')}
                </button>
                <button
                  onClick={() => handleRespond(false)}
                  className="px-3 py-2 rounded-lg text-xs font-medium
                    text-text-muted border border-border-subtle
                    hover:bg-bg-secondary hover:text-text-primary
                    transition-smooth cursor-pointer"
                >
                  {t('msg.permissionDenyHint')}
                </button>
              </>
            )}
            {isFailed && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="px-4 py-2 rounded-lg text-xs font-semibold
                  border-2 border-warning/40 text-warning bg-warning/5
                  hover:bg-warning/15 transition-smooth cursor-pointer
                  flex items-center gap-1.5"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Format tool input for display. Shows the most relevant field per tool type. */
function formatInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return String(input.command ?? JSON.stringify(input, null, 2));
    case 'Edit':
    case 'Write':
      return String(input.file_path ?? JSON.stringify(input, null, 2));
    case 'Read':
      return String(input.file_path ?? JSON.stringify(input, null, 2));
    default:
      return JSON.stringify(input, null, 2);
  }
}
