import { useEffect, useState, useCallback, useRef } from 'react';
import { useProviderStore, type ApiProvider, type ModelMapping } from '../../stores/providerStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

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
  const [testError, setTestError] = useState('');
  const [testTimeMs, setTestTimeMs] = useState<number | null>(null);

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
    setTestTimeMs(null);
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
      if (result.startsWith('OK')) {
        setTestStatus('success');
        setTestTimeMs(elapsed);
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
              {testTimeMs != null ? `${testTimeMs}ms` : t('provider.testSuccess')}
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
