export interface PresetProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: 'anthropic' | 'openai';
  extra_env: Record<string, string>;
}

export const PROVIDER_PRESETS: PresetProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (官方)',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    extra_env: {},
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'openai',
    extra_env: {},
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiFormat: 'openai',
    extra_env: {},
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiFormat: 'openai',
    extra_env: {},
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiFormat: 'openai',
    extra_env: {},
  },
  {
    id: 'bedrock',
    name: 'AWS Bedrock',
    baseUrl: '',
    apiFormat: 'anthropic',
    extra_env: { ANTHROPIC_BEDROCK_ENABLED: '1', AWS_REGION: 'us-east-1' },
  },
  {
    id: 'vertex',
    name: 'Google Vertex',
    baseUrl: '',
    apiFormat: 'anthropic',
    extra_env: { ANTHROPIC_VERTEX_ENABLED: '1', CLOUD_ML_REGION: 'us-east5' },
  },
];
