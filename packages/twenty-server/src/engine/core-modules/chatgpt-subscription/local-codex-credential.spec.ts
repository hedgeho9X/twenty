/** Verifies private account loading with synthetic files only; no real login is inspected. */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLocalCodexCredential } from './local-codex-credential';

describe('local subscription credential', () => {
  let directory: string;
  let previous: string | undefined;
  const value = {
    auth_mode: 'chatgpt',
    tokens: {
      access_token: 'synthetic-token-'.repeat(4),
      account_id: 'synthetic-account',
    },
  };

  beforeEach(async () => {
    previous = process.env.RECRUITING_CODEX_AUTH_FILE;
    directory = await mkdtemp(join(tmpdir(), 'recruiting-subscription-'));
    process.env.RECRUITING_CODEX_AUTH_FILE = join(directory, 'auth.json');
    await writeFile(join(directory, 'auth.json'), JSON.stringify(value), {
      mode: 0o600,
    });
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.RECRUITING_CODEX_AUTH_FILE;
    else process.env.RECRUITING_CODEX_AUTH_FILE = previous;
    await rm(directory, { recursive: true });
  });

  it('loads the selected account without modifying its login file', async () => {
    const before = await readFile(join(directory, 'auth.json'), 'utf8');
    const credential = await loadLocalCodexCredential('synthetic-account');
    expect(credential.protocol).toBe('codex');
    expect(credential.accountId).toBe('synthetic-account');
    expect(await readFile(join(directory, 'auth.json'), 'utf8')).toBe(before);
  });

  it('uses the installed desktop catalog version without changing credentials', async () => {
    await writeFile(
      join(directory, 'models_cache.json'),
      JSON.stringify({ client_version: '0.166.0' }),
    );
    expect((await loadLocalCodexCredential()).clientVersion).toBe('0.166.0');
  });
  it('falls back safely when catalog version metadata is malformed', async () => {
    await writeFile(
      join(directory, 'models_cache.json'),
      JSON.stringify({ client_version: 'invalid/header' }),
    );
    expect((await loadLocalCodexCredential()).clientVersion).toBe('0.144.1');
  });

  it('rejects a login file readable by other users', async () => {
    await chmod(join(directory, 'auth.json'), 0o644);
    await expect(loadLocalCodexCredential()).rejects.toThrow('reconnect');
  });

  it('does not silently switch subscriptions after the desktop account changes', async () => {
    await expect(loadLocalCodexCredential('different-account')).rejects.toThrow(
      'reconnect',
    );
  });

  it('does not reinterpret an API key as subscription authorization', async () => {
    await writeFile(
      join(directory, 'auth.json'),
      JSON.stringify({
        auth_mode: 'apikey',
        OPENAI_API_KEY: 'synthetic-api-key',
      }),
    );
    await expect(loadLocalCodexCredential()).rejects.toThrow('reconnect');
  });
});
