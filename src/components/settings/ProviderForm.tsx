import { useEffect, useState, useCallback, useRef } from 'react';
import { useProviderStore, type ApiProvider, type ModelMapping } from '../../stores/providerStore';
import { bridge, type ConnectionTestResult } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PROVIDER_PRESETS } from '../../lib/provider-presets';

const MODEL_TIERS: { tier: 'opus' | 'sonnet' | 'haiku'; labelKey: string; placeholderKey: string }[] = [
  { tier: 'opus', labelKey: 'provider.opusModel', placeholderKey: 'provider.opusPlaceholder' },
  { tier: 'sonnet', labelKey: 'provider.sonnetModel', placeholderKey: 'provider.sonnetPlaceholder' },
  { tier: 'haiku', labelKey: 'provider.haikuModel', placeholderKey: 'provider.haikuPlaceholder' },
];

const INPUT_CLASS = 'w-full px-3 py-2 text-[13px] bg-bg-chat border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent';

/* SVG eye icons */
function EyeOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
      <path d="M2 14L14 2" />
    </svg>
  );
}

export type TestStatus = 'idle' | 'testing' | 'success' | 'auth_error' | 'failed';

interface ProviderFormProps {
  provider: ApiProvider;
  onClose: () => void;
  onDelete: () => void;
  autoTest?: boolean;
  onTestStatusChange?: (status: TestStatus) => void;
}

export function ProviderForm({ provider, onClose, onDelete, autoTest, onTestStatusChange }: ProviderFormProps) {
  const t = useT();
  const updateProvider = useProviderStore((s) => s.updateProvider);

  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiFormat, setApiFormat] = useState(provider.apiFormat);
  const [apiKey, setApiKey] = useState(provider.apiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [mappings, setMappings] = useState<ModelMapping[]>(provider.modelMappings);
  const [extraEnv, setExtraEnv] = useState<Record<string, string>>(provider.extra_env || {});
  const [testStatus, _setTestStatus] = useState<TestStatus>('idle');
  const [_testError, setTestError] = useState('');
  const [testTimeMs, setTestTimeMs] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const setTestStatus = useCallback((status: TestStatus) => {
    _setTestStatus(status);
    onTestStatusChange?.(status);
  }, [onTestStatusChange]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  const autoSave = useCallback((patch: Partial<ApiProvider>) => {
    clearTimeout(saveTimerRef.current);
    // Reset test status on any field change
    setTestStatus('idle');
    setTestError('');
    setTestTimeMs(null);
    saveTimerRef.current = setTimeout(() => {
      updateProvider(provider.id, patch);
    }, 500);
  }, [provider.id, updateProvider]);

  const handleNameChange = (v: string) => { setName(v); autoSave({ name: v }); };
  const handleBaseUrlChange = (v: string) => { setBaseUrl(v); autoSave({ baseUrl: v }); };
  const handleApiKeyChange = (v: string) => { setApiKey(v); autoSave({ apiKey: v || undefined }); };
  // API format selector hidden from UI — kept for backward compat
  const _handleApiFormatChange = (v: 'anthropic' | 'openai') => { setApiFormat(v); autoSave({ apiFormat: v }); }; void _handleApiFormatChange;

  const FIXED_TIERS = new Set(['opus', 'sonnet', 'haiku']);

  const getMapping = (tier: string): string => {
    return mappings.find((m) => m.tier === tier)?.providerModel || '';
  };

  const updateMapping = (tier: string, value: string) => {
    const updated = mappings.filter((m) => m.tier !== tier);
    if (value) {
      updated.push({ tier, providerModel: value });
    }
    setMappings(updated);
    autoSave({ modelMappings: updated });
  };

  const extraMappings = mappings.filter((m) => !FIXED_TIERS.has(m.tier));

  const addExtraMapping = () => {
    const updated = [...mappings, { tier: '', providerModel: '' }];
    setMappings(updated);
    autoSave({ modelMappings: updated });
  };

  /** Update extra model: tier and providerModel are always the same value */
  const updateExtraModel = (oldTier: string, modelName: string) => {
    const updated = mappings.map((m) =>
      m.tier === oldTier && !FIXED_TIERS.has(m.tier) ? { tier: modelName, providerModel: modelName } : m,
    );
    setMappings(updated);
    autoSave({ modelMappings: updated });
  };

  const removeExtraMapping = (tier: string) => {
    const updated = mappings.filter((m) => m.tier !== tier || FIXED_TIERS.has(m.tier));
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
    setTestTimeMs(null);
    setTestResult(null);
    try {
      const testModel = mappings.find((m) => m.providerModel)?.providerModel || '';
      if (!testModel) {
        setTestStatus('failed');
        setTestError(t('provider.testNoModel'));
        return;
      }
      if (!apiKey) {
        setTestStatus('failed');
        setTestError(t('provider.testNoKey'));
        return;
      }
      const start = Date.now();
      const result = await bridge.testProviderConnection(baseUrl, apiFormat, apiKey, testModel);
      const elapsed = Date.now() - start;
      setTestResult(result);
      setTestTimeMs(elapsed);
      if (result.connectivity.ok && result.auth.ok && result.model.ok) {
        setTestStatus('success');
      } else if (!result.auth.ok && result.connectivity.ok) {
        setTestStatus('auth_error');
        setTestError(result.auth.message);
      } else {
        setTestStatus('failed');
        const failedStep = !result.connectivity.ok ? result.connectivity : result.model;
        setTestError(failedStep.message);
      }
    } catch (e) {
      setTestStatus('failed');
      setTestError(String(e));
    }
  }, [baseUrl, apiFormat, apiKey, mappings, t]);

  // Auto-trigger test when opened via card test button
  const autoTestDone = useRef(false);
  useEffect(() => {
    if (autoTest && !autoTestDone.current) {
      autoTestDone.current = true;
      handleTestConnection();
    }
  }, [autoTest, handleTestConnection]);

  return (
    <div className="p-4 rounded-lg border border-border-subtle bg-bg-secondary/50 space-y-3 ml-5">
      {/* Form header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-medium text-text-primary">{t('provider.editProvider')}</h4>
        <div className="flex items-center gap-1">
          <button onClick={onDelete}
            className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300 transition-smooth">
            {t('provider.deleteProvider')}
          </button>
          <button onClick={onClose}
            className="px-2 py-1 rounded text-xs text-text-tertiary hover:text-text-muted transition-smooth">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Test Connection — at the top */}
      <div className="space-y-1.5">
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
            ) : (
              t('provider.testConnection')
            )}
          </button>
          {testTimeMs != null && testStatus !== 'testing' && (
            <span className="text-xs text-text-tertiary">{testTimeMs}ms</span>
          )}
        </div>
        {testResult && (
          <div className="space-y-0.5 text-xs">
            {([
              { key: 'connectivity' as const, label: t('provider.testConnectivity') },
              { key: 'auth' as const, label: t('provider.testAuth') },
              { key: 'model' as const, label: t('provider.testModel') },
            ]).map(({ key, label }) => {
              const step = testResult[key];
              const isSkipped = step.message === 'Skipped';
              return (
                <div key={key} className="flex items-center gap-1.5">
                  {step.ok ? (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
                      stroke="rgb(34 197 94)" strokeWidth="2" strokeLinecap="round">
                      <path d="M3 8l4 4 6-7" />
                    </svg>
                  ) : isSkipped ? (
                    <span className="w-2.5 h-2.5 rounded-full bg-text-tertiary/30" />
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
                      stroke="rgb(239 68 68)" strokeWidth="2" strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  )}
                  <span className={step.ok ? 'text-green-500' : isSkipped ? 'text-text-tertiary' : 'text-red-400'}>
                    {label}
                  </span>
                  {!step.ok && !isSkipped && (
                    <span className="text-red-400/70 truncate flex-1" title={step.message}>
                      — {step.message}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Name */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.providerName')}</label>
        <input className={INPUT_CLASS} value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder={t('provider.providerNamePlaceholder')} />
      </div>

      {/* Base URL */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.baseUrl')}</label>
        <input className={INPUT_CLASS} value={baseUrl}
          onChange={(e) => handleBaseUrlChange(e.target.value)}
          placeholder={t('provider.baseUrlPlaceholder')} />
      </div>

      {/* API Format — hidden from UI, defaults to anthropic.
          Existing providers with 'openai' format still work via stored config. */}

      {/* API Key */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-text-muted">{t('provider.apiKey')}</label>
          {provider.preset && (() => {
            const keyUrl = PROVIDER_PRESETS.find(p => p.id === provider.preset)?.keyUrl;
            return keyUrl ? (
              <button onClick={() => openUrl(keyUrl)}
                className="text-xs text-accent hover:underline">
                {t('provider.getApiKey')}
              </button>
            ) : null;
          })()}
        </div>
        <div className="flex gap-1.5">
          <input
            className={`${INPUT_CLASS} flex-1`}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            placeholder={t('provider.apiKeyPlaceholder')}
          />
          <button onClick={() => setShowKey(!showKey)}
            className="px-2 py-1.5 rounded-lg border border-border-subtle
              text-text-muted hover:bg-bg-secondary transition-smooth flex items-center justify-center">
            {showKey ? <EyeClosedIcon /> : <EyeOpenIcon />}
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
              <input className={INPUT_CLASS}
                value={getMapping(tier)}
                onChange={(e) => updateMapping(tier, e.target.value)}
                placeholder={t(placeholderKey)} />
            </div>
          ))}
          {extraMappings.map((m, i) => (
            <div key={`extra-${i}`} className="flex items-center gap-1.5">
              <input className="w-2/5 shrink-0 px-3 py-2 text-[13px] bg-bg-chat border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                value={m.tier}
                onChange={(e) => updateExtraTier(m.tier, e.target.value)}
                placeholder={t('provider.modelIdPlaceholder')} />
              <span className="text-text-tertiary text-xs shrink-0">→</span>
              <input className="flex-1 min-w-0 px-3 py-2 text-[13px] bg-bg-chat border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                value={m.providerModel}
                onChange={(e) => updateMapping(m.tier || `__extra_${i}`, e.target.value)}
                placeholder={t('provider.providerModelPlaceholder')} />
              <button onClick={() => removeExtraMapping(m.tier)}
                className="text-text-tertiary hover:text-text-primary transition-smooth shrink-0 p-0.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          ))}
          <button onClick={addExtraMapping}
            className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-muted transition-smooth mt-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            {t('provider.addModelMapping')}
          </button>
        </div>
      </div>

      {/* Extra Env */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('provider.extraEnv')}</label>
        <p className="text-xs text-text-tertiary mb-1.5">{t('provider.extraEnvHint')}</p>
        <div className="space-y-1">
          {Object.entries(extraEnv).map(([key, value]) => (
            <div key={key} className="flex items-center gap-1">
              <input className={`${INPUT_CLASS} w-[140px] shrink-0`}
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
              <input className={`${INPUT_CLASS} flex-1`}
                value={value}
                onChange={(e) => handleExtraEnvChange(key, e.target.value)}
                placeholder={t('provider.extraEnvValuePlaceholder')} />
              <button onClick={() => handleExtraEnvRemove(key)}
                className="p-1 text-text-tertiary hover:text-red-400 transition-smooth">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l6 6M8 2l-6 6" />
                </svg>
              </button>
            </div>
          ))}
          <button onClick={handleExtraEnvAdd}
            className="text-xs text-accent hover:text-accent/80 transition-smooth">
            + {t('provider.addEnvVar')}
          </button>
        </div>
      </div>
    </div>
  );
}
