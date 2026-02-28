import { useSettingsStore, MODEL_OPTIONS } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { ConversationList } from '../conversations/ConversationList';
import { useT } from '../../lib/i18n';
import { useAgentStore } from '../../stores/agentStore';

/** Map raw model ID to friendly display name */
function getModelDisplayName(modelId: string): string {
  const option = MODEL_OPTIONS.find((m) => modelId.includes(m.id));
  return option?.short || modelId;
}

/** Format token count: 1234 → "1.2k", 123456 → "123k", 1234567 → "1.2M" */
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return (n / 1000).toFixed(1) + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}

export function Sidebar() {
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const updateAvailable = useSettingsStore((s) => s.updateAvailable);
  const sessionMeta = useChatStore((s) => s.sessionMeta);
  const sessionStatus = useChatStore((s) => s.sessionStatus);
  const t = useT();

  // Window dragging handled via CSS -webkit-app-region: drag on the top strip

  return (
    <div className="flex flex-col h-full pt-8 pb-4">
      {/* Logo area */}
      <div
        className="flex items-center justify-between mb-6 px-5 cursor-default">
        <div className="flex items-center pointer-events-none">
          {/* Text logo — TOKEN/CODE, slash uses theme accent */}
          <svg viewBox="0 0 689 90" fill="none"
            className="h-[14px]" style={{width: 'auto'}}>
            <path d="M381.126 0H393.126L370.35 90H358.35L370.35 42L381.126 0Z" style={{fill: 'var(--color-accent)'}}/>
            <path d="M646.302 49.54V72.75H688.212V81H637.502V9.5H688.102V17.75H646.302V41.29H680.512V49.54H646.302Z" fill="currentColor"/>
            <path d="M584.979 9.5C592.166 9.5 598.179 10.4533 603.019 12.36C607.932 14.1933 611.856 16.76 614.789 20.06C617.723 23.36 619.849 27.1367 621.169 31.39C622.489 35.6433 623.149 40.1533 623.149 44.92C623.149 49.6867 622.453 54.2333 621.059 58.56C619.666 62.8867 617.429 66.7367 614.349 70.11C611.343 73.4833 607.419 76.16 602.579 78.14C597.739 80.0467 591.873 81 584.979 81H561.769V9.5H584.979ZM570.569 72.75H584.979C590.773 72.75 595.539 71.9433 599.279 70.33C603.093 68.7167 606.099 66.59 608.299 63.95C610.499 61.2367 612.039 58.23 612.919 54.93C613.873 51.63 614.349 48.2933 614.349 44.92C614.349 41.5467 613.873 38.2467 612.919 35.02C612.039 31.7933 610.499 28.8967 608.299 26.33C606.099 23.69 603.093 21.6 599.279 20.06C595.539 18.52 590.773 17.75 584.979 17.75H570.569V72.75Z" fill="currentColor"/>
            <path d="M512.243 82.1C505.717 82.1 499.777 80.5967 494.423 77.59C489.143 74.51 484.927 70.22 481.773 64.72C478.62 59.22 477.043 52.73 477.043 45.25C477.043 37.77 478.62 31.28 481.773 25.78C484.927 20.2067 489.143 15.9167 494.423 12.91C499.777 9.90333 505.717 8.4 512.243 8.4C518.77 8.4 524.673 9.90333 529.953 12.91C535.307 15.9167 539.56 20.2067 542.713 25.78C545.867 31.28 547.443 37.77 547.443 45.25C547.443 52.73 545.867 59.22 542.713 64.72C539.56 70.22 535.307 74.51 529.953 77.59C524.673 80.5967 518.77 82.1 512.243 82.1ZM512.243 73.85C517.23 73.85 521.703 72.7867 525.663 70.66C529.623 68.46 532.777 65.2333 535.123 60.98C537.47 56.7267 538.643 51.4833 538.643 45.25C538.643 39.0167 537.47 33.81 535.123 29.63C532.777 25.3767 529.623 22.15 525.663 19.95C521.703 17.75 517.23 16.65 512.243 16.65C507.33 16.65 502.857 17.75 498.823 19.95C494.863 22.15 491.71 25.3767 489.363 29.63C487.017 33.81 485.843 39.0167 485.843 45.25C485.843 51.4833 487.017 56.7267 489.363 60.98C491.71 65.2333 494.863 68.46 498.823 70.66C502.857 72.7867 507.33 73.85 512.243 73.85Z" fill="currentColor"/>
            <path d="M465.886 57.13C465.153 62.2633 463.393 66.7 460.606 70.44C457.819 74.18 454.263 77.0767 449.936 79.13C445.683 81.11 440.916 82.1 435.636 82.1C430.723 82.1 426.176 81.2567 421.996 79.57C417.816 77.81 414.149 75.3167 410.996 72.09C407.916 68.8633 405.496 64.9767 403.736 60.43C401.976 55.8833 401.096 50.8233 401.096 45.25C401.096 39.6033 401.976 34.5433 403.736 30.07C405.496 25.5233 407.916 21.6367 410.996 18.41C414.149 15.1833 417.816 12.7267 421.996 11.04C426.176 9.28 430.723 8.4 435.636 8.4C440.989 8.4 445.793 9.42666 450.046 11.48C454.373 13.46 457.929 16.3567 460.716 20.17C463.503 23.91 465.263 28.3833 465.996 33.59H457.856C456.829 29.9233 455.216 26.8433 453.016 24.35C450.889 21.8567 448.323 19.95 445.316 18.63C442.309 17.31 439.083 16.65 435.636 16.65C431.163 16.65 426.946 17.75 422.986 19.95C419.099 22.15 415.946 25.3767 413.526 29.63C411.106 33.8833 409.896 39.09 409.896 45.25C409.896 51.41 411.106 56.6167 413.526 60.87C415.946 65.1233 419.099 68.35 422.986 70.55C426.946 72.75 431.163 73.85 435.636 73.85C439.083 73.85 442.273 73.2267 445.206 71.98C448.213 70.66 450.779 68.7533 452.906 66.26C455.106 63.7667 456.719 60.7233 457.746 57.13H465.886Z" fill="currentColor"/>
            <path d="M334.255 70.55L331.835 71.32V9.5H340.635V81H331.835L285.415 20.06L287.835 19.29V81H279.035V9.5H287.835L334.255 70.55Z" fill="currentColor"/>
            <path d="M221.77 49.54V72.75H263.68V81H212.97V9.5H263.57V17.75H221.77V41.29H255.98V49.54H221.77Z" fill="currentColor"/>
            <path d="M160.626 46.24V40.52L201.986 81H189.996L152.376 43.6L185.486 9.5H197.366L160.626 46.24ZM143.576 9.5H152.376V81H143.576V9.5Z" fill="currentColor"/>
            <path d="M94.05 82.1C87.5233 82.1 81.5833 80.5967 76.23 77.59C70.95 74.51 66.7333 70.22 63.58 64.72C60.4267 59.22 58.85 52.73 58.85 45.25C58.85 37.77 60.4267 31.28 63.58 25.78C66.7333 20.2067 70.95 15.9167 76.23 12.91C81.5833 9.90333 87.5233 8.4 94.05 8.4C100.577 8.4 106.48 9.90333 111.76 12.91C117.113 15.9167 121.367 20.2067 124.52 25.78C127.673 31.28 129.25 37.77 129.25 45.25C129.25 52.73 127.673 59.22 124.52 64.72C121.367 70.22 117.113 74.51 111.76 77.59C106.48 80.5967 100.577 82.1 94.05 82.1ZM94.05 73.85C99.0367 73.85 103.51 72.7867 107.47 70.66C111.43 68.46 114.583 65.2333 116.93 60.98C119.277 56.7267 120.45 51.4833 120.45 45.25C120.45 39.0167 119.277 33.81 116.93 29.63C114.583 25.3767 111.43 22.15 107.47 19.95C103.51 17.75 99.0367 16.65 94.05 16.65C89.1367 16.65 84.6633 17.75 80.63 19.95C76.67 22.15 73.5167 25.3767 71.17 29.63C68.8233 33.81 67.65 39.0167 67.65 45.25C67.65 51.4833 68.8233 56.7267 71.17 60.98C73.5167 65.2333 76.67 68.46 80.63 70.66C84.6633 72.7867 89.1367 73.85 94.05 73.85Z" fill="currentColor"/>
            <path d="M0 9.5H57.2V17.75H0V9.5ZM24.2 16.87H33V81H24.2V16.87Z" fill="currentColor"/>
          </svg>
        </div>
        <button onClick={toggleSidebar}
          className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-tertiary
            transition-smooth" title={t('sidebar.hide')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <path d="M10 4L6 8L10 12" />
          </svg>
        </button>
      </div>

      {/* New Chat — navigate to WelcomeScreen where user picks a folder */}
      <div className="px-3">
      <button onClick={() => {
        // Save current session to cache before switching
        const currentTabId = useSessionStore.getState().selectedSessionId;
        if (currentTabId) {
          useChatStore.getState().saveToCache(currentTabId);
          useAgentStore.getState().saveToCache(currentTabId);
        }

        // Deselect current session FIRST so background stream routing works
        useSessionStore.getState().setSelectedSession(null);

        // Clear working directory so ChatPanel shows WelcomeScreen
        useSettingsStore.getState().setWorkingDirectory('');
        useChatStore.getState().resetSession();
      }}
        className="w-full py-2.5 px-4 rounded-[20px] text-sm font-medium
          bg-accent hover:bg-accent-hover text-text-inverse
          hover:shadow-glow transition-smooth mb-4
          flex items-center justify-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M8 3v10M3 8h10" />
        </svg>
        {t('sidebar.newChat')}
      </button>

      {/* Current Session — compressed single-line card */}
      {sessionMeta.sessionId && (
        <div className="px-3 py-2 rounded-xl bg-bg-secondary border border-border-subtle mb-3
          flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 transition-smooth
            ${sessionStatus === 'running'
              ? 'bg-success shadow-[0_0_8px_var(--color-accent-glow)] animate-pulse-soft'
              : sessionStatus === 'completed' ? 'bg-success'
              : sessionStatus === 'error' ? 'bg-error'
              : 'bg-text-tertiary'}`} />
          <span className="text-xs font-medium text-text-primary truncate">
            {sessionMeta.model ? getModelDisplayName(sessionMeta.model) : 'Claude'}
          </span>
          {(sessionMeta.totalInputTokens || sessionMeta.totalOutputTokens
            || sessionMeta.inputTokens || sessionMeta.outputTokens) ? (
            <span className="text-[10px] text-text-tertiary font-mono flex items-center gap-1 ml-auto flex-shrink-0">
              <span>↑{formatTokenCount(sessionMeta.totalInputTokens || sessionMeta.inputTokens || 0)}</span>
              <span>↓{formatTokenCount(sessionMeta.totalOutputTokens || sessionMeta.outputTokens || 0)}</span>
            </span>
          ) : (
            <span className="text-[10px] text-text-tertiary capitalize ml-auto flex-shrink-0">{sessionStatus}</span>
          )}
        </div>
      )}
      </div>

      {/* Conversation History */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 -mr-1.5 pr-1.5">
        <ConversationList />
      </div>

      {/* Footer */}
      <div className="pt-3 mt-3 border-t border-border-subtle px-3">
        <button onClick={toggleSettings}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl
            text-sm text-text-muted hover:bg-bg-secondary hover:text-text-primary
            transition-smooth">
          <div className="relative">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="2" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
            </svg>
            {updateAvailable && (
              <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full
                bg-green-500 border-[1.5px] border-bg-sidebar" />
            )}
          </div>
          {t('settings.title')}
        </button>
      </div>
    </div>
  );
}
