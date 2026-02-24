import { useEffect, useCallback, useState } from 'react';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';
import { stripAnsi } from '../../lib/strip-ansi';
import {
  bridge,
  onDownloadProgress,
} from '../../lib/tauri-bridge';

/**
 * SetupWizard — lightweight CLI detection & direct download install.
 *
 * Simplified flow (TK-302 v3):
 *   checking → (CLI found? skip to main) | not_installed
 *   not_installed → user clicks Install → installing (download with progress)
 *   installing → installed → auto-complete
 *   install_failed → retry | skip
 *
 * On Windows, git-bash (PortableGit) is auto-installed as part of the flow.
 * Auth/login is handled separately in Settings (TK-303).
 */
export function SetupWizard() {
  const t = useT();
  const step = useSetupStore((s) => s.step);
  const error = useSetupStore((s) => s.error);
  const cliVersion = useSetupStore((s) => s.cliVersion);
  const setStep = useSetupStore((s) => s.setStep);
  const setError = useSetupStore((s) => s.setError);
  const setCliInfo = useSetupStore((s) => s.setCliInfo);
  const setSetupCompleted = useSettingsStore((s) => s.setSetupCompleted);

  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadPhase, setDownloadPhase] = useState<string>('');

  // Auto-detect CLI on mount — skip wizard entirely if found
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      try {
        const status = await bridge.checkClaudeCli();
        if (cancelled) return;
        if (status.installed && !status.git_bash_missing) {
          setCliInfo(status.version ?? null, status.path ?? null);
          setSetupCompleted(true);
          return;
        }
        // CLI installed but git-bash missing → treat as needing install
        // (install_claude_cli will auto-install git-bash then detect existing CLI)
        if (status.installed && status.git_bash_missing) {
          setCliInfo(status.version ?? null, status.path ?? null);
        }
        setStep('not_installed');
      } catch {
        if (!cancelled) setStep('not_installed');
      }
    }
    detect();
    return () => { cancelled = true; };
  }, []);

  // Download-based install: Rust HTTP client downloads binary directly
  const handleInstall = useCallback(async () => {
    setStep('installing');
    setError(null);
    setDownloadPercent(0);
    setDownloadPhase('');

    const unlistenProgress = await onDownloadProgress((event) => {
      setDownloadPercent(event.percent);
      setDownloadPhase(event.phase);
    });

    try {
      await bridge.installClaudeCli();
      unlistenProgress();

      // Verify installation
      const status = await bridge.checkClaudeCli();
      if (status.installed) {
        setCliInfo(status.version ?? null, status.path ?? null);
        setStep('installed');
        setTimeout(() => setSetupCompleted(true), 1200);
      } else {
        setError('CLI not found after download');
        setStep('install_failed');
      }
    } catch (err) {
      unlistenProgress();
      setError(stripAnsi(String(err)));
      setStep('install_failed');
    }
  }, []);

  const handleSkip = useCallback(() => {
    setSetupCompleted(true);
  }, []);

  // Phase label for download progress
  const phaseLabel = downloadPhase === 'version' ? t('setup.fetchingVersion') || 'Fetching version...'
    : downloadPhase === 'downloading' ? t('setup.downloading') || 'Downloading...'
    : downloadPhase === 'installing' ? t('setup.finalizing') || 'Finalizing...'
    : downloadPhase === 'node_downloading' ? t('setup.downloadingNode') || 'Downloading Node.js...'
    : downloadPhase === 'node_extracting' ? t('setup.extractingNode') || 'Extracting Node.js...'
    : downloadPhase === 'node_complete' ? t('setup.preparingEnv') || 'Preparing environment...'
    : downloadPhase === 'npm_fallback' ? t('setup.installingCli') || 'Installing CLI via npm...'
    : downloadPhase === 'git_downloading' ? t('setup.downloadingGit') || 'Downloading Git...'
    : downloadPhase === 'git_extracting' ? t('setup.extractingGit') || 'Installing Git...'
    : downloadPhase === 'git_complete' ? t('setup.preparingEnv') || 'Preparing environment...'
    : '';

  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="w-full max-w-md">
        {/* Icon — brand </> */}
        <div className="w-20 h-20 rounded-3xl bg-black dark:bg-white
          flex items-center justify-center mb-6 shadow-glow mx-auto">
          <svg width="44" height="44" viewBox="0 0 171 171" fill="none">
            <path d="M66.79 58.73L40.33 85.19L66.79 111.66L57.53 120.92L21.8 85.19L57.53 49.47Z" className="fill-white dark:fill-black" />
            <path d="M111.5 49.47L147.22 85.19L111.5 120.92L102.24 111.66L128.7 85.19L102.24 58.73Z" className="fill-white dark:fill-black" />
            <path d="M90.01 39.92L102.01 39.92L79.24 129.92L67.24 129.92L79.24 81.92Z" fill="var(--color-icon-slash)" />
          </svg>
        </div>

        {/* Step: Checking */}
        {step === 'checking' && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm font-bold leading-none animate-pulse-soft text-accent">
                /
              </span>
              <span className="text-sm text-text-muted">{t('setup.checking')}</span>
            </div>
          </div>
        )}

        {/* Step: Not Installed */}
        {step === 'not_installed' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-accent">
              {t('setup.notInstalled')}
            </h2>
            <p className="text-sm text-text-muted leading-relaxed">
              {t('setup.notInstalledDesc')}
            </p>
            <button
              onClick={handleInstall}
              className="px-6 py-3 rounded-xl text-sm font-medium
                bg-accent hover:bg-accent-hover text-text-inverse
                hover:shadow-glow transition-smooth
                flex items-center gap-2 mx-auto cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 14h10" />
              </svg>
              {t('setup.install')}
            </button>

            <button onClick={handleSkip}
              className="text-xs text-text-tertiary hover:text-text-muted
                transition-smooth mt-2 cursor-pointer">
              {t('setup.skip')}
            </button>
          </div>
        )}

        {/* Step: Installing (download progress) */}
        {step === 'installing' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm font-bold leading-none animate-pulse-soft text-accent">
                /
              </span>
              <span className="text-sm text-text-muted">
                {phaseLabel || t('setup.installing')}
              </span>
            </div>
            {/* Precise progress bar */}
            <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
                style={{ width: `${Math.max(downloadPercent, 2)}%` }}
              />
            </div>
            {downloadPercent > 0 && (
              <span className="text-xs text-text-tertiary">{downloadPercent}%</span>
            )}
          </div>
        )}

        {/* Step: Install Failed */}
        {step === 'install_failed' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-red-500">
              {t('setup.installFailed')}
            </h2>
            <p className="text-sm text-text-muted leading-relaxed">
              {t('setup.installFailedDesc')}
            </p>
            {error && (
              <p className="text-xs text-red-400 font-mono bg-red-500/10 p-2 rounded-lg">
                {error}
              </p>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={handleInstall}
                className="px-4 py-2 rounded-xl text-sm font-medium
                  bg-accent hover:bg-accent-hover text-text-inverse
                  transition-smooth cursor-pointer">
                {t('setup.retry')}
              </button>
              <button onClick={handleSkip}
                className="px-4 py-2 rounded-xl text-sm font-medium
                  border border-border-subtle text-text-muted
                  hover:bg-bg-tertiary transition-smooth cursor-pointer">
                {t('setup.skip')}
              </button>
            </div>
          </div>
        )}

        {/* Step: Installed (brief confirmation, auto-completes) */}
        {step === 'installed' && (
          <div className="space-y-3 animate-scale-in">
            <div className="flex items-center justify-center gap-2">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-success">
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 10l3 3 5-6" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-sm text-text-primary font-medium">{t('setup.installed')}</span>
            </div>
            {cliVersion && (
              <p className="text-xs text-text-tertiary">
                {t('setup.version')}: {cliVersion}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
