/** Prepares a separate PG16 restore stream while preserving the unmodified production dump. */
import { createReadStream, createWriteStream } from 'node:fs';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';

const source = resolve(
  process.argv[2] ??
    '.local/recruiting/backups/original-production/original.sql.gz',
);
const target = resolve(
  process.argv[3] ??
    '.local/recruiting/backups/original-production/restore-pg16.sql.gz',
);
if (source === target)
  throw new Error('Restore preparation must not overwrite the source dump');
const lines = createInterface({
  input: createReadStream(source).pipe(createGunzip()),
  crlfDelay: Infinity,
});
const omitted = { transactionTimeout: 0, providerMonitoring: 0 };
/** These provider monitoring extensions carry no recruiting business data. */
async function* compatibleLines() {
  let copying = false;
  for await (const line of lines) {
    if (line.startsWith('COPY ')) copying = true;
    if (line === '\\.') copying = false;
    if (!copying && line === 'SET transaction_timeout = 0;') {
      omitted.transactionTimeout++;
      continue;
    }
    if (
      !copying &&
      /^(CREATE EXTENSION IF NOT EXISTS|COMMENT ON EXTENSION) (pg_stat_monitor|pgaudit)( |;)/.test(
        line,
      )
    ) {
      omitted.providerMonitoring++;
      continue;
    }
    yield line + '\n';
  }
}
await pipeline(
  Readable.from(compatibleLines()),
  createGzip(),
  createWriteStream(target, { flags: 'wx', mode: 0o600 }),
);
console.log(JSON.stringify({ prepared: true, omitted }));
