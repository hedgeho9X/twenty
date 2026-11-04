#!/usr/bin/env node
/** Plans monthly pairs, or submits them through the same authenticated API as manual matching. */
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createRecruitingClient } from './cli.mjs';

const help = `Usage: node ops/recruiting/match-month.mjs --workspace-id UUID [options]
Required environment: FANHAN_BASE_URL (API origin), FANHAN_API_KEY
  --from YYYY-MM-DD --to YYYY-MM-DD  Shanghai dates, inclusive/exclusive
                                   Default: current month in Asia/Shanghai
  --scope both-new|either-side      Default: both-new
  --dry-run                        Default; read and print only, no matching POSTs
  --apply                          Explicitly submit paid matching work
  --limit N                        Maximum missing pairs, after skipping existing
  --concurrency N                  Outstanding pair runs (default 2, maximum 20)
  --timeout-ms N                   Wait per run (default 600000)
  --help                           No credentials or network needed
Scope both-new: interval jobs x interval CANDIDATE contacts.
Scope either-side: interval jobs x all CANDIDATE contacts, plus all jobs x
interval CANDIDATE contacts, deduped. Pairs run oldest first by the earlier
createdAt of their two sides, with IDs breaking ties.
Inactive jobs are included; the shared evaluator excludes them without billing.
JSON lines contain IDs and counts, never resumes, model output or credentials.
Do not overlap this command with another bulk run. Ctrl-C leaves submitted work
in the durable queue; rerun with the same workspace to recover its receipts.`;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const integer = (value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > maximum
  )
    throw new Error(`Invalid ${name}`);
  return number;
};

/** Calendar dates are unambiguous; Asia/Shanghai uses UTC+08 for supported modern dates. */
const shanghaiDate = (value) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '2000-01-01' ||
    value > '9998-12-31'
  )
    throw new Error('Dates must be YYYY-MM-DD between 2000 and 9998');
  const midnightUtc = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(midnightUtc.getTime()) ||
    midnightUtc.toISOString().slice(0, 10) !== value
  )
    throw new Error('Invalid calendar date');
  return new Date(`${value}T00:00:00+08:00`).toISOString();
};

export const parseOptions = (args, now = new Date()) => {
  const { values } = parseArgs({
    args,
    options: {
      'workspace-id': { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      scope: { type: 'string', default: 'both-new' },
      'dry-run': { type: 'boolean' },
      apply: { type: 'boolean' },
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '2' },
      'timeout-ms': { type: 'string', default: '600000' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { help: true };
  if (!uuid.test(values['workspace-id'] ?? ''))
    throw new Error('--workspace-id must be a UUID');
  if (values.apply && values['dry-run'])
    throw new Error('--apply and --dry-run are mutually exclusive');
  if (!['both-new', 'either-side'].includes(values.scope))
    throw new Error('--scope must be both-new or either-side');
  if (Boolean(values.from) !== Boolean(values.to))
    throw new Error('Supply both --from and --to');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year').value);
  const month = Number(parts.find((part) => part.type === 'month').value);
  const from = values.from ?? `${year}-${String(month).padStart(2, '0')}-01`;
  const to =
    values.to ??
    `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
  const fromUtc = shanghaiDate(from);
  const toUtc = shanghaiDate(to);
  if (fromUtc >= toUtc) throw new Error('--from must precede --to');
  return {
    workspaceId: values['workspace-id'].toLowerCase(),
    from,
    to,
    fromUtc,
    toUtc,
    scope: values.scope,
    apply: Boolean(values.apply),
    limit:
      values.limit === undefined ? Infinity : integer(values.limit, '--limit', 0),
    concurrency: integer(values.concurrency, '--concurrency', 1, 20),
    timeoutMs: integer(values['timeout-ms'], '--timeout-ms', 1),
  };
};

const pairKey = (candidateId, jobId) => `${candidateId}:${jobId}`;
/** Independent of month/limit/order: overlapping intervals and interrupted submissions reuse one run. */
export const pairInput = (workspaceId, candidateId, jobId) => ({
  direction: 'PAIR',
  subjectId: candidateId,
  jobId,
  idempotencyKey: `monthly-pair-v1:${createHash('sha256')
    .update(`${workspaceId}:${pairKey(candidateId, jobId)}`)
    .digest('hex')}`,
});

/** Dry-run only sends GraphQL queries and GETs. No generic writes to server-signed result envelopes. */
export const runMonthlyMatches = async (
  options,
  {
    client,
    log = (row) => console.log(JSON.stringify(row)),
    pause = sleep,
    now = Date.now,
  } = {},
) => {
  const graphql = async (path, query, variables = {}) => {
    const body = await client.request(path, {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    if (body.errors?.length || !body.data)
      throw new Error('GraphQL read failed; check schema and role permissions');
    return body.data;
  };
  const current = await graphql('/metadata', '{ currentWorkspace { id } }');
  if (current.currentWorkspace?.id?.toLowerCase() !== options.workspaceId)
    throw new Error('Workspace identity mismatch; no matching submitted');

  const select = async (plural, type, extraFilter = {}, inWindow = true) => {
    const records = new Map();
    const cursors = new Set();
    let after;
    do {
      const data = await graphql(
        '/graphql',
        `query MonthlyRecords($filter: ${type}FilterInput, $after: String) {
        ${plural}(filter: $filter, first: 100, after: $after, orderBy: [{id: AscNullsLast}]) {
          edges { node { id createdAt } } pageInfo { hasNextPage endCursor }
        }
      }`,
        {
          filter: {
            and: [
              ...(inWindow
                ? [{ createdAt: { gte: options.fromUtc, lt: options.toUtc } }]
                : []),
              ...(Object.keys(extraFilter).length ? [extraFilter] : []),
            ],
          },
          ...(after ? { after } : {}),
        },
      );
      const page = data[plural];
      if (
        !Array.isArray(page?.edges) ||
        typeof page.pageInfo?.hasNextPage !== 'boolean'
      )
        throw new Error('Invalid record pagination');
      for (const { node } of page.edges) {
        const created = Date.parse(node.createdAt);
        if (
          !uuid.test(node.id) ||
          !Number.isFinite(created) ||
          (inWindow &&
            (created < Date.parse(options.fromUtc) ||
              created >= Date.parse(options.toUtc)))
        )
          throw new Error('Record outside requested interval or missing readable createdAt');
        records.set(node.id, created);
      }
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
      if (!after || cursors.has(after)) throw new Error('Invalid record cursor');
      cursors.add(after);
    } while (true);
    return records;
  };
  // Sequential reads keep planning light on small deployments.
  const monthJobs = await select('recruitmentJobs', 'RecruitmentJob');
  const candidateFilter = {
    contactRoles: { containsAny: ['CANDIDATE'] },
  };
  const monthCandidates = await select('people', 'Person', candidateFilter);
  const eitherSide = options.scope === 'either-side';
  const jobs = eitherSide
    ? new Map([
        ...(await select('recruitmentJobs', 'RecruitmentJob', {}, false)),
        ...monthJobs,
      ])
    : monthJobs;
  const candidates = eitherSide
    ? new Map([
        ...(await select('people', 'Person', candidateFilter, false)),
        ...monthCandidates,
      ])
    : monthCandidates;
  const isInScope = (candidateId, jobId) =>
    candidates.has(candidateId) &&
    jobs.has(jobId) &&
    (!eitherSide || monthJobs.has(jobId) || monthCandidates.has(candidateId));
  const existing = new Set();
  let staleResults = 0;
  let inaccessibleResults = 0;
  if (jobs.size && candidates.size) {
    // Use validated task details, not raw unsigned CRM JSON or the expiring 24-hour model cache.
    for (let offset = 0; ; offset += 50) {
      const page = await client.request(`/recruiting/match-runs?offset=${offset}`);
      if (
        !Array.isArray(page.records) ||
        typeof page.hasNextPage !== 'boolean' ||
        page.integrityRejected
      )
        throw new Error('Invalid or untrusted match history; planning stopped');
      for (const run of page.records) {
        const subjects =
          run.direction === 'JOB_TO_CANDIDATES' ? jobs : candidates;
        if (!subjects.has(run.subjectId)) continue;
        const detail = await client.request(
          `/recruiting/match-runs/${encodeURIComponent(run.runId)}`,
        );
        if (!Array.isArray(detail.results))
          throw new Error('Match detail is missing results');
        staleResults += detail.stale ?? 0;
        inaccessibleResults += detail.inaccessible ?? 0;
        for (const pair of detail.results) {
          if (
            isInScope(pair.candidateId, pair.jobId) &&
            ['SCORED', 'EXCLUDED', 'NEEDS_REVIEW'].includes(pair.status)
          )
            existing.add(pairKey(pair.candidateId, pair.jobId));
        }
      }
      if (!page.hasNextPage) break;
    }
  }
  const total = eitherSide
    ? monthJobs.size * candidates.size +
      (jobs.size - monthJobs.size) * monthCandidates.size
    : jobs.size * candidates.size;
  if (!Number.isSafeInteger(total))
    throw new Error('Pair count exceeds safe integer range');
  const planned = Math.min(options.limit, total - existing.size);
  log({
    event: 'plan',
    mode: options.apply ? 'apply' : 'dry-run',
    workspaceId: options.workspaceId,
    timezone: 'Asia/Shanghai',
    from: options.from,
    toExclusive: options.to,
    fromUtc: options.fromUtc,
    toUtc: options.toUtc,
    jobs: jobs.size,
    candidates: candidates.size,
    totalPairs: total,
    skippedExisting: existing.size,
    staleResults,
    inaccessibleResults,
    planned,
    deferredByLimit: total - existing.size - planned,
    concurrency: options.concurrency,
    scope: eitherSide ? 'either-side-created' : 'new-jobs-x-new-candidates',
  });
  const missingPairs = [];
  for (const [candidateId, candidateCreatedAt] of candidates) {
    const eligibleJobs = eitherSide && !monthCandidates.has(candidateId)
      ? monthJobs
      : jobs;
    for (const [jobId, jobCreatedAt] of eligibleJobs) {
      if (existing.has(pairKey(candidateId, jobId))) continue;
      missingPairs.push({
        candidateId,
        jobId,
        createdAt: Math.min(candidateCreatedAt, jobCreatedAt),
      });
    }
  }
  missingPairs.sort((left, right) =>
    left.createdAt - right.createdAt ||
    left.candidateId.localeCompare(right.candidateId) ||
    left.jobId.localeCompare(right.jobId),
  );
  function* pairs() {
    for (let index = 0; index < planned; index++) {
      const { candidateId, jobId } = missingPairs[index];
      yield { candidateId, jobId };
    }
  }
  if (!options.apply) {
    for (const pair of pairs()) log({ event: 'planned-pair', ...pair });
    return { planned, submitted: 0, completed: 0, errors: 0 };
  }

  const iterator = pairs();
  const summary = { planned, submitted: 0, completed: 0, errors: 0 };
  let stop = false;
  const worker = async () => {
    while (!stop) {
      const next = iterator.next();
      if (next.done) return;
      const pair = next.value;
      let runId;
      try {
        const receipt = await client.post(
          'match-runs',
          pairInput(options.workspaceId, pair.candidateId, pair.jobId),
        );
        runId = receipt.runId;
        if (!uuid.test(runId ?? '')) throw new Error('Invalid run receipt');
        summary.submitted++;
        log({
          event: 'submitted',
          ...pair,
          runId,
          submitted: summary.submitted,
          planned,
        });
        const deadline = now() + options.timeoutMs;
        let previousStatus;
        while (true) {
          const detail = await client.request(`/recruiting/match-runs/${runId}`);
          if (detail.status !== previousStatus) {
            log({
              event: 'progress',
              ...pair,
              runId,
              status: detail.status,
              counts: detail.counts,
            });
            previousStatus = detail.status;
          }
          if (!['QUEUED', 'PROCESSING'].includes(detail.status)) {
            const result = detail.results?.find(
              (row) =>
                row.candidateId === pair.candidateId &&
                row.jobId === pair.jobId,
            );
            if (
              !['COMPLETED', 'NO_RESULTS'].includes(detail.status) ||
              !detail.complete ||
              !result ||
              !['SCORED', 'EXCLUDED'].includes(result.status)
            )
              throw Object.assign(new Error('Incomplete pair'), {
                code: 'INCOMPLETE_PAIR',
              });
            summary.completed++;
            log({
              event: 'completed',
              ...pair,
              runId,
              status: result.status,
              cached: result.cached,
              completed: summary.completed,
              planned,
            });
            break;
          }
          const remaining = deadline - now();
          if (remaining <= 0)
            throw Object.assign(new Error('Run timed out'), {
              code: 'RUN_TIMEOUT',
            });
          await pause(Math.min(2000, remaining));
        }
      } catch (error) {
        summary.errors++;
        stop = true;
        // Do not echo response bodies: upstream errors may contain private material.
        log({
          event: 'pair-error',
          ...pair,
          runId,
          httpStatus: error.status,
          message: 'Pair did not complete. Scheduling stopped; inspect this run/permissions and rerun.',
          code: error.status
            ? 'API_ERROR'
            : ['INCOMPLETE_PAIR', 'RUN_TIMEOUT'].includes(error.code)
              ? error.code
              : 'INCOMPLETE_OR_UNCERTAIN',
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, planned) }, worker),
  );
  log({ event: 'summary', ...summary, notSubmitted: planned - summary.submitted });
  return summary;
};

export const main = async (args = process.argv.slice(2)) => {
  const options = parseOptions(args);
  if (options.help) return console.log(help);
  // No saved auth, default host, login, DB bootstrap or environment-file loading.
  if (!process.env.FANHAN_BASE_URL || !process.env.FANHAN_API_KEY)
    throw new Error('Set FANHAN_BASE_URL and FANHAN_API_KEY explicitly');
  const client = createRecruitingClient({
    baseUrl: process.env.FANHAN_BASE_URL,
    token: process.env.FANHAN_API_KEY,
  });
  const summary = await runMonthlyMatches(options, { client });
  if (summary.errors) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: 'fatal',
      httpStatus: error.status,
      message: 'Planning/request failed; check arguments, required environment, schema and permissions. No further pairs scheduled. Use --help for usage.',
    }));
    process.exitCode = 1;
  });
}
