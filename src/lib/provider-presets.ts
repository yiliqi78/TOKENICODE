export interface PresetProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: 'anthropic' | 'openai';
  extra_env: Record<string, string>;
  /** URL to the provider's API key management page */
  keyUrl?: string;
  /** Provider-level thinking support: full = native, ignored = param silently dropped, unknown = untested */
  thinkingSupport?: 'full' | 'ignored' | 'unknown';
  /** Default model for all tiers (non-Claude providers) */
  defaultModel?: string;
  /** Per-tier default models (takes precedence over defaultModel) */
  defaultModels?: {
    opus?: string;
    sonnet?: string;
    haiku?: string;
  };
}

export const PROVIDER_PRESETS: PresetProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (官方)',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    extra_env: {},
    keyUrl: 'https://console.anthropic.com/account/keys',
    thinkingSupport: 'full',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    apiFormat: 'anthropic',
    extra_env: {},
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    thinkingSupport: 'full',
    defaultModels: {
      opus: 'glm-5',
      sonnet: 'glm-5-turbo',
      haiku: 'glm-4.7',
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/anthropic/',
    apiFormat: 'anthropic',
    extra_env: {},
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    thinkingSupport: 'full',
    defaultModels: {
      opus: 'kimi-k2.5',
      sonnet: 'kimi-k2',
      haiku: 'kimi-k2-turbo-preview',
    },
  },
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    baseUrl: 'https://api.kimi.com/coding/',
    apiFormat: 'anthropic',
    extra_env: {
      ENABLE_TOOL_SEARCH: 'false',
    },
    keyUrl: 'https://www.kimi.com/code/console',
    thinkingSupport: 'full',
    defaultModel: 'kimi-for-coding',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiFormat: 'anthropic',
    extra_env: {
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    thinkingSupport: 'full',
    defaultModels: {
      opus: 'MiniMax-M2.7',
      sonnet: 'MiniMax-M2.5',
      haiku: 'MiniMax-M2.1',
    },
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    apiFormat: 'anthropic',
    extra_env: {},
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    thinkingSupport: 'unknown',
    defaultModels: {
      opus: 'qwen3-max',
      sonnet: 'qwen3.5-plus',
      haiku: 'qwen3.5-flash',
    },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    apiFormat: 'anthropic',
    // S15: earlier versions tried `ANTHROPIC_AUTH_TOKEN: '${API_KEY}'` but the
    // `${API_KEY}` literal was never substituted, so the CLI sent an empty
    // bearer token. resolve_provider_env (Rust) sets ANTHROPIC_API_KEY from
    // the user's stored apiKey — OpenRouter accepts this on the
    // /api/v1/anthropic endpoint, matching the native Anthropic auth flow.
    extra_env: {},
    keyUrl: 'https://openrouter.ai/settings/keys',
    thinkingSupport: 'full',
  },
  {
    id: 'mimo',
    name: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    apiFormat: 'anthropic',
    extra_env: {},
    keyUrl: 'https://platform.xiaomimimo.com/',
    thinkingSupport: 'full',
    defaultModels: {
      opus: 'mimo-v2-pro[1m]',
      sonnet: 'mimo-v2-omni',
      haiku: 'mimo-v2-pro',
    },
  },
  {
    id: 'mimo-token-plan',
    name: '小米 MiMo Token Plan',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    apiFormat: 'anthropic',
    extra_env: {},
    keyUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
    thinkingSupport: 'full',
    defaultModels: {
      opus: 'mimo-v2-pro[1m]',
      sonnet: 'mimo-v2-omni',
      haiku: 'mimo-v2-pro',
    },
  },
];
