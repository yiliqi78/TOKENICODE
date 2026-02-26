import { useEffect, useState, useCallback, useRef } from 'react';
import { useSettingsStore, MODEL_OPTIONS, ColorTheme, type ApiProviderMode } from '../../stores/settingsStore';
import { bridge } from '../../lib/tauri-bridge';
import { useMcpStore } from '../../stores/mcpStore';
import type { McpServer, McpServerConfig } from '../../stores/mcpStore';
import { useT } from '../../lib/i18n';
import { ChangelogModal } from '../shared/ChangelogModal';
import { buildExportConfig, parseAndValidate, applyConfig } from '../../lib/api-config';

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

          {/* CLI Management */}
          <CliSection />

          {/* About & Update */}
          <UpdateSection />

          {/* ── Advanced ── */}
          <div className="pt-3 mt-1 border-t border-border-subtle">
            <h3 className="text-[10px] font-semibold text-text-tertiary uppercase
              tracking-widest mb-3 flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
                <circle cx="8" cy="8" r="3" />
              </svg>
              {t('settings.advanced')}
            </h3>

            {/* API Provider (TK-303) */}
            <ApiProviderSection />

            {/* MCP Servers */}
            <McpSection />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   API Provider section (TK-303)
   ================================================================ */

const API_MODES: { id: ApiProviderMode; labelKey: string; descKey: string }[] = [
  { id: 'inherit', labelKey: 'api.inherit', descKey: 'api.inheritDesc' },
  { id: 'official', labelKey: 'api.official', descKey: 'api.officialDesc' },
  { id: 'custom', labelKey: 'api.custom', descKey: 'api.customDesc' },
];

const MODEL_TIERS: { tier: 'opus' | 'sonnet' | 'haiku'; labelKey: string; placeholderKey: string }[] = [
  { tier: 'opus', labelKey: 'api.opusModel', placeholderKey: 'api.opusPlaceholder' },
  { tier: 'sonnet', labelKey: 'api.sonnetModel', placeholderKey: 'api.sonnetPlaceholder' },
  { tier: 'haiku', labelKey: 'api.haikuModel', placeholderKey: 'api.haikuPlaceholder' },
];

function ApiProviderSection() {
  const t = useT();
  const mode = useSettingsStore((s) => s.apiProviderMode);
  const setMode = useSettingsStore((s) => s.setApiProviderMode);
  const providerName = useSettingsStore((s) => s.customProviderName);
  const setProviderName = useSettingsStore((s) => s.setCustomProviderName);
  const baseUrl = useSettingsStore((s) => s.customProviderBaseUrl);
  const setBaseUrl = useSettingsStore((s) => s.setCustomProviderBaseUrl);
  const modelMappings = useSettingsStore((s) => s.customProviderModelMappings);
  const setModelMappings = useSettingsStore((s) => s.setCustomProviderModelMappings);
  const apiFormat = useSettingsStore((s) => s.customProviderApiFormat);
  const setApiFormat = useSettingsStore((s) => s.setCustomProviderApiFormat);

  const [collapsed, setCollapsed] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'empty' | 'saved' | 'editing'>('empty');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'auth_error' | 'failed'>('idle');
  const [testError, setTestError] = useState('');
  const [baseUrlSaved, setBaseUrlSaved] = useState(false);
  const baseUrlTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveKeyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Tracks whether the key input is showing the mask vs real/editing content */
  const isMaskedRef = useRef(false);
  const [importError, setImportError] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'success'>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'success'>('idle');

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(baseUrlTimerRef.current);
      clearTimeout(saveKeyTimerRef.current);
    };
  }, []);

  // Load existing API key status on mount
  useEffect(() => {
    bridge.loadApiKey().then((key) => {
      if (key) {
        setApiKeyInput('••••••••••••');
        isMaskedRef.current = true;
        setKeyStatus('saved');
      }
    }).catch(() => {});
  }, []);

  // Auto-save API key with debounce
  const handleKeyChange = useCallback((value: string) => {
    // If currently showing mask and user starts typing, clear the mask
    let cleanValue = value;
    if (isMaskedRef.current) {
      cleanValue = value.replace('••••••••••••', '');
      isMaskedRef.current = false;
    }
    setApiKeyInput(cleanValue);
    setKeyStatus('editing');
    clearTimeout(saveKeyTimerRef.current);
    const trimmed = cleanValue.trim();
    if (!trimmed) return;
    saveKeyTimerRef.current = setTimeout(async () => {
      try {
        await bridge.saveApiKey(trimmed);
        setKeyStatus('saved');
        // Bump key version so envFingerprint changes → pre-warm staleness
        // check will kill the old process and spawn fresh with the new key.
        const { useSettingsStore: getSettings } = await import('../../stores/settingsStore');
        getSettings.getState().bumpApiKeyVersion();
      } catch (e) {
        console.error('Failed to save API key:', e);
      }
    }, 800);
  }, []);

  // Eye toggle: load real key when revealing
  const handleToggleShowKey = useCallback(async () => {
    if (!showKey && keyStatus === 'saved') {
      try {
        const realKey = await bridge.loadApiKey();
        if (realKey) {
          setApiKeyInput(realKey);
          isMaskedRef.current = false;
          setShowKey(true);
        }
      } catch {
        setShowKey(true);
      }
    } else if (showKey) {
      // Hide: re-mask if we were showing a saved key
      if (keyStatus === 'saved') {
        setApiKeyInput('••••••••••••');
        isMaskedRef.current = true;
      }
      setShowKey(false);
    } else {
      setShowKey(!showKey);
    }
  }, [showKey, keyStatus]);

  const handleTestConnection = useCallback(async () => {
    if (!baseUrl) return;
    setTestStatus('testing');
    setTestError('');
    try {
      const testModel = modelMappings.find((m) => m.providerModel)?.providerModel || '';
      if (!testModel) {
        setTestStatus('failed');
        setTestError(t('api.testNoModel'));
        setTimeout(() => { setTestStatus('idle'); setTestError(''); }, 5000);
        return;
      }
      const result = await bridge.testApiConnection(baseUrl, apiFormat, testModel);
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
    // Reset after 5s
    setTimeout(() => { setTestStatus('idle'); setTestError(''); }, 5000);
  }, [baseUrl, apiFormat, modelMappings]);

  const getMapping = (tier: 'opus' | 'sonnet' | 'haiku'): string => {
    return modelMappings.find((m) => m.tier === tier)?.providerModel || '';
  };

  const updateMapping = (tier: 'opus' | 'sonnet' | 'haiku', value: string) => {
    const existing = modelMappings.filter((m) => m.tier !== tier);
    if (value) {
      existing.push({ tier, providerModel: value });
    }
    setModelMappings(existing);
  };

  const inputClass = 'w-full px-2 py-1.5 text-[11px] bg-bg-chat border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/40';

  const handleImport = useCallback(async () => {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
    const result = await openDialog({
      title: t('api.importTitle'),
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

      await applyConfig(parsed.config);

      // Update local key display
      if (parsed.config.provider.apiKey) {
        setApiKeyInput('••••••••••••');
        isMaskedRef.current = true;
        setKeyStatus('saved');
      }

      setImportStatus('success');
      setCollapsed(false);
      setTimeout(() => setImportStatus('idle'), 3000);

      // Auto-test connection using the imported values directly
      const testModel = parsed.config.provider.modelMappings.find((m) => m.model)?.model;
      if (testModel && parsed.config.provider.baseUrl && parsed.config.provider.apiKey) {
        setTestStatus('testing');
        setTestError('');
        try {
          const testResult = await bridge.testApiConnection(
            parsed.config.provider.baseUrl,
            parsed.config.provider.apiFormat,
            testModel,
          );
          if (testResult.startsWith('OK')) {
            setTestStatus('success');
          } else {
            setTestStatus('failed');
            setTestError(testResult);
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
      }
    } catch (e) {
      setImportError(String(e));
      setTimeout(() => setImportError(''), 5000);
    }
  }, [t]);

  const handleExport = useCallback(async () => {
    try {
      const { json } = await buildExportConfig();
      const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');
      const filePath = await saveDialog({
        title: t('api.exportTitle'),
        defaultPath: 'api-config.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!filePath) return;

      await bridge.writeFileContent(filePath, json);
      setExportStatus('success');
      setTimeout(() => setExportStatus('idle'), 3000);
    } catch (e) {
      console.error('Export failed:', e);
    }
  }, [t]);

  return (
    <div className="pt-2 border-t border-border-subtle">
      {/* Header */}
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
            {t('api.title')}
          </h3>
          <span className="text-[10px] text-text-tertiary">
            {t(`api.${mode}`)}
          </span>
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-3 ml-4">
          {/* Mode selector */}
          <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
            {API_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`py-1.5 px-3 text-[11px] font-medium transition-smooth
                  border-r border-border-subtle last:border-r-0 whitespace-nowrap
                  ${mode === m.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:bg-bg-secondary'
                  }`}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>

          {/* Mode description */}
          <p className="text-[10px] text-text-tertiary">
            {t(API_MODES.find((m) => m.id === mode)?.descKey || '')}
          </p>

          {/* Import / Export config */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleImport}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth
                border border-border-subtle text-text-muted hover:bg-bg-secondary"
            >
              {t('api.importConfig')}
            </button>
            {mode === 'custom' && baseUrl && (
              <button
                onClick={handleExport}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth
                  border border-border-subtle text-text-muted hover:bg-bg-secondary"
              >
                {t('api.exportConfig')}
              </button>
            )}
            {importStatus === 'success' && (
              <span className="text-[10px] text-green-500">{t('api.importSuccess')}</span>
            )}
            {importError && (
              <span className="text-[10px] text-red-400 truncate flex-1" title={importError}>
                {importError}
              </span>
            )}
            {exportStatus === 'success' && (
              <span className="text-[10px] text-green-500">{t('api.exportSuccess')}</span>
            )}
          </div>

          {/* Custom provider form */}
          {mode === 'custom' && (
            <div className="space-y-2.5">
              {/* Provider name */}
              <div>
                <label className="text-[10px] text-text-muted mb-1 block">{t('api.providerName')}</label>
                <input
                  className={inputClass}
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  placeholder={t('api.providerNamePlaceholder')}
                />
              </div>

              {/* Base URL */}
              <div>
                <label className="text-[10px] text-text-muted mb-1 block">
                  {t('api.baseUrl')}
                  {baseUrlSaved && (
                    <span className="ml-1.5 text-green-500">{t('api.saved')}</span>
                  )}
                </label>
                <input
                  className={inputClass}
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setBaseUrlSaved(false);
                    clearTimeout(baseUrlTimerRef.current);
                    if (e.target.value.trim()) {
                      baseUrlTimerRef.current = setTimeout(() => {
                        setBaseUrlSaved(true);
                        setTimeout(() => setBaseUrlSaved(false), 2000);
                      }, 600);
                    }
                  }}
                  placeholder={t('api.baseUrlPlaceholder')}
                />
              </div>

              {/* API Format */}
              <div>
                <label className="text-[10px] text-text-muted mb-1 block">{t('api.format')}</label>
                <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
                  {(['anthropic', 'openai'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setApiFormat(fmt)}
                      className={`py-1.5 px-3 text-[11px] font-medium transition-smooth
                        border-r border-border-subtle last:border-r-0 whitespace-nowrap
                        ${apiFormat === fmt
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-muted hover:bg-bg-secondary'
                        }`}
                    >
                      {t(fmt === 'anthropic' ? 'api.formatAnthropic' : 'api.formatOpenai')}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-text-tertiary mt-1">{t('api.formatHint')}</p>
              </div>

              {/* API Key */}
              <div>
                <label className="text-[10px] text-text-muted mb-1 block">
                  {t('api.apiKey')}
                  {keyStatus === 'saved' && (
                    <span className="ml-1.5 text-green-500">{t('api.apiKeySaved')}</span>
                  )}
                </label>
                <div className="flex gap-1.5">
                  <input
                    className={`${inputClass} flex-1`}
                    type={showKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => handleKeyChange(e.target.value)}
                    placeholder={t('api.apiKeyPlaceholder')}
                  />
                  <button
                    onClick={handleToggleShowKey}
                    className="px-2 py-1.5 rounded-lg border border-border-subtle
                      text-[10px] text-text-muted hover:bg-bg-secondary transition-smooth"
                  >
                    {showKey ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              {/* Model Mappings */}
              <div>
                <label className="text-[10px] text-text-muted mb-1 block">{t('api.modelMappings')}</label>
                <p className="text-[9px] text-text-tertiary mb-1.5">{t('api.modelMappingsHint')}</p>
                <div className="space-y-1.5">
                  {MODEL_TIERS.map(({ tier, labelKey, placeholderKey }) => (
                    <div key={tier} className="flex items-center gap-2">
                      <span className="text-[10px] text-text-muted w-12 shrink-0">{t(labelKey)}</span>
                      <input
                        className={inputClass}
                        value={getMapping(tier)}
                        onChange={(e) => updateMapping(tier, e.target.value)}
                        placeholder={t(placeholderKey)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Test Connection */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTestConnection}
                  disabled={!baseUrl || testStatus === 'testing'}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-smooth
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
                      {t('api.testing')}
                    </span>
                  ) : testStatus === 'success' ? (
                    <span className="flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M3 8l4 4 6-7" />
                      </svg>
                      {t('api.testSuccess')}
                    </span>
                  ) : testStatus === 'auth_error' ? (
                    t('api.testAuthError')
                  ) : testStatus === 'failed' ? (
                    t('api.testFailed')
                  ) : (
                    t('api.testConnection')
                  )}
                </button>
                {testError && (testStatus === 'failed' || testStatus === 'auth_error') && (
                  <span className="text-[9px] text-red-400 truncate flex-1" title={testError}>
                    {testError}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   About & Update section
   ================================================================ */

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error';

type CliCheckStatus = 'idle' | 'checking' | 'found' | 'not_found' | 'installing' | 'installed' | 'install_failed';

import { stripAnsi } from '../../lib/strip-ansi';

/** Detect if an error message looks like a permission/access issue */
function isPermissionError(msg: string): boolean {
  const hints = ['EPERM', 'EACCES', 'permission denied', 'access denied',
    'Access is denied', 'operation not permitted'];
  const lower = msg.toLowerCase();
  return hints.some(h => lower.includes(h.toLowerCase()));
}

/** Detect if an error message looks like a network/firewall issue */
function isNetworkError(msg: string): boolean {
  // If it's a permission error, don't misclassify as network
  // (e.g. FetchError wrapping EPERM on npm cache)
  if (isPermissionError(msg)) return false;
  const hints = ['timeout', 'timed out', 'network', 'connect', 'ENOTFOUND',
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'fetch', 'Failed to download',
    'All install methods failed', 'dns', 'certificate'];
  const lower = msg.toLowerCase();
  return hints.some(h => lower.includes(h.toLowerCase()));
}

function CliSection() {
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
    <div className="pt-2 border-t border-border-subtle space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-muted font-medium">Claude Code CLI</span>
        {cliVersion && status !== 'not_found' && status !== 'install_failed' && (
          <span className="text-[10px] text-text-tertiary">v{cliVersion}</span>
        )}
      </div>

      {/* Status + path display */}
      {(status === 'found' || status === 'idle') && cliPath && (
        <div className="py-0.5 space-y-1">
          <span className="text-[11px] text-green-500 font-medium">
            ✓ {t('cli.installed')}
          </span>
          <p className="text-[10px] text-text-tertiary truncate" title={cliPath}>
            {cliPath}
          </p>
        </div>
      )}

      {/* Git Bash missing warning (Windows) — will be auto-installed on next install/reinstall */}
      {gitBashMissing && (status === 'found' || status === 'idle') && (
        <div className="py-1 px-2 rounded-lg bg-amber-500/10">
          <p className="text-[11px] text-amber-500 font-medium">
            {t('setup.gitBashMissing')} — {t('cli.reinstallHint') || 'Click reinstall to fix'}
          </p>
        </div>
      )}

      {status === 'not_found' && (
        <p className="text-[11px] text-amber-500">{t('cli.notFound')}</p>
      )}

      {/* Action buttons — always visible (check + install/reinstall) */}
      {(status === 'idle' || status === 'found' || status === 'not_found') && (
        <div className="flex gap-2">
          <button
            onClick={handleCheck}
            className="flex-1 py-1.5 text-[11px] font-medium rounded-lg
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
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-smooth
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
        <div className="flex items-center justify-center gap-2 py-1.5">
          <div className="w-3 h-3 border-2 border-accent/30
            border-t-accent rounded-full animate-spin" />
          <span className="text-[11px] text-text-muted">{t('cli.checking')}</span>
        </div>
      )}

      {status === 'installing' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted">
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
              <span className="text-[11px] text-text-tertiary">{downloadPercent}%</span>
            )}
          </div>
          <div className="w-full h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
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
        <div className="py-1.5 text-center space-y-2">
          <span className="text-[11px] text-green-500 font-medium">
            ✓ {t('cli.installDone')}
          </span>
          {cliPath && (
            <p className="text-[10px] text-text-tertiary truncate" title={cliPath}>
              {cliPath}
            </p>
          )}
          <button
            onClick={handleRestart}
            className="w-full py-1.5 text-[11px] font-medium rounded-lg
              bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
          >
            {t('cli.restart')}
          </button>
        </div>
      )}

      {status === 'install_failed' && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-red-500 text-center">{t('cli.installFail')}</p>
          {errorMsg && (
            <p className="text-[10px] text-text-tertiary text-center truncate" title={errorMsg}>
              {errorMsg}
            </p>
          )}
          {isPermissionError(errorMsg) && (
            <p className="text-[10px] text-amber-500 text-center">
              {t('error.permissionHint')}
            </p>
          )}
          {isNetworkError(errorMsg) && (
            <p className="text-[10px] text-amber-500 text-center">
              {t('network.firewallHint')}
            </p>
          )}
          <button
            onClick={handleInstall}
            className="w-full py-1.5 text-[11px] font-medium rounded-lg
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpdateHandle = any;

function UpdateSection() {
  const t = useT();
  const [appVersion, setAppVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateHandle>(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [showChangelog, setShowChangelog] = useState(false);
  const storeUpdateVersion = useSettingsStore((s) => s.updateVersion);

  useEffect(() => {
    import('@tauri-apps/api/app').then(({ getVersion }) =>
      getVersion().then(setAppVersion).catch(() => {})
    );
  }, []);

  // Bridge auto-check result: if store has an update version, pre-fill
  useEffect(() => {
    if (storeUpdateVersion && status === 'idle') {
      import('@tauri-apps/plugin-updater').then(({ check }) =>
        check().then((update) => {
          if (update) {
            setUpdateInfo(update);
            setStatus('available');
          }
        }).catch(() => {})
      );
    }
  }, [storeUpdateVersion]);

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
        <span className="text-[11px] text-text-muted flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 171 171" fill="none" className="flex-shrink-0 opacity-60">
            <path d="M66.79 58.73L40.33 85.19L66.79 111.66L57.53 120.92L21.8 85.19L57.53 49.47Z" fill="currentColor" />
            <path d="M111.5 49.47L147.22 85.19L111.5 120.92L102.24 111.66L128.7 85.19L102.24 58.73Z" fill="currentColor" />
            <path d="M90.01 39.92L102.01 39.92L79.24 129.92L67.24 129.92L79.24 81.92Z" className="fill-accent" />
          </svg>
          TOKENICODE
        </span>
        <span className="text-[11px] text-text-tertiary">
          {appVersion ? `v${appVersion}` : '...'}
        </span>
      </div>

      {/* View changelog */}
      <button
        onClick={() => setShowChangelog(true)}
        className="w-full py-1.5 text-[11px] font-medium rounded-lg
          border border-border-subtle text-text-muted
          hover:bg-bg-secondary hover:text-text-primary transition-smooth"
      >
        {t('changelog.view')}
      </button>

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
          {isPermissionError(errorMsg) && (
            <p className="text-[10px] text-amber-500 text-center">
              {t('error.permissionHint')}
            </p>
          )}
          {isNetworkError(errorMsg) && (
            <p className="text-[10px] text-amber-500 text-center">
              {t('network.firewallHint')}
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

      {/* Changelog modal */}
      {showChangelog && appVersion && (
        <ChangelogModal
          version={appVersion}
          onClose={() => setShowChangelog(false)}
        />
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
