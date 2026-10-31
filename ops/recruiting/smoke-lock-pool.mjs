/** Verifies local-B lock concurrency while keeping only two ordinary query connections; no business data is written. */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';

const require = createRequire(import.meta.url);
const {
  PostgresAdvisoryLockService,
} = require('../../packages/twenty-server/dist/database/typeorm/postgres-advisory-lock.service.js');
const {
  recruitingLockPoolOptions,
} = require('../../packages/twenty-server/dist/modules/recruiting/recruiting-lock-pool.options.js');
const environment = JSON.parse(
  await readFile('.local/recruiting/environment.json', 'utf8'),
);
const url = new URL(environment.PG_DATABASE_URL);
if (
  url.hostname !== '127.0.0.1' ||
  url.port !== '25432' ||
  url.pathname !== '/recruiting'
)
  throw new Error('Refusing a database outside local B');
const core = new DataSource({
  type: 'postgres',
  url: url.toString(),
  entities: [],
  synchronize: false,
  migrationsRun: false,
  installExtensions: false,
  poolSize: 2,
  logging: false,
});
const lockSource = new DataSource(recruitingLockPoolOptions(core));
const started = performance.now();
try {
  await core.initialize();
  await lockSource.initialize();
  const locks = new PostgresAdvisoryLockService(lockSource);
  let entered = 0;
  let active = 0;
  let maximum = 0;
  let release;
  const barrier = new Promise((done) => {
    release = done;
  });
  const timeout = setTimeout(() => release(), 5000);
  const prefix = `local-recruiting-lock-smoke-${randomUUID()}`;
  const results = await Promise.all(
    Array.from({ length: 18 }, (_, index) =>
      locks.tryWithLock(`${prefix}-${index}`, async () => {
        entered++;
        active++;
        maximum = Math.max(maximum, active);
        if (entered === 18) release();
        await barrier;
        try {
          const [value] = await core.query('SELECT 1 AS ok');
          return value.ok === 1;
        } finally {
          active--;
        }
      }),
    ),
  );
  clearTimeout(timeout);
  if (
    maximum !== 18 ||
    results.some((result) => !result.acquired || result.value !== true)
  )
    throw new Error('Lock isolation or core query progress failed');
  const report = {
    corePoolSize: 2,
    lockPoolSize: 18,
    simultaneousLocks: maximum,
    completedCoreQueries: results.length,
    durationMs: Math.round(performance.now() - started),
  };
  await writeFile(
    '.local/recruiting/lock-pool-smoke.json',
    JSON.stringify(report),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} finally {
  if (lockSource.isInitialized) await lockSource.destroy();
  if (core.isInitialized) await core.destroy();
}
