#!/usr/bin/env node
/** Matches refreshed candidates as they finish parsing, retaining one whole-pool result per candidate. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createRecruitingClient } from './cli.mjs';
const { values } = parseArgs({ options: {
  input: { type: 'string' }, jobs: { type: 'string' }, output: { type: 'string' },
  'batch-key': { type: 'string' }, total: { type: 'string' }, concurrency: { type: 'string', default: '4' }, extra: { type: 'string' },
} });
const concurrency = Number(values.concurrency), total = Number(values.total);
if (!values.input || !values.jobs || !values.output || !values['batch-key'] || !Number.isSafeInteger(total) || total < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Provide input, jobs, output, batch-key, total and concurrency 1..8');
const client = createRecruitingClient({ baseUrl: process.env.FANHAN_BASE_URL, token: process.env.FANHAN_API_KEY });
const jobIds = JSON.parse(await readFile(values.jobs, 'utf8'));
if (!Array.isArray(jobIds) || jobIds.length > 2000 || jobIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid explicit job plan');
const extra = values.extra ? JSON.parse(await readFile(values.extra, 'utf8')) : [];
let state = { batchKey: values['batch-key'], records: {} };
try { state = JSON.parse(await readFile(values.output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (state.batchKey !== values['batch-key']) throw new Error('Checkpoint belongs to another batch');
let stopped = false;
process.once('SIGINT', () => { stopped = true; });
process.once('SIGTERM', () => { stopped = true; });
const save = async () => { await writeFile(`${values.output}.tmp`, JSON.stringify(state), { mode: 0o600 }); await rename(`${values.output}.tmp`, values.output); };
const terminal = new Set(['COMPLETED', 'PARTIAL', 'NO_RESULTS', 'FAILED', 'SUPERSEDED']);
while (!stopped) {
  const parsed = JSON.parse(await readFile(values.input, 'utf8'));
  const ready = [...new Set([...Object.entries(parsed.records).filter(([, row]) => row.state === 'COMPLETED').map(([id]) => id), ...extra])];
  for (const record of Object.values(state.records).filter((row) => !terminal.has(row.status))) {
    const result = await client.request(`/recruiting/match-runs/${record.runId}`);
    record.status = result.status;
    record.counts = result.counts;
    if (terminal.has(record.status)) console.log(JSON.stringify({ event: 'matched', ...record }));
  }
  await save();
  let active = Object.values(state.records).filter((row) => !terminal.has(row.status)).length;
  for (const id of ready) {
    if (stopped || active >= concurrency) break;
    if (state.records[id]) continue;
    const result = await client.post('match-runs', { direction: 'CANDIDATE_TO_JOBS', subjectId: id, targetIds: jobIds, idempotencyKey: `refresh-pool:${values['batch-key']}:${id}` });
    state.records[id] = { candidateId: id, runId: result.runId, status: result.status };
    await save(); active++;
    console.log(JSON.stringify({ event: 'submitted', candidateId: id, runId: result.runId, jobs: jobIds.length }));
  }
  const parsedDone = Object.values(parsed.records).filter((row) => ['COMPLETED', 'FAILED', 'NEEDS_REVIEW'].includes(row.state)).length >= total;
  if (parsedDone && ready.every((id) => state.records[id] && terminal.has(state.records[id].status))) break;
  await new Promise((done) => setTimeout(done, 5000));
}
console.log(JSON.stringify({ event: 'summary', stopped, states: Object.values(state.records).reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }), {}) }));
