import { type AiProviderConfig } from 'src/engine/metadata-modules/ai/ai-models/types/ai-provider-config.type';

export const isProviderConfigured = (config: AiProviderConfig): boolean =>
  config.authType === 'chatgpt'
    ? Boolean(config.subscriptionConnectionId)
    : Boolean(config.apiKey || config.accessKeyId || config.authType);
