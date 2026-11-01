/** Creates private synthetic mailbox credentials shared by local setup and the optional SMTP/IMAP harness. */
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Retains credentials across runs and never places them in source files or command arguments. */
export const ensureLocalMailConfig = async (privateDirectory) => {
  const directory = join(privateDirectory, 'mail-test');
  const path = join(directory, 'account.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let account;
  try {
    account = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    account = {
      handle: 'recruiting-harness@recruiting.local.invalid',
      username: 'recruiting-harness',
      password: randomBytes(24).toString('hex'),
      host: '127.0.0.1',
      smtpPort: 23025,
      imapPort: 23143,
      apiPort: 23080,
    };
    await writeFile(path, JSON.stringify(account, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
  }
  assert.equal(account.host, '127.0.0.1');
  assert.equal(account.handle, 'recruiting-harness@recruiting.local.invalid');
  assert.equal(account.username, 'recruiting-harness');
  assert.match(account.password, /^[a-f0-9]{48}$/);
  const options = [
    '-Dgreenmail.setup.test.smtp',
    '-Dgreenmail.setup.test.imap',
    '-Dgreenmail.hostname=0.0.0.0',
    '-Dgreenmail.api.hostname=0.0.0.0',
    '-Dgreenmail.api.port=8080',
    `-Dgreenmail.users=${account.username}:${account.password}@recruiting.local.invalid`,
  ];
  await writeFile(
    join(directory, 'server.env'),
    `GREENMAIL_OPTS=${options.join(' ')}\n`,
    {
      mode: 0o600,
    },
  );
  return account;
};
