/** Replays frozen pair scores without billing; reports coverage separately from quality. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { evaluateRecruitingEligibility } from '../../packages/twenty-server/src/modules/recruiting/matching/domain/match-policy.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    output: { type: 'string' },
    constraints: { type: 'string' },
    labels: { type: 'string' },
  },
});
if (!values.source)
  throw new Error(
    '--source must point to the existing experiment work directory',
  );
const source = resolve(values.source);
const output = resolve(
  values.output ??
    join(repository, '.local/recruiting/evaluations/cache-baseline'),
);

/** Reads local JSON without printing private resume or credential content. */
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
/** Freezes exact bytes so unrelated source changes cannot masquerade as model improvements. */
const hash = (value) => createHash('sha256').update(value).digest('hex');
const inputBytes = await readFile(join(source, 'jev/inputs.json'));
const input = JSON.parse(inputBytes);
const candidateById = new Map(
  input.candidates.map((candidate) => [candidate.id, candidate]),
);
const jobById = new Map(input.jobs.map((job) => [job.id, job]));
if (
  candidateById.size !== input.candidates.length ||
  jobById.size !== input.jobs.length
) {
  throw new Error('Duplicate record identities in the frozen input');
}
const constraints = values.constraints
  ? await json(resolve(values.constraints))
  : { candidates: {}, jobs: {} };
const labels = values.labels ? await json(resolve(values.labels)) : [];
const labelsByPair = new Map(
  labels.map((label) => [`${label.candidateId}:${label.jobId}`, label]),
);
if (labelsByPair.size !== labels.length)
  throw new Error('Duplicate review labels');

const pairs = new Map();
const failed = [];
const models = new Set();
const protocols = new Set();
const staleJobs = [];
let reportedCost = 0;
for (const name of (await readdir(join(source, 'jev/results')))
  .filter((name) => name.endsWith('.json'))
  .sort()) {
  const result = await json(join(source, 'jev/results', name));
  const job = jobById.get(result.jobId);
  if (!job) continue;
  if (
    result.inputHash !==
    hash(JSON.stringify({ job, candidates: input.candidates }))
  ) {
    staleJobs.push(job.id);
    continue;
  }
  models.add(result.model);
  protocols.add(result.protocol);
  for (const item of result.failed ?? [])
    failed.push({ candidateId: item.id, jobId: job.id });
  for (const row of result.ranked) {
    if (!candidateById.has(row.id))
      throw new Error('Cached score references an unknown candidate');
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 4)
      throw new Error('Invalid cached score');
    const key = `${row.id}:${job.id}`;
    if (pairs.has(key)) throw new Error('Duplicate cached pair');
    const eligibility = evaluateRecruitingEligibility(
      constraints.candidates?.[row.id] ?? {},
      {
        ...constraints.jobs?.[job.id],
        status: job.status,
      },
    );
    pairs.set(key, {
      candidateId: row.id,
      jobId: job.id,
      score: row.score,
      eligibility,
    });
    if (Number.isFinite(Number(row.cost))) reportedCost += Number(row.cost);
  }
}

const ranked = input.candidates.map((candidate) => {
  const all = [...pairs.values()].filter(
    (pair) => pair.candidateId === candidate.id,
  );
  const available = all
    .filter((pair) => pair.eligibility.status !== 'excluded')
    .sort(
      (left, right) =>
        right.score - left.score || left.jobId.localeCompare(right.jobId),
    );
  const split =
    parseInt(hash(candidate.id).slice(0, 8), 16) % 10 < 7
      ? 'development'
      : 'retrospective_validation';
  return {
    candidateId: candidate.id,
    split,
    suppliedJobs: input.jobs.length,
    scoredJobs: all.length,
    excludedJobs: all.length - available.length,
    complete: all.length === input.jobs.length,
    top: available.slice(0, 5).map((pair) => ({
      ...pair,
      review: labelsByPair.get(`${pair.candidateId}:${pair.jobId}`) ?? null,
    })),
  };
});
const topPairs = ranked.flatMap((row) => row.top);
const labeledTop = topPairs.filter((row) => row.review);
const expectedPairs = input.candidates.length * input.jobs.length;
const report = {
  createdAt: new Date().toISOString(),
  mode: 'cached-replay-no-model-calls',
  codeCommit: spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).stdout.trim(),
  policyHash: hash(
    await readFile(
      join(
        repository,
        'packages/twenty-server/src/modules/recruiting/matching/domain/match-policy.ts',
      ),
    ),
  ),
  inputHash: hash(inputBytes),
  inputVersion: input.inputVersion,
  modelAliases: [...models],
  protocols: [...protocols],
  exactUnderlyingModelBuild: 'not recorded by the original gateway result',
  counts: {
    candidates: input.candidates.length,
    jobs: input.jobs.length,
    expectedPairs,
    validPairs: pairs.size,
    missingPairs: expectedPairs - pairs.size,
    staleJobs: staleJobs.length,
    failedPairs: failed.length,
    developmentCandidates: ranked.filter((row) => row.split === 'development')
      .length,
    retrospectiveValidationCandidates: ranked.filter(
      (row) => row.split === 'retrospective_validation',
    ).length,
  },
  testSetStatus:
    'These 30 candidates were already reviewed; this split is retrospective, not an untouched test set.',
  reviews: {
    supplied: labels.length,
    topPairs: topPairs.length,
    reviewedTopPairs: labeledTop.length,
    worthDiscussing: labeledTop.filter(
      (row) => row.review.label === 'worth_discussing',
    ).length,
    caveat:
      'Unreviewed pairs are unknown, not negative labels. Agent reviews are not human-confirmed ground truth.',
  },
  constraints: {
    candidateRecords: Object.keys(constraints.candidates ?? {}).length,
    jobRecords: Object.keys(constraints.jobs ?? {}).length,
    caveat:
      'Without independently verified constraints this replay cannot claim hard-condition compliance.',
  },
  originalReportedCostUSD: reportedCost,
  newModelRequests: 0,
  newModelCostUSD: 0,
  complete:
    pairs.size === expectedPairs &&
    failed.length === 0 &&
    staleJobs.length === 0,
};
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), {
  mode: 0o600,
});
await writeFile(
  join(output, 'rankings.json'),
  JSON.stringify(ranked, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
if (!report.complete) process.exitCode = 2;
