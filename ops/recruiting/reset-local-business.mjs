/** Backs up and resets only the isolated local workspace business records, retaining login and model/mail configuration. */
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  rename,
  cp,
  realpath,
  stat,
} from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { assertLocalResetTarget } from './local-reset-guard.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDirectory = join(repository, '.local/recruiting');
const environment = JSON.parse(
  await readFile(join(privateDirectory, 'environment.json'), 'utf8'),
);
const target = assertLocalResetTarget(environment, repository);
if ((await realpath(target.storage)) !== target.storage)
  throw new Error('Storage symlinks cannot be reset');
const client = new pg.Client({ connectionString: environment.PG_DATABASE_URL });
const cache = new IORedis(environment.REDIS_URL, {
  maxRetriesPerRequest: null,
});
const preserved = new Set([
  'workspaceMember',
  '_recruitingMailbox',
  'accessGroup',
]);
const businessFolders = new Set(['files-field', 'agent-chat', 'workflow']);
let backupDirectory;
let storageArchived = false;
let parserArchived = false;
let committed = false;
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const qualified = (table) => `${quote(target.schema)}.${quote(table)}`;

/** Invokes only the fixed local containers, keeping dump bytes and credentials out of stdout. */
const docker = (args, options = {}) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (result.status !== 0)
    throw new Error(
      'Local Docker operation failed: ' +
        (result.stderr || result.error?.code || result.status),
    );
  return result.stdout?.trim();
};
/** Records hashes for authentication/configuration without serializing their contents into the report. */
const protectedState = async () => {
  const hashes = {};
  for (const table of [
    'user',
    'userWorkspace',
    'workspace',
    'connectedAccount',
    'keyValuePair',
  ]) {
    hashes[table] = (
      await client.query(
        `select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text) hash from core.${quote(table)} t`,
      )
    ).rows[0].hash;
  }
  for (const table of preserved)
    hashes[table] = (
      await client.query(
        `select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text) hash from ${qualified(table)} t`,
      )
    ).rows[0].hash;
  return hashes;
};

try {
  await client.connect();
  const tables = (
    await client.query(
      'select tablename from pg_tables where schemaname=$1 order by tablename',
      [target.schema],
    )
  ).rows.map((row) => row.tablename);
  if (!tables.includes('company') || !tables.includes('_recruitingIntake'))
    throw new Error('Unexpected local workspace schema');
  const clearedTables = tables.filter((table) => !preserved.has(table));
  const before = {};
  for (const table of tables)
    before[table] = (
      await client.query(`select count(*)::int n from ${qualified(table)}`)
    ).rows[0].n;
  if (!process.argv.includes('--apply')) {
    console.log(
      JSON.stringify(
        {
          mode: 'plan',
          target: 'localhost:25432/recruiting',
          tables: clearedTables.length,
          preserved: [...preserved],
          before,
        },
        null,
        2,
      ),
    );
  } else {
    if (docker(['context', 'show']) !== 'orbstack')
      throw new Error('OrbStack is required');
    for (const container of [
      'twenty-recruiting-db-1',
      'twenty-recruiting-cache-1',
    ])
      if (
        docker([
          'inspect',
          container,
          '--format',
          '{{index .Config.Labels "com.docker.compose.project"}}',
        ]) !== 'twenty-recruiting'
      )
        throw new Error('Container project mismatch');
    for (const name of [
      'recruiting-queue',
      'recruiting-match-queue',
      'ai-queue',
    ]) {
      const queue = new Queue(name, {
        connection: cache,
        prefix: environment.REDIS_QUEUE_PREFIX ?? 'bull',
      });
      const active = await queue.getActiveCount();
      await queue.close();
      if (active) throw new Error('Stop and drain workers before resetting');
    }
    const directory = join(
      privateDirectory,
      'backups',
      'business-reset-' +
        new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'),
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    backupDirectory = directory;
    const savedConfiguration = await protectedState();
    const dumpPath = join(directory, 'database.dump');
    const descriptor = openSync(dumpPath, 'wx', 0o600);
    try {
      docker(
        [
          'exec',
          'twenty-recruiting-db-1',
          'pg_dump',
          '-U',
          'twenty',
          '-d',
          'recruiting',
          '-Fc',
          '--no-owner',
          '--no-acl',
        ],
        { stdio: ['ignore', descriptor, 'pipe'] },
      );
    } finally {
      closeSync(descriptor);
    }
    if ((await stat(dumpPath)).size < 1000)
      throw new Error('Backup is unexpectedly empty');
    const validationPath = '/tmp/twenty-business-reset-validation.dump';
    docker(['cp', dumpPath, 'twenty-recruiting-db-1:' + validationPath]);
    try {
      docker([
        'exec',
        'twenty-recruiting-db-1',
        'pg_restore',
        '--list',
        validationPath,
      ]);
    } finally {
      docker(['exec', 'twenty-recruiting-db-1', 'rm', validationPath]);
    }
    await cache.save();
    docker([
      'cp',
      'twenty-recruiting-cache-1:/data/dump.rdb',
      join(directory, 'cache.rdb'),
    ]);
    await writeFile(
      join(directory, 'before.json'),
      JSON.stringify({ before, savedConfiguration }, null, 2),
      { mode: 0o600 },
    );
    await rename(target.storage, join(directory, 'storage'));
    storageArchived = true;
    await mkdir(target.storage, { mode: 0o700 });
    // Restore only application code and profile pictures into the active file tree.
    const savedStorage = join(directory, 'storage');
    for (const workspace of await readdir(savedStorage, {
      withFileTypes: true,
    })) {
      if (!workspace.isDirectory() || workspace.name.startsWith('_')) continue;
      for (const application of await readdir(
        join(savedStorage, workspace.name),
        { withFileTypes: true },
      )) {
        if (!application.isDirectory()) continue;
        for (const folder of await readdir(
          join(savedStorage, workspace.name, application.name),
          { withFileTypes: true },
        )) {
          if (businessFolders.has(folder.name)) continue;
          const suffix = join(workspace.name, application.name, folder.name);
          await cp(join(savedStorage, suffix), join(target.storage, suffix), {
            recursive: true,
            preserveTimestamps: true,
          });
        }
      }
    }
    const parserOutput = join(privateDirectory, 'parser-output');
    await rename(parserOutput, join(directory, 'parser-output'));
    parserArchived = true;
    await mkdir(parserOutput, { mode: 0o700 });
    await client.query('begin');
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query(
        'truncate table ' + clearedTables.map(qualified).join(', '),
      );
      const deletedFiles = await client.query(
        `delete from core.file where "workspaceId"=$1 and (path like 'files-field/%' or path like 'agent-chat/%' or path like 'workflow/%')`,
        [target.workspaceId],
      );
      if (
        JSON.stringify(savedConfiguration) !==
        JSON.stringify(await protectedState())
      )
        throw new Error('Protected configuration changed');
      await client.query('commit');
      committed = true;
      await cache.flushdb();
      const after = {};
      for (const table of clearedTables)
        after[table] = (
          await client.query(`select count(*)::int n from ${qualified(table)}`)
        ).rows[0].n;
      if (Object.values(after).some(Boolean))
        throw new Error('Business data remains after reset');
      const report = {
        completedAt: new Date().toISOString(),
        directory,
        target: 'localhost:25432/recruiting',
        before,
        after,
        protectedConfigurationUnchanged: true,
        deletedFileRecords: deletedFiles.rowCount,
      };
      await writeFile(
        join(directory, 'report.json'),
        JSON.stringify(report, null, 2),
        { mode: 0o600 },
      );
      await writeFile(
        join(privateDirectory, 'business-reset-latest.json'),
        JSON.stringify(report, null, 2),
        { mode: 0o600 },
      );
      console.log(
        JSON.stringify(
          {
            directory,
            clearedTables: clearedTables.length,
            deletedFileRecords: deletedFiles.rowCount,
            businessRowsRemaining: 0,
            protectedConfigurationUnchanged: true,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
} catch (error) {
  // Restore file trees if database work rolled back; keep the dump for diagnosis and manual recovery.
  if (backupDirectory && !committed) {
    if (storageArchived) {
      await rename(
        target.storage,
        join(backupDirectory, 'aborted-active-storage'),
      );
      await rename(join(backupDirectory, 'storage'), target.storage);
    }
    if (parserArchived) {
      await rename(
        join(privateDirectory, 'parser-output'),
        join(backupDirectory, 'aborted-parser-output'),
      );
      await rename(
        join(backupDirectory, 'parser-output'),
        join(privateDirectory, 'parser-output'),
      );
    }
  }
  throw error;
} finally {
  await client.end();
  await cache.quit();
}
