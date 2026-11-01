/** Replays frozen pairs with disjoint candidate and stored job families; never replaces the full 46-job experiment. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = join(root, '.local/recruiting/evaluations/rsi-v1');
const seed = 'joint-disjoint-rsi-v1';
/** Fixes the split from source identities without selecting a seed using model scores or review labels. */
const hash = (value) => createHash('sha256').update(value).digest('hex');
/** Reads existing private artifacts only; this command has no network client or model provider. */
const json = async (...parts) =>
  JSON.parse(await readFile(join(directory, ...parts), 'utf8'));
const manifestBytes = await readFile(join(directory, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const reportBytes = await readFile(join(directory, 'report.json'));
assert.equal(hash(manifestBytes), JSON.parse(reportBytes).manifestHash);
const jobFamily = new Map();
const runs = new Map();
for (const candidate of manifest.candidates) {
  const run = await json(candidate.id, 'match.json');
  assert.equal(run.complete, true);
  assert.equal(run.results.length, manifest.jobIds.length);
  assert.equal(
    new Set(run.results.map((pair) => pair.jobId)).size,
    manifest.jobIds.length,
  );
  for (const pair of run.results) {
    assert.equal(pair.status, 'SCORED');
    assert.equal(typeof pair.duplicateKey, 'string');
    assert.ok(manifest.jobIds.includes(pair.jobId));
    if (jobFamily.has(pair.jobId))
      assert.equal(jobFamily.get(pair.jobId), pair.duplicateKey);
    jobFamily.set(pair.jobId, pair.duplicateKey);
  }
  runs.set(candidate.id, run);
}
const familySplit = new Map(
  [...new Set(jobFamily.values())].map((family) => [
    family,
    Number.parseInt(hash(`${seed}:${family}`).slice(0, 8), 16) % 2
      ? 'development'
      : 'holdout',
  ]),
);
const jobIds = {};
const candidateIds = {};
for (const split of ['development', 'holdout']) {
  jobIds[split] = [...jobFamily]
    .filter(([, family]) => familySplit.get(family) === split)
    .map(([id]) => id)
    .sort();
  candidateIds[split] = manifest.candidates
    .filter((candidate) => candidate.split === split)
    .map((candidate) => candidate.id)
    .sort();
  assert.ok(jobIds[split].length > 0 && candidateIds[split].length > 0);
}
assert.equal(
  new Set([...jobIds.development, ...jobIds.holdout]).size,
  manifest.jobIds.length,
);
assert.equal(
  new Set([...candidateIds.development, ...candidateIds.holdout]).size,
  manifest.candidates.length,
);
/** Computes observed partition intersections instead of hard-coding successful audit counts. */
const overlap = (left, right) =>
  [...new Set(left)].filter((value) => right.includes(value)).length;
const checks = {
  candidateOverlap: overlap(candidateIds.development, candidateIds.holdout),
  jobOverlap: overlap(jobIds.development, jobIds.holdout),
  storedDuplicateFamilyOverlap: overlap(
    jobIds.development.map((id) => jobFamily.get(id)),
    jobIds.holdout.map((id) => jobFamily.get(id)),
  ),
};
assert.ok(Object.values(checks).every((count) => count === 0));
const candidates = [];
for (const candidate of manifest.candidates) {
  const run = runs.get(candidate.id);
  const silver = await json(candidate.id, 'silver.json');
  const labels = new Map(silver.labels.map((label) => [label.jobId, label]));
  const scoped = run.results.filter((pair) =>
    jobIds[candidate.split].includes(pair.jobId),
  );
  const families = new Set();
  const top = scoped
    .toSorted(
      (a, b) => b.score - a.score || a.jobId.localeCompare(b.jobId, 'en'),
    )
    .filter((pair) => {
      if (families.has(pair.duplicateKey)) return false;
      families.add(pair.duplicateKey);
      return true;
    })
    .slice(0, 5);
  candidates.push({
    candidateId: candidate.id,
    split: candidate.split,
    scoredPairs: scoped.length,
    top: top.map((pair) => ({
      jobId: pair.jobId,
      score: pair.score,
      family: pair.duplicateKey,
      label: labels.has(pair.jobId)
        ? {
            worthDiscussing: labels.get(pair.jobId).worthDiscussing,
            eligibility: labels.get(pair.jobId).eligibility,
          }
        : null,
    })),
  });
}
/** Unreviewed shortlist rows remain unknown; observed labels are selection-biased from the original full-pool review. */
const aggregate = (split) => {
  const people = candidates.filter((candidate) => candidate.split === split);
  const top = people.flatMap((candidate) => candidate.top);
  const reviewed = top.filter((pair) => pair.label !== null);
  return {
    candidates: people.length,
    jobs: jobIds[split].length,
    scoredPairs: people.reduce(
      (sum, candidate) => sum + candidate.scoredPairs,
      0,
    ),
    topSlots: top.length,
    reviewedTopSlots: reviewed.length,
    unknownTopSlots: top.length - reviewed.length,
    reviewedWorthDiscussing: reviewed.filter(
      (pair) => pair.label.worthDiscussing,
    ).length,
    fullShortlistWorthDiscussingRate: null,
  };
};
const replay = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  mode: 'retrospective-cache-replay-not-new-unseen-test',
  seed,
  codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceHash: hash(await readFile(fileURLToPath(import.meta.url))),
  manifestHash: hash(manifestBytes),
  reportHash: hash(reportBytes),
  partition: {
    candidateIds,
    jobIds,
    jobFamily: Object.fromEntries(jobFamily),
    familySplit: Object.fromEntries(familySplit),
  },
  checks,
  development: aggregate('development'),
  holdout: aggregate('holdout'),
  candidates,
  newModelRequests: 0,
  newModelCostUSD: 0,
  limitations: [
    'All eight candidates and their scores/labels were already observed; this is retrospective, never a fresh holdout result.',
    'The original full 46-job results remain authoritative for the full-pool experiment; this complementary split measures a different scope.',
    'Family grouping uses stored duplicateKey only. Unlabelled semantic near duplicates remain an open correctness question.',
    'Existing reviews were selected as full-pool top-five plus controls. Unknown new-shortlist labels are neither positive nor negative.',
  ],
};
assert.equal(
  hash(await readFile(join(directory, 'manifest.json'))),
  replay.manifestHash,
);
assert.equal(
  hash(await readFile(join(directory, 'report.json'))),
  replay.reportHash,
);
await writeFile(
  join(directory, 'joint-disjoint-replay-v1.json'),
  JSON.stringify(replay, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    checks: replay.checks,
    development: replay.development,
    holdout: replay.holdout,
    newModelRequests: 0,
  }),
);
