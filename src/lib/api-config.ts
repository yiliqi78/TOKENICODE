import { bridge } from './tauri-bridge';
import { useSettingsStore, type ApiFormat } from '../stores/settingsStore';

/**
 * Canonical JSON format for API provider config import/export.
 *
 * Example:
 * ```json
 * {
 *   "version": 1,
 *   "provider": {
 *     "name": "云雾",
 *     "baseUrl": "https://xxx.com/v1",
 *     "apiFormat": "openai",
 *     "apiKey": "sk-xxx",
 *     "modelMappings": [
 *       { "tier": "opus", "model": "claude-opus-4-6" },
 *       { "tier": "sonnet", "model": "claude-sonnet-4-6" },
 *       { "tier": "haiku", "model": "claude-haiku-4-5-20251001" }
 *     ]
 *   }
 * }
 * ```
 */
export interface ApiConfigFile {
  version: number;
  provider: {
    name: string;
    baseUrl: string;
    apiFormat: string;
    apiKey?: string;
    modelMappings: { tier: string; model: string }[];
  };
}

/**
 * Build an exportable JSON string from the current store state.
 * Includes the decrypted API key if available.
 */
export async function buildExportConfig(): Promise<{ json: string; hasKey: boolean }> {
  const state = useSettingsStore.getState();

  let apiKey: string | undefined;
  try {
    const key = await bridge.loadApiKey();
    if (key) apiKey = key;
  } catch {
    // Key unavailable — export without it
  }

  const config: ApiConfigFile = {
    version: 1,
    provider: {
      name: state.customProviderName,
      baseUrl: state.customProviderBaseUrl,
      apiFormat: state.customProviderApiFormat,
      ...(apiKey ? { apiKey } : {}),
      modelMappings: state.customProviderModelMappings
        .filter((m) => m.providerModel)
        .map((m) => ({ tier: m.tier, model: m.providerModel })),
    },
  };

  return { json: JSON.stringify(config, null, 2), hasKey: !!apiKey };
}

/**
 * Parse and validate a raw JSON string as an API config file.
 * Returns a human-readable Chinese error message on failure.
 */
export function parseAndValidate(
  raw: string,
): { ok: true; config: ApiConfigFile } | { ok: false; error: string } {
  // Strip UTF-8 BOM (Windows Notepad)
  let text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  text = text.trim();

  if (!text) {
    return { ok: false, error: '文件内容为空' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON 格式' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '配置文件格式不正确，应为 JSON 对象' };
  }

  const obj = parsed as Record<string, unknown>;

  // version
  if (obj.version !== 1) {
    return { ok: false, error: `不支持的配置版本：${obj.version ?? '缺失'}` };
  }

  // provider
  if (typeof obj.provider !== 'object' || obj.provider === null) {
    return { ok: false, error: '缺少 provider 配置' };
  }
  const p = obj.provider as Record<string, unknown>;

  // baseUrl — required
  if (typeof p.baseUrl !== 'string' || !p.baseUrl.trim()) {
    return { ok: false, error: '缺少 API 端点地址（baseUrl）' };
  }
  let baseUrl = p.baseUrl.trim();
  if (!/^https?:\/\//i.test(baseUrl)) {
    baseUrl = 'https://' + baseUrl;
  }
  baseUrl = baseUrl.replace(/\/+$/, '');

  // apiFormat — optional, default anthropic
  const validFormats = ['anthropic', 'openai'];
  const apiFormat = typeof p.apiFormat === 'string' ? p.apiFormat : 'anthropic';
  if (!validFormats.includes(apiFormat)) {
    return { ok: false, error: `API 格式无效：${apiFormat}，仅支持 anthropic 或 openai` };
  }

  // apiKey — optional
  if (p.apiKey !== undefined && p.apiKey !== null && typeof p.apiKey !== 'string') {
    return { ok: false, error: 'API Key 格式不正确，应为字符串' };
  }
  const apiKey = typeof p.apiKey === 'string' ? p.apiKey.trim() : undefined;

  // modelMappings — optional, default empty
  let rawMappings: unknown[] = [];
  if (p.modelMappings !== undefined) {
    if (!Array.isArray(p.modelMappings)) {
      return { ok: false, error: 'modelMappings 应为数组' };
    }
    rawMappings = p.modelMappings;
  }

  const validTiers = ['opus', 'sonnet', 'haiku'];
  const mappings: { tier: string; model: string }[] = [];
  for (const item of rawMappings) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, error: '模型映射条目格式不正确' };
    }
    const m = item as Record<string, unknown>;
    const tier = String(m.tier ?? '');
    if (!validTiers.includes(tier)) {
      return { ok: false, error: `无效的模型层级：${tier}，仅支持 opus / sonnet / haiku` };
    }
    const model = String(m.model ?? '');
    mappings.push({ tier, model });
  }

  const config: ApiConfigFile = {
    version: 1,
    provider: {
      name: typeof p.name === 'string' ? p.name : '',
      baseUrl,
      apiFormat,
      ...(apiKey ? { apiKey } : {}),
      modelMappings: mappings,
    },
  };

  return { ok: true, config };
}

/**
 * Apply a validated config to the settings store and save the API key.
 */
export async function applyConfig(config: ApiConfigFile): Promise<void> {
  const store = useSettingsStore.getState();

  store.setApiProviderMode('custom');
  store.setCustomProviderName(config.provider.name);
  store.setCustomProviderBaseUrl(config.provider.baseUrl);
  store.setCustomProviderApiFormat(config.provider.apiFormat as ApiFormat);
  store.setCustomProviderModelMappings(
    config.provider.modelMappings.map((m) => ({
      tier: m.tier as 'opus' | 'sonnet' | 'haiku',
      providerModel: m.model,
    })),
  );

  if (config.provider.apiKey) {
    await bridge.saveApiKey(config.provider.apiKey);
    store.bumpApiKeyVersion();
  }
}
