import { useT } from '../../lib/i18n';
import type { ApiProvider } from '../../stores/providerStore';

export type CardTestStatus = 'idle' | 'testing' | 'success' | 'auth_error' | 'failed';

interface ProviderCardProps {
  provider: ApiProvider;
  isActive: boolean;
  isEditing: boolean;
  testStatus: CardTestStatus;
  testTimeMs?: number;
  onActivate: () => void;
  onToggleEdit: () => void;
  onRequestDelete: () => void;
  onExport: () => void;
  onTest: () => void;
}

export function ProviderCard({
  provider,
  isActive,
  isEditing,
  testStatus,
  testTimeMs,
  onActivate,
  onToggleEdit,
  onRequestDelete,
  onExport,
  onTest,
}: ProviderCardProps) {
  const t = useT();

  let hostname = '';
  if (provider.baseUrl) {
    try {
      hostname = new URL(provider.baseUrl).hostname;
    } catch { /* ignore */ }
  }

  const formatLabel = provider.apiFormat === 'anthropic'
    ? t('provider.formatAnthropicShort')
    : t('provider.formatOpenaiShort');

  return (
    <div
      onClick={onActivate}
      className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-smooth cursor-pointer
        ${isEditing
          ? 'bg-bg-secondary border border-accent/30'
          : isActive
            ? 'bg-accent/5 border border-accent/20'
            : 'border border-border-subtle hover:bg-bg-secondary'
        }`}
    >
      {/* Active indicator dot */}
      <span className={`shrink-0 block w-2.5 h-2.5 rounded-full transition-smooth
        ${isActive
          ? 'bg-accent shadow-[0_0_4px_rgba(var(--accent-rgb,99,102,241),0.4)]'
          : 'border-[1.5px] border-text-tertiary'
        }`}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text-primary truncate">
          {provider.name || t('provider.unnamed')}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {hostname && (
            <span className="text-[11px] text-text-tertiary truncate">
              {hostname}
            </span>
          )}
          {hostname && (
            <span className="text-[11px] text-text-tertiary">·</span>
          )}
          <span className="text-[11px] text-text-tertiary whitespace-nowrap">
            {formatLabel}
          </span>
        </div>
      </div>

      {/* Test button — same style as form test button */}
      <button
        onClick={(e) => { e.stopPropagation(); onTest(); }}
        disabled={testStatus === 'testing'}
        className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-medium transition-smooth
          border
          ${testStatus === 'success'
            ? 'bg-green-500/10 text-green-500 border-green-500/30'
            : testStatus === 'failed' || testStatus === 'auth_error'
              ? 'bg-red-500/10 text-red-500 border-red-500/30'
              : 'border-border-subtle text-text-tertiary hover:text-text-muted hover:bg-bg-secondary'
          }
          disabled:cursor-not-allowed`}
      >
        {testStatus === 'testing' ? (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 border-[1.5px] border-accent/30
              border-t-accent rounded-full animate-spin" />
            {t('provider.testing')}
          </span>
        ) : testStatus === 'success' ? (
          <span className="flex items-center gap-1">
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M3 8l4 4 6-7" />
            </svg>
            {testTimeMs != null ? `${testTimeMs}ms` : t('provider.testSuccess')}
          </span>
        ) : testStatus === 'auth_error' ? (
          t('provider.testAuthError')
        ) : testStatus === 'failed' ? (
          t('provider.testFailed')
        ) : (
          t('provider.testConnection')
        )}
      </button>

      {/* Action buttons — hover to reveal */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
        {/* Export */}
        <button
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          className="p-1.5 rounded text-text-tertiary hover:text-text-muted transition-smooth"
          title={t('provider.exportConfig')}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3M8 10V2M5 5l3-3 3 3" />
          </svg>
        </button>
        {/* Edit */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleEdit(); }}
          className="p-1.5 rounded text-text-tertiary hover:text-text-muted transition-smooth"
          title={t('provider.editProvider')}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M11 2l3 3-9 9H2v-3z" />
          </svg>
        </button>
        {/* Delete — trash icon, red */}
        <button
          onClick={(e) => { e.stopPropagation(); onRequestDelete(); }}
          className="p-1.5 rounded text-red-400/60 hover:text-red-400 transition-smooth"
          title={t('provider.deleteProvider')}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M13 4v9.33a1.33 1.33 0 01-1.33 1.34H4.33A1.33 1.33 0 013 13.33V4M6.67 7.33v4M9.33 7.33v4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
