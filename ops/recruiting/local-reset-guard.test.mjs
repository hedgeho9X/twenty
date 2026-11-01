/** Ensures reset rejects production-like targets, the old environment and unrelated storage before any I/O. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalResetTarget } from './local-reset-guard.mjs';
const repository = '/tmp/twenty';
const environment = {
  PG_DATABASE_URL: 'postgres://twenty:secret@127.0.0.1:25432/recruiting',
  REDIS_URL: 'redis://127.0.0.1:26379',
  STORAGE_LOCAL_PATH: '/tmp/twenty/.local/recruiting/storage',
};
test('accepts only the dedicated local environment', () =>
  assert.equal(
    assertLocalResetTarget(environment, repository).workspaceId,
    '4cb349cd-5765-4826-a2cb-73e5c5c2d564',
  ));
for (const patch of [
  { STORAGE_TYPE: 's3' },
  { PG_DATABASE_URL: 'postgres://remote.example:25432/recruiting' },
  { PG_DATABASE_URL: 'postgres://127.0.0.1:15432/recruiting' },
  { PG_DATABASE_URL: 'postgres://127.0.0.1:25432/production' },
  {
    PG_DATABASE_URL:
      'postgres://127.0.0.1:25432/recruiting?host=remote.example',
  },
  { REDIS_URL: 'redis://127.0.0.1:26379?db=1' },
  { REDIS_URL: 'redis://remote.example:26379' },
  { REDIS_URL: 'redis://127.0.0.1:26379/1' },
  { STORAGE_LOCAL_PATH: '/tmp/another-project/storage' },
])
  test(
    'rejects a different reset target: ' +
      Object.keys(patch)[0] +
      Object.values(patch)[0],
    () =>
      assert.throws(() =>
        assertLocalResetTarget({ ...environment, ...patch }, repository),
      ),
  );
