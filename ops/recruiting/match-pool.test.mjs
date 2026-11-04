/** Tests durable whole-pool dispatch without network calls or model work. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchPool } from './match-pool.mjs';
test('submits one job-to-people run and recovers it without a second submission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-pool-'));
  const id = '11111111-1111-4111-8111-111111111111'; let posts = 0;
  const client = { post: async (_path, body) => { posts++; assert.equal(body.direction, 'JOB_TO_CANDIDATES'); assert.deepEqual(body.targetIds, [id]); return { runId: 'run', status: 'QUEUED' }; }, request: async (path) => { assert.equal(path, '/recruiting/match-runs/run/summary'); return ({ status: 'COMPLETED', counts: { cached: 1 } }); } };
  const input = { client, subjects: [id, id], targets: [id], direction: 'JOB_TO_CANDIDATES', checkpoint: join(dir, 'state'), batchKey: 'test', log: () => {} };
  try { await matchPool(input); await matchPool(input); assert.equal(posts, 1); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
