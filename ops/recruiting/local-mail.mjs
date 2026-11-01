/** Operates only the optional local OrbStack GreenMail service and reports readiness without exposing credentials. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureLocalMailConfig } from './local-mail-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = join(root, '.local/recruiting');
const action = process.argv[2] ?? 'status';
assert.ok(['up', 'down', 'status'].includes(action));
assert.equal(
  spawnSync('docker', ['context', 'show'], { encoding: 'utf8' }).stdout.trim(),
  'orbstack',
);
const account = await ensureLocalMailConfig(directory);
let allowlistChanged = false;

/** Checks loopback listeners only; no message is sent by startup or status checks. */
const listening = (port) =>
  new Promise((resolveStatus) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    const done = (ready) => {
      socket.destroy();
      resolveStatus(ready);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });

if (action === 'up' || action === 'down') {
  const args = [
    'compose',
    '-f',
    join(root, 'ops/recruiting/compose.yaml'),
    '--profile',
    'mail-test',
  ];
  const child = spawnSync(
    'docker',
    [
      ...args,
      ...(action === 'up'
        ? ['up', '-d', '--no-deps', 'mail-test']
        : ['stop', 'mail-test']),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  assert.equal(child.status, 0);
}
if (action === 'up') {
  const path = join(directory, 'environment.json');
  const env = JSON.parse(await readFile(path, 'utf8'));
  const database = new URL(env.PG_DATABASE_URL);
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '25432');
  assert.equal(database.pathname, '/recruiting');
  const value = env.OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS;
  const hosts = Array.isArray(value) ? value : value ? JSON.parse(value) : [];
  assert.ok(Array.isArray(hosts));
  if (!hosts.includes('127.0.0.1')) {
    await writeFile(
      join(directory, 'mail-test/allowed-hosts-original.json'),
      JSON.stringify({ hadValue: value !== undefined, value: value ?? null }),
      { mode: 0o600, flag: 'wx' },
    ).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    env.OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS = JSON.stringify([
      ...hosts,
      '127.0.0.1',
    ]);
    allowlistChanged = true;
    await writeFile(path, JSON.stringify(env, null, 2), { mode: 0o600 });
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      (await listening(account.imapPort)) &&
      (await listening(account.smtpPort))
    )
      break;
    if (attempt === 39)
      throw new Error('Local mail service did not become ready');
    await delay(500);
  }
}
const status = {
  service: 'twenty-recruiting-mail-test',
  smtp: await listening(account.smtpPort),
  imap: await listening(account.imapPort),
  api: await listening(account.apiPort),
  allowlistRequiresApiRestart: allowlistChanged,
};
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(
  join(directory, 'mail-test/status.json'),
  JSON.stringify(status),
  { mode: 0o600 },
);
console.log(JSON.stringify(status));
