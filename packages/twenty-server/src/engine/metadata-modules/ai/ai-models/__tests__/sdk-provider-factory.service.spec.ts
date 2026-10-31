/** Verifies gateway model kinds without making billable requests. */
import { SdkProviderFactoryService } from '../services/sdk-provider-factory.service';

describe('AI Gateway provider', () => {
  it('registers native evaluation models separately from language models', () => {
    const factory = new SdkProviderFactoryService();
    const provider = factory.createProvider('test-gateway', {
      npm: '@ai-sdk/gateway',
      apiKey: 'test-only',
    });
    expect(provider.createEvaluationModel?.('typesafe-ai/jev').modelId).toBe(
      'typesafe-ai/jev',
    );
    expect(provider.createModel?.('openai/test')).toMatchObject({
      modelId: 'openai/test',
    });
    expect(
      factory.createProvider('test-gateway', { npm: '@ai-sdk/gateway' }),
    ).toBe(provider);
    factory.clearCache();
    expect(
      factory.createProvider('test-gateway', { npm: '@ai-sdk/gateway' }),
    ).not.toBe(provider);
  });
});
