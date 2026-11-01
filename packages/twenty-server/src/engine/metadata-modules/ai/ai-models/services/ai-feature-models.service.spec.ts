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
  const providers = { getResolvedProviders: jest.fn(() => ({})) };
  return {
    config,
    service: new AiFeatureModelsService(
      config as never,
      registry as never,
      providers as never,
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
