import { useCallback } from 'react';
import { type ChatMessage, useChatStore } from '../../stores/chatStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

interface Props {
  message: ChatMessage;
}

/**
 * PermissionCard — enhanced bordered card for permission prompts.
 *
 * Enhancements over the inline version:
 * - Bordered card with warning left accent
 * - Tool name in mono badge
 * - Command/description in a code block
 * - Larger Allow/Deny buttons with "(y)"/"(n)" keyboard hints
 */
export function PermissionCard({ message }: Props) {
  const t = useT();

  const handleRespond = useCallback((allow: boolean) => {
    const stdinId = useChatStore.getState().sessionMeta.stdinId;
    if (!stdinId || message.resolved) return;
    bridge.sendRawStdin(stdinId, allow ? 'y' : 'n');
    useChatStore.getState().updateMessage(message.id, { resolved: true });
    // Resume generation display after user responds
    useChatStore.getState().setSessionStatus('running');
    useChatStore.getState().setActivityStatus({ phase: 'thinking' });
  }, [message.id, message.resolved]);

  return (
    <div className={`ml-11 animate-scale-in ${message.resolved ? 'opacity-60' : ''}`}>
      <div className={`rounded-xl border overflow-hidden transition-all duration-200
        ${message.resolved
          ? 'border-border-subtle bg-bg-secondary/30'
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
              {message.permissionTool && (
                <code className="text-[10px] px-1.5 py-0.5 rounded
                  bg-warning/10 text-warning font-mono font-medium">
                  {message.permissionTool}
                </code>
              )}
            </div>
          </div>
          {message.resolved && (
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
        </div>

        {/* Description / command preview */}
        {message.content && (
          <div className="px-3 pb-2">
            <pre className="text-[11px] text-text-muted font-mono leading-relaxed
              whitespace-pre-wrap break-words bg-bg-secondary/50 rounded-lg px-2.5 py-2
              border border-border-subtle/30 max-h-32 overflow-y-auto">
              {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
            </pre>
          </div>
        )}

        {/* Action buttons — only when not resolved */}
        {!message.resolved && (
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border-subtle/50
            bg-bg-secondary/20">
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
          </div>
        )}
      </div>
    </div>
  );
}
