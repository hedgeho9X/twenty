/** Reports coverage, shortlist silver labels and disagreement separately; missing review evidence is never counted as a negative. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const directory = '.local/recruiting/evaluations/rsi-v1';
const manifestBytes = await readFile(`${directory}/manifest.json`);
const manifest = JSON.parse(manifestBytes);
const protocols = new Set();
const all = [];
/** Ratios with no observations remain unknown, including false-exclusion metrics when no pair was excluded. */
const ratio = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
for (const candidate of manifest.candidates) {
  const base = `${directory}/${candidate.id}`;
  const run = JSON.parse(await readFile(`${base}/match.json`, 'utf8'));
  const silver = JSON.parse(await readFile(`${base}/silver.json`, 'utf8'));
  const materials = JSON.parse(
    await readFile(`${base}/materials.json`, 'utf8'),
  );
  const response = JSON.parse(
    await readFile(`${base}/judge-response.json`, 'utf8'),
  );
  protocols.add(run.protocol);
  const byJob = new Map(run.results.map((pair) => [pair.jobId, pair]));
  for (const label of silver.labels) {
    const pair = byJob.get(label.jobId);
    all.push({
      ...label,
      top: run.top.some((row) => row.jobId === label.jobId),
      pair,
      candidateRunId: run.runId,
      runComplete: run.complete,
      runCounts: run.counts,
      runElapsedMs: Date.parse(run.completedAt) - Date.parse(run.startedAt),
      judgeElapsedMs: response.elapsedMs,
      materialCount: materials.length,
      materialPages: materials.reduce(
        (sum, item) => sum + (item.pages ?? 0),
        0,
      ),
      materialsComplete: materials.every((item) => item.status === 'complete'),
    });
  }
}
/** Measures agreement only on non-tied, observed labels and scores from the same candidate. */
const aggregate = (split) => {
  const rows = all.filter((row) => !split || row.split === split);
  const people = new Map(rows.map((row) => [row.candidateId, row]));
  const top = rows.filter((row) => row.top);
  const controls = rows.filter((row) => !row.top);
  const scored = rows.filter(
    (row) => Number.isFinite(row.pair?.score) && row.ability >= 0,
  );
  const excluded = rows.filter(
    (row) => row.pair?.eligibility?.status === 'excluded',
  );
  let concordant = 0,
    comparable = 0,
    ties = 0;
  for (const id of people.keys()) {
    const pairs = scored.filter((row) => row.candidateId === id);
    for (let i = 0; i < pairs.length; i++)
      for (let j = i + 1; j < pairs.length; j++) {
        const predicted = Math.sign(pairs[i].pair.score - pairs[j].pair.score);
        const expected = Math.sign(pairs[i].ability - pairs[j].ability);
        if (!predicted || !expected) {
          ties++;
          continue;
        }
        comparable++;
        if (predicted === expected) concordant++;
      }
  }
  return {
    candidates: people.size,
    judgedPairs: rows.length,
    topPairs: top.length,
    controlPairs: controls.length,
    completeCandidateRuns: [...people.values()].filter((row) => row.runComplete)
      .length,
    scoredTotal: [...people.values()].reduce(
      (sum, row) => sum + row.runCounts.scored,
      0,
    ),
    failedTotal: [...people.values()].reduce(
      (sum, row) => sum + row.runCounts.failed,
      0,
    ),
    topWorthDiscussing: ratio(
      top.filter((row) => row.worthDiscussing).length,
      top.length,
    ),
    controlWorthDiscussing: ratio(
      controls.filter((row) => row.worthDiscussing).length,
      controls.length,
    ),
    topExplicitConflict: ratio(
      top.filter((row) => row.eligibility === 'conflict').length,
      top.length,
    ),
    topUnknownEligibility: ratio(
      top.filter((row) => row.eligibility === 'unknown').length,
      top.length,
    ),
    judgedUnknownWronglyExcluded: ratio(
      excluded.filter((row) => row.eligibility === 'unknown').length,
      excluded.length,
    ),
    exactEvidenceQuote: ratio(
      rows.filter((row) => row.evidenceQuoteVerified).length,
      rows.filter((row) => row.evidence).length,
    ),
    meanAbsoluteAbilityDifference: scored.length
      ? scored.reduce(
          (sum, row) => sum + Math.abs(row.pair.score - row.ability),
          0,
        ) / scored.length
      : null,
    pairwiseAgreement: ratio(concordant, comparable),
    ignoredTiedPairs: ties,
    completeOriginalMaterialCandidates: [...people.values()].filter(
      (row) => row.materialsComplete,
    ).length,
    runElapsedMs: [...people.values()].map((row) => row.runElapsedMs),
    judgeElapsedMs: [...people.values()].map((row) => row.judgeElapsedMs),
  };
};
let cost = 0,
  requests = 0,
  inputTokens = 0,
  outputTokens = 0;
const modelIds = new Set();
for (const candidate of manifest.candidates) {
  const run = JSON.parse(
    await readFile(`${directory}/${candidate.id}/match.json`, 'utf8'),
  );
  for (const pair of run.results) {
    modelIds.add(pair.resolvedModelId ?? pair.modelId);
    if (pair.status === 'SCORED' && !pair.cached) {
      cost += Number(pair.cost ?? 0);
      requests++;
      inputTokens += Number(pair.usage?.inputTokens ?? 0);
      outputTokens += Number(pair.usage?.outputTokens ?? 0);
    }
  }
}
const report = {
  createdAt: new Date().toISOString(),
  manifestHash: createHash('sha256').update(manifestBytes).digest('hex'),
  frozenAt: manifest.frozenAt,
  freezeCommit: manifest.codeCommit,
  reportCommit: spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).stdout.trim(),
  protocols: [...protocols],
  jevModelIds: [...modelIds],
  judgeModel: 'chatgpt-subscription/gpt-5.6-sol',
  labelKind: 'independent-model-silver-not-human-gold',
  development: aggregate('development'),
  holdout: aggregate('holdout'),
  overall: aggregate(),
  measuredJev: {
    newScoredRequests: requests,
    reportedCostUSD: cost,
    inputTokens,
    outputTokens,
  },
  limitations: [
    'Eight candidates and two controls per person are a small selected sample, not full-pool recall or deployment acceptance.',
    'The judge sees original parsed text without Jev scores/ranks; screenshots exist but were not input to this first text-only judge.',
    'Jev and the independent model can both be wrong. Matching a model label is not objective recruitment accuracy.',
    'This holdout is untouched only for the frozen first assessment. After inspecting it, subsequent tuning must call it a reused regression set.',
    'Source excerpts are checked as literal text, not as a full semantic or OCR-fidelity proof. No exclusion observation means the false-exclusion rate is unknown.',
    'Subscription billing reports are not monetary costs; capture native Agent token counts separately rather than treating zero API credits as free usage.',
  ],
};
await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), {
  mode: 0o600,
});
const discrepancies = all.filter(
  (row) =>
    (row.top &&
      (!row.worthDiscussing ||
        row.eligibility === 'conflict' ||
        !row.evidenceQuoteVerified)) ||
    (Number.isFinite(row.pair?.score) &&
      row.ability >= 0 &&
      Math.abs(row.pair.score - row.ability) >= 1.5),
);
await writeFile(
  `${directory}/discrepancies.json`,
  JSON.stringify(discrepancies, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
