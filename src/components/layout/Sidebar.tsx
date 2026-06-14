import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { ConversationList } from '../conversations/ConversationList';
import { useT } from '../../lib/i18n';
import { useAgentStore } from '../../stores/agentStore';
import { IS_ALPHA } from '../../lib/edition';

export function Sidebar() {
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const updateAvailable = useSettingsStore((s) => s.updateAvailable);
  const cliUpdateAvailable = useSettingsStore((s) => s.cliUpdateAvailable);
  const t = useT();

  // Window dragging handled via CSS -webkit-app-region: drag on the top strip

  return (
    <div className="flex flex-col h-full pt-8 pb-4">
      {/* Logo area */}
      <div
        className="flex items-center justify-between mb-6 mt-2 pl-5 pr-3.5 cursor-default">
        <div className="flex items-center pointer-events-none">
          {IS_ALPHA ? (
            <>
              <span className="text-[14px] font-bold tracking-tight text-text-primary">
                TC<span style={{color: 'var(--color-accent)'}}>/</span>Alpha
              </span>
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase
                bg-accent/15 text-accent leading-none">
                alpha
              </span>
            </>
          ) : (
            /* Her logo — fixed red circle + "Her" italic serif text */
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 332 332" fill="none"
                className="h-[26px] w-[26px] flex-shrink-0">
                <rect width="332" height="332" rx="166" fill="#E2373A"/>
                <path d="M178.07 131.021C188.854 131.351 199.57 135.102 209.475 139.951C218.502 144.371 227.374 149.969 235.591 155.453C245.477 148.343 257.076 142.006 272.396 142.006C282.825 142.006 291.406 144.724 297.332 150.301C303.379 155.991 305.489 163.564 304.907 170.608C303.828 183.688 292.913 197.686 276.925 197.686C269.017 197.686 260.541 193.419 253.155 189.017C247.865 185.864 242.088 181.961 236.223 177.961C235.871 178.234 235.517 178.509 235.16 178.786C221.573 189.279 204.882 201 177.795 201C166.969 201 156.358 197.538 146.422 192.962C137.762 188.973 129.055 183.864 120.689 178.841C104.459 189.957 85.6339 201 64.709 201C52.5478 201 42.6757 197.679 35.9098 191.344C29.0487 184.92 26.3435 176.263 27.1328 167.887C28.6925 151.336 43.4887 136.512 64.709 136.512C75.7629 136.512 86.5531 139.945 96.6493 144.529C104.513 148.099 112.361 152.564 119.938 157.067C128.577 150.96 137.634 144.533 146.71 139.687C156.331 134.549 166.864 130.678 178.07 131.021ZM64.709 154.845C52.2213 154.845 45.8141 163.098 45.1991 169.625C44.9011 172.787 45.8655 175.669 48.2467 177.899C50.7233 180.217 55.6669 182.667 64.709 182.667C77.6398 182.667 90.0894 176.805 103.191 168.478C98.4521 165.795 93.8061 163.338 89.2104 161.251C80.2438 157.181 72.1403 154.845 64.709 154.845ZM177.521 149.346C170.786 149.14 163.512 151.451 155.192 155.894C149.33 159.025 143.39 162.961 137.118 167.325C142.879 170.683 148.462 173.753 153.951 176.281C162.806 180.359 170.68 182.667 177.795 182.667C196.577 182.667 208.704 175.737 220.196 167.209C213.971 163.197 207.733 159.47 201.56 156.448C192.742 152.132 184.679 149.566 177.521 149.346ZM272.396 160.339C264.565 160.339 258.299 162.667 251.942 166.538C255.613 169.003 259.08 171.261 262.377 173.227C269.908 177.715 274.503 179.353 276.925 179.353C281.597 179.353 286.36 174.678 286.822 169.084C287.011 166.792 286.357 165.028 284.962 163.716C283.447 162.29 279.909 160.339 272.396 160.339Z" fill="white"/>
              </svg>
              <span className="text-[16px] text-text-primary italic"
                style={{fontFamily: 'Georgia, "Times New Roman", serif'}}>
                Her
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={toggleSidebar}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-tertiary
              transition-smooth" title={t('sidebar.hide')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M10 4L6 8L10 12" />
            </svg>
          </button>
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
          }}
            {...(import.meta.env.DEV && { 'data-testid': 'new-session-button' })}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-tertiary
              hover:text-text-primary transition-smooth" title={t('sidebar.newChat')}>
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Conversation History */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 no-scrollbar">
        <ConversationList />
      </div>

      {/* Footer */}
      <div className="pt-3 mt-3 border-t border-border-subtle px-3">
        <button onClick={toggleSettings}
          {...(import.meta.env.DEV && { 'data-testid': 'settings-button' })}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl
            text-sm text-text-muted hover:bg-bg-secondary hover:text-text-primary
            transition-smooth">
          <div className="relative">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {(updateAvailable || cliUpdateAvailable) && (
              <span className={`absolute -top-1 -right-1.5 w-2 h-2 rounded-full
                border-[1.5px] border-bg-sidebar ${cliUpdateAvailable ? 'bg-red-500' : 'bg-green-500'}`} />
            )}
          </div>
          {t('settings.title')}
        </button>
      </div>
    </div>
  );
}
