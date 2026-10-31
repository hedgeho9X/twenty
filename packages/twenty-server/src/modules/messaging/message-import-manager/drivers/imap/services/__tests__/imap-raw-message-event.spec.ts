/** Verifies the native source boundary before any recruiting consumer or external mailbox participates. */
import { EventEmitter2 } from '@nestjs/event-emitter';
import PostalMime from 'postal-mime';
import { type ImapClientProvider } from 'src/modules/messaging/message-import-manager/drivers/imap/providers/imap-client.provider';
import { type ImapMessageParserService } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-message-parser.service';
import { type ImapMessagesImportErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-messages-import-error-handler.service';
import { ImapGetMessagesService } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-get-messages.service';
import { IMAP_RAW_MESSAGE_RECEIVED_EVENT } from 'src/modules/messaging/message-import-manager/drivers/imap/constants/imap-raw-message-received-event.constant';
import { type ImapRawMessageEvent } from 'src/modules/messaging/message-import-manager/drivers/imap/types/imap-raw-message-event.type';

const account = {
  id: 'account',
  workspaceId: 'workspace',
  userWorkspaceId: 'owner',
  handle: 'recruiting@example.test',
  handleAliases: [],
};

/** Uses actual MIME parsing but a synthetic native connection and UID source. */
const setup = async (
  from = 'candidate@example.test',
  flags = new Set<string>(),
) => {
  const raw = Buffer.from(
    `From: ${from}\r\nTo: recruiting@example.test\r\nSubject: synthetic\r\nMessage-ID: <native-boundary@example.test>\r\n\r\nFull original body.\r\n> Original quoted text.\r\n`,
  );
  const parsed = await PostalMime.parse(raw);
  const client = {};
  const provider = {
    getClient: jest.fn(async () => client),
    closeClient: jest.fn(),
  };
  const parser = {
    parseMessagesFromFolder: jest.fn(async () => ({
      uidValidity: BigInt(99),
      messages: [{ uid: 123, parsed, rawSource: raw, flags }],
    })),
  };
  const events = new EventEmitter2();
  const service = new ImapGetMessagesService(
    provider as unknown as ImapClientProvider,
    parser as unknown as ImapMessageParserService,
    { handleError: jest.fn() } as unknown as ImapMessagesImportErrorHandler,
    events,
  );
  return { service, events, provider, raw };
};

it('awaits durable source acceptance and includes complete bytes and stable owner/UID references', async () => {
  const { service, events, raw } = await setup();
  let received: ImapRawMessageEvent | undefined;
  events.on(
    IMAP_RAW_MESSAGE_RECEIVED_EVENT,
      // oxlint-disable-next-line typescript/no-misused-promises -- EventEmitter2.emitAsync consumes and awaits this returned promise.
    async (event: ImapRawMessageEvent) => {
      await Promise.resolve();
      received = event;
    },
  );
  const projected = await service.getMessages(['INBOX:123'], account);
  expect(received).toMatchObject({
    workspaceId: 'workspace',
    userWorkspaceId: 'owner',
    connectedAccountId: 'account',
    folder: 'INBOX',
    uidValidity: '99',
    uid: 123,
  });
  expect(received!.source.equals(raw)).toBe(true);
  expect(projected).toHaveLength(1);
  expect('accessToken' in received!).toBe(false);
});

it.each([
  { from: 'recruiting@example.test', flags: new Set<string>() },
  { from: 'candidate@example.test', flags: new Set(['\\Draft']) },
])('does not capture outgoing or draft mail', async ({ from, flags }) => {
  const { service, events } = await setup(from, flags);
  const listener = jest.fn();
  events.on(IMAP_RAW_MESSAGE_RECEIVED_EVENT, listener);
  await service.getMessages(['INBOX:123'], account);
  expect(listener).not.toHaveBeenCalled();
});

it('propagates a configured source-consumer failure while always closing the native connection', async () => {
  const { service, events, provider } = await setup();
  // oxlint-disable-next-line typescript/no-misused-promises -- The rejection must reach the awaited emitAsync caller.
  events.on(IMAP_RAW_MESSAGE_RECEIVED_EVENT, async () => {
    throw new Error('archive unavailable');
  });
  await expect(service.getMessages(['INBOX:123'], account)).rejects.toThrow(
    'archive unavailable',
  );
  expect(provider.closeClient).toHaveBeenCalledTimes(1);
});
