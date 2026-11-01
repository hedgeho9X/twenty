import { experimental_evaluate as evaluate } from 'ai';
jest.mock('ai', () => ({ experimental_evaluate: jest.fn() }));
/** Validates feature model boundaries and preservation of unrelated native settings. */
import { AiFeatureModelsService } from './ai-feature-models.service';

const setup = () => {
  const values: Record<string, unknown> = {
    AI_FEATURE_MODELS: { jd_extraction: 'text/old' },
  };
  const config = {
    get: jest.fn((key) => values[key]),
    set: jest.fn(async (key, value) => {
      values[key] = value;
    }),
  };
  const registry = {
    getModel: jest.fn((id) => (id.startsWith('text/') ? {} : undefined)),
    getEvaluationModel: jest.fn((id) =>
      id.startsWith('eval/') ? {} : undefined,
    ),
    isModelAdminAllowed: jest.fn((id) => id !== 'text/disabled'),
    getDefaultModelForTier: jest.fn(() => ({ modelId: 'text/default' })),
    getAllModelsWithStatus: jest.fn(() => []),
    getAllEvaluationModelsWithStatus: jest.fn(() => []),
  };
  const factory = {
    createTransientProvider: jest.fn(() => ({
      createEvaluationModel: jest.fn(() => ({})),
    })),
  };
  const providers = { getResolvedProviders: jest.fn(() => ({})) };
  return {
    config,
    values,
    providers,
    factory,
    service: new AiFeatureModelsService(
      config as never,
      registry as never,
      providers as never,
      factory as never,
    ),
  };
};
it('persists one feature without overwriting another feature', async () => {
  const { service, config } = setup();
  await service.set('candidate_extraction', 'text/new');
  expect(config.set).toHaveBeenCalledWith('AI_FEATURE_MODELS', {
    jd_extraction: 'text/old',
    candidate_extraction: 'text/new',
  });
  expect(service.resolve('candidate_extraction')).toBe('text/new');
});
it.each([
  ['unknown', 'text/new'],
  ['jev_matching', 'text/new'],
  ['candidate_extraction', 'eval/new'],
  ['candidate_extraction', 'text/disabled'],
])('rejects invalid binding %s / %s', async (feature, model) => {
  const { service, config } = setup();
  await expect(service.set(feature, model)).rejects.toThrow();
  expect(config.set).not.toHaveBeenCalled();
});

it('tests unsaved Jev settings with synthetic input and does not persist them', async () => {
  const { service, values, providers, factory, config } = setup();
  values.AI_FEATURE_MODELS = { jev_matching: 'eval/jev' };
  providers.getResolvedProviders.mockReturnValue({
    eval: { npm: '@ai-sdk/gateway', apiKey: 'original' },
  });
  jest
    .mocked(evaluate)
    .mockResolvedValue({
      answers: { match: { type: 'score', score: 4 } },
    } as never);
  const result = await service.testJev({
    baseUrl: 'https://example.test',
    apiKey: 'private-key',
  });
  expect(result.success).toBe(true);
  expect(factory.createTransientProvider).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: 'private-key',
      baseUrl: 'https://example.test',
    }),
  );
  expect(config.set).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('private-key');
});
it('does not expose sensitive upstream Jev errors', async () => {
  const { service, values, providers } = setup();
  values.AI_FEATURE_MODELS = { jev_matching: 'eval/jev' };
  providers.getResolvedProviders.mockReturnValue({
    eval: { npm: '@ai-sdk/gateway' },
  });
  jest.mocked(evaluate).mockRejectedValue(new Error('private-key'));
  await expect(service.testJev({ baseUrl: '' })).rejects.toThrow(
    'Jev 测试失败',
  );
});
