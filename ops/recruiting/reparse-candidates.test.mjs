/** Checks recovery and bounded dispatch without model or network calls. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reparseCandidates } from './reparse-candidates.mjs';
const id = '11111111-1111-4111-8111-111111111111';
test('dry run makes no API calls', async () => {
  await reparseCandidates({ client: {}, ids: [id], batchKey: 'test', checkpoint: '/unused', log: () => {} });
});
test('deduplicates the plan and resumes without resubmitting completed work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reparse-test-'));
  let submissions = 0;
  const client = { post: async () => { submissions++; return { intakeId: 'task' }; }, request: async () => ({ state: 'COMPLETED', stage: 'STORED' }) };
  const input = { client, ids: [id, id], batchKey: 'test', checkpoint: join(dir, 'checkpoint.json'), apply: true, log: () => {} };
  try {
    await reparseCandidates(input);
    await reparseCandidates(input);
    assert.equal(submissions, 1);
    assert.equal(JSON.parse(await readFile(input.checkpoint, 'utf8')).records[id].state, 'COMPLETED');
    await assert.rejects(reparseCandidates({ ...input, batchKey: 'other' }), /another batch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('rejects invalid concurrency before making requests', async () => {
  await assert.rejects(reparseCandidates({ client: {}, ids: [id], concurrency: 9 }), /Concurrency/);
});
test('a slow receipt leaves a checkpoint while other candidates are still dispatched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reparse-pending-'));
  const otherId = '22222222-2222-4222-8222-222222222222';
  const calls = [];
  const client = { post: async (path) => { calls.push(path); return { intakeId: path }; }, request: async () => ({ state: 'PROCESSING' }) };
  try {
    await reparseCandidates({ client, ids: [id, otherId], batchKey: 'slow', checkpoint: join(dir, 'state'), apply: true, concurrency: 1, timeoutMs: 0, log: () => {} });
    assert.equal(calls.length, 2);
    const state = JSON.parse(await readFile(join(dir, 'state'), 'utf8'));
    assert.equal(Object.keys(state.records).length, 2);
    assert.equal(state.records[id].state, 'QUEUED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
