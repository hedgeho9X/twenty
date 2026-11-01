import pg from 'pg';
import mime from 'mime-types';
/** Copies immutable native storage keys into local MinIO, verifies bytes, then optionally switches the driver. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { ensureMinioConfig } from './config.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = join(root, '.local/recruiting');
const config = await ensureMinioConfig(directory);
const environmentPath = join(directory, 'environment.json');
const environment = JSON.parse(await readFile(environmentPath, 'utf8'));
if (
  config.endpoint !== 'http://127.0.0.1:23004' ||
  config.bucket !== 'twenty-local'
)
  throw Error('Only the isolated local bucket may be migrated');
const s3 = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
});
const docker = spawnSync(
  'docker',
  [
    'compose',
    '-f',
    'ops/recruiting/compose.yaml',
    '--profile',
    'minio',
    'up',
    '-d',
    '--no-deps',
    'minio',
  ],
  { cwd: root, encoding: 'utf8' },
);
if (docker.status) throw Error('Unable to start local MinIO: ' + docker.stderr);
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    if ((await fetch(config.endpoint + '/minio/health/live')).ok) break;
  } catch {}
  if (attempt === 29) throw Error('MinIO not ready');
  await new Promise((r) => setTimeout(r, 1000));
}
try {
  await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
} catch (error) {
  if (![404, 400].includes(error.$metadata?.httpStatusCode)) throw error;
  await s3.send(new CreateBucketCommand({ Bucket: config.bucket }));
}
const activate = process.argv.includes('--activate');
if (activate) {
  const open = await new Promise((resolveOpen) => {
    const socket = createConnection({ host: '127.0.0.1', port: 23001 });
    socket.on('connect', () => {
      socket.destroy();
      resolveOpen(true);
    });
    socket.on('error', () => resolveOpen(false));
  });
  if (open) throw Error('Stop local API and worker before activation');
}
const storage = resolve(environment.STORAGE_LOCAL_PATH);
if (storage !== join(directory, 'storage'))
  throw Error('Unexpected local storage root');
const database = new URL(environment.PG_DATABASE_URL);
if (
  database.hostname !== '127.0.0.1' ||
  database.port !== '25432' ||
  database.pathname !== '/recruiting'
)
  throw Error('Unexpected file metadata database');
const client = new pg.Client({ connectionString: environment.PG_DATABASE_URL });
await client.connect();
const metadata = await client.query(
  'select f."workspaceId", a."universalIdentifier" as "applicationId", f.path, f."mimeType" from core.file f join core.application a on a.id=f."applicationId"',
);
await client.end();
const contentTypes = new Map(
  metadata.rows.map((row) => [
    `${row.workspaceId}/${row.applicationId}/${row.path}`,
    row.mimeType,
  ]),
);
const files = [];
/** Keeps temporary parser inputs and regression artifacts on disk, outside native S3 keys. */
const walk = async (path) => {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    const key = relative(storage, full).split('\\').join('/');
    if (key.split('/')[0].startsWith('_')) continue;
    if (entry.isSymbolicLink())
      throw Error('Storage symlinks cannot be migrated');
    if (entry.isDirectory()) await walk(full);
    else files.push({ full, key });
  }
};
await walk(storage);
const hashes = [];
let index = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (index < files.length) {
      const file = files[index++];
      const bytes = await readFile(file.full);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const contentType =
        contentTypes.get(file.key) ||
        mime.lookup(file.key) ||
        'application/octet-stream';
      let exists = false;
      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: file.key }),
        );
        exists =
          head.Metadata?.sha256 === hash &&
          head.ContentLength === bytes.length &&
          head.ContentType === contentType;
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) throw error;
      }
      if (!exists)
        await s3.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: file.key,
            Body: bytes,
            ContentType: contentType,
            Metadata: { sha256: hash },
          }),
        );
      const saved = await s3.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: file.key }),
      );
      const restored = await saved.Body.transformToByteArray();
      if (createHash('sha256').update(restored).digest('hex') !== hash)
        throw Error('Object verification failed');
      hashes.push({ key: file.key, bytes: bytes.length, sha256: hash });
    }
  }),
);
const report = {
  at: new Date().toISOString(),
  objects: hashes.length,
  bytes: hashes.reduce((total, item) => total + item.bytes, 0),
  verified: true,
  activated: environment.STORAGE_TYPE === 's3',
  bucket: config.bucket,
};
if (activate) {
  const backup = join(directory, 'backups', 'before-minio-' + Date.now());
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await writeFile(
    join(backup, 'environment.json'),
    JSON.stringify(environment, null, 2),
    { mode: 0o600 },
  );
  await writeFile(join(backup, 'objects.json'), JSON.stringify(hashes), {
    mode: 0o600,
  });
  const next = {
    ...environment,
    STORAGE_TYPE: 's3',
    STORAGE_S3_REGION: config.region,
    STORAGE_S3_NAME: config.bucket,
    STORAGE_S3_ENDPOINT: config.endpoint,
    STORAGE_S3_ACCESS_KEY_ID: config.accessKeyId,
    STORAGE_S3_SECRET_ACCESS_KEY: config.secretAccessKey,
    STORAGE_S3_PRESIGNED_URL_ENABLED: 'false',
  };
  await writeFile(environmentPath, JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
  report.activated = true;
  report.backup = backup;
}
await writeFile(
  join(directory, 'minio-migration.json'),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(report);
s3.destroy();
