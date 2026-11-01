/** Restricts business resets to the dedicated local Twenty database, cache and storage directory. */
import { resolve } from 'node:path';

/** Rejects any environment that could target a remote service, the old local copy or unrelated storage. */
export const assertLocalResetTarget = (environment, repository) => {
  if (environment.STORAGE_TYPE && environment.STORAGE_TYPE !== 'local')
    throw new Error(
      'S3 storage requires a bucket snapshot before business reset',
    );
  const database = new URL(environment.PG_DATABASE_URL);
  const cache = new URL(environment.REDIS_URL);
  if (
    ['host', 'hostaddr', 'port', 'dbname', 'database', 'service'].some((key) =>
      database.searchParams.has(key),
    ) ||
    cache.search
  )
    throw new Error('Connection parameters cannot override the reset target');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !['localhost', '127.0.0.1'].includes(database.hostname) ||
    database.port !== '25432' ||
    database.pathname !== '/recruiting'
  )
    throw new Error(
      'Reset requires the isolated localhost:25432/recruiting database',
    );
  if (
    cache.protocol !== 'redis:' ||
    !['localhost', '127.0.0.1'].includes(cache.hostname) ||
    cache.port !== '26379' ||
    !['', '/', '/0'].includes(cache.pathname)
  )
    throw new Error(
      'Reset requires the isolated localhost:26379 cache database 0',
    );
  const storage = resolve(repository, '.local/recruiting/storage');
  if (resolve(environment.STORAGE_LOCAL_PATH) !== storage)
    throw new Error('Reset storage must be the isolated recruiting directory');
  return {
    storage,
    schema: 'workspace_4jgxpoe06z2lp3cp2mjiatyec',
    workspaceId: '4cb349cd-5765-4826-a2cb-73e5c5c2d564',
  };
};
