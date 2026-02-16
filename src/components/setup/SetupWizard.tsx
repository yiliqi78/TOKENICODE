import { useEffect, useRef, useCallback } from 'react';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';
import {
  bridge,
  onSetupInstallOutput,
  onSetupInstallExit,
} from '../../lib/tauri-bridge';

export function SetupWizard() {
  const t = useT();
  const step = useSetupStore((s) => s.step);
  const installOutput = useSetupStore((s) => s.installOutput);
  const error = useSetupStore((s) => s.error);
  const cliVersion = useSetupStore((s) => s.cliVersion);
  const setStep = useSetupStore((s) => s.setStep);
  const appendInstallOutput = useSetupStore((s) => s.appendInstallOutput);
  const setError = useSetupStore((s) => s.setError);
  const setCliInfo = useSetupStore((s) => s.setCliInfo);
  const setSetupCompleted = useSettingsStore((s) => s.setSetupCompleted);

  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll output to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [installOutput]);

  // Poll auth status while in logging_in state (user is logging in via terminal)
  useEffect(() => {
    if (step !== 'logging_in') return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const auth = await bridge.checkClaudeAuth();
        if (cancelled) return;
        if (auth.authenticated) {
          setStep('ready');
        }
      } catch {
        // Ignore — keep polling
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step]);

  // Step 1: Auto-detect CLI on mount
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      try {
        const status = await bridge.checkClaudeCli();
        if (cancelled) return;
        if (status.installed) {
          setCliInfo(status.version ?? null, status.path ?? null);
          // Check auth before showing anything
          try {
            const auth = await bridge.checkClaudeAuth();
            if (cancelled) return;
            if (auth.authenticated) {
              // CLI installed + authenticated → skip wizard entirely
              setSetupCompleted(true);
              return;
            } else {
              setStep('login_needed');
            }
          } catch {
            if (!cancelled) setStep('login_needed');
          }
        } else {
          setStep('not_installed');
        }
      } catch {
        if (!cancelled) setStep('not_installed');
      }
    }
    detect();
    return () => { cancelled = true; };
  }, []);

  const handleInstall = useCallback(async () => {
    setStep('installing');
    setError(null);
    useSetupStore.getState().installOutput.length = 0; // clear

    const unlistenOutput = await onSetupInstallOutput((event) => {
      appendInstallOutput(event.line);
    });
    const unlistenExit = await onSetupInstallExit(async (event) => {
      unlistenOutput();
      unlistenExit();
      if (event.code === 0) {
        // Verify installation
        try {
          const status = await bridge.checkClaudeCli();
          if (status.installed) {
            setCliInfo(status.version ?? null, status.path ?? null);
            setStep('installed');
            // Auto-advance: check auth
            try {
              const auth = await bridge.checkClaudeAuth();
              if (auth.authenticated) {
                setStep('ready');
              } else {
                setStep('login_needed');
              }
            } catch {
              setStep('login_needed');
            }
          } else {
            setError('CLI not found after installation');
            setStep('install_failed');
          }
        } catch {
          setError('Failed to verify installation');
          setStep('install_failed');
        }
      } else {
        setError(`Install script exited with code ${event.code}`);
        setStep('install_failed');
      }
    });

    // Fire and forget — events handle the result
    bridge.installClaudeCli().catch((err) => {
      unlistenOutput();
      unlistenExit();
      setError(String(err));
      setStep('install_failed');
    });
  }, []);

  const handleLogin = useCallback(async () => {
    setStep('logging_in');
    setError(null);

    try {
      // Open a native terminal window with `claude login`
      await bridge.openTerminalLogin();
      // Terminal opened — wait a moment then start polling for auth
      setStep('logging_in');
    } catch (err) {
      setError(String(err));
      setStep('login_failed');
    }
  }, []);

  const handleSkip = useCallback(() => {
    setStep('skipped');
    setSetupCompleted(true);
  }, []);

  const handleComplete = useCallback(() => {
    setStep('ready');
    setSetupCompleted(true);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="w-full max-w-md">
        {/* Icon */}
        <div className="w-20 h-20 rounded-3xl bg-accent/10
          flex items-center justify-center mb-6 shadow-glow mx-auto">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
            className="text-accent">
            <path d="M18 4C10.268 4 4 10.268 4 18s6.268 14 14 14 14-6.268 14-14S25.732 4 18 4z"
              stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 17h10M13 21h6" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" />
          </svg>
        </div>

        {/* Step: Checking */}
        {step === 'checking' && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2">
              <span className="text-base leading-none animate-spin-slow text-accent">
                &#x2731;
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
                flex items-center gap-2 mx-auto"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 14h10" />
              </svg>
              {t('setup.install')}
            </button>

            {/* Manual install collapsible */}
            <details className="text-left mt-4">
              <summary className="text-xs text-text-tertiary cursor-pointer
                hover:text-text-muted transition-smooth">
                {t('setup.manualInstall')}
              </summary>
              <div className="mt-2 p-3 rounded-lg bg-bg-tertiary">
                <p className="text-xs text-text-muted mb-2">{t('setup.manualInstallCmd')}</p>
                <code className="text-xs font-mono text-accent block break-all">
                  curl -fsSL https://claude.ai/install.sh | sh
                </code>
              </div>
            </details>

            <button onClick={handleSkip}
              className="text-xs text-text-tertiary hover:text-text-muted
                transition-smooth mt-2">
              {t('setup.skip')}
            </button>
          </div>
        )}

        {/* Step: Installing */}
        {step === 'installing' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              <span className="text-base leading-none animate-spin-slow text-accent">
                &#x2731;
              </span>
              <span className="text-sm text-text-muted">{t('setup.installing')}</span>
            </div>
            <div
              ref={outputRef}
              className="h-48 overflow-y-auto rounded-lg bg-bg-tertiary p-3
                text-left font-mono text-xs text-text-muted leading-relaxed"
            >
              {installOutput.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
              ))}
            </div>
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
            {installOutput.length > 0 && (
              <div
                ref={outputRef}
                className="h-32 overflow-y-auto rounded-lg bg-bg-tertiary p-3
                  text-left font-mono text-xs text-text-muted leading-relaxed"
              >
                {installOutput.slice(-20).map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                ))}
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={handleInstall}
                className="px-4 py-2 rounded-xl text-sm font-medium
                  bg-accent hover:bg-accent-hover text-text-inverse
                  transition-smooth">
                {t('setup.retry')}
              </button>
              <button onClick={handleSkip}
                className="px-4 py-2 rounded-xl text-sm font-medium
                  border border-border-subtle text-text-muted
                  hover:bg-bg-tertiary transition-smooth">
                {t('setup.skip')}
              </button>
            </div>

            <details className="text-left mt-2">
              <summary className="text-xs text-text-tertiary cursor-pointer
                hover:text-text-muted transition-smooth">
                {t('setup.manualInstall')}
              </summary>
              <div className="mt-2 p-3 rounded-lg bg-bg-tertiary">
                <p className="text-xs text-text-muted mb-2">{t('setup.manualInstallCmd')}</p>
                <code className="text-xs font-mono text-accent block break-all">
                  curl -fsSL https://claude.ai/install.sh | sh
                </code>
              </div>
            </details>
          </div>
        )}

        {/* Step: Installed (brief, auto-advances) */}
        {step === 'installed' && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-green-500">
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 10l3 3 5-6" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-sm text-text-muted">{t('setup.installed')}</span>
            </div>
            {cliVersion && (
              <p className="text-xs text-text-tertiary">
                {t('setup.version')}: {cliVersion}
              </p>
            )}
            <div className="flex items-center justify-center gap-2">
              <span className="text-base leading-none animate-spin-slow text-accent">
                &#x2731;
              </span>
              <span className="text-xs text-text-tertiary">{t('setup.checking')}</span>
            </div>
          </div>
        )}

        {/* Step: Login Needed */}
        {step === 'login_needed' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-accent">
              {t('setup.loginNeeded')}
            </h2>
            <p className="text-sm text-text-muted leading-relaxed">
              {t('setup.loginNeededDesc')}
            </p>
            {cliVersion && (
              <p className="text-xs text-text-tertiary">
                CLI {t('setup.version')}: {cliVersion}
              </p>
            )}
            <button
              onClick={handleLogin}
              className="px-6 py-3 rounded-xl text-sm font-medium
                bg-accent hover:bg-accent-hover text-text-inverse
                hover:shadow-glow transition-smooth
                flex items-center gap-2 mx-auto"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6 2h4M8 2v5M5 8a3 3 0 006 0M3 14h10" />
              </svg>
              {t('setup.login')}
            </button>
            <button onClick={handleSkip}
              className="text-xs text-text-tertiary hover:text-text-muted
                transition-smooth block mx-auto">
              {t('setup.skip')}
            </button>
          </div>
        )}

        {/* Step: Logging In (via native terminal) */}
        {step === 'logging_in' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              <span className="text-base leading-none animate-spin-slow text-accent">
                &#x2731;
              </span>
              <span className="text-sm text-text-muted">{t('setup.loggingIn')}</span>
            </div>
            <p className="text-xs text-text-tertiary leading-relaxed">
              {t('setup.loggingInTerminalDesc')}
            </p>
            <button onClick={handleSkip}
              className="text-xs text-text-tertiary hover:text-text-muted
                transition-smooth block mx-auto">
              {t('setup.skip')}
            </button>
          </div>
        )}

        {/* Step: Login Failed */}
        {step === 'login_failed' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-red-500">
              {t('setup.loginFailed')}
            </h2>
            <p className="text-sm text-text-muted leading-relaxed">
              {t('setup.loginFailedDesc')}
            </p>
            {error && (
              <p className="text-xs text-red-400 font-mono bg-red-500/10 p-2 rounded-lg">
                {error}
              </p>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={handleLogin}
                className="px-4 py-2 rounded-xl text-sm font-medium
                  bg-accent hover:bg-accent-hover text-text-inverse
                  transition-smooth">
                {t('setup.retry')}
              </button>
              <button onClick={handleSkip}
                className="px-4 py-2 rounded-xl text-sm font-medium
                  border border-border-subtle text-text-muted
                  hover:bg-bg-tertiary transition-smooth">
                {t('setup.skip')}
              </button>
            </div>
          </div>
        )}

        {/* Step: Ready */}
        {step === 'ready' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-green-500">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 12l4 4 6-7" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h2 className="text-xl font-semibold text-accent">
                {t('setup.ready')}
              </h2>
            </div>
            <p className="text-sm text-text-muted leading-relaxed">
              {t('setup.readyDesc')}
            </p>
            {cliVersion && (
              <p className="text-xs text-text-tertiary">
                {t('setup.version')}: {cliVersion}
              </p>
            )}
            <button
              onClick={handleComplete}
              className="px-6 py-3 rounded-xl text-sm font-medium
                bg-accent hover:bg-accent-hover text-text-inverse
                hover:shadow-glow transition-smooth
                flex items-center gap-2 mx-auto"
            >
              {t('setup.start')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
