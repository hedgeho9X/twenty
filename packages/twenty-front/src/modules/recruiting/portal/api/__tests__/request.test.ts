/** Verifies capability-only portal transport preserves readable errors when a proxy returns an empty or non-JSON body. */
import { portalRequest } from '@/recruiting/portal/api/request';

jest.mock('~/config/index', () => ({
  REACT_APP_SERVER_BASE_URL: 'http://localhost:23000',
}));
jest.mock('file-saver', () => ({ saveAs: jest.fn() }));

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = jest.fn();
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

it('keeps native credentials omitted and sends the scoped capability only in the request body', async () => {
  const view = { kind: 'CANDIDATE', files: [] };
  jest
    .mocked(fetch)
    .mockResolvedValue({ ok: true, json: async () => view } as Response);

  await expect(
    portalRequest('fixture-capability', { action: 'view' }),
  ).resolves.toEqual(view);
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:23000/recruiting-portal',
    expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify({ token: 'fixture-capability', action: 'view' }),
    }),
  );
});

it('shows a readable unavailable message for an empty proxy error response', async () => {
  jest.mocked(fetch).mockResolvedValue({
    ok: false,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  } as unknown as Response);

  await expect(
    portalRequest('fixture-capability', { action: 'view' }),
  ).rejects.toThrow('入口暂不可用，请联系运营人员');
});

it('preserves the server permission message instead of hiding capability rejection', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue({
      ok: false,
      json: async () => ({ message: '链接已失效或当前无权访问' }),
    } as Response);

  await expect(
    portalRequest('fixture-capability', { action: 'view' }),
  ).rejects.toThrow('链接已失效或当前无权访问');
});

it('rejects an empty successful JSON response with a readable incomplete-content message', async () => {
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  } as unknown as Response);

  await expect(
    portalRequest('fixture-capability', { action: 'view' }),
  ).rejects.toThrow('入口返回内容不完整，请稍后重试或联系运营人员');
});
