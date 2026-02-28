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
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
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
    id: 'qwen-coder',
    name: 'Qwen Coder',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: 'openai',
    extra_env: {},
  },
  {
    id: 'kimi',
    name: 'Kimi k2',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiFormat: 'openai',
    extra_env: {},
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai',
    extra_env: {},
  },
];
