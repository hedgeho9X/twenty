/** Replays private legacy JD text through local intake APIs; never restores legacy generated profiles or touches production. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { localRequest } from './local-api.mjs';

const sourcePath = resolve(
  process.argv.slice(2).find((value) => !value.startsWith('--')) ??
    '.local/recruiting/job-reimport/source.json',
);
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const manifestPath = join(dirname(sourcePath), 'manifest.json');
const sourceHash = createHash('sha256')
  .update(await readFile(sourcePath))
  .digest('hex');
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
manifest ??= {
  sourceHash,
  companies: {},
  jobs: {},
  rejected: [],
  startedAt: new Date().toISOString(),
};
if (manifest.sourceHash !== sourceHash)
  throw Error('Source snapshot changed; use a separate manifest');

/** Extracts BlockNote text without executing markup; Markdown remains the preferred original representation. */
const blockText = (value) => {
  if (!value) return '';
  if (typeof value === 'string') {
    try {
      return blockText(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value))
    return value.map(blockText).filter(Boolean).join('\n');
  if (typeof value === 'object')
    return [
      typeof value.text === 'string' ? value.text : '',
      blockText(value.content),
      blockText(value.children),
    ]
      .filter(Boolean)
      .join('\n');
  return '';
};
const textField = (row, prefix) =>
  row[`${prefix}Markdown`]?.trim() || blockText(row[`${prefix}Blocknote`]);
const companyById = new Map(source.companies.map((row) => [row.id, row]));
const ready = [];
manifest.rejected = [];
for (const job of source.jobs) {
  if (job.jobStatus !== 'RECRUITING') continue;
  const reason =
    !job.companyId || !companyById.has(job.companyId)
      ? 'missing_company'
      : !textField(job, 'jobDescription')
        ? 'missing_jd'
        : !job.name
          ? 'missing_title'
          : null;
  if (reason)
    manifest.rejected.push({ sourceId: job.id, title: job.name, reason });
  else ready.push(job);
}
const summary = () => ({
  sourceJobs: source.jobs.filter((job) => job.jobStatus === 'RECRUITING')
    .length,
  skippedInactive: source.jobs.filter((job) => job.jobStatus !== 'RECRUITING')
    .length,
  ready: ready.length,
  rejected: manifest.rejected.length,
  submitted: Object.keys(manifest.jobs).length,
  completed: Object.values(manifest.jobs).filter((x) => x.state === 'COMPLETED')
    .length,
  failed: Object.values(manifest.jobs).filter(
    (x) => x.state === 'FAILED' || x.state === 'NEEDS_REVIEW',
  ).length,
  createdJobs: Object.values(manifest.jobs).reduce(
    (n, x) => n + (x.jobIds?.length ?? 0),
    0,
  ),
});
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify(summary()));
  process.exit(0);
}
/** Atomic private checkpoints make interrupted API submissions resumable with the same idempotency keys. */
const save = async () => {
  await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
  await rename(`${manifestPath}.tmp`, manifestPath);
};
const request = async (path, body, method = body ? 'POST' : 'GET') => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await localRequest(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 429) {
      await new Promise((done) =>
        setTimeout(done, Math.min(1000 * 2 ** attempt, 15000)),
      );
      continue;
    }
    const data = await response.json();
    if (!response.ok)
      throw Error(
        `${method} ${path}: ${response.status} ${JSON.stringify(data.message ?? '')}`,
      );
    return data;
  }
  throw Error('Local API speed limit did not recover');
};
await save();
for (const sourceId of new Set(ready.map((job) => job.companyId))) {
  if (manifest.companies[sourceId]) continue;
  const company = companyById.get(sourceId);
  const candidates = await request(
    `/recruiting/companies?search=${encodeURIComponent(company.name)}`,
  );
  const exact = candidates.records.filter((row) => row.name === company.name);
  if (exact.length > 1) throw Error(`Ambiguous company for source ${sourceId}`);
  const created =
    exact[0] ??
    (await request('/recruiting/companies', {
      name: company.name,
      ...(company.domainNamePrimaryLinkUrl
        ? { domain: company.domainNamePrimaryLinkUrl }
        : {}),
      recruitmentPreferences: textField(company, 'recruitmentPreferences'),
    }));
  if (!created.id) throw Error('Company response has no id');
  manifest.companies[sourceId] = created.id;
  await save();
}
for (const job of ready) {
  if (manifest.jobs[job.id]) continue;
  const text = [
    `岗位名称：${job.name}`,
    textField(job, 'jobDescription'),
    textField(job, 'jobRecruitmentPreferences')
      ? `岗位招聘偏好：\n${textField(job, 'jobRecruitmentPreferences')}`
      : '',
    textField(job, 'companyRecruitmentPreferences')
      ? `原岗位保存的公司招聘偏好：\n${textField(job, 'companyRecruitmentPreferences')}`
      : '',
    job.jobAttributes ? `原始岗位属性：${job.jobAttributes}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const result = await request('/recruiting/job-intakes', {
    companyId: manifest.companies[job.companyId],
    text,
    source: 'api',
    sourceId: `legacy-job:${job.id}`,
    idempotencyKey: `legacy-reparse:${basename(dirname(sourcePath))}:${sourceHash}:${job.id}`,
  });
  manifest.jobs[job.id] = {
    intakeId: result.intakeId,
    state: result.state,
    sourceStatus: job.jobStatus,
  };
  await save();
}
console.log(JSON.stringify(summary()));
const deadline = Date.now() + 45 * 60_000;
while (Date.now() < deadline) {
  let pending = 0;
  for (const [sourceId, item] of Object.entries(manifest.jobs)) {
    if (['COMPLETED', 'FAILED', 'NEEDS_REVIEW'].includes(item.state)) continue;
    const result = await request(`/recruiting/resume-intakes/${item.intakeId}`);
    if (['FAILED', 'NEEDS_REVIEW'].includes(result.state)) {
      item.state = result.state;
      item.error = result.error ?? result.stage;
      await save();
      continue;
    }
    if (result.state === 'COMPLETED') {
      const jobIds = (result.items ?? [])
        .filter((row) => row.status === 'CREATED')
        .map((row) => row.jobId);
      if (!jobIds.length)
        throw Error(`Completed intake without jobs: ${item.intakeId}`);
      for (const jobId of jobIds)
        await request(
          `/rest/recruitmentJobs/${jobId}`,
          {
            legacySource: {
              source: 'legacy-reparse',
              originalJobId: sourceId,
              originalCompanyId: source.jobs.find((job) => job.id === sourceId)
                .companyId,
            },
          },
          'PATCH',
        );
      item.jobIds = jobIds;
      item.state = 'COMPLETED';
      await save();
    } else pending++;
  }
  console.log(JSON.stringify(summary()));
  if (!pending) {
    manifest.finishedAt = new Date().toISOString();
    await save();
    break;
  }
  await new Promise((done) => setTimeout(done, 10_000));
}

if (!manifest.finishedAt)
  throw new Error(
    'Import still pending; resume with the same source and manifest',
  );
if (summary().failed) process.exitCode = 2;
