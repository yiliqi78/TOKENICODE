import { useEffect, useState, useCallback, useRef } from 'react';
import { useProviderStore, type ApiProvider, type ModelMapping } from '../../stores/providerStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { PROVIDER_PRESETS, type PresetProvider } from '../../lib/provider-presets';
import { parseAndValidate, exportProvider, importAsProvider } from '../../lib/api-config';

const MODEL_TIERS: { tier: 'opus' | 'sonnet' | 'haiku'; labelKey: string; placeholderKey: string }[] = [
  { tier: 'opus', labelKey: 'provider.opusModel', placeholderKey: 'provider.opusPlaceholder' },
  { tier: 'sonnet', labelKey: 'provider.sonnetModel', placeholderKey: 'provider.sonnetPlaceholder' },
  { tier: 'haiku', labelKey: 'provider.haikuModel', placeholderKey: 'provider.haikuPlaceholder' },
];

export function ProviderManager({ alwaysExpanded = false }: { alwaysExpanded?: boolean } = {}) {
  const t = useT();
  const providers = useProviderStore((s) => s.providers);
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const loaded = useProviderStore((s) => s.loaded);
  const setActive = useProviderStore((s) => s.setActive);
  const deleteProvider = useProviderStore((s) => s.deleteProvider);
  const addProvider = useProviderStore((s) => s.addProvider);

  const [collapsed, setCollapsed] = useState(alwaysExpanded ? false : true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'success'>('idle');
  const [importError, setImportError] = useState('');

  // Load providers on mount
  useEffect(() => {
    if (!loaded) {
      useProviderStore.getState().load();
    }
  }, [loaded]);

  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const activeLabel = activeProvider ? activeProvider.name : t('provider.inherit');

  const handleAddFromPreset = useCallback((preset: PresetProvider) => {
    addProvider({
      name: preset.name,
      baseUrl: preset.baseUrl,
      apiFormat: preset.apiFormat,
      modelMappings: [
        { tier: 'opus', providerModel: 'claude-opus-4-6' },
        { tier: 'sonnet', providerModel: 'claude-sonnet-4-6' },
        { tier: 'haiku', providerModel: 'claude-haiku-4-5-20251001' },
      ],
      extra_env: { ...preset.extra_env },
      preset: preset.id,
    });
    // Edit the newly added provider
    const { providers: updated } = useProviderStore.getState();
    const last = updated[updated.length - 1];
    if (last) setEditingId(last.id);
  }, [addProvider]);

  const handleImport = useCallback(async () => {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
    const result = await openDialog({
      title: t('provider.importTitle'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    });
    const filePath = Array.isArray(result) ? result[0] : result;
    if (!filePath) return;

    setImportError('');
    setImportStatus('idle');

    try {
      const content = await bridge.readFileContent(filePath);
      const parsed = parseAndValidate(content);
      if (!parsed.ok) {
        setImportError(parsed.error);
        setTimeout(() => setImportError(''), 5000);
        return;
      }
      importAsProvider(parsed.provider);
      setImportStatus('success');
      setTimeout(() => setImportStatus('idle'), 3000);
      // Edit the imported provider
      const { providers: updated } = useProviderStore.getState();
      const last = updated[updated.length - 1];
      if (last) setEditingId(last.id);
    } catch (e) {
      setImportError(String(e));
      setTimeout(() => setImportError(''), 5000);
    }
  }, [t]);

  const inputClass = 'w-full px-3 py-2 text-[13px] bg-bg-chat border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent';

  const isExpanded = alwaysExpanded || !collapsed;

  return (
    <div className={alwaysExpanded ? '' : 'pt-2 border-t border-border-subtle'}>
      {/* Header */}
      {!alwaysExpanded && (
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
            <h3 className="text-[13px] font-medium text-text-primary">
              {t('provider.title')}
            </h3>
            <span className="text-xs text-text-tertiary">
              {activeLabel}
            </span>
          </button>
        </div>
      )}

      {isExpanded && (
        <div className="space-y-3 ml-0">
          {/* Provider list */}
          <div className="space-y-1">
            {/* Inherit system config option */}
            <button
              onClick={() => setActive(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-smooth
                ${!activeProviderId
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'text-text-muted hover:bg-bg-secondary border border-border-subtle'
                }`}
            >
              {t('provider.inherit')}
              <span className="text-xs text-text-tertiary ml-2">{t('provider.inheritDesc')}</span>
            </button>

            {/* Provider entries */}
            {providers.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <button
                  onClick={() => setActive(p.id)}
                  className={`flex-1 text-left px-3 py-2 rounded-lg text-[13px] transition-smooth
                    ${activeProviderId === p.id
                      ? 'bg-accent/10 text-accent border border-accent/30'
                      : 'text-text-muted hover:bg-bg-secondary border border-border-subtle'
                    }`}
                >
                  {p.name || t('provider.unnamed')}
                  {p.baseUrl && (() => {
                    try {
                      return (
                        <span className="text-xs text-text-tertiary ml-2">
                          {new URL(p.baseUrl).hostname}
                        </span>
                      );
                    } catch {
                      return null;
                    }
                  })()}
                </button>
                <button
                  onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                  className="p-1 text-text-tertiary hover:text-text-muted transition-smooth"
                  title={t('provider.editProvider')}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M11 2l3 3-9 9H2v-3z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add / Import buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                const preset = PROVIDER_PRESETS.find((p) => p.id === 'anthropic');
                if (preset) handleAddFromPreset(preset);
              }}
              className="px-3 py-2 rounded-lg text-[13px] font-medium transition-smooth
                border border-border-subtle text-text-muted hover:bg-bg-secondary"
            >
              Anthropic {t('provider.official')}
            </button>
            <button
              onClick={() => {
                addProvider({
                  name: '',
                  baseUrl: '',
                  apiFormat: 'openai',
                  modelMappings: [
                    { tier: 'opus', providerModel: '' },
                    { tier: 'sonnet', providerModel: '' },
                    { tier: 'haiku', providerModel: '' },
                  ],
                  extra_env: {},
                });
                const { providers: updated } = useProviderStore.getState();
                const last = updated[updated.length - 1];
                if (last) setEditingId(last.id);
              }}
              className="px-3 py-2 rounded-lg text-[13px] font-medium transition-smooth
                border border-border-subtle text-text-muted hover:bg-bg-secondary"
            >
              {t('provider.customApi')}
            </button>
            <button
              onClick={handleImport}
              className="px-3 py-2 rounded-lg text-[13px] font-medium transition-smooth
                border border-border-subtle text-text-muted hover:bg-bg-secondary"
            >
              {t('provider.importConfig')}
            </button>
            {importStatus === 'success' && (
              <span className="text-xs text-green-500">{t('provider.importSuccess')}</span>
            )}
            {importError && (
              <span className="text-xs text-red-400 truncate flex-1" title={importError}>
                {importError}
              </span>
            )}
          </div>

          {/* Provider edit form */}
          {editingId && (
            <ProviderForm
              provider={providers.find((p) => p.id === editingId)!}
              onClose={() => setEditingId(null)}
              onDelete={() => {
                deleteProvider(editingId);
                setEditingId(null);
              }}
              inputClass={inputClass}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Provider edit form
   ================================================================ */

function ProviderForm({
  provider,
  onClose,
  onDelete,
  inputClass,
}: {
  provider: ApiProvider;
  onClose: () => void;
  onDelete: () => void;
  inputClass: string;
}) {
  const t = useT();
  const updateProvider = useProviderStore((s) => s.updateProvider);

  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiFormat, setApiFormat] = useState(provider.apiFormat);
  const [apiKey, setApiKey] = useState(provider.apiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [mappings, setMappings] = useState<ModelMapping[]>(provider.modelMappings);
  const [extraEnv, setExtraEnv] = useState<Record<string, string>>(provider.extra_env || {});
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'auth_error' | 'failed'>('idle');
  const [testError, setTestError] = useState('');
  const [exportStatus, setExportStatus] = useState<'idle' | 'success'>('idle');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  // Auto-save with debounce
  const autoSave = useCallback((patch: Partial<ApiProvider>) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      updateProvider(provider.id, patch);
    }, 500);
  }, [provider.id, updateProvider]);

  const handleNameChange = (v: string) => { setName(v); autoSave({ name: v }); };
  const handleBaseUrlChange = (v: string) => { setBaseUrl(v); autoSave({ baseUrl: v }); };
  const handleApiKeyChange = (v: string) => { setApiKey(v); autoSave({ apiKey: v || undefined }); };
  const handleApiFormatChange = (v: 'anthropic' | 'openai') => { setApiFormat(v); autoSave({ apiFormat: v }); };

  const getMapping = (tier: 'opus' | 'sonnet' | 'haiku'): string => {
    return mappings.find((m) => m.tier === tier)?.providerModel || '';
  };

  const updateMapping = (tier: 'opus' | 'sonnet' | 'haiku', value: string) => {
    const updated = mappings.filter((m) => m.tier !== tier);
    if (value) {
      updated.push({ tier, providerModel: value });
    }
    setMappings(updated);
    autoSave({ modelMappings: updated });
  };

  const handleExtraEnvChange = (key: string, value: string) => {
    const updated = { ...extraEnv, [key]: value };
    setExtraEnv(updated);
    autoSave({ extra_env: updated });
  };

  const handleExtraEnvRemove = (key: string) => {
    const updated = { ...extraEnv };
    delete updated[key];
    setExtraEnv(updated);
    autoSave({ extra_env: updated });
  };

  const handleExtraEnvAdd = () => {
    const key = `NEW_VAR_${Object.keys(extraEnv).length}`;
    setExtraEnv({ ...extraEnv, [key]: '' });
  };

  const handleTestConnection = useCallback(async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      const testModel = mappings.find((m) => m.providerModel)?.providerModel || '';
      if (!testModel) {
        setTestStatus('failed');
        setTestError(t('provider.testNoModel'));
        setTimeout(() => { setTestStatus('idle'); setTestError(''); }, 5000);
        return;
      }
      if (!apiKey) {
        setTestStatus('failed');
        setTestError(t('provider.testNoKey'));
        setTimeout(() => { setTestStatus('idle'); setTestError(''); }, 5000);
        return;
      }
      const result = await bridge.testProviderConnection(baseUrl, apiFormat, apiKey, testModel);
      if (result.startsWith('OK')) {
        setTestStatus('success');
      } else {
        setTestStatus('failed');
        setTestError(result);
      }
    } catch (e) {
      const err = String(e);
      if (err.includes('AUTH_ERROR')) {
        setTestStatus('auth_error');
        setTestError(err.replace('AUTH_ERROR: ', ''));
      } else {
        setTestStatus('failed');
        setTestError(err);
      }
    }
    setTimeout(() => { setTestStatus('idle'); setTestError(''); }, 5000);
  }, [baseUrl, apiFormat, apiKey, mappings, t]);

  const handleExport = useCallback(async () => {
    try {
      // Get latest provider state
      const currentProvider = useProviderStore.getState().providers.find((p) => p.id === provider.id);
      if (!currentProvider) return;

      const json = exportProvider(currentProvider);
      const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');
      const filePath = await saveDialog({
        title: t('provider.exportTitle'),
        defaultPath: `${name || 'provider'}-config.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!filePath) return;

      await bridge.writeFileContent(filePath, json);
      setExportStatus('success');
      setTimeout(() => setExportStatus('idle'), 3000);
    } catch (e) {
      console.error('Export failed:', e);
    }
  }, [provider.id, name, t]);

  return (
    <div className="p-4 rounded-lg border border-border-subtle bg-bg-secondary/50 space-y-3">
      {/* Form header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-medium text-text-primary">{t('provider.editProvider')}</h4>
        <div className="flex items-center gap-1">
          <button onClick={handleExport}
            className="px-2 py-1 rounded text-xs text-text-tertiary hover:text-text-muted transition-smooth">
            {exportStatus === 'success' ? t('provider.exportSuccess') : t('provider.exportConfig')}
          </button>
          <button onClick={onDelete}
            className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300 transition-smooth">
            {t('provider.deleteProvider')}
          </button>
          <button onClick={onClose}
            className="px-2 py-1 rounded text-xs text-text-tertiary hover:text-text-muted transition-smooth">
            ✕
          </button>
        </div>
      </div>

      {/* Name */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.providerName')}</label>
        <input className={inputClass} value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder={t('provider.providerNamePlaceholder')} />
      </div>

      {/* Base URL */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.baseUrl')}</label>
        <input className={inputClass} value={baseUrl}
          onChange={(e) => handleBaseUrlChange(e.target.value)}
          placeholder={t('provider.baseUrlPlaceholder')} />
      </div>

      {/* API Format */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.format')}</label>
        <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
          {(['anthropic', 'openai'] as const).map((fmt) => (
            <button key={fmt}
              onClick={() => handleApiFormatChange(fmt)}
              className={`py-1.5 px-3 text-[13px] font-medium transition-smooth
                border-r border-border-subtle last:border-r-0 whitespace-nowrap
                ${apiFormat === fmt
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-bg-secondary'
                }`}>
              {t(fmt === 'anthropic' ? 'provider.formatAnthropic' : 'provider.formatOpenai')}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-tertiary mt-1">{t('provider.formatHint')}</p>
      </div>

      {/* API Key */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.apiKey')}</label>
        <div className="flex gap-1.5">
          <input
            className={`${inputClass} flex-1`}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            placeholder={t('provider.apiKeyPlaceholder')}
          />
          <button onClick={() => setShowKey(!showKey)}
            className="px-2 py-1.5 rounded-lg border border-border-subtle
              text-xs text-text-muted hover:bg-bg-secondary transition-smooth">
            {showKey ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      {/* Model Mappings */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.modelMappings')}</label>
        <p className="text-xs text-text-tertiary mb-1.5">{t('provider.modelMappingsHint')}</p>
        <div className="space-y-1.5">
          {MODEL_TIERS.map(({ tier, labelKey, placeholderKey }) => (
            <div key={tier} className="flex items-center gap-2">
              <span className="text-xs text-text-muted w-14 shrink-0">{t(labelKey)}</span>
              <input className={inputClass}
                value={getMapping(tier)}
                onChange={(e) => updateMapping(tier, e.target.value)}
                placeholder={t(placeholderKey)} />
            </div>
          ))}
        </div>
      </div>

      {/* Extra Env */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.extraEnv')}</label>
        <p className="text-xs text-text-tertiary mb-1.5">{t('provider.extraEnvHint')}</p>
        <div className="space-y-1">
          {Object.entries(extraEnv).map(([key, value]) => (
            <div key={key} className="flex items-center gap-1">
              <input className={`${inputClass} w-[140px] shrink-0`}
                value={key}
                onChange={(e) => {
                  const newEnv = { ...extraEnv };
                  delete newEnv[key];
                  newEnv[e.target.value] = value;
                  setExtraEnv(newEnv);
                  autoSave({ extra_env: newEnv });
                }}
                placeholder="KEY" />
              <span className="text-xs text-text-tertiary">=</span>
              <input className={`${inputClass} flex-1`}
                value={value}
                onChange={(e) => handleExtraEnvChange(key, e.target.value)}
                placeholder={t('provider.extraEnvValuePlaceholder')} />
              <button onClick={() => handleExtraEnvRemove(key)}
                className="p-1 text-text-tertiary hover:text-red-400 transition-smooth text-xs">
                ✕
              </button>
            </div>
          ))}
          <button onClick={handleExtraEnvAdd}
            className="text-xs text-accent hover:text-accent/80 transition-smooth">
            + {t('provider.addEnvVar')}
          </button>
        </div>
      </div>

      {/* Test Connection */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleTestConnection}
          disabled={!baseUrl || testStatus === 'testing'}
          className={`px-3 py-2 rounded-lg text-[13px] font-medium transition-smooth
            border border-border-subtle
            ${testStatus === 'success'
              ? 'bg-green-500/10 text-green-500 border-green-500/30'
              : testStatus === 'failed' || testStatus === 'auth_error'
                ? 'bg-red-500/10 text-red-500 border-red-500/30'
                : 'text-text-muted hover:bg-bg-secondary'
            }
            disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {testStatus === 'testing' ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border-[1.5px] border-accent/30
                border-t-accent rounded-full animate-spin" />
              {t('provider.testing')}
            </span>
          ) : testStatus === 'success' ? (
            <span className="flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 8l4 4 6-7" />
              </svg>
              {t('provider.testSuccess')}
            </span>
          ) : testStatus === 'auth_error' ? (
            t('provider.testAuthError')
          ) : testStatus === 'failed' ? (
            t('provider.testFailed')
          ) : (
            t('provider.testConnection')
          )}
        </button>
        {testError && (testStatus === 'failed' || testStatus === 'auth_error') && (
          <span className="text-xs text-red-400 truncate flex-1" title={testError}>
            {testError}
          </span>
        )}
      </div>
    </div>
  );
}
