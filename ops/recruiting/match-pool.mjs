#!/usr/bin/env node
/** Builds whole-subject result views for an explicit pool, reusing the server's versioned pair cache. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createRecruitingClient } from './cli.mjs';
import { withRecruitingRetry } from './retry-client.mjs';

/** Keeps stable receipts so a restart cannot duplicate a paid matching submission. */
export async function matchPool({ client, subjects, targets, direction, checkpoint, batchKey, concurrency = 4, pollMs = 5000, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log }) {
  if (!['CANDIDATE_TO_JOBS', 'JOB_TO_CANDIDATES'].includes(direction)) throw new Error('Invalid matching direction');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !targets.length || targets.length > 2000) throw new Error('Invalid pool size or concurrency');
  if ([...subjects, ...targets].some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid pool identity');
  let state = { batchKey, direction, records: {} };
  try { state = JSON.parse(await readFile(checkpoint, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state.batchKey !== batchKey || state.direction !== direction) throw new Error('Checkpoint does not match this pool');
  let writes = Promise.resolve();
  const save = () => { const data = JSON.stringify(state); writes = writes.then(async () => { await writeFile(`${checkpoint}.tmp`, data, { mode: 0o600 }); await rename(`${checkpoint}.tmp`, checkpoint); }); return writes; };
  let index = 0, stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const ids = [...new Set(subjects)];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (!stopped && index < ids.length) {
        const id = ids[index++];
        if (['COMPLETED', 'NO_RESULTS'].includes(state.records[id]?.status)) continue;
        let row = state.records[id];
        if (!row?.runId) {
          const result = await client.post('match-runs', { direction, subjectId: id, targetIds: [...new Set(targets)], idempotencyKey: `pool:${batchKey}:${direction}:${id}` });
          row = state.records[id] = { runId: result.runId, status: result.status };
          await save();
        }
        const deadline = Date.now() + 1800000;
        while (Date.now() < deadline) {
          const result = await client.request(`/recruiting/match-runs/${row.runId}/summary`);
          row.status = result.status; row.counts = result.counts;
          await save();
          if (!['QUEUED', 'PROCESSING'].includes(row.status)) break;
          await pause(pollMs);
        }
        if (['QUEUED', 'PROCESSING'].includes(row.status)) throw new Error('Pool run still pending; resume checkpoint');
        log(JSON.stringify({ event: 'subject', subjectId: id, ...row }));
      }
    }));
    await writes;
    return state;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { subjects: { type: 'string' }, targets: { type: 'string' }, direction: { type: 'string' }, checkpoint: { type: 'string' }, 'batch-key': { type: 'string' }, concurrency: { type: 'string', default: '4' } } });
  const result = await matchPool({ client: withRecruitingRetry(createRecruitingClient({ baseUrl: process.env.FANHAN_BASE_URL, token: process.env.FANHAN_API_KEY })), subjects: JSON.parse(await readFile(values.subjects, 'utf8')), targets: JSON.parse(await readFile(values.targets, 'utf8')), direction: values.direction, checkpoint: values.checkpoint, batchKey: values['batch-key'], concurrency: Number(values.concurrency) });
  console.log(JSON.stringify({ event: 'summary', count: Object.keys(result.records).length }));
}
