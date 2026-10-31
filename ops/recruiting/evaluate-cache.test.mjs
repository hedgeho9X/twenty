/** Exercises cached evaluation coverage and eligibility without models or databases. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Builds synthetic frozen inputs with no personal data or credentials. */
const fixture = async (change = () => {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'recruiting-eval-'));
  await mkdir(join(directory, 'jev/results'), { recursive: true });
  const input = {
    inputVersion: 'test',
    candidates: [{ id: 'candidate', resume: { skills: ['TypeScript'] } }],
    jobs: [
      { id: 'internship', status: 'RECRUITING', text: 'TypeScript internship' },
      { id: 'full-time', status: 'RECRUITING', text: 'TypeScript full time' },
    ],
  };
  await writeFile(join(directory, 'jev/inputs.json'), JSON.stringify(input));
  for (const job of input.jobs) {
    const result = {
      jobId: job.id,
      model: 'test/jev',
      protocol: 'test-v1',
      inputHash: createHash('sha256')
        .update(JSON.stringify({ job, candidates: input.candidates }))
        .digest('hex'),
      ranked: [
        { id: 'candidate', score: job.id === 'internship' ? 4 : 3, cost: 0.01 },
      ],
      failed: [],
    };
    change(result, job);
    await writeFile(
      join(directory, `jev/results/${job.id}.json`),
      JSON.stringify(result),
    );
  }
  return directory;
};

/** Executes the public CLI and reads its private reports for assertions. */
const replay = async (directory, extra = []) => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./evaluate-cache.mjs', import.meta.url)),
      '--source',
      directory,
      '--output',
      join(directory, 'output'),
      ...extra,
    ],
    { encoding: 'utf8' },
  );
  const report =
    result.status === 0 || result.status === 2
      ? JSON.parse(
          await readFile(join(directory, 'output/report.json'), 'utf8'),
        )
      : null;
  return { result, report };
};

test('replays complete inputs while keeping unreviewed quality unknown', async () => {
  const directory = await fixture();
  try {
    const { result, report } = await replay(directory);
    assert.equal(result.status, 0);
    assert.equal(report.complete, true);
    assert.equal(report.counts.validPairs, 2);
    assert.equal(report.reviews.reviewedTopPairs, 0);
    assert.equal(report.newModelRequests, 0);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('rejects stale model results instead of calling them complete', async () => {
  const directory = await fixture((result) => {
    result.inputHash = 'stale';
  });
  try {
    const { result, report } = await replay(directory);
    assert.equal(result.status, 2);
    assert.equal(report.complete, false);
    assert.equal(report.counts.validPairs, 0);
    assert.equal(report.counts.staleJobs, 2);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('rejects duplicate pairs rather than counting inflated coverage', async () => {
  const directory = await fixture((result) =>
    result.ranked.push(result.ranked[0]),
  );
  try {
    const { result } = await replay(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Duplicate cached pair/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('removes a confirmed internship conflict before displaying rankings', async () => {
  const directory = await fixture();
  try {
    const path = join(directory, 'constraints.json');
    await writeFile(
      path,
      JSON.stringify({
        candidates: {
          candidate: {
            employmentTypes: { values: ['full_time'], certainty: 'confirmed' },
          },
        },
        jobs: {
          internship: { employmentTypes: ['internship'] },
          'full-time': { employmentTypes: ['full_time'] },
        },
      }),
    );
    const { result } = await replay(directory, ['--constraints', path]);
    assert.equal(result.status, 0);
    const rankings = JSON.parse(
      await readFile(join(directory, 'output/rankings.json'), 'utf8'),
    );
    assert.equal(rankings[0].excludedJobs, 1);
    assert.deepEqual(
      rankings[0].top.map((row) => row.jobId),
      ['full-time'],
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});
