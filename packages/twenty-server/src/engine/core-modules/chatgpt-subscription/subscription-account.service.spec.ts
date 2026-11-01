/** Verifies quota accuracy and prevents credential disclosure in management results. */
import { SubscriptionAccountService } from './subscription-account.service';
import { loadLocalCodexCredential } from './local-codex-credential';
jest.mock('./local-codex-credential', () => ({
  loadLocalCodexCredential: jest.fn(),
}));
const setup = (body: unknown, status = 200) => {
  jest.mocked(loadLocalCodexCredential).mockResolvedValue({
    accessToken: 'private-token',
    accountId: 'bound-account',
    protocol: 'codex',
  });
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(Response.json(body, { status }));
  const configured = {
    source: {
      npm: '@ai-sdk/openai',
      authType: 'chatgpt',
      subscriptionAccountId: 'bound-account',
      models: [],
    },
    unrelated: { npm: '@ai-sdk/anthropic' },
  };
  const config = {
    get: jest.fn(() => configured),
    set: jest.fn(async () => undefined),
  };
  return { service: new SubscriptionAccountService(config as never), config };
};
afterEach(() => jest.restoreAllMocks());
it('reports real quota windows without exposing upstream account data', async () => {
  const { service } = setup({
    email: 'private@example.test',
    plan_type: 'pro',
    rate_limit: {
      primary_window: {
        used_percent: 23.5,
        limit_window_seconds: 18000,
        reset_at: 1800000000,
      },
      secondary_window: null,
    },
  });
  const result = await service.usage();
  expect(result.windows).toEqual([
    {
      remainingPercent: 76.5,
      windowSeconds: 18000,
      resetsAt: new Date(1800000000000).toISOString(),
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('private');
  expect(loadLocalCodexCredential).toHaveBeenCalledWith('bound-account');
});
it('does not invent quota when a window is absent', async () => {
  const { service } = setup({ rate_limit: null });
  expect((await service.usage()).windows).toEqual([]);
});
it('rejects invalid upstream percentages', async () => {
  const { service } = setup({
    rate_limit: {
      primary_window: { used_percent: 120, limit_window_seconds: 18000 },
    },
  });
  await expect(service.usage()).rejects.toThrow('格式');
});
it('keeps upstream errors private', async () => {
  const { service } = setup({ message: 'private-token' }, 401);
  await expect(service.usage()).rejects.toThrow('订阅信息暂不可用');
});
it('registers discovered models and preserves other providers', async () => {
  const { service, config } = setup({
    models: [
      {
        slug: 'available-model',
        display_name: 'Available',
        input_modalities: ['text', 'image'],
      },
    ],
  });
  await expect(service.syncModels()).resolves.toEqual({ count: 1 });
  expect(config.set).toHaveBeenCalledWith(
    'AI_PROVIDERS',
    expect.objectContaining({
      unrelated: { npm: '@ai-sdk/anthropic' },
      source: expect.objectContaining({
        models: [
          expect.objectContaining({
            name: 'available-model',
            modalities: ['text', 'image'],
          }),
        ],
      }),
    }),
  );
});
