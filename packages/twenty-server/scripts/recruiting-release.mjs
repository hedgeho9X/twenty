/** Backs up the target database before running schema upgrades; failures stop release. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';

/** Runs a child without exposing the database password in process arguments. */
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`Release command failed: ${command} (${result.status})`);
  }
};

const database = new URL(process.env.PG_DATABASE_URL);
const backupDirectory = '/data/backups';
mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
const backup = `${backupDirectory}/${Date.now()}-${process.env.APP_VERSION ?? 'release'}.dump`;
const output = openSync(backup, 'wx', 0o600);
try {
  run('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
    stdio: ['ignore', output, 'inherit'],
    env: {
      ...process.env,
      PGHOST: database.hostname,
      PGPORT: database.port || '5432',
      PGUSER: decodeURIComponent(database.username),
      PGPASSWORD: decodeURIComponent(database.password),
      PGDATABASE: database.pathname.slice(1),
    },
  });
} finally {
  closeSync(output);
}
run('node', ['dist/command/command', 'upgrade']);
