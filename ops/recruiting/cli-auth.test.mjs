/** Verifies credential precedence and server isolation without touching real Keychain items. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiOrigin, resolveAuth } from './cli-auth.mjs';
test('environment key bypasses saved credentials', async () => {
  const value = await resolveAuth(
    undefined,
    { FANHAN_API_KEY: 'override', FANHAN_BASE_URL: 'https://example.test' },
    {
      get: () => {
        throw Error('must not read');
      },
    },
    { baseUrl: 'https://saved.test' },
  );
  assert.equal(value.token, 'override');
  assert.equal(value.source, 'environment');
});
test('saved credentials are looked up by the selected origin', async () => {
  let lookup;
  await resolveAuth(
    'https://different.test',
    {},
    {
      get: async (origin) => {
        lookup = origin;
      },
    },
    { baseUrl: 'https://saved.test' },
  );
  if (process.platform === 'darwin')
    assert.equal(lookup, 'https://different.test');
});
test('rejects credentials embedded in URLs and remote plaintext', () => {
  assert.throws(() => apiOrigin('http://example.test'));
  assert.throws(() => apiOrigin('https://user:secret@example.test'));
});
