/** Ensures an empty transport body never surfaces a raw JSON parser error to operators. */
import { recruitingRequest } from './request';
jest.mock('~/config/index', () => ({
  REACT_APP_SERVER_BASE_URL: 'http://localhost:23000',
}));
jest.mock('file-saver', () => ({ saveAs: jest.fn() }));
const previous = global.fetch;
afterEach(() => {
  global.fetch = previous;
});
it('accepts an explicit JSON null when no saved draft exists', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => null,
  })) as never;
  expect(await recruitingRequest('match-runs/id/draft')).toBeNull();
});
it('shows a readable error for an empty successful body', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => {
      throw Error('Unexpected end of JSON input');
    },
  })) as never;
  await expect(recruitingRequest('match-runs/id/draft')).rejects.toThrow(
    '服务器返回的数据不完整',
  );
});
it('shows a readable error when an error response is also empty', async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    json: async () => {
      throw Error('Unexpected end of JSON input');
    },
  })) as never;
  await expect(recruitingRequest('match-runs/id')).rejects.toThrow(
    '请求未完成',
  );
});
