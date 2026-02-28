import { useEffect, useState, useCallback } from 'react';
import { useMcpStore } from '../../stores/mcpStore';
import type { McpServer, McpServerConfig } from '../../stores/mcpStore';
import { useT } from '../../lib/i18n';

export function McpTab() {
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

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleDelete = useCallback(async (name: string) => {
    if (confirm(t('mcp.confirmDelete'))) {
      await deleteServer(name);
    }
  }, [deleteServer, t]);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-text-primary">
            {t('mcp.title')}
          </h3>
          <span className="text-xs text-text-tertiary">{servers.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchServers()}
            className="p-1.5 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.refresh')}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M1 6a5 5 0 019-2M11 6a5 5 0 01-9 2" />
              <path d="M10 1v3h-3M2 11V8h3" />
            </svg>
          </button>
          <button
            onClick={() => setAdding(true)}
            className="p-1.5 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.add')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content — always expanded */}
      <div className="space-y-2">
        {/* Add form */}
        {isAdding && (
          <McpServerForm
            onSave={async (name, config) => { await addServer(name, config); }}
            onCancel={() => setAdding(false)}
            t={t}
          />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-accent/30
              border-t-accent rounded-full animate-spin" />
          </div>
        ) : servers.length === 0 && !isAdding ? (
          <p className="text-[13px] text-text-tertiary text-center py-6">
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
    </div>
  );
}

/* Compact server card */
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
    <div className="px-4 py-3 rounded-lg transition-smooth group border
      border-border-subtle hover:bg-bg-secondary">
      {/* Name + type + actions */}
      <div className="flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className="text-text-tertiary flex-shrink-0">
          <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v1H2V4z" />
          <path d="M2 7h12v5a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" />
        </svg>
        <span className="text-[13px] font-medium truncate flex-1 text-text-primary">
          {server.name}
        </span>
        <span className="flex-shrink-0 px-2 py-0.5 text-xs rounded-md
          bg-blue-500/15 text-blue-400 font-medium">
          {server.config.type}
        </span>
        <button
          onClick={onEdit}
          className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100
            hover:bg-bg-tertiary transition-smooth text-text-tertiary"
          title={t('mcp.edit')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100
            hover:bg-red-500/10 transition-smooth text-text-tertiary hover:text-red-500"
          title={t('mcp.delete')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
          </svg>
        </button>
      </div>
      {/* Command */}
      <p className="text-xs text-text-muted mt-1 font-mono truncate pl-5">
        {cmdDisplay}
      </p>
      {envCount > 0 && (
        <p className="text-xs text-text-tertiary mt-0.5 pl-5">
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

  const inputClass = `w-full px-3 py-2 text-[13px] bg-bg-chat border border-border-subtle
    rounded-lg outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary`;

  return (
    <div className="px-4 py-3 rounded-lg border border-accent/30 bg-accent/5 space-y-3">
      <div>
        <label className="text-xs text-text-muted">
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
        <label className="text-xs text-text-muted">
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
        <label className="text-xs text-text-muted">
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
        <label className="text-xs text-text-muted">
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
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !command.trim() || isSaving}
          className="flex-1 px-4 py-2 text-[13px] font-medium bg-accent text-text-inverse rounded-lg
            hover:bg-accent-hover disabled:opacity-40 transition-smooth"
        >
          {isSaving ? '...' : t('mcp.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-[13px] text-text-muted hover:text-text-primary transition-smooth"
        >
          {t('mcp.cancel')}
        </button>
      </div>
    </div>
  );
}
