import { useEffect, useState, useCallback } from 'react';
import { bridge, type CliCandidate } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { APP_NAME } from '../../lib/edition';
import { stripAnsi } from '../../lib/strip-ansi';
import { isPermissionError, isNetworkError } from './settingsUtils';
import { useSettingsStore } from '../../stores/settingsStore';

type CliCheckStatus = 'idle' | 'checking' | 'found' | 'not_found' | 'installing' | 'installed' | 'install_failed' | 'updating' | 'updated' | 'update_failed';

const SOURCE_I18N_KEYS: Record<string, string> = {
  official: 'cli.source.official',
  system: 'cli.source.system',
  appLocal: 'cli.source.appLocal',
  versionManager: 'cli.source.versionManager',
  dynamic: 'cli.source.dynamic',
};

const SOURCE_COLORS: Record<string, string> = {
  official: 'text-green-500',
  system: 'text-blue-400',
  appLocal: 'text-amber-500',
  versionManager: 'text-purple-400',
  dynamic: 'text-text-tertiary',
};

export function CliTab() {
  const t = useT();
  const [status, setStatus] = useState<CliCheckStatus>('idle');
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliPath, setCliPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [gitBashMissing, setGitBashMissing] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'configuring' | 'npm_fallback' | 'node_downloading' | 'node_extracting' | 'git_downloading' | 'git_extracting' | 'native_version' | 'native_manifest' | 'native_download' | 'native_verify' | 'native_install'>('idle');

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
      const p = event.phase;
      if (p === 'native_version' || p === 'native_manifest' || p === 'native_download'
        || p === 'native_verify' || p === 'native_install') {
        setPhase(p);
      } else if (p === 'git_downloading') {
        setPhase('git_downloading');
      } else if (p === 'git_extracting') {
        setPhase('git_extracting');
      } else if (p === 'npm_fallback') {
        setPhase('npm_fallback');
      } else if (p === 'node_downloading') {
        setPhase('node_downloading');
      } else if (p === 'node_extracting') {
        setPhase('node_extracting');
      } else if (p === 'complete' || event.percent >= 100) {
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

  const handleUpdate = useCallback(async () => {
    setStatus('updating');
    setErrorMsg('');
    setDownloadPercent(0);
    setPhase('idle');

    const { onDownloadProgress } = await import('../../lib/tauri-bridge');
    const unlisten = await onDownloadProgress((event) => {
      setDownloadPercent(event.percent);
      const p = event.phase;
      if (p === 'npm_fallback') {
        setPhase('npm_fallback');
      } else if (p === 'native_download') {
        setPhase('native_download');
      } else if (p === 'complete' || event.percent >= 100) {
        setPhase('configuring');
      }
    });

    try {
      const newVersion = await bridge.updateClaudeCli();
      unlisten();
      setCliVersion(newVersion);
      setStatus('updated');
      useSettingsStore.setState({ cliUpdateAvailable: false, cliLatestVersion: '' });
    } catch (e) {
      unlisten();
      setErrorMsg(stripAnsi(String(e)));
      setStatus('update_failed');
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
          <span className={`text-[13px] font-medium ${gitBashMissing ? 'text-amber-500' : 'text-green-500'}`}>
            {gitBashMissing ? '⚠' : '✓'} {t('cli.installed')}
          </span>
          <p className="text-xs text-text-tertiary truncate" title={cliPath}>
            {cliPath}
          </p>
        </div>
      )}

      {/* CLI update available */}
      {useSettingsStore.getState().cliUpdateAvailable && (status === 'found' || status === 'idle') && (
        <div className="py-2 px-3 rounded-lg bg-accent/10">
          <p className="text-[13px] text-accent font-medium">
            {t('cli.update')} — v{useSettingsStore.getState().cliLatestVersion} {t('update.available') || 'available'}
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
      {(status === 'idle' || status === 'found' || status === 'not_found' || status === 'update_failed') && (
        <div className="flex gap-3">
          {status !== 'not_found' && (
            <button
              onClick={handleUpdate}
              className="flex-1 py-2 text-[13px] font-medium rounded-lg
                border border-border-subtle text-text-muted
                hover:bg-bg-secondary hover:text-text-primary transition-smooth"
            >
              {t('cli.update')}
            </button>
          )}
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
                const confirmed = await ask(t('cli.confirmReinstall'), { title: APP_NAME, kind: 'warning' });
                if (!confirmed) return;
              }
              handleInstall();
            }}
            className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-smooth
              ${(status === 'not_found' || gitBashMissing)
                ? 'bg-accent text-text-inverse hover:bg-accent-hover'
                : 'border border-border-subtle text-text-muted hover:bg-bg-secondary hover:text-text-primary'
              }`}
          >
            {status === 'not_found' ? t('cli.install') : t('cli.reinstall')}
          </button>
        </div>
      )}

      {status === 'updating' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-muted">
              {phase === 'npm_fallback' ? t('setup.npmFallback')
                : phase === 'native_download' ? t('setup.nativeDownload')
                : phase === 'configuring' ? t('cli.configuring')
                : t('cli.updating')}
            </span>
            {downloadPercent > 0 && downloadPercent < 100 && (
              <span className="text-[13px] text-text-tertiary">{downloadPercent}%</span>
            )}
          </div>
          <div className="w-full h-2 rounded-full bg-bg-tertiary overflow-hidden">
            {downloadPercent > 0 ? (
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

      {status === 'updated' && (
        <div className="py-2 text-center space-y-3">
          <span className="text-[13px] text-green-500 font-medium">
            ✓ {t('cli.updateDone')} {cliVersion && `v${cliVersion}`}
          </span>
          <button
            onClick={handleRestart}
            className="w-full py-2 text-[13px] font-medium rounded-lg
              bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
          >
            {t('cli.restart')}
          </button>
        </div>
      )}

      {status === 'update_failed' && errorMsg && (
        <div className="py-2 px-3 rounded-lg bg-red-500/10">
          <p className="text-[13px] text-red-500 truncate" title={errorMsg}>{errorMsg}</p>
        </div>
      )}

      {status === 'checking' && (
        <div className="flex items-center justify-center gap-2 py-2">
          <div className="w-4 h-4 border-2 border-text-tertiary/30
            border-t-text-tertiary rounded-full animate-spin" />
          <span className="text-[13px] text-text-muted">{t('cli.checking')}</span>
        </div>
      )}

      {status === 'installing' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-muted">
              {phase === 'native_version' ? t('setup.nativeVersion')
                : phase === 'native_manifest' ? t('setup.nativeManifest')
                : phase === 'native_download' ? t('setup.nativeDownload')
                : phase === 'native_verify' ? t('setup.nativeVerify')
                : phase === 'native_install' ? t('setup.nativeInstall')
                : phase === 'configuring' ? t('cli.configuring')
                : phase === 'npm_fallback' ? t('setup.npmFallback')
                : phase === 'node_downloading' ? t('setup.downloadingNode')
                : phase === 'node_extracting' ? t('setup.extractingNode')
                : phase === 'git_downloading' ? t('setup.downloadingGit')
                : phase === 'git_extracting' ? t('setup.extractingGit')
                : t('cli.installing')}
            </span>
            {(phase === 'native_download' || phase === 'downloading' || phase === 'node_downloading' || phase === 'git_downloading') && downloadPercent > 0 && (
              <span className="text-[13px] text-text-tertiary">{downloadPercent}%</span>
            )}
          </div>
          <div className="w-full h-2 rounded-full bg-bg-tertiary overflow-hidden">
            {(phase === 'native_download' || phase === 'downloading' || phase === 'node_downloading' || phase === 'git_downloading') && downloadPercent > 0 ? (
              <div
                className="h-full bg-text-secondary rounded-full transition-all duration-300"
                style={{ width: `${downloadPercent}%` }}
              />
            ) : (
              <div className="h-full bg-text-secondary/60 rounded-full animate-pulse w-full" />
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

      {/* CLI Environment Diagnostics */}
      <CliDiagnostics />
    </div>
  );
}

// ─── CLI Diagnostics Panel ─────────────────────────────────

function CliDiagnostics() {
  const t = useT();
  const [candidates, setCandidates] = useState<CliCandidate[]>([]);
  const [pinnedPath, setPinnedPath] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  // Auto-scan on mount
  const handleScan = useCallback(async () => {
    setScanning(true);
    setActionMsg('');
    try {
      const [result, pinned] = await Promise.all([
        bridge.diagnoseCli(),
        bridge.getPinnedCli(),
      ]);
      setCandidates(result);
      setPinnedPath(pinned);
    } catch (e) {
      console.error('diagnose_cli failed:', e);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { handleScan(); }, [handleScan]);

  const handlePin = useCallback(async (path: string) => {
    try {
      await bridge.pinCli(path);
      setPinnedPath(path);
      setActionMsg(t('cli.pinned'));
    } catch (e) {
      setActionMsg(String(e));
    }
  }, [t]);

  const handleUnpin = useCallback(async () => {
    try {
      await bridge.unpinCli();
      setPinnedPath(null);
      setActionMsg(t('cli.unpinned'));
    } catch (e) {
      setActionMsg(String(e));
    }
  }, [t]);

  const handleInjectPath = useCallback(async (path: string) => {
    try {
      const result = await bridge.injectCliPath(path);
      setActionMsg(result);
    } catch (e) {
      setActionMsg(String(e));
    }
  }, []);

  const handleDelete = useCallback(async (path: string) => {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    const confirmed = await ask(
      `${t('cli.confirmDelete')}\n${path}`,
      { title: 'CLI', kind: 'warning' }
    );
    if (!confirmed) return;
    try {
      const result = await bridge.deleteCli(path);
      setActionMsg(result);
      const updated = await bridge.diagnoseCli();
      setCandidates(updated);
    } catch (e) {
      setActionMsg(String(e));
    }
  }, [t]);

  const handleRepair = useCallback(async () => {
    setScanning(true);
    setActionMsg('');
    try {
      const report = await bridge.repairCli();
      if (report.removed.length === 0) {
        setActionMsg(t('cli.repairNoneFound'));
      } else {
        setActionMsg(
          t('cli.repairRemoved').replace('{count}', String(report.removed.length))
        );
      }
      const updated = await bridge.diagnoseCli();
      setCandidates(updated);
    } catch (e) {
      setActionMsg(String(e));
    } finally {
      setScanning(false);
    }
  }, [t]);

  const isActive = (path: string) => pinnedPath ? path === pinnedPath : candidates[0]?.path === path;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-primary">{t('cli.environment')}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRepair}
            disabled={scanning}
            title={t('cli.repairTitle')}
            className="text-xs text-text-tertiary hover:text-text-primary transition-smooth disabled:opacity-50"
          >
            {t('cli.repair')}
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="text-xs text-text-tertiary hover:text-text-primary transition-smooth disabled:opacity-50"
          >
            {scanning ? t('cli.scanning') : t('cli.rescan')}
          </button>
        </div>
      </div>

      {scanning && candidates.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-3">
          <div className="w-4 h-4 border-2 border-text-tertiary/30
            border-t-text-tertiary rounded-full animate-spin" />
          <span className="text-[13px] text-text-muted">{t('cli.scanning')}</span>
        </div>
      )}

      {!scanning && candidates.length === 0 && (
        <p className="text-[13px] text-text-tertiary py-2">{t('cli.noCliFound')}</p>
      )}

      <div className="space-y-2">
        {candidates.map((c) => {
          const active = isActive(c.path);
          const canDelete = c.source !== 'official';
          return (
            <div
              key={c.path}
              className={`py-2.5 px-3 rounded-lg transition-smooth border
                ${active
                  ? 'border-accent/20 bg-accent/5'
                  : 'border-border-subtle'
                }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded
                    ${SOURCE_COLORS[c.source] || 'text-text-tertiary'}
                    ${active ? 'bg-accent/10' : 'bg-bg-tertiary/50'}`}
                  >
                    {t(SOURCE_I18N_KEYS[c.source] || '') || c.source}
                  </span>
                  {c.version && (
                    <span className="text-[13px] text-text-secondary font-medium">v{c.version}</span>
                  )}
                  {c.isNative && (
                    <span className="text-[11px] text-text-tertiary">native</span>
                  )}
                  {active && pinnedPath && (
                    <span className="text-[11px] text-accent font-medium">★</span>
                  )}
                </div>
                {active && (
                  <span className="text-[11px] text-accent font-medium shrink-0">{t('cli.inUse')}</span>
                )}
              </div>
              <p className="text-xs text-text-tertiary truncate mt-1" title={c.path}>
                {c.path}
              </p>
              {c.issues.length > 0 && (
                <p className="text-xs text-amber-500 mt-1">{c.issues.join(' · ')}</p>
              )}
              {/* Actions */}
              <div className="flex gap-2 mt-2">
                {!active && c.issues.length === 0 && (
                  <button
                    onClick={() => handlePin(c.path)}
                    className="py-1 px-2.5 text-xs font-medium rounded-md
                      border border-border-subtle text-text-muted
                      hover:bg-bg-secondary hover:text-text-primary transition-smooth"
                  >
                    {t('cli.use')}
                  </button>
                )}
                {active && pinnedPath && (
                  <button
                    onClick={handleUnpin}
                    className="py-1 px-2.5 text-xs font-medium rounded-md
                      border border-border-subtle text-text-muted
                      hover:bg-bg-tertiary transition-smooth"
                  >
                    {t('cli.unpin')}
                  </button>
                )}
                <button
                  onClick={() => handleInjectPath(c.path)}
                  className="py-1 px-2.5 text-xs font-medium rounded-md
                    border border-border-subtle text-text-muted
                    hover:bg-bg-tertiary transition-smooth"
                >
                  {t('cli.injectPath')}
                </button>
                {canDelete && (
                  <button
                    onClick={() => handleDelete(c.path)}
                    className="py-1 px-2.5 text-xs font-medium rounded-md
                      border border-red-500/20 text-red-400
                      hover:bg-red-500/10 transition-smooth"
                  >
                    {t('cli.delete')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {actionMsg && (
        <p className="text-xs text-text-tertiary">{actionMsg}</p>
      )}
    </div>
  );
}
