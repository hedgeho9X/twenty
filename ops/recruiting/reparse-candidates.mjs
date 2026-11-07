#!/usr/bin/env node
/** Re-extracts an explicit candidate plan with bounded concurrency and durable local receipts. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createRecruitingClient } from './cli.mjs';
import { withRecruitingRetry } from './retry-client.mjs';

/** Completed candidates are never resubmitted; uncertain requests reuse server-side idempotency. */
export async function reparseCandidates({ client, ids, batchKey, checkpoint, concurrency = 2, pollMs = 5000, timeoutMs = 1800000, apply = false, pause = (ms) => new Promise((done) => setTimeout(done, ms)), log = console.log }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Concurrency must be 1..8');
  if (!batchKey || !checkpoint) throw new Error('Batch key and checkpoint are required');
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid candidate ID');
  const unique = [...new Set(ids)];
  log(JSON.stringify({ event: 'plan', total: unique.length, apply, concurrency }));
  if (!apply) return;
  let state = { batchKey, records: {} };
  try { state = JSON.parse(await readFile(checkpoint, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state.batchKey !== batchKey) throw new Error('Checkpoint belongs to another batch');
  let writes = Promise.resolve();
  const save = () => { const snapshot = JSON.stringify(state); writes = writes.then(async () => { await writeFile(`${checkpoint}.tmp`, snapshot, { mode: 0o600 }); await rename(`${checkpoint}.tmp`, checkpoint); }); return writes; };
  let index = 0;
  let stopped = false;
  let fatal;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (!stopped && index < unique.length) {
        const id = unique[index++];
        if (['COMPLETED', 'NEEDS_REVIEW', 'FAILED'].includes(state.records[id]?.state)) continue;
        try {
          let record = state.records[id];
          if (!record?.intakeId) {
            const receipt = await client.post(`candidates/${id}/reparse`, { batchKey });
            record = state.records[id] = { intakeId: receipt.intakeId, state: 'QUEUED' };
            await save();
          }
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const task = await client.request(`/recruiting/resume-intakes/${record.intakeId}`);
            record.state = task.state;
            record.stage = task.stage;
            await save();
            if (['COMPLETED', 'NEEDS_REVIEW', 'FAILED'].includes(task.state)) break;
            await pause(pollMs);
          }
          if (!['COMPLETED', 'NEEDS_REVIEW', 'FAILED'].includes(record.state)) {
            // A slow receipt stays resumable without blocking dispatch of the rest of the pool.
            log(JSON.stringify({ event: 'pending', candidateId: id, ...record }));
            continue;
          }
          log(JSON.stringify({ event: 'candidate', candidateId: id, ...record }));
        } catch (error) {
          stopped = true;
          fatal = error;
          log(JSON.stringify({ event: 'stopped', candidateId: id, status: error.status, message: error.message }));
        }
      }
    }));
    await writes;
    log(JSON.stringify({ event: 'summary', states: Object.values(state.records).reduce((counts, row) => ({ ...counts, [row.state]: (counts[row.state] ?? 0) + 1 }), {}), stopped }));
    if (fatal) throw fatal;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, checkpoint: { type: 'string' }, 'batch-key': { type: 'string' }, concurrency: { type: 'string', default: '2' }, apply: { type: 'boolean' } } });
  const plan = JSON.parse(await readFile(values.plan, 'utf8'));
  await reparseCandidates({ client: withRecruitingRetry(createRecruitingClient({ baseUrl: process.env.FANHAN_BASE_URL, token: process.env.FANHAN_API_KEY })), ids: plan, batchKey: values['batch-key'], checkpoint: values.checkpoint, concurrency: Number(values.concurrency), apply: Boolean(values.apply) });
}
