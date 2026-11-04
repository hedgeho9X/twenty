/** Offline coverage only: all API requests are injected mocks; no environment or database is used. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, pairInput, runMonthlyMatches } from './match-month.mjs';

const workspaceId = '10000000-0000-4000-8000-000000000001';
const candidateA = '20000000-0000-4000-8000-000000000001';
const candidateB = '20000000-0000-4000-8000-000000000002';
const jobA = '30000000-0000-4000-8000-000000000001';
const jobB = '30000000-0000-4000-8000-000000000002';
const runA = '40000000-0000-4000-8000-000000000001';
const runB = '40000000-0000-4000-8000-000000000002';
const options = (extra = []) => parseOptions([
  '--workspace-id', workspaceId, '--from', '2026-11-01', '--to', '2026-12-01', ...extra,
]);
const page = (ids, more = false, cursor = 'next') => ({
  edges: ids.map((id) => ({ node: { id, createdAt: '2026-11-03T00:00:00.000Z' } })),
  pageInfo: { hasNextPage: more, endCursor: more ? cursor : null },
});

const fixture = ({ jobs = [jobA, jobB], candidates = [candidateA, candidateB], history = [], details = {} } = {}) => {
  const requests = [];
  const writes = [];
  const log = [];
  const client = {
    async request(path, init) {
      requests.push({ path, ...init });
      if (path === '/metadata') return { data: { currentWorkspace: { id: workspaceId } } };
      if (path === '/graphql') {
        const { query, variables } = JSON.parse(init.body);
        assert.deepEqual(variables.filter.and.slice(0, 2), [
          { createdAt: { gte: '2026-10-31T16:00:00.000Z' } },
          { createdAt: { lt: '2026-11-30T16:00:00.000Z' } },
        ]);
        if (query.includes('people(')) {
          assert.deepEqual(variables.filter.and[2], { contactRoles: { containsAny: ['CANDIDATE'] } });
          return { data: { people: page(candidates) } };
        }
        return { data: { recruitmentJobs: page(jobs) } };
      }
      if (path.includes('?offset=')) {
        const offset = Number(new URL(path, 'https://example.invalid').searchParams.get('offset'));
        return { records: history.slice(offset, offset + 50), hasNextPage: offset + 50 < history.length };
      }
      if (path.startsWith('/recruiting/match-runs/')) {
        const id = path.split('/').at(-1);
        if (!details[id]) throw new Error('Unexpected detail request');
        return details[id];
      }
      throw new Error('Unexpected request');
    },
    async post(path, input) {
      writes.push({ path, input });
      throw new Error('Unexpected mutation');
    },
  };
  return { client, requests, writes, log, dependencies: { client, log: (row) => log.push(row), pause: async () => {} } };
};

const eitherSideFixture = ({ monthJobs, monthCandidates, history, details } = {}) => {
  const f = fixture({ history, details });
  const original = f.client.request;
  const record = (id, createdAt) => ({ id, createdAt });
  const pools = {
    recruitmentJobs: {
      month: monthJobs ?? [record(jobA, '2026-11-20T00:00:00Z')],
      all: [record(jobA, '2026-11-20T00:00:00Z'), record(jobB, '2026-10-01T00:00:00Z')],
    },
    people: {
      month: monthCandidates ?? [record(candidateA, '2026-11-10T00:00:00Z')],
      all: [record(candidateA, '2026-11-10T00:00:00Z'), record(candidateB, '2026-09-01T00:00:00Z')],
    },
  };
  f.client.request = async (path, init) => {
    if (path !== '/graphql') return original(path, init);
    f.requests.push({ path, ...init });
    const { query, variables } = JSON.parse(init.body);
    assert.match(query, /node \{ id createdAt \}/);
    const plural = query.includes('people(') ? 'people' : 'recruitmentJobs';
    const inWindow = variables.filter.and.some((filter) => filter.createdAt);
    assert.deepEqual(variables.filter.and, [
      ...(inWindow ? [{ createdAt: { gte: '2026-10-31T16:00:00.000Z' } }, { createdAt: { lt: '2026-11-30T16:00:00.000Z' } }] : []),
      ...(plural === 'people' ? [{ contactRoles: { containsAny: ['CANDIDATE'] } }] : []),
    ]);
    const records = pools[plural][inWindow ? 'month' : 'all'];
    const offset = Number(variables.after ?? 0);
    return { data: { [plural]: {
      edges: records.slice(offset, offset + 1).map((node) => ({ node })),
      pageInfo: { hasNextPage: offset + 1 < records.length, endCursor: String(offset + 1) },
    } } };
  };
  return f;
};

test('month defaults use Shanghai at UTC month/year rollover, with exclusive upper bound', () => {
  const result = parseOptions(['--workspace-id', workspaceId], new Date('2026-12-31T16:00:00Z'));
  assert.equal(result.from, '2027-01-01');
  assert.equal(result.to, '2027-02-01');
  assert.equal(result.fromUtc, '2026-12-31T16:00:00.000Z');
  assert.equal(result.toUtc, '2027-01-31T16:00:00.000Z');
  assert.equal(result.apply, false);
  assert.equal(result.concurrency, 2);
  assert.equal(result.limit, Infinity);
  assert.equal(result.scope, 'both-new');
});

test('invalid dates, partial ranges and accidental writes fail before any requests', () => {
  for (const args of [
    ['--from', '2026-02-30', '--to', '2026-03-01'],
    ['--from', '2026-11-01'],
    ['--from', '2026-12-01', '--to', '2026-11-01'],
    ['--apply', '--dry-run'], ['--dry-run=false'], ['--concurrency', '0'],
    ['--limit', '-1'], ['--timeout-ms', 'NaN'], ['--concurrency', '2.5'],
    ['--unknown'], ['--scope', 'everything'],
  ]) assert.throws(() => parseOptions(['--workspace-id', workspaceId, ...args]));
  assert.equal(parseOptions(['--help']).help, true);
});

test('default dry-run reads only, enumerates stable Cartesian pairs and applies limit after dedupe', async () => {
  const f = fixture({
    jobs: [jobB, jobA], candidates: [candidateB, candidateA],
    history: [{ runId: runA, subjectId: jobA, direction: 'JOB_TO_CANDIDATES' }],
    details: { [runA]: { results: [{ candidateId: candidateA, jobId: jobA, status: 'SCORED' }] } },
  });
  const result = await runMonthlyMatches(options(['--limit', '2']), f.dependencies);
  assert.equal(result.planned, 2);
  assert.deepEqual(f.log.filter((row) => row.event === 'planned-pair').map(({ candidateId, jobId }) => [candidateId, jobId]), [
    [candidateA, jobB], [candidateB, jobA],
  ]);
  assert.equal(f.log[0].skippedExisting, 1);
  assert.equal(f.log[0].deferredByLimit, 1);
  assert.equal(f.log[0].scope, 'new-jobs-x-new-candidates');
  assert.equal(f.writes.length, 0);
  for (const request of f.requests) {
    if (request.method === 'POST') assert.match(JSON.parse(request.body).query, /^(query|\{)/);
    else assert.match(request.path, /^\/recruiting\/match-runs/);
  }
});

test('either-side paginates unfiltered pools, dedupes overlap and orders by the earlier creation time', async () => {
  const f = eitherSideFixture();
  const result = await runMonthlyMatches(options(['--scope', 'either-side']), f.dependencies);
  assert.equal(result.planned, 3);
  assert.deepEqual(f.log.filter((row) => row.event === 'planned-pair').map(({ candidateId, jobId }) => [candidateId, jobId]), [
    [candidateB, jobA], [candidateA, jobB], [candidateA, jobA],
  ]);
  assert.equal(f.log[0].scope, 'either-side-created');
  assert.equal(f.log[0].mode, 'dry-run');
  assert.equal(f.log[0].totalPairs, 3);
  assert.equal(f.log[0].jobs, 2);
  assert.equal(f.log[0].candidates, 2);
  assert.equal(f.requests.filter((request) => request.path === '/graphql').length, 6);
  assert.equal(f.writes.length, 0);
});

test('either-side skips existing pairs from old subjects, ignoring old-old results before applying limit', async () => {
  const f = eitherSideFixture({
    history: [
      { runId: runA, subjectId: candidateB, direction: 'PAIR' },
      { runId: runB, subjectId: jobB, direction: 'JOB_TO_CANDIDATES' },
    ],
    details: {
      [runA]: { results: [
        { candidateId: candidateB, jobId: jobA, status: 'SCORED' },
        { candidateId: candidateB, jobId: jobB, status: 'SCORED' },
      ] },
      [runB]: { results: [
        { candidateId: candidateB, jobId: jobA, status: 'SCORED' },
        { candidateId: candidateA, jobId: jobB, status: 'NEEDS_REVIEW' },
      ] },
    },
  });
  const result = await runMonthlyMatches(options(['--scope', 'either-side', '--limit', '1']), f.dependencies);
  assert.equal(result.planned, 1);
  assert.equal(f.log[0].skippedExisting, 2);
  assert.equal(f.log[0].deferredByLimit, 0);
  assert.deepEqual(f.log.filter((row) => row.event === 'planned-pair'), [
    { event: 'planned-pair', candidateId: candidateA, jobId: jobA },
  ]);
  assert.equal(f.writes.length, 0);
});

test('either-side keeps pairs when only one monthly pool is populated', async () => {
  for (const [emptyPool, expected] of [
    ['monthJobs', [[candidateA, jobB], [candidateA, jobA]]],
    ['monthCandidates', [[candidateB, jobA], [candidateA, jobA]]],
  ]) {
    const f = eitherSideFixture({ [emptyPool]: [] });
    await runMonthlyMatches(options(['--scope', 'either-side']), f.dependencies);
    const pairs = f.log.filter((row) => row.event === 'planned-pair').map(({ candidateId, jobId }) => [candidateId, jobId]);
    assert.deepEqual(pairs, expected);
    assert.equal(f.writes.length, 0);
  }
});

test('either-side applies the limit after oldest-first sorting', async () => {
  const f = eitherSideFixture();
  await runMonthlyMatches(options(['--scope', 'either-side', '--limit', '1']), f.dependencies);
  assert.deepEqual(f.log.filter((row) => row.event === 'planned-pair'), [
    { event: 'planned-pair', candidateId: candidateB, jobId: jobA },
  ]);
  assert.equal(f.log[0].deferredByLimit, 2);
  assert.equal(f.writes.length, 0);
});

test('both-new also orders by the earlier creation time before breaking ties by IDs', async () => {
  const f = fixture();
  const original = f.client.request;
  f.client.request = async (path, init) => {
    const result = await original(path, init);
    if (path === '/graphql') {
      const records = result.data.people ?? result.data.recruitmentJobs;
      for (const { node } of records.edges) {
        node.createdAt = node.id === candidateB
          ? '2026-11-01T00:00:00Z'
          : '2026-11-20T00:00:00Z';
      }
    }
    return result;
  };
  await runMonthlyMatches(options(), f.dependencies);
  assert.deepEqual(f.log.filter((row) => row.event === 'planned-pair').map(({ candidateId, jobId }) => [candidateId, jobId]), [
    [candidateB, jobA], [candidateB, jobB], [candidateA, jobA], [candidateA, jobB],
  ]);
});

test('mismatched workspace stops before reading data or submitting matches', async () => {
  const f = fixture();
  await assert.rejects(runMonthlyMatches({ ...options(), workspaceId: jobA }, f.dependencies), /identity mismatch/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.writes.length, 0);
});

test('record cursor pages are exhausted; malformed cursor, GraphQL errors and unreadable dates abort', async () => {
  for (const fault of ['none', 'cursor', 'graphql', 'date']) {
    const f = fixture({ jobs: [], candidates: [] });
    const original = f.client.request;
    let pages = 0;
    f.client.request = async (path, init) => {
      if (path !== '/graphql' || !JSON.parse(init.body).query.includes('recruitmentJobs(')) return original(path, init);
      pages++;
      if (fault === 'graphql') return { data: {}, errors: [{ message: 'private response' }] };
      if (fault === 'date') return { data: { recruitmentJobs: { ...page([jobA]), edges: [{ node: { id: jobA } }] } } };
      if (pages === 1 || fault === 'cursor') return { data: { recruitmentJobs: page([jobA], true) } };
      assert.equal(JSON.parse(init.body).variables.after, 'next');
      return { data: { recruitmentJobs: page([jobB]) } };
    };
    if (fault === 'none') {
      const result = await runMonthlyMatches(options(), f.dependencies);
      assert.equal(pages, 2);
      assert.equal(f.log[0].jobs, 2);
      assert.equal(result.planned, 0);
    } else await assert.rejects(runMonthlyMatches(options(), f.dependencies));
    assert.equal(f.writes.length, 0);
  }
});

test('history paginates and dedupes bidirectional results; failures remain planned, review rows skip', async () => {
  const history = Array.from({ length: 50 }, () => ({ subjectId: jobB, direction: 'JOB_TO_CANDIDATES', runId: runB }));
  history.push({ subjectId: candidateA, direction: 'PAIR', runId: runA });
  const f = fixture({
    history,
    details: {
      [runB]: { results: [{ candidateId: candidateB, jobId: jobB, status: 'NEEDS_REVIEW' }] },
      [runA]: { results: [
        { candidateId: candidateA, jobId: jobA, status: 'EXCLUDED' },
        { candidateId: candidateA, jobId: jobB, status: 'FAILED' },
      ], stale: 1, inaccessible: 2 },
    },
  });
  const result = await runMonthlyMatches(options(), f.dependencies);
  assert.equal(result.planned, 2);
  assert.equal(f.log[0].skippedExisting, 2);
  assert.equal(f.log[0].staleResults, 1);
  assert.equal(f.log[0].inaccessibleResults, 2);
  assert(f.requests.some((row) => row.path.endsWith('?offset=50')));
});

test('zero limit and empty pools never submit', async () => {
  for (const setup of [{}, { candidates: [] }, { jobs: [] }]) {
    const f = fixture(setup);
    const result = await runMonthlyMatches(options(['--apply', '--limit', '0']), f.dependencies);
    assert.equal(result.planned, 0);
    assert.equal(f.writes.length, 0);
  }
});

test('apply waits for durable terminal results, bounds outstanding work and recovers identical submissions', async () => {
  const f = fixture();
  const active = new Set();
  const persisted = new Map();
  const polls = new Map();
  let peak = 0;
  const original = f.client.request;
  f.client.post = async (path, input) => {
    assert.equal(path, 'match-runs');
    assert.equal(input.direction, 'PAIR');
    let stored = persisted.get(input.idempotencyKey);
    if (!stored) {
      const runId = `40000000-0000-4000-8000-${String(persisted.size + 1).padStart(12, '0')}`;
      stored = { runId, input };
      persisted.set(input.idempotencyKey, stored);
    }
    active.add(stored.runId);
    peak = Math.max(peak, active.size);
    return { runId: stored.runId };
  };
  f.client.request = async (path, init) => {
    const stored = [...persisted.values()].find((row) => path.endsWith(`/${row.runId}`));
    if (!stored) return original(path, init);
    const count = (polls.get(stored.runId) ?? 0) + 1;
    polls.set(stored.runId, count);
    if (count === 1) return { status: 'PROCESSING', results: [] };
    active.delete(stored.runId);
    return { status: 'COMPLETED', complete: true, results: [{
      candidateId: stored.input.subjectId, jobId: stored.input.jobId, status: 'SCORED', cached: count > 2,
    }] };
  };
  for (let iteration = 0; iteration < 2; iteration++) {
    const result = await runMonthlyMatches(options(['--apply']), f.dependencies);
    assert.equal(result.completed, 4);
    assert.equal(result.errors, 0);
  }
  assert.equal(peak, 2);
  assert.equal(persisted.size, 4);
  assert.equal(pairInput(workspaceId, candidateA, jobA).idempotencyKey, [...persisted.keys()][0]);
  assert.notEqual(pairInput(jobA, candidateA, jobA).idempotencyKey, [...persisted.keys()][0]);
});

test('partial/stale results, throttling and uncertain submits stop scheduling and never auto-retry paid work', async () => {
  for (const fault of ['partial', 'stale', '429', 'network']) {
    const f = fixture();
    let submissions = 0;
    const original = f.client.request;
    f.client.post = async () => {
      submissions++;
      if (fault === '429' || fault === 'network') {
        const error = new Error('sensitive response must not be logged');
        if (fault === '429') error.status = 429;
        throw error;
      }
      return { runId: runA };
    };
    f.client.request = async (path, init) => path.endsWith(`/${runA}`)
      ? { status: fault === 'partial' ? 'PARTIAL' : 'COMPLETED', complete: false, results: [] }
      : original(path, init);
    const result = await runMonthlyMatches(options(['--apply', '--concurrency', '1']), f.dependencies);
    assert.equal(result.errors, 1);
    assert.equal(result.completed, 0);
    assert.equal(submissions, 1);
    assert(!JSON.stringify(f.log).includes('sensitive response'));
  }
});

test('poll timeout reports the durable run and leaves all remaining pairs unsubmitted', async () => {
  const f = fixture();
  const original = f.client.request;
  let clock = 0;
  f.client.post = async () => ({ runId: runA });
  f.client.request = async (path, init) => path.endsWith(`/${runA}`)
    ? { status: 'QUEUED', results: [] } : original(path, init);
  const result = await runMonthlyMatches(options(['--apply', '--concurrency', '1', '--timeout-ms', '10']), {
    ...f.dependencies, now: () => clock, pause: async (ms) => { clock += ms; },
  });
  assert.equal(result.submitted, 1);
  assert.equal(result.errors, 1);
  assert.equal(f.log.find((row) => row.event === 'pair-error').runId, runA);
});

test('excluded outcomes persist as NO_RESULTS and count as completed without inventing a score', async () => {
  const f = fixture({ jobs: [jobA], candidates: [candidateA] });
  const original = f.client.request;
  f.client.post = async () => ({ runId: runA });
  f.client.request = async (path, init) => path.endsWith(`/${runA}`)
    ? {
      status: 'NO_RESULTS', complete: true,
      results: [{ candidateId: candidateA, jobId: jobA, status: 'EXCLUDED' }],
    }
    : original(path, init);
  const result = await runMonthlyMatches(options(['--apply']), f.dependencies);
  assert.equal(result.completed, 1);
  assert.equal(result.errors, 0);
  assert.equal(f.log.find((row) => row.event === 'completed').status, 'EXCLUDED');
});

test('rate-limit wrapper retries 429 then succeeds, rethrows other errors', async () => {
  const { withRateLimitRetry } = await import('./match-month.mjs');
  let calls = 0;
  const c = withRateLimitRetry({
    async request() { if (++calls < 3) throw Object.assign(new Error('x'), { status: 429 }); return 'ok'; },
    async post() { throw Object.assign(new Error('y'), { status: 500 }); },
  }, { pause: async () => {} });
  assert.equal(await c.request('/a'), 'ok');
  assert.equal(calls, 3);
  await assert.rejects(c.post('a', {}), { status: 500 });
});

test('status filters reach GraphQL as enum filters and invalid values fail before requests', async () => {
  assert.throws(() => options(['--exclude-job-status', 'closed']), /exclude-job-status/);
  assert.throws(() => options(['--candidate-ai-status', 'A,B']), /candidate-ai-status/);
  const seen = {};
  const f = fixture();
  const original = f.client.request;
  f.client.request = async (path, init) => {
    if (path !== '/graphql') return original(path, init);
    const { query, variables } = JSON.parse(init.body);
    const plural = query.includes('people(') ? 'people' : 'recruitmentJobs';
    seen[plural] = variables.filter.and;
    return { data: { [plural]: page(plural === 'people' ? [candidateA] : [jobA]) } };
  };
  const parsed = parseOptions(['--workspace-id', workspaceId, '--scope', 'all', '--exclude-job-status', 'CLOSED,PAUSED', '--candidate-ai-status', 'COMPLETED']);
  const result = await runMonthlyMatches(parsed, f.dependencies);
  assert.equal(result.planned, 1);
  assert.deepEqual(seen.recruitmentJobs, [{ and: [{ jobStatus: { neq: 'CLOSED' } }, { jobStatus: { neq: 'PAUSED' } }] }]);
  assert.deepEqual(seen.people, [{ and: [{ contactRoles: { containsAny: ['CANDIDATE'] } }, { candidateAiStatus: { eq: 'COMPLETED' } }] }]);
  assert.deepEqual(f.log[0].excludeJobStatuses, ['CLOSED', 'PAUSED']);
  assert.equal(f.log[0].candidateAiStatus, 'COMPLETED');
});

test('history cache skips terminal run details on restart but refetches active runs', async () => {
  const history = [
    { subjectId: candidateA, direction: 'PAIR', runId: runA },
    { subjectId: candidateB, direction: 'PAIR', runId: runB },
  ];
  const details = {
    [runA]: { status: 'COMPLETED', results: [{ candidateId: candidateA, jobId: jobA, status: 'SCORED', score: 9 }] },
    [runB]: { status: 'PROCESSING', results: [] },
  };
  let stored = {};
  const historyStore = { load: async () => stored, save: async (value) => { stored = JSON.parse(JSON.stringify(value)); } };
  const first = fixture({ history, details });
  await runMonthlyMatches(options(), { ...first.dependencies, historyStore });
  assert.deepEqual(Object.keys(stored), [runA]);
  assert.deepEqual(stored[runA].results, [{ candidateId: candidateA, jobId: jobA, status: 'SCORED' }]);
  const second = fixture({ history, details });
  const result = await runMonthlyMatches(options(), { ...second.dependencies, historyStore });
  const detailPaths = second.requests.filter((row) => /match-runs\/[0-9a-f-]+$/.test(row.path)).map((row) => row.path);
  assert.deepEqual(detailPaths, [`/recruiting/match-runs/${runB}`]);
  assert.equal(second.log[0].detailRequests, 1);
  assert.equal(second.log[0].skippedExisting, 1);
  assert.equal(result.planned, 3);
});

test('--max-errors keeps scheduling after a failed pair and stops at the threshold', async () => {
  const run = async (maxErrors) => {
    const f = fixture();
    f.client.post = async (path, input) => {
      f.writes.push({ path, input });
      throw Object.assign(new Error('boom'), { status: 500 });
    };
    const result = await runMonthlyMatches(options(['--apply', '--concurrency', '1', '--max-errors', String(maxErrors)]), f.dependencies);
    return { result, f };
  };
  const strict = await run(1);
  assert.equal(strict.f.writes.length, 1);
  const lenient = await run(3);
  assert.equal(lenient.f.writes.length, 3);
  assert.equal(lenient.result.errors, 3);
  assert.equal(lenient.f.log.filter((row) => row.event === 'pair-error').at(-1).message.includes('stopped'), true);
});
