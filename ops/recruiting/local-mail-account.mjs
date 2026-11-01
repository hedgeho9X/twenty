/** Registers the dedicated loopback test mailbox through native account APIs and disables native history synchronization. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localGraphql, localRequest } from './local-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const accountPath = join(root, '.local/recruiting/mail-test/account.json');

/** Reuses only the named synthetic connection; native encryption and owner checks stay authoritative. */
export const ensureLocalMailAccount = async () => {
  const account = JSON.parse(await readFile(accountPath, 'utf8'));
  assert.equal(account.host, '127.0.0.1');
  assert.equal(account.imapPort, 23143);
  assert.equal(account.smtpPort, 23025);
  assert.equal(account.handle, 'recruiting-harness@recruiting.local.invalid');
  const response = await localRequest('/recruiting/mailboxes');
  assert.equal(response.status, 200);
  const settings = await response.json();
  const existing = settings.connections.find(
    (row) => row.handle === account.handle,
  );
  if (existing) account.connectedAccountId = existing.connectedAccountId;
  else {
    const created = await localGraphql(
      'mutation LocalMailAccount($handle:String!,$connectionParameters:EmailAccountConnectionParameters!){saveImapSmtpCaldavAccount(handle:$handle,connectionParameters:$connectionParameters){success connectedAccountId}}',
      {
        handle: account.handle,
        connectionParameters: {
          name: 'Local recruiting mail harness',
          IMAP: {
            host: account.host,
            port: account.imapPort,
            username: account.username,
            password: account.password,
            connectionSecurity: 'NONE',
          },
        },
      },
    );
    assert.equal(created.saveImapSmtpCaldavAccount.success, true);
    account.connectedAccountId =
      created.saveImapSmtpCaldavAccount.connectedAccountId;
    await writeFile(accountPath, JSON.stringify(account, null, 2), {
      mode: 0o600,
    });
  }
  const current = await localGraphql(
    'query LocalMailConnection($id:UUID!){getConnectedImapSmtpCaldavAccount(id:$id){id handle connectionParameters{IMAP{host port username connectionSecurity}}}}',
    { id: account.connectedAccountId },
  );
  assert.equal(
    current.getConnectedImapSmtpCaldavAccount.handle,
    account.handle,
  );
  assert.equal(
    current.getConnectedImapSmtpCaldavAccount.connectionParameters.IMAP.host,
    account.host,
  );
  assert.equal(
    current.getConnectedImapSmtpCaldavAccount.connectionParameters.IMAP.port,
    account.imapPort,
  );
  const channels = await localGraphql(
    'query LocalMailChannels($connectedAccountId:UUID!){myMessageChannels(connectedAccountId:$connectedAccountId){id connectedAccountId isSyncEnabled isContactAutoCreationEnabled}}',
    { connectedAccountId: account.connectedAccountId },
  );
  assert.equal(channels.myMessageChannels.length, 1);
  const channel = channels.myMessageChannels[0];
  assert.equal(channel.connectedAccountId, account.connectedAccountId);
  if (channel.isSyncEnabled || channel.isContactAutoCreationEnabled)
    await localGraphql(
      'mutation LocalMailNoHistory($input:UpdateMessageChannelInput!){updateMessageChannel(input:$input){id isSyncEnabled isContactAutoCreationEnabled}}',
      {
        input: {
          id: channel.id,
          update: { isSyncEnabled: false, isContactAutoCreationEnabled: false },
        },
      },
    );
  const check = await localGraphql(
    'query LocalMailDisabled($connectedAccountId:UUID!){myMessageChannels(connectedAccountId:$connectedAccountId){id isSyncEnabled isContactAutoCreationEnabled}}',
    { connectedAccountId: account.connectedAccountId },
  );
  assert.ok(
    check.myMessageChannels.every(
      (row) => !row.isSyncEnabled && !row.isContactAutoCreationEnabled,
    ),
  );
  return account;
};
