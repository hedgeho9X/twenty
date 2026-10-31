/** Tests native-owner isolation and read-only single-message reception without external credentials or network. */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { type ImapClientProvider } from 'src/modules/messaging/message-import-manager/drivers/imap/providers/imap-client.provider';
import { type ImapRawMessageEvent } from 'src/modules/messaging/message-import-manager/drivers/imap/types/imap-raw-message-event.type';
import { type RecruitingRecordsService } from './recruiting-records.service';
import { type RecruitingActorService } from './recruiting-actor.service';
import { type RecruitingUploadService } from './recruiting-upload.service';
import { type RecruitingMailService } from './recruiting-mail.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { RecruitingMailboxService } from './recruiting-mailbox.service';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';

const accountId = '151bf00b-d37f-415f-8612-1696e1ab880e';
const actor = { workspaceId: 'workspace', userWorkspaceId: 'owner' };
const context = {
  type: 'user',
  workspace: { id: 'workspace' },
  userWorkspaceId: 'owner',
} as WorkspaceAuthContext;
const event: ImapRawMessageEvent = {
  ...actor,
  connectedAccountId: accountId,
  folder: 'INBOX',
  uidValidity: '99',
  uid: 123,
  flags: [],
  source: Buffer.from('original EML'),
};

/** Minimal native-like state keeps credentials out of the directory and exposes only readonly client methods. */
const setup = () => {
  const account = {
    id: accountId,
    handle: 'owner@example.test',
    userWorkspaceId: 'owner',
  };
  const accounts = {
    find: jest.fn(async () => [account]),
    findOne: jest.fn(async () => account as typeof account | null),
  };
  let setting: Record<string, unknown> | undefined;
  const records = {
    one: jest.fn(async () => {
      if (!setting) throw new NotFoundException();
      return setting;
    }),
    list: jest.fn(async () => ({ records: [] })),
    create: jest.fn(
      async (_context, _object, value: Record<string, unknown>) => {
        setting = structuredClone(value);
        return setting;
      },
    ),
    update: jest.fn(
      async (_context, _object, _id, value: Record<string, unknown>) => {
        setting = { ...setting, ...structuredClone(value) };
        return setting;
      },
    ),
  };
  const actors = {
    capture: jest.fn(() => actor),
    resolve: jest.fn(async () => context),
  };
  const uploads = { assertUploadPermission: jest.fn(async () => actor) };
  const lock = { release: jest.fn() };
  const client = {
    mailbox: { uidValidity: BigInt(99), uidNext: 124 },
    getMailboxLock: jest.fn(async () => lock),
    search: jest.fn(async () => [] as number[]),
    fetchOne: jest
      .fn()
      .mockResolvedValueOnce({ uid: 123, size: 100 })
      .mockResolvedValueOnce({
        uid: 123,
        source: event.source,
        flags: new Set(),
        internalDate: new Date('2026-11-01T00:00:00Z'),
      }),
  };
  const native = {
    getClient: jest.fn(async () => client),
    closeClient: jest.fn(),
  };
  const mail = {
    receive: jest.fn(async () => ({ archiveId: 'archive', status: 'QUEUED' })),
  };
  const config = { get: jest.fn(() => true) };
  const queue = {
    addCron: jest.fn(async () => undefined),
    removeCron: jest.fn(async () => undefined),
  };
  const locks = {
    tryWithLock: jest.fn(async (_name, callback) => ({
      acquired: true,
      value: await callback(),
    })),
  };
  const service = new RecruitingMailboxService(
    accounts as unknown as WorkspaceScopedRepository<ConnectedAccountEntity>,
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
    uploads as unknown as RecruitingUploadService,
    native as unknown as ImapClientProvider,
    mail as unknown as RecruitingMailService,
    config as unknown as TwentyConfigService,
    queue as unknown as MessageQueueService,
    locks as unknown as PostgresAdvisoryLockService,
  );
  return {
    service,
    accounts,
    records,
    actors,
    native,
    client,
    lock,
    mail,
    config,
    queue,
    locks,
  };
};

it('defaults capture off and never returns tokens or connection parameters', async () => {
  const { service } = setup();
  const result = await service.list(context);
  expect(result.connections).toEqual([
    {
      connectedAccountId: accountId,
      handle: 'owner@example.test',
      enabled: false,
      autoSubmit: true,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('password');
  expect(JSON.stringify(result)).not.toContain('accessToken');
});

it('creates a no-download baseline, schedules one durable timer and removes it on opt-out', async () => {
  const { service, client, queue, records } = setup();
  await service.configure(context, {
    connectedAccountId: accountId,
    enabled: true,
  });
  expect(client.fetchOne).not.toHaveBeenCalled();
  expect(records.create).toHaveBeenCalledWith(
    context,
    'recruitingMailbox',
    expect.objectContaining({
      payload: expect.objectContaining({
        cursor: { uidValidity: '99', lastUid: 123 },
      }),
    }),
  );
  expect(queue.addCron).toHaveBeenCalledWith(
    expect.objectContaining({ options: { repeat: { every: 60_000 } } }),
  );
  await service.configure(context, {
    connectedAccountId: accountId,
    enabled: false,
  });
  expect(queue.removeCron).toHaveBeenCalledTimes(1);
  const opened = client.getMailboxLock.mock.calls.length;
  expect(
    await service.poll({ ...actor, connectedAccountId: accountId, actor }),
  ).toEqual({ received: 0 });
  expect(client.getMailboxLock).toHaveBeenCalledTimes(opened);
});

it('accepts each new UID durably before advancing and filters IMAP reverse-range old UIDs', async () => {
  const { service, client, mail, records } = setup();
  await service.configure(context, {
    connectedAccountId: accountId,
    enabled: true,
  });
  client.search.mockResolvedValue([123, 124]);
  client.fetchOne.mockReset().mockResolvedValue({
    uid: 124,
    size: 100,
    internalDate: new Date(Date.now() + 1000),
    flags: new Set(),
    source: event.source,
  });
  const data = { ...actor, connectedAccountId: accountId, actor };
  expect(await service.poll(data)).toEqual({ received: 1 });
  expect(mail.receive).toHaveBeenCalledTimes(1);
  expect(records.update).toHaveBeenLastCalledWith(
    context,
    'recruitingMailbox',
    expect.any(String),
    expect.objectContaining({
      payload: expect.objectContaining({
        cursor: { uidValidity: '99', lastUid: 124 },
      }),
    }),
  );
  expect(await service.poll(data)).toEqual({ received: 0 });
  expect(mail.receive).toHaveBeenCalledTimes(1);
});

it('preserves the failing UID on archive failure and rejects oversized messages before body download', async () => {
  const { service, client, mail, records } = setup();
  await service.configure(context, {
    connectedAccountId: accountId,
    enabled: true,
  });
  client.search.mockResolvedValue([124]);
  client.fetchOne.mockReset().mockResolvedValue({
    uid: 124,
    size: 100,
    internalDate: new Date(Date.now() + 1000),
    flags: new Set(),
    source: event.source,
  });
  mail.receive.mockRejectedValue(new Error('private upstream failure'));
  const data = { ...actor, connectedAccountId: accountId, actor };
  await expect(service.poll(data)).rejects.toBeInstanceOf(BadRequestException);
  expect(records.update).toHaveBeenLastCalledWith(
    context,
    'recruitingMailbox',
    expect.any(String),
    expect.objectContaining({
      payload: expect.objectContaining({
        cursor: { uidValidity: '99', lastUid: 123 },
        lastPollError: expect.not.stringContaining('private upstream'),
      }),
    }),
  );
  client.fetchOne
    .mockReset()
    .mockResolvedValue({ uid: 124, size: 51 * 1024 * 1024 });
  await expect(service.poll(data)).rejects.toBeInstanceOf(BadRequestException);
  expect(client.fetchOne).toHaveBeenCalledTimes(1);
});

it('stops acquisition after UIDVALIDITY changes rather than silently replaying or skipping a different mailbox', async () => {
  const { service, client, records, queue } = setup();
  await service.configure(context, {
    connectedAccountId: accountId,
    enabled: true,
  });
  client.mailbox.uidValidity = BigInt(100);
  expect(
    await service.poll({ ...actor, connectedAccountId: accountId, actor }),
  ).toEqual({ received: 0, baselineChanged: true });
  expect(client.search).not.toHaveBeenCalled();
  expect(client.fetchOne).not.toHaveBeenCalled();
  expect(records.update).toHaveBeenLastCalledWith(
    context,
    'recruitingMailbox',
    expect.any(String),
    expect.objectContaining({ enabled: false }),
  );
  expect(queue.removeCron).toHaveBeenCalledTimes(1);
});

it('does not report enabled if its durable timer cannot be registered', async () => {
  const { service, queue } = setup();
  queue.addCron.mockRejectedValue(new Error('queue unavailable'));
  await expect(
    service.configure(context, {
      connectedAccountId: accountId,
      enabled: true,
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect((await service.list(context)).connections[0].enabled).toBe(false);
});

it('refuses API-key ownership and foreign connections before opening the native client', async () => {
  const { service, native, accounts } = setup();
  await expect(
    service.receiveLatest({ type: 'apiKey' } as WorkspaceAuthContext, {
      connectedAccountId: accountId,
    }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  accounts.findOne.mockResolvedValue(null);
  await expect(
    service.receiveLatest(context, { connectedAccountId: accountId }),
  ).rejects.toBeInstanceOf(NotFoundException);
  expect(native.getClient).not.toHaveBeenCalled();
});

it('respects the native protocol feature switch before reading or capturing mail', async () => {
  const { service, config, native, mail } = setup();
  config.get.mockReturnValue(false);
  await expect(
    service.receiveLatest(context, { connectedAccountId: accountId }),
  ).rejects.toBeInstanceOf(BadRequestException);
  await service.capture(event);
  expect(native.getClient).not.toHaveBeenCalled();
  expect(mail.receive).not.toHaveBeenCalled();
});

it('fetches the latest UID once in a read-only mailbox and closes it before archive acceptance', async () => {
  const { service, client, lock, native, mail } = setup();
  await service.receiveLatest(context, { connectedAccountId: accountId });
  expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX', {
    readOnly: true,
  });
  expect(client.fetchOne.mock.calls).toEqual([
    ['*', { uid: true, size: true }, { uid: false }],
    [
      '123',
      { uid: true, source: true, flags: true, internalDate: true },
      { uid: true },
    ],
  ]);
  expect(lock.release).toHaveBeenCalledTimes(1);
  expect(native.closeClient).toHaveBeenCalledTimes(1);
  expect(mail.receive).toHaveBeenCalledWith(
    context,
    event.source,
    expect.objectContaining({
      transport: 'IMAP',
      connectedAccountId: accountId,
      uidValidity: '99',
      uid: 123,
    }),
    false,
  );
});

it('rejects oversized originals before fetching their source bytes and still releases the mailbox', async () => {
  const { service, client, lock, native, mail } = setup();
  client.fetchOne
    .mockReset()
    .mockResolvedValue({ uid: 123, size: 51 * 1024 * 1024 });
  await expect(
    service.receiveLatest(context, { connectedAccountId: accountId }),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(client.fetchOne).toHaveBeenCalledTimes(1);
  expect(lock.release).toHaveBeenCalledTimes(1);
  expect(native.closeClient).toHaveBeenCalledTimes(1);
  expect(mail.receive).not.toHaveBeenCalled();
});

it('leaves unconfigured native mail untouched and accepts configured capture under the original owner', async () => {
  const { service, mail, actors } = setup();
  await service.capture(event);
  expect(mail.receive).not.toHaveBeenCalled();
  await service.configure(context, {
    connectedAccountId: accountId,
    enabled: true,
    autoSubmit: true,
  });
  await service.capture({
    ...event,
    internalDate: new Date(Date.now() + 1000),
  });
  expect(actors.resolve).toHaveBeenLastCalledWith(actor);
  expect(mail.receive).toHaveBeenCalledWith(
    context,
    event.source,
    expect.objectContaining({ uid: 123 }),
    true,
  );
});

it('propagates failure after owner opt-in instead of silently advancing the configured native import', async () => {
  const { service, mail } = setup();
  await service.configure(context, {
    connectedAccountId: accountId,
    enabled: true,
  });
  mail.receive.mockRejectedValue(new Error('durable archive unavailable'));
  await expect(
    service.capture({ ...event, internalDate: new Date(Date.now() + 1000) }),
  ).rejects.toThrow('durable archive unavailable');
});

it('does not turn historical native replay into new recruiting applications', async () => {
  const { service, mail } = setup();
  await service.configure(context, {
    connectedAccountId: accountId,
    enabled: true,
  });
  await service.capture({ ...event, internalDate: new Date(0) });
  expect(mail.receive).not.toHaveBeenCalled();
  await expect(service.capture(event)).rejects.toBeInstanceOf(
    BadRequestException,
  );
});
