/** Exercises real loopback callbacks with synthetic OAuth exchange results; never launches a browser or authorizes an account. */
import { SiwcLoginService } from './siwc-login.service';
import { type SiwcStoreService } from './siwc-store.service';
import { type Repository } from 'typeorm';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';

const services: SiwcLoginService[] = [];
beforeEach(() => jest.useRealTimers());
afterEach(() => {
  services.splice(0).forEach((service) => service.onModuleDestroy());
  jest.useFakeTimers();
});
/** Leaves cryptographic validation to the protocol tests and focuses on transaction ownership and one-time consumption. */
const setup = () => {
  const users = {
    findOne: jest.fn(async () => ({
      id: 'owner',
      disabled: false,
      deletedAt: null,
      canAccessFullAdminPanel: true,
    })),
  };
  const exchange = jest.fn(async () => ({
    clientId: 'oaiapp_syntheticClient',
    identity: {
      subject: 'synthetic-subject',
      issuer: 'https://auth.openai.com',
    },
    tokens: {
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
      id_token: 'synthetic-id',
      token_type: 'Bearer',
      scope: 'chatgpt.tokens.use.direct',
      expires_in: 3600,
    },
  }));
  const store = {
    hostId: jest.fn(async () => 'urn:uuid:synthetic-host'),
    protocol: { exchange, revoke: jest.fn(async () => true) },
    save: jest.fn(async () => ({ id: 'connection', status: 'READY' })),
  };
  const service = new SiwcLoginService(
    store as unknown as SiwcStoreService,
    users as unknown as Repository<UserEntity>,
  );
  services.push(service);
  return { service, users, store };
};
/** Uses only the returned loopback URI and synthetic code; requests never leave this machine. */
const callback = (authorizeUrl: string, state?: string) => {
  const url = new URL(authorizeUrl);
  const target = new URL(url.searchParams.get('redirect_uri')!);
  target.searchParams.set('state', state ?? url.searchParams.get('state')!);
  target.searchParams.set('code', 'synthetic-code');
  target.searchParams.set('client_id', 'oaiapp_syntheticClient');
  return target;
};
it('rejects another owner and malformed Unicode state without consuming a valid pending attempt', async () => {
  const { service, store } = setup();
  const attempt = await service.start('owner');
  expect(service.active('owner')?.attemptId).toBe(attempt.attemptId);
  expect(service.active('other')).toBeUndefined();
  expect(() => service.status('other', attempt.attemptId)).toThrow('不存在');
  const bad = await fetch(callback(attempt.authorizeUrl, 'é'.repeat(43)));
  expect(bad.status).toBe(400);
  expect(store.protocol.exchange).not.toHaveBeenCalled();
  expect(service.status('owner', attempt.attemptId).status).toBe('PENDING');
  service.cancel('owner', attempt.attemptId);
  expect(service.status('owner', attempt.attemptId).status).toBe('CANCELLED');
});
it('consumes a valid callback once and never returns tokens to the browser or polling UI', async () => {
  const { service, store } = setup();
  const attempt = await service.start('owner');
  store.protocol.exchange.mockImplementation(async () => {
    await new Promise((done) => setTimeout(done, 30));
    return {
      clientId: 'oaiapp_syntheticClient',
      identity: {
        subject: 'synthetic-subject',
        issuer: 'https://auth.openai.com',
      },
      tokens: {
        access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh',
        id_token: 'synthetic-id',
        token_type: 'Bearer',
        scope: 'chatgpt.tokens.use.direct',
        expires_in: 3600,
      },
    };
  });
  const responses = await Promise.all([
    fetch(callback(attempt.authorizeUrl)),
    fetch(callback(attempt.authorizeUrl)),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 400,
  ]);
  expect(store.protocol.exchange).toHaveBeenCalledTimes(1);
  expect(store.save).toHaveBeenCalledTimes(1);
  const status = service.status('owner', attempt.attemptId);
  expect(status).toMatchObject({
    status: 'COMPLETED',
    connectionId: 'connection',
  });
  expect(JSON.stringify(status)).not.toContain('synthetic-access');
});
it('does not exchange a denied authorization and leaves existing connections untouched', async () => {
  const { service, store } = setup();
  const attempt = await service.start('owner');
  const url = callback(attempt.authorizeUrl);
  url.searchParams.set('error', 'access_denied');
  expect((await fetch(url)).status).toBe(400);
  expect(store.protocol.exchange).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
  expect(service.status('owner', attempt.attemptId).status).toBe('FAILED');
});
it('rechecks the administrator before storing and revokes a newly issued session if ownership is lost', async () => {
  const { service, store, users } = setup();
  const attempt = await service.start('owner');
  users.findOne.mockResolvedValueOnce({
    id: 'owner',
    disabled: true,
    deletedAt: null,
    canAccessFullAdminPanel: true,
  });
  expect((await fetch(callback(attempt.authorizeUrl))).status).toBe(400);
  expect(store.save).not.toHaveBeenCalled();
  expect(store.protocol.revoke).toHaveBeenCalledWith(
    'oaiapp_syntheticClient',
    'synthetic-refresh',
  );
});
