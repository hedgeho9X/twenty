/** Tests actual native authenticated encryption and refresh coordination with synthetic, non-network credentials. */
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SiwcStoreService } from './siwc-store.service';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type EnvironmentConfigDriver } from 'src/engine/core-modules/twenty-config/drivers/environment-config.driver';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';

const tokens = {
  access_token: 'synthetic-access-token-never-a-real-credential',
  refresh_token: 'synthetic-refresh-token',
  id_token: 'synthetic-id-token',
  token_type: 'Bearer',
  scope: 'openid chatgpt.tokens.use.direct',
  expires_in: 3600,
};
const account = {
  subject: 'synthetic-subject',
  issuer: 'https://auth.openai.com',
  email: 'synthetic@example.test',
};
let path: string;
let previousPath: string | undefined;
beforeEach(async () => {
  jest.useRealTimers();
  path = await mkdtemp(join(tmpdir(), 'twenty-siwc-test-'));
  previousPath = process.env.RECRUITING_CHATGPT_CONNECTIONS_PATH;
  process.env.RECRUITING_CHATGPT_CONNECTIONS_PATH = path;
});
afterEach(async () => {
  if (previousPath === undefined)
    delete process.env.RECRUITING_CHATGPT_CONNECTIONS_PATH;
  else process.env.RECRUITING_CHATGPT_CONNECTIONS_PATH = previousPath;
  await rm(path, { recursive: true, force: true });
  jest.useFakeTimers();
});
/** Shares one admission primitive across two service instances, as native PostgreSQL does across API/worker processes. */
const setup = () => {
  const busy = new Set<string>();
  const locks = {
    tryWithLock: async <T>(key: string, callback: () => Promise<T>) => {
      if (busy.has(key)) return { acquired: false };
      busy.add(key);
      try {
        return { acquired: true, value: await callback() };
      } finally {
        busy.delete(key);
      }
    },
  };
  const encryption = new SecretEncryptionService({
    get: (name: string) =>
      name === 'APP_SECRET'
        ? 'synthetic-encryption-key-not-for-production'
        : undefined,
  } as unknown as EnvironmentConfigDriver);
  const build = () =>
    new SiwcStoreService(
      encryption,
      { get: () => join(path, 'storage') } as unknown as TwentyConfigService,
      locks as unknown as PostgresAdvisoryLockService,
    );
  return { first: build(), second: build() };
};
it('persists actual AES-GCM envelopes and returns no token in account-list projections', async () => {
  const { first, second } = setup();
  const value = await first.save(
    'host',
    'oaiapp_syntheticClient',
    account,
    tokens,
  );
  const disk = await readFile(join(path, `${value.id}.enc`), 'utf8');
  expect(disk).toMatch(/^enc:v2:/);
  expect(disk).not.toContain(tokens.access_token);
  expect(JSON.stringify(await second.list())).not.toContain('token');
  expect((await second.credential(value.id)).accessToken).toBe(
    tokens.access_token,
  );
  await chmod(join(path, `${value.id}.enc`), 0o644);
  await expect(second.read(value.id)).rejects.toThrow('permissions');
});
it('rechecks encrypted state after lock admission so simultaneous services rotate once', async () => {
  const { first, second } = setup();
  const value = await first.save('host', 'oaiapp_syntheticClient', account, {
    ...tokens,
    expires_in: 0.001,
  });
  const replacement = {
    ...tokens,
    access_token: 'replacement-access-token',
    refresh_token: 'replacement-refresh-token',
    id_token: undefined,
  };
  const a = jest
    .spyOn(first.protocol, 'refresh')
    .mockResolvedValue(replacement);
  const b = jest
    .spyOn(second.protocol, 'refresh')
    .mockResolvedValue(replacement);
  const results = await Promise.all([
    first.credential(value.id),
    second.credential(value.id),
  ]);
  expect(a.mock.calls.length + b.mock.calls.length).toBe(1);
  expect(
    results.every((result) => result.accessToken === replacement.access_token),
  ).toBe(true);
  expect((await first.read(value.id)).tokens?.refresh_token).toBe(
    replacement.refresh_token,
  );
});
it('clears invalid rotating credentials and preserves the registered identity for reauthorization', async () => {
  const { first } = setup();
  const value = await first.save('host', 'oaiapp_syntheticClient', account, {
    ...tokens,
    expires_in: 0.001,
  });
  jest
    .spyOn(first.protocol, 'refresh')
    .mockRejectedValue(new Error('SIWC_REAUTH_REQUIRED'));
  await expect(first.credential(value.id)).rejects.toThrow('renewal failed');
  const stored = await first.read(value.id);
  expect(stored).toMatchObject({
    status: 'NEEDS_AUTH',
    clientId: 'oaiapp_syntheticClient',
    subject: account.subject,
  });
  expect(stored.tokens).toBeUndefined();
});
it('does not expose an identity-only grant as an inference credential', async () => {
  const { first } = setup();
  const value = await first.save('host', 'oaiapp_syntheticClient', account, {
    ...tokens,
    scope: 'openid email',
  });
  expect(value.status).toBe('MISSING_PLAN_PERMISSION');
  await expect(first.credential(value.id)).rejects.toThrow('authorization');
});
it('reports remote revocation failure while completing local sign-out', async () => {
  const { first } = setup();
  const value = await first.save(
    'host',
    'oaiapp_syntheticClient',
    account,
    tokens,
  );
  jest.spyOn(first.protocol, 'revoke').mockRejectedValue(new Error('offline'));
  const result = await first.disconnect(value.id);
  expect(result).toMatchObject({
    status: 'SIGNED_OUT',
    remoteRevocationConfirmed: false,
    canRefresh: false,
  });
  expect((await first.read(value.id)).tokens).toBeUndefined();
});

it('keeps an independent Codex registration encrypted and refreshes it without local login files', async () => {
  const { first } = setup();
  const connection = await first.save(
    'host',
    'codex-client',
    account,
    { ...tokens, expires_in: 1 },
    undefined,
    'codex',
    'account-id',
  );
  const refresh = jest.spyOn(first.codexProtocol, 'refresh').mockResolvedValue({
    ...tokens,
    id_token: undefined,
    scope: 'openid',
    expires_in: 3600,
  });
  const credential = await first.credential(connection.id);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(credential).toMatchObject({
    protocol: 'codex',
    accountId: 'account-id',
    clientVersion: '0.166.0',
  });
  expect(JSON.stringify(await first.list())).not.toContain(tokens.access_token);
});
