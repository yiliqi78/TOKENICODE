import { useEffect, useState, useCallback } from 'react';
import { useSettingsStore, MODEL_OPTIONS, ColorTheme } from '../../stores/settingsStore';
import { useMcpStore } from '../../stores/mcpStore';
import type { McpServer, McpServerConfig } from '../../stores/mcpStore';
import { useT } from '../../lib/i18n';

const COLOR_THEMES: { id: ColorTheme; labelKey: string; preview: string; previewDark: string }[] = [
  {
    id: 'black',
    labelKey: 'settings.black',
    preview: '#333333',
    previewDark: '#D0D0D0',
  },
  {
    id: 'blue',
    labelKey: 'settings.blue',
    preview: '#4E80F7',
    previewDark: '#6B9AFF',
  },
  {
    id: 'orange',
    labelKey: 'settings.orange',
    preview: '#C47252',
    previewDark: '#D4856A',
  },
  {
    id: 'green',
    labelKey: 'settings.green',
    preview: '#57A64B',
    previewDark: '#6DBF62',
  },
];

export function SettingsPanel() {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme);
  const colorTheme = useSettingsStore((s) => s.colorTheme);
  const locale = useSettingsStore((s) => s.locale);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setColorTheme = useSettingsStore((s) => s.setColorTheme);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const setFontSize = useSettingsStore((s) => s.setFontSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) toggleSettings(); }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-[420px] max-h-[80vh] rounded-2xl bg-bg-card
        border border-border-subtle shadow-lg overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4
          border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">
            {t('settings.title')}
          </h2>
          <button onClick={toggleSettings}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary
              text-text-tertiary transition-smooth">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[calc(80vh-64px)]">

          {/* Row 1: Color Theme + Appearance */}
          <div className="flex gap-4">
            {/* Color Theme — compact circles */}
            <div className="flex-1">
              <h3 className="text-[11px] font-semibold text-text-muted uppercase
                tracking-wider mb-2">{t('settings.colorTheme')}</h3>
              <div className="flex gap-2">
                {COLOR_THEMES.map((ct) => (
                  <button
                    key={ct.id}
                    onClick={() => setColorTheme(ct.id)}
                    className="group relative"
                    title={t(ct.labelKey)}
                  >
                    <div
                      className={`w-7 h-7 rounded-full shadow-sm transition-smooth
                        ${colorTheme === ct.id
                          ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-card scale-110'
                          : 'hover:scale-110 opacity-75 hover:opacity-100'
                        }`}
                      style={{ background: ct.preview }}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Appearance — compact toggle */}
            <div className="flex-1">
              <h3 className="text-[11px] font-semibold text-text-muted uppercase
                tracking-wider mb-2">{t('settings.appearance')}</h3>
              <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
                {(['light', 'dark', 'system'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setTheme(m)}
                    className={`py-1.5 px-3 text-[11px] font-medium transition-smooth
                      border-r border-border-subtle last:border-r-0 whitespace-nowrap
                      ${theme === m
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-muted hover:bg-bg-secondary'
                      }`}
                  >
                    {t(`settings.${m}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Language + Font Size */}
          <div className="flex gap-4 items-end">
            {/* Language — compact toggle */}
            <div>
              <h3 className="text-[11px] font-semibold text-text-muted uppercase
                tracking-wider mb-2">{t('settings.language')}</h3>
              <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
                {(['zh', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className={`py-1.5 px-3 text-[11px] font-medium transition-smooth
                      border-r border-border-subtle last:border-r-0
                      ${locale === l
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-muted hover:bg-bg-secondary'
                      }`}
                  >
                    {l === 'zh' ? '中文' : 'EN'}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size — inline compact */}
            <div>
              <h3 className="text-[11px] font-semibold text-text-muted uppercase
                tracking-wider mb-2">{t('settings.fontSize')}</h3>
              <div className="inline-flex items-center rounded-lg border border-border-subtle
                overflow-hidden">
                <button
                  onClick={() => setFontSize(fontSize - 1)}
                  disabled={fontSize <= 10}
                  className="w-7 h-7 text-xs font-bold text-text-primary
                    hover:bg-bg-secondary transition-smooth
                    disabled:opacity-30 disabled:cursor-not-allowed
                    flex items-center justify-center border-r border-border-subtle"
                >-</button>
                <span className="w-10 text-center text-xs font-semibold text-text-primary">
                  {fontSize}px
                </span>
                <button
                  onClick={() => setFontSize(fontSize + 1)}
                  disabled={fontSize >= 24}
                  className="w-7 h-7 text-xs font-bold text-text-primary
                    hover:bg-bg-secondary transition-smooth
                    disabled:opacity-30 disabled:cursor-not-allowed
                    flex items-center justify-center border-l border-border-subtle"
                >+</button>
              </div>
            </div>
          </div>

          {/* Row 3: Default Model — compact grid */}
          <div>
            <h3 className="text-[11px] font-semibold text-text-muted uppercase
              tracking-wider mb-2">{t('settings.defaultModel')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {MODEL_OPTIONS.map((model) => (
                <button
                  key={model.id}
                  onClick={() => setSelectedModel(model.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5
                    rounded-lg text-[11px] font-medium transition-smooth
                    ${selectedModel === model.id
                      ? 'bg-accent/10 text-accent border border-accent/30'
                      : 'text-text-muted hover:bg-bg-secondary border border-border-subtle'
                    }`}
                >
                  {selectedModel === model.id && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M3 8l4 4 6-7" />
                    </svg>
                  )}
                  {model.short}
                </button>
              ))}
            </div>
          </div>

          {/* MCP Servers */}
          <McpSection />

          {/* About & Update */}
          <UpdateSection />
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   About & Update section
   ================================================================ */

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpdateHandle = any;

function UpdateSection() {
  const t = useT();
  const [appVersion, setAppVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateHandle>(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    import('@tauri-apps/api/app').then(({ getVersion }) =>
      getVersion().then(setAppVersion).catch(() => {})
    );
  }, []);

  const handleCheck = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        setUpdateInfo(update);
        setStatus('available');
      } else {
        setStatus('latest');
        setTimeout(() => setStatus('idle'), 3000);
      }
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!updateInfo) return;
    setStatus('downloading');
    setProgress(0);
    try {
      let totalLen = 0;
      let downloaded = 0;
      await updateInfo.downloadAndInstall((event: { event: string; data: { contentLength?: number; chunkLength: number } }) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalLen = event.data.contentLength;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (totalLen > 0) setProgress(Math.round((downloaded / totalLen) * 100));
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });
      setStatus('ready');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }, [updateInfo]);

  const handleRestart = useCallback(async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }, []);

  return (
    <div className="pt-2 border-t border-border-subtle space-y-2">
      {/* Version row */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-muted">TOKENICODE</span>
        <span className="text-[11px] text-text-tertiary">
          {appVersion ? `v${appVersion}` : '...'}
        </span>
      </div>

      {/* Update controls */}
      {status === 'idle' && (
        <button
          onClick={handleCheck}
          className="w-full py-1.5 text-[11px] font-medium rounded-lg
            border border-border-subtle text-text-muted
            hover:bg-bg-secondary hover:text-text-primary transition-smooth"
        >
          {t('update.check')}
        </button>
      )}

      {status === 'checking' && (
        <div className="flex items-center justify-center gap-2 py-1.5">
          <div className="w-3 h-3 border-2 border-accent/30
            border-t-accent rounded-full animate-spin" />
          <span className="text-[11px] text-text-muted">{t('update.checking')}</span>
        </div>
      )}

      {status === 'latest' && (
        <div className="py-1.5 text-center">
          <span className="text-[11px] text-green-500 font-medium">
            {t('update.latest')}
          </span>
        </div>
      )}

      {status === 'available' && updateInfo && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted">
              {t('update.version')}: <span className="font-medium text-accent">
                v{updateInfo.version}
              </span>
            </span>
          </div>
          <button
            onClick={handleDownload}
            className="w-full py-1.5 text-[11px] font-medium rounded-lg
              bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
          >
            {t('update.install')}
          </button>
        </div>
      )}

      {status === 'downloading' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted">{t('update.downloading')}</span>
            <span className="text-[11px] text-text-tertiary">{progress}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {status === 'ready' && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-text-muted text-center">
            {t('update.readyRestart')}
          </p>
          <button
            onClick={handleRestart}
            className="w-full py-1.5 text-[11px] font-medium rounded-lg
              bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
          >
            {t('update.restart')}
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-red-500 text-center">
            {t('update.error')}
          </p>
          {errorMsg && (
            <p className="text-[10px] text-text-tertiary text-center truncate"
              title={errorMsg}>
              {errorMsg}
            </p>
          )}
          <button
            onClick={handleCheck}
            className="w-full py-1.5 text-[11px] font-medium rounded-lg
              border border-border-subtle text-text-muted
              hover:bg-bg-secondary transition-smooth"
          >
            {t('update.check')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   MCP Servers section — collapsible, embedded in settings
   ================================================================ */

function McpSection() {
  const t = useT();
  const servers = useMcpStore((s) => s.servers);
  const isLoading = useMcpStore((s) => s.isLoading);
  const fetchServers = useMcpStore((s) => s.fetchServers);
  const addServer = useMcpStore((s) => s.addServer);
  const updateServer = useMcpStore((s) => s.updateServer);
  const deleteServer = useMcpStore((s) => s.deleteServer);
  const editingServer = useMcpStore((s) => s.editingServer);
  const isAdding = useMcpStore((s) => s.isAdding);
  const setEditing = useMcpStore((s) => s.setEditing);
  const setAdding = useMcpStore((s) => s.setAdding);

  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleDelete = useCallback(async (name: string) => {
    if (confirm(t('mcp.confirmDelete'))) {
      await deleteServer(name);
    }
  }, [deleteServer, t]);

  return (
    <div className="pt-2 border-t border-border-subtle">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className={`text-text-tertiary transition-transform ${collapsed ? '' : 'rotate-90'}`}>
            <path d="M3 1l4 4-4 4" />
          </svg>
          <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            {t('mcp.title')}
          </h3>
          <span className="text-[10px] text-text-tertiary">{servers.length}</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetchServers()}
            className="p-1 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.refresh')}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M1 6a5 5 0 019-2M11 6a5 5 0 01-9 2" />
              <path d="M10 1v3h-3M2 11V8h3" />
            </svg>
          </button>
          <button
            onClick={() => { setAdding(true); setCollapsed(false); }}
            className="p-1 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.add')}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Collapsible content */}
      {!collapsed && (
        <div className="space-y-1.5">
          {/* Add form */}
          {isAdding && (
            <McpServerForm
              onSave={async (name, config) => { await addServer(name, config); }}
              onCancel={() => setAdding(false)}
              t={t}
            />
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-4 h-4 border-2 border-accent/30
                border-t-accent rounded-full animate-spin" />
            </div>
          ) : servers.length === 0 && !isAdding ? (
            <p className="text-[11px] text-text-tertiary text-center py-3">
              {t('mcp.noServers')}
            </p>
          ) : (
            servers.map((server) => (
              editingServer === server.name ? (
                <McpServerForm
                  key={server.name}
                  server={server}
                  onSave={async (name, config) => {
                    await updateServer(server.name, name, config);
                  }}
                  onCancel={() => setEditing(null)}
                  t={t}
                />
              ) : (
                <McpServerCardCompact
                  key={server.name}
                  server={server}
                  onEdit={() => setEditing(server.name)}
                  onDelete={() => handleDelete(server.name)}
                  t={t}
                />
              )
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* Compact server card for settings panel */
function McpServerCardCompact({
  server,
  onEdit,
  onDelete,
  t,
}: {
  server: McpServer;
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string) => string;
}) {
  const envCount = Object.keys(server.config.env).length;
  const cmdDisplay = [server.config.command, ...server.config.args].join(' ');

  return (
    <div className="px-2.5 py-2 rounded-lg transition-smooth group border
      border-border-subtle hover:bg-bg-secondary">
      {/* Name + type + actions */}
      <div className="flex items-center gap-1.5">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className="text-text-tertiary flex-shrink-0">
          <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v1H2V4z" />
          <path d="M2 7h12v5a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" />
        </svg>
        <span className="text-[12px] font-medium truncate flex-1 text-text-primary">
          {server.name}
        </span>
        <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] rounded-md
          bg-blue-500/15 text-blue-400 font-medium">
          {server.config.type}
        </span>
        <button
          onClick={onEdit}
          className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
            hover:bg-bg-tertiary transition-smooth text-text-tertiary"
          title={t('mcp.edit')}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
            hover:bg-red-500/10 transition-smooth text-text-tertiary hover:text-red-500"
          title={t('mcp.delete')}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
          </svg>
        </button>
      </div>
      {/* Command */}
      <p className="text-[10px] text-text-muted mt-0.5 font-mono truncate pl-4">
        {cmdDisplay}
      </p>
      {envCount > 0 && (
        <p className="text-[9px] text-text-tertiary mt-0.5 pl-4">
          {envCount} {t('mcp.envCount')}
        </p>
      )}
    </div>
  );
}

/* Add/Edit form for MCP servers */
function McpServerForm({
  server,
  onSave,
  onCancel,
  t,
}: {
  server?: McpServer;
  onSave: (name: string, config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [name, setName] = useState(server?.name || '');
  const [command, setCommand] = useState(server?.config.command || '');
  const [argsText, setArgsText] = useState(server?.config.args.join('\n') || '');
  const [envText, setEnvText] = useState(
    server?.config.env
      ? Object.entries(server.config.env).map(([k, v]) => `${k}=${v}`).join('\n')
      : ''
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !command.trim()) return;
    setIsSaving(true);
    try {
      const args = argsText.split('\n').map((s) => s.trim()).filter(Boolean);
      const env: Record<string, string> = {};
      envText.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
      });
      await onSave(name.trim(), { command: command.trim(), args, env, type: 'stdio' });
    } finally {
      setIsSaving(false);
    }
  }, [name, command, argsText, envText, onSave]);

  const inputClass = `w-full px-2 py-1 text-xs bg-bg-chat border border-border-subtle
    rounded-lg outline-none focus:border-accent text-text-primary`;

  return (
    <div className="px-2.5 py-2 rounded-lg border border-accent/30 bg-accent/5 space-y-2">
      <div>
        <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
          {t('mcp.name')}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('mcp.namePlaceholder')}
          className={inputClass}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        />
      </div>
      <div>
        <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
          {t('mcp.command')}
        </label>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t('mcp.commandPlaceholder')}
          className={inputClass}
        />
      </div>
      <div>
        <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
          {t('mcp.args')}
        </label>
        <textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder={t('mcp.argsHint')}
          rows={2}
          className={`${inputClass} resize-none font-mono`}
        />
      </div>
      <div>
        <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
          {t('mcp.env')}
        </label>
        <textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder={t('mcp.envHint')}
          rows={2}
          className={`${inputClass} resize-none font-mono`}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !command.trim() || isSaving}
          className="flex-1 px-2 py-1 text-xs bg-accent text-text-inverse rounded-lg
            hover:bg-accent-hover disabled:opacity-40 transition-smooth"
        >
          {isSaving ? '...' : t('mcp.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-smooth"
        >
          {t('mcp.cancel')}
        </button>
      </div>
    </div>
  );
}
