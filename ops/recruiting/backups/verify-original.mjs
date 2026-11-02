/** Verifies an isolated production backup without connecting to any live service. */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Hashes bytes as a stream so verification does not load a resume corpus into memory. */
const inspect = async (path) => {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
};

const root = resolve(
  process.argv[2] ?? '.local/recruiting/backups/original-production',
);
const manifest = JSON.parse(
  await readFile(resolve(root, 'objects-manifest.json'), 'utf8'),
);
const summary = JSON.parse(
  await readFile(resolve(root, 'backup-summary.json'), 'utf8'),
);
const database = await inspect(resolve(root, 'original.sql.gz'));
if (
  database.bytes !== summary.database.bytes ||
  database.sha256 !== summary.database.sha256
)
  throw new Error('Database archive does not match its captured source hash');
let bytes = 0;
for (const object of manifest.objects) {
  const path = resolve(root, 'files', object.key);
  if (!path.startsWith(resolve(root, 'files') + '/'))
    throw new Error('Invalid object path');
  const result = await inspect(path);
  if (result.bytes !== object.size || result.sha256 !== object.sha256)
    throw new Error('An object does not match the backup manifest');
  bytes += result.bytes;
}
console.log(
  JSON.stringify({
    databaseVerified: true,
    objects: manifest.objects.length,
    objectBytes: bytes,
  }),
);
