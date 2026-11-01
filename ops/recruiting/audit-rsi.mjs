/** Audits existing frozen RSI evidence without changing inputs, labels, scores or calling models. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = join(root, '.local/recruiting/evaluations/rsi-v1');
/** Hashes exact stored bytes; a matching hash is not a semantic or OCR accuracy judgment. */
const hash = (value) => createHash('sha256').update(value).digest('hex');
/** Reads private artifacts without exposing resumes, identities or download credentials. */
const json = async (...parts) =>
  JSON.parse(await readFile(join(directory, ...parts), 'utf8'));
const manifestBytes = await readFile(join(directory, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const reportBytes = await readFile(join(directory, 'report.json'));
const report = JSON.parse(reportBytes);
assert.equal(hash(manifestBytes), report.manifestHash);
const categoryCandidates = {};
const splitCandidates = {};
const parserVersions = new Set();
const seenMaterials = new Set();
let materialReferences = 0,
  verifiedOriginals = 0,
  pages = 0,
  missingCategory = 0;
let topSlots = 0,
  duplicateSlots = 0,
  excludedTopSlots = 0,
  unscoredTopSlots = 0;
let declaredIntent = 0,
  unspecifiedIntent = 0,
  unknownIntent = 0;
for (const candidate of manifest.candidates) {
  splitCandidates[candidate.split] =
    (splitCandidates[candidate.split] ?? 0) + 1;
  const source = await json(candidate.id, 'source.json');
  const run = await json(candidate.id, 'match.json');
  assert.equal(run.complete, true);
  assert.equal(run.counts.total, manifest.jobIds.length);
  assert.ok(run.top.length <= 5);
  const categories = new Set(source.candidateJobCategories ?? []);
  if (!categories.size) missingCategory++;
  for (const category of categories) {
    assert.match(category, /^[A-Z_]{1,30}$/);
    categoryCandidates[category] = (categoryCandidates[category] ?? 0) + 1;
  }
  const intent = run.results[0]?.intent?.status;
  if (intent === 'declared') declaredIntent++;
  else if (intent === 'unspecified') unspecifiedIntent++;
  else unknownIntent++;
  const keys = new Set();
  for (const pair of run.top) {
    assert.equal(typeof pair.duplicateKey, 'string');
    if (keys.has(pair.duplicateKey)) duplicateSlots++;
    keys.add(pair.duplicateKey);
    topSlots++;
    if (pair.eligibility.status === 'excluded') excludedTopSlots++;
    if (pair.status !== 'SCORED') unscoredTopSlots++;
  }
  for (const material of await json(candidate.id, 'materials.json')) {
    materialReferences++;
    assert.match(material.requestId, /^[0-9a-f-]{36}$/i);
    assert.match(material.sourceHash, /^[0-9a-f]{64}$/);
    assert.equal(material.status, 'complete');
    assert.ok(['all_pages', 'text_only'].includes(material.coverage));
    if (material.coverage === 'all_pages')
      assert.equal(material.previews.length, material.pages);
    const original = await readFile(
      join(
        root,
        '.local/recruiting/storage/_recruiting-evaluation',
        material.requestId,
      ),
    );
    assert.equal(original.length, material.bytes);
    assert.equal(hash(original), material.sourceHash);
    if (!seenMaterials.has(material.requestId)) {
      seenMaterials.add(material.requestId);
      verifiedOriginals++;
      pages += material.pages ?? 0;
    }
    parserVersions.add(material.parserVersion);
  }
}
const audit = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  auditorSourceHash: hash(await readFile(fileURLToPath(import.meta.url))),
  auditCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  mode: 'frozen-artifacts-only-no-model-calls',
  manifestHash: hash(manifestBytes),
  frozenReportHash: hash(reportBytes),
  labelKind: report.labelKind,
  sample: {
    candidates: manifest.candidates.length,
    splitCandidates,
    legacyCategoryCandidates: categoryCandidates,
    missingCategory,
    declaredIntent,
    unspecifiedIntent,
    unknownIntent,
  },
  sourceIntegrity: {
    materialReferences,
    uniqueOriginals: verifiedOriginals,
    bytesVerified: verifiedOriginals,
    pages,
    parserVersions: [...parserVersions],
  },
  shortlist: {
    topSlots,
    duplicateSlotsByStoredDuplicateKey: duplicateSlots,
    programExcludedSlots: excludedTopSlots,
    unscoredSlots: unscoredTopSlots,
  },
  semanticInputFidelity: {
    value: null,
    reason:
      'No per-fact reference labels: exact original hashes, page coverage and source quotes do not prove semantic preservation in model inputs.',
  },
  nearDuplicateCorrectness: {
    value: null,
    reason:
      'Stored duplicate-key occupancy is measurable; no independent labels establish whether semantically similar roles should be merged.',
  },
  unknownWronglyExcluded: report.overall.judgedUnknownWronglyExcluded,
  silverDisagreement: {
    topExplicitConflict: report.overall.topExplicitConflict,
    quoteVerification: report.overall.exactEvidenceQuote,
  },
  newModelRequests: 0,
  limitations: [
    'Legacy category tags describe the selected snapshot; they are not independently verified occupation labels.',
    'Boundary unit regressions are separate from the eight-candidate Jev quality experiment.',
    'This audit cannot validate newer parser or context versions using old scores. Frozen inputs and labels remain unchanged.',
  ],
};
assert.equal(
  hash(await readFile(join(directory, 'manifest.json'))),
  audit.manifestHash,
);
assert.equal(
  hash(await readFile(join(directory, 'report.json'))),
  audit.frozenReportHash,
);
await writeFile(
  join(directory, 'coverage-audit-v1.json'),
  JSON.stringify(audit, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(audit));
