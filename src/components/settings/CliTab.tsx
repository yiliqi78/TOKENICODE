import { useEffect, useState, useCallback } from 'react';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { stripAnsi } from '../../lib/strip-ansi';
import { isPermissionError, isNetworkError } from './settingsUtils';

type CliCheckStatus = 'idle' | 'checking' | 'found' | 'not_found' | 'installing' | 'installed' | 'install_failed';

export function CliTab() {
  const t = useT();
  const [status, setStatus] = useState<CliCheckStatus>('idle');
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliPath, setCliPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [gitBashMissing, setGitBashMissing] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'configuring' | 'npm_fallback' | 'node_downloading' | 'node_extracting' | 'git_downloading' | 'git_extracting'>('idle');

  // Auto-check on mount
  useEffect(() => {
    bridge.checkClaudeCli().then((result) => {
      if (result.installed) {
        setCliVersion(result.version ?? null);
        setCliPath(result.path ?? null);
        setGitBashMissing(result.git_bash_missing ?? false);
        setStatus('found');
      } else {
        setStatus('not_found');
      }
    }).catch(() => setStatus('not_found'));
  }, []);

  const handleCheck = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const result = await bridge.checkClaudeCli();
      if (result.installed) {
        setCliVersion(result.version ?? null);
        setCliPath(result.path ?? null);
        setGitBashMissing(result.git_bash_missing ?? false);
        setStatus('found');
      } else {
        setStatus('not_found');
      }
    } catch (e) {
      setErrorMsg(stripAnsi(String(e)));
      setStatus('not_found');
    }
  }, []);

  const handleInstall = useCallback(async () => {
    setStatus('installing');
    setErrorMsg('');
    setDownloadPercent(0);
    setPhase('downloading');

    const { onDownloadProgress } = await import('../../lib/tauri-bridge');
    const unlisten = await onDownloadProgress((event) => {
      setDownloadPercent(event.percent);
      if (event.phase === 'git_downloading') {
        setPhase('git_downloading');
      } else if (event.phase === 'git_extracting') {
        setPhase('git_extracting');
      } else if (event.phase === 'npm_fallback') {
        setPhase('npm_fallback');
      } else if (event.phase === 'node_downloading') {
        setPhase('node_downloading');
      } else if (event.phase === 'node_extracting') {
        setPhase('node_extracting');
      } else if (event.phase === 'complete' || event.percent >= 100) {
        setPhase('configuring');
      }
    });

    try {
      await bridge.installClaudeCli();
      unlisten();
      const result = await bridge.checkClaudeCli();
      if (result.installed) {
        setCliVersion(result.version ?? null);
        setCliPath(result.path ?? null);
        setStatus('installed');
      } else {
        setErrorMsg('CLI not found after installation');
        setStatus('install_failed');
      }
    } catch (e) {
      unlisten();
      setErrorMsg(stripAnsi(String(e)));
      setStatus('install_failed');
    }
  }, []);

  const handleRestart = useCallback(async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-primary">Claude Code CLI</span>
        {cliVersion && status !== 'not_found' && status !== 'install_failed' && (
          <span className="text-xs text-text-tertiary">v{cliVersion}</span>
        )}
      </div>

      {/* Status + path display */}
      {(status === 'found' || status === 'idle') && cliPath && (
        <div className="py-1 space-y-1">
          <span className="text-[13px] text-green-500 font-medium">
            ✓ {t('cli.installed')}
          </span>
          <p className="text-xs text-text-tertiary truncate" title={cliPath}>
            {cliPath}
          </p>
        </div>
      )}

      {/* Git Bash missing warning (Windows) */}
      {gitBashMissing && (status === 'found' || status === 'idle') && (
        <div className="py-2 px-3 rounded-lg bg-amber-500/10">
          <p className="text-[13px] text-amber-500 font-medium">
            {t('setup.gitBashMissing')} — {t('cli.reinstallHint') || 'Click reinstall to fix'}
          </p>
        </div>
      )}

      {status === 'not_found' && (
        <p className="text-[13px] text-amber-500">{t('cli.notFound')}</p>
      )}

      {/* Action buttons */}
      {(status === 'idle' || status === 'found' || status === 'not_found') && (
        <div className="flex gap-3">
          <button
            onClick={handleCheck}
            className="flex-1 py-2 text-[13px] font-medium rounded-lg
              border border-border-subtle text-text-muted
              hover:bg-bg-secondary hover:text-text-primary transition-smooth"
          >
            {t('cli.check')}
          </button>
          <button
            onClick={async () => {
              if (status !== 'not_found') {
                const { ask } = await import('@tauri-apps/plugin-dialog');
                const confirmed = await ask(t('cli.confirmReinstall'), { title: 'TOKENICODE', kind: 'warning' });
                if (!confirmed) return;
              }
              handleInstall();
            }}
            className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-smooth
              ${status === 'not_found'
                ? 'bg-accent text-text-inverse hover:bg-accent-hover'
                : 'border border-border-subtle text-text-muted hover:bg-bg-secondary hover:text-text-primary'
              }`}
          >
            {status === 'not_found' ? t('cli.install') : t('cli.reinstall')}
          </button>
        </div>
      )}

      {status === 'checking' && (
        <div className="flex items-center justify-center gap-2 py-2">
          <div className="w-4 h-4 border-2 border-accent/30
            border-t-accent rounded-full animate-spin" />
          <span className="text-[13px] text-text-muted">{t('cli.checking')}</span>
        </div>
      )}

      {status === 'installing' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-muted">
              {phase === 'configuring'
                ? t('cli.configuring')
                : phase === 'npm_fallback'
                  ? t('cli.npmFallback')
                  : phase === 'node_downloading'
                    ? t('setup.downloadingNode')
                    : phase === 'node_extracting'
                      ? t('setup.extractingNode')
                      : phase === 'git_downloading'
                        ? t('setup.downloadingGit')
                        : phase === 'git_extracting'
                          ? t('setup.extractingGit')
                          : t('cli.installing')}
            </span>
            {(phase === 'downloading' || phase === 'node_downloading' || phase === 'git_downloading') && downloadPercent > 0 && (
              <span className="text-[13px] text-text-tertiary">{downloadPercent}%</span>
            )}
          </div>
          <div className="w-full h-2 rounded-full bg-bg-tertiary overflow-hidden">
            {(phase === 'downloading' || phase === 'node_downloading' || phase === 'git_downloading') && downloadPercent > 0 ? (
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${downloadPercent}%` }}
              />
            ) : (
              <div className="h-full bg-accent/60 rounded-full animate-pulse w-full" />
            )}
          </div>
        </div>
      )}

      {status === 'installed' && (
        <div className="py-2 text-center space-y-3">
          <span className="text-[13px] text-green-500 font-medium">
            ✓ {t('cli.installDone')}
          </span>
          {cliPath && (
            <p className="text-xs text-text-tertiary truncate" title={cliPath}>
              {cliPath}
            </p>
          )}
          <button
            onClick={handleRestart}
            className="w-full py-2 text-[13px] font-medium rounded-lg
              bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
          >
            {t('cli.restart')}
          </button>
        </div>
      )}

      {status === 'install_failed' && (
        <div className="space-y-2">
          <p className="text-[13px] text-red-500 text-center">{t('cli.installFail')}</p>
          {errorMsg && (
            <p className="text-xs text-text-tertiary text-center truncate" title={errorMsg}>
              {errorMsg}
            </p>
          )}
          {isPermissionError(errorMsg) && (
            <p className="text-xs text-amber-500 text-center">
              {t('error.permissionHint')}
            </p>
          )}
          {isNetworkError(errorMsg) && (
            <p className="text-xs text-amber-500 text-center">
              {t('network.firewallHint')}
            </p>
          )}
          <button
            onClick={handleInstall}
            className="w-full py-2 text-[13px] font-medium rounded-lg
              border border-border-subtle text-text-muted
              hover:bg-bg-secondary transition-smooth"
          >
            {t('cli.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
