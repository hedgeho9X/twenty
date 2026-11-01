import { generateText } from 'ai';
jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { object: jest.fn() },
}));
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
    .mockImplementation(async () => Response.json(body, { status }));
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
  const store = {
    credential: jest.fn(async () => ({
      accessToken: 'independent-token',
      protocol: 'codex',
      accountId: 'managed-account',
      clientVersion: '0.166.0',
    })),
  };
  return {
    service: new SubscriptionAccountService(config as never, store as never),
    config,
    store,
  };
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

it('uses the current client version and excludes hidden or unavailable catalog entries', async () => {
  const { service, config } = setup({
    models: [
      { slug: 'gpt-6-astra', visibility: 'list', supported_in_api: true },
      { slug: 'internal-model', visibility: 'hide' },
      { slug: 'unsupported-model', supported_in_api: false },
    ],
  });
  jest.mocked(loadLocalCodexCredential).mockResolvedValue({
    accessToken: 'private-token',
    accountId: 'bound-account',
    protocol: 'codex',
    clientVersion: '0.166.0',
  });
  expect(await service.syncModels()).toEqual({ count: 1 });
  expect(jest.mocked(global.fetch).mock.calls[0][0]).toBe(
    'https://chatgpt.com/backend-api/codex/models?client_version=0.166.0',
  );
  expect(config.set).toHaveBeenCalledWith(
    'AI_PROVIDERS',
    expect.objectContaining({
      source: expect.objectContaining({
        models: [expect.objectContaining({ name: 'gpt-6-astra' })],
      }),
    }),
  );
});

it('uses the managed registration without reading local Codex credentials', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(Response.json({ rate_limit: null }));
  jest.mocked(loadLocalCodexCredential).mockClear();
  const config = {
    get: () => ({
      source: { authType: 'chatgpt', subscriptionConnectionId: 'managed' },
    }),
  };
  const store = {
    credential: jest.fn(async () => ({
      accessToken: 'managed-token',
      accountId: 'managed-account',
      protocol: 'codex',
      clientVersion: '0.166.0',
    })),
  };
  const service = new SubscriptionAccountService(
    config as never,
    store as never,
  );
  await service.usage();
  expect(store.credential).toHaveBeenCalledWith('managed');
  expect(loadLocalCodexCredential).not.toHaveBeenCalled();
});

it('activates only after refreshing and validating the independent credential', async () => {
  const { service, config, store } = setup({
    models: [{ slug: 'gpt-6.1-sol' }],
  });
  jest
    .mocked(generateText)
    .mockResolvedValue({ output: { ok: true } } as never);
  jest.mocked(loadLocalCodexCredential).mockClear();
  const result = await service.activate('managed-id');
  expect(result.refreshVerified).toBe(true);
  expect(store.credential).toHaveBeenCalledWith('managed-id', true);
  expect(loadLocalCodexCredential).not.toHaveBeenCalled();
  expect(config.set).toHaveBeenCalledWith(
    'AI_PROVIDERS',
    expect.objectContaining({
      source: expect.objectContaining({
        subscriptionConnectionId: 'managed-id',
        subscriptionAccountId: undefined,
      }),
    }),
  );
});
it('retains the active provider when an independent connection fails inference', async () => {
  const { service, config } = setup({ models: [{ slug: 'gpt-6.1-sol' }] });
  jest.mocked(generateText).mockRejectedValue(new Error('private-failure'));
  await expect(service.activate('managed-id')).rejects.toThrow('原连接保留');
  expect(config.set).not.toHaveBeenCalled();
});
