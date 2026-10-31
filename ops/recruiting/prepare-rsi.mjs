/** Freezes a candidate-level holdout before labels, then obtains original files through the isolated instance's native authorization. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { localRequest } from './local-api.mjs';

const { values } = parseArgs({
  options: { source: { type: 'string' }, output: { type: 'string' } },
});
if (!values.source)
  throw new Error('--source must name the prior experiment work directory');
const output = resolve(values.output ?? '.local/recruiting/evaluations/rsi-v1');
if (!output.startsWith(resolve('.local/recruiting') + '/'))
  throw new Error('Evaluation evidence must remain private');
const hash = (value) => createHash('sha256').update(value).digest('hex');
/** Inspects only the explicitly authorized local-B database and fails before interpreting a failed query. */
const sql = (query) => {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'twenty-recruiting-db-1',
      'psql',
      '-U',
      'twenty',
      '-d',
      'recruiting',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error('Local evaluation inspection failed');
  return JSON.parse(result.stdout);
};
/** Reads files privately; missing prior review evidence stops sampling rather than weakening exclusion rules. */
const excluded = new Set();
for (const path of [
  join(resolve(values.source), 'jev/inputs.json'),
  '.local/recruiting/missing-career-inputs.json',
]) {
  const text = await readFile(path, 'utf8');
  for (const id of text.match(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
  ) ?? [])
    excluded.add(id);
}
const windowIds = sql(
  `SELECT payload->'targetIds' FROM workspace_4jgxpoe06z2lp3cp2mjiatyec."_recruitingMatchRun" WHERE id='bf87e31f-0af5-5230-b33e-4bf5fda49412'`,
);
windowIds.forEach((id) => excluded.add(id));
excluded.add('926eee86-1b7f-5085-82a1-50f164e09124');
const inventory = sql(
  `SELECT json_agg(json_build_object('id',id,'files',"candidateResumes")) FROM workspace_4jgxpoe06z2lp3cp2mjiatyec.person WHERE "deletedAt" IS NULL AND 'CANDIDATE'=ANY("contactRoles")`,
);
const eligible = inventory.filter(
  (row) =>
    !excluded.has(row.id) && Array.isArray(row.files) && row.files.length > 0,
);
const seed = 'recruiting-rsi-v1-2026-11-01-before-labels';
eligible.sort((a, b) => hash(seed + a.id).localeCompare(hash(seed + b.id)));
const source = JSON.parse(
  await readFile(join(values.source, 'jev/inputs.json'), 'utf8'),
);
await mkdir(output, { recursive: true, mode: 0o700 });
let manifest;
try {
  manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  manifest = {
    version: 1,
    seed,
    frozenAt: new Date().toISOString(),
    codeCommit: spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).stdout.trim(),
    excludedCount: excluded.size,
    sampling:
      'candidate-level deterministic hash; original old30, 69 input-review cases and 8 window cases excluded; no label-based resampling',
    candidates: eligible
      .slice(0, 8)
      .map((row, index) => ({
        id: row.id,
        split: index < 4 ? 'development' : 'holdout',
      })),
    jobIds: source.jobs.map((job) => job.id),
    labelKind: 'independent-model-silver-not-human-gold',
    judgmentPlan:
      'Blind raw-material review of Jev top five plus two hash-selected controls per candidate; shuffled IDs; no scores or rank given to judge. This measures proposed-shortlist quality, not full-pool recall.',
  };
  await writeFile(
    join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600, flag: 'wx' },
  );
}
const environment = JSON.parse(
  await readFile('.local/recruiting/environment.json', 'utf8'),
);
/** Saves exact API-returned snapshots and the original bytes without logging labels, URLs or career data. */
for (const selected of manifest.candidates) {
  const directory = join(output, selected.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let profile;
  try {
    profile = JSON.parse(
      await readFile(join(directory, 'source.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await localRequest(`/rest/people/${selected.id}`);
    if (!response.ok)
      throw new Error(`Candidate source access failed: ${response.status}`);
    profile = (await response.json()).data.person;
    await writeFile(join(directory, 'source.json'), JSON.stringify(profile), {
      mode: 0o600,
    });
  }
  const materials = [];
  for (const file of profile.candidateResumes ?? []) {
    const saved = join(directory, `${file.fileId}.json`);
    try {
      materials.push(JSON.parse(await readFile(saved, 'utf8')));
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const url = new URL(file.url);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Refusing nonlocal source download');
    url.hostname = '127.0.0.1';
    url.port = '23001';
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`Source download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const requestId = randomUUID();
    const storageKey = `_recruiting-evaluation/${requestId}`;
    await mkdir(join('.local/recruiting/storage', '_recruiting-evaluation'), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(join('.local/recruiting/storage', storageKey), bytes, {
      mode: 0o600,
    });
    const parsed = await fetch('http://127.0.0.1:23003/parse', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${environment.RECRUITING_PARSER_TOKEN}`,
      },
      body: JSON.stringify({
        requestId,
        storageKey,
        originalName: `resume${extname(file.label)}`,
        sha256: hash(bytes),
      }),
      signal: AbortSignal.timeout(180000),
    });
    const result = {
      fileId: file.fileId,
      requestId,
      sourceHash: hash(bytes),
      bytes: bytes.length,
      httpStatus: parsed.status,
      ...(await parsed.json()),
    };
    await writeFile(saved, JSON.stringify(result), { mode: 0o600 });
    materials.push(result);
  }
  await writeFile(
    join(directory, 'materials.json'),
    JSON.stringify(materials),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      candidateId: selected.id,
      split: selected.split,
      materials: materials.length,
      pages: materials.reduce((sum, m) => sum + (m.pages ?? 0), 0),
      complete: materials.every((m) => m.status === 'complete'),
    }),
  );
}
console.log(
  JSON.stringify({
    frozenCandidates: manifest.candidates.length,
    jobs: manifest.jobIds.length,
    manifestHash: hash(await readFile(join(output, 'manifest.json'))),
  }),
);
