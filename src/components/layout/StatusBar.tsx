import { useActiveTab } from '../../stores/chatStore';
import { useMcpStore } from '../../stores/mcpStore';
import { useSkillStore } from '../../stores/skillStore';
import { useSettingsStore, MODEL_OPTIONS } from '../../stores/settingsStore';
import { useProviderStore } from '../../stores/providerStore';
import { useContextUsage } from '../../hooks/useContextUsage';
import { useT } from '../../lib/i18n';

/** Compact status bar at the bottom of the AppShell */
export function StatusBar() {
  const t = useT();
  const sessionMeta = useActiveTab((s) => s.sessionMeta);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const mcpCount = useMcpStore((s) => s.servers.length);
  const skillCount = useSkillStore((s) => s.skills.length);
  const activeProviderId = useProviderStore((s) => s.activeProviderId);

  const totalInput = sessionMeta?.totalInputTokens ?? 0;
  const totalOutput = sessionMeta?.totalOutputTokens ?? 0;
  const turns = sessionMeta?.turns ?? 0;

  const model = sessionMeta?.model || selectedModel;
  const context = useContextUsage();

  // Model display name
  const modelOption = MODEL_OPTIONS.find((m) => m.id === model);
  const modelLabel = modelOption?.label || model?.replace('claude-', '') || '—';

  // Provider indicator
  const providerLabel = activeProviderId ? '🔌' : '';

  return (
    <div className="h-6 flex items-center px-3 gap-3 text-[11px] text-text-tertiary
      bg-bg-sidebar border-t border-border-subtle select-none flex-shrink-0
      overflow-hidden whitespace-nowrap">
      {/* Model name */}
      <span className="flex items-center gap-1 truncate max-w-[160px]" title={model}>
        {providerLabel && <span className="text-[10px]">{providerLabel}</span>}
        <span className="font-medium text-text-secondary">{modelLabel}</span>
      </span>

      <span className="w-px h-3 bg-border-subtle" />

      {/* Token stats — compact */}
      <span className="flex items-center gap-1.5" title={`Input: ${totalInput.toLocaleString()} | Output: ${totalOutput.toLocaleString()}`}>
        <span>↑{formatK(totalInput)}</span>
        <span>↓{formatK(totalOutput)}</span>
      </span>

      {/* Cache hit rate */}
      {context.cacheHitRate > 0 && (
        <>
          <span className="w-px h-3 bg-border-subtle" />
          <span className="flex items-center gap-0.5" title={t('chat.cacheHitRate')}>
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M5 8h6" />
            </svg>
            {context.cacheHitRate}%
          </span>
        </>
      )}

      {/* Context window percentage */}
      {totalInput > 0 && (
        <>
          <span className="w-px h-3 bg-border-subtle" />
          <span className="flex items-center gap-1">
            <span className="w-10 h-1 rounded-full bg-bg-secondary overflow-hidden">
              <span
                className={`h-full rounded-full transition-all ${
                  context.level === 'danger' ? 'bg-red-500' :
                  context.level === 'warning' ? 'bg-amber-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(100, context.percentage)}%` }}
              />
            </span>
            <span className={
              context.level === 'danger' ? 'text-red-400' :
              context.level === 'warning' ? 'text-amber-500' : 'text-text-tertiary'
            }>
              {Math.round(context.percentage)}%
            </span>
          </span>
        </>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* MCP count */}
      <span className="flex items-center gap-0.5" title="MCP Servers">
        <span className={`w-1.5 h-1.5 rounded-full ${mcpCount > 0 ? 'bg-green-500' : 'bg-text-tertiary'}`} />
        MCP:{mcpCount}
      </span>

      <span className="w-px h-3 bg-border-subtle" />

      {/* Skill count */}
      <span title="Skills">
        Skills:{skillCount}
      </span>

      {/* Turn count */}
      {turns > 0 && (
        <>
          <span className="w-px h-3 bg-border-subtle" />
          <span title={t('cmd.costTurns')}>{turns}T</span>
        </>
      )}
    </div>
  );
}

/** Format token count as compact K/M string */
function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
