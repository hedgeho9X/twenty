/** Verifies gateway model kinds without making billable requests. */
import { SdkProviderFactoryService } from '../services/sdk-provider-factory.service';
import { type SiwcStoreService } from 'src/engine/core-modules/chatgpt-subscription/siwc-store.service';

describe('AI Gateway provider', () => {
  it('registers native evaluation models separately from language models', () => {
    const factory = new SdkProviderFactoryService({
      credential: jest.fn(),
    } as unknown as SiwcStoreService);
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

it('rejects a legacy subscription configuration instead of reading a local Codex login', () => {
  const credentials = jest.fn();
  const factory = new SdkProviderFactoryService({
    credential: credentials,
  } as unknown as SiwcStoreService);
  expect(() =>
    factory.createProvider('legacy', {
      npm: '@ai-sdk/openai',
      authType: 'chatgpt',
      subscriptionAccountId: 'old-account',
    }),
  ).toThrow('请在设置中连接');
  expect(credentials).not.toHaveBeenCalled();
});
