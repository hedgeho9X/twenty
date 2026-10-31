/** Evaluates the frozen local cohort against the exact real-job IDs and checkpoints task IDs before waiting. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { localRequest } from './local-api.mjs';

const directory = '.local/recruiting/evaluations/rsi-v1';
const bytes = await readFile(`${directory}/manifest.json`);
const manifest = JSON.parse(bytes);
const hash = createHash('sha256').update(bytes).digest('hex');
let submissions = [];
try {
  submissions = JSON.parse(
    await readFile(`${directory}/match-submissions.json`, 'utf8'),
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
/** Reuses deterministic keys after a crash; HTTP acceptance is never treated as a completed ranking. */
for (const candidate of manifest.candidates) {
  if (submissions.some((row) => row.candidateId === candidate.id)) continue;
  const response = await localRequest('/recruiting/match-runs', {
    method: 'POST',
    body: JSON.stringify({
      direction: 'CANDIDATE_TO_JOBS',
      subjectId: candidate.id,
      targetIds: manifest.jobIds,
      idempotencyKey: `rsi-v1:${hash}:${candidate.id}`,
    }),
  });
  if (!response.ok)
    throw new Error(`Frozen match submission failed: ${response.status}`);
  const receipt = await response.json();
  submissions.push({
    candidateId: candidate.id,
    split: candidate.split,
    runId: receipt.runId,
  });
  await writeFile(
    `${directory}/match-submissions.json`,
    JSON.stringify(submissions),
    { mode: 0o600 },
  );
}
/** Exports current native job/company context privately, independently from any judge labels. */
let jobs = {};
try {
  jobs = JSON.parse(await readFile(`${directory}/jobs.json`, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const companies = new Map(
  Object.values(jobs)
    .filter((value) => value.company?.id)
    .map((value) => [value.company.id, value.company]),
);
for (const id of manifest.jobIds) {
  if (jobs[id]) continue;
  const response = await localRequest(`/rest/recruitmentJobs/${id}`);
  if (!response.ok)
    throw new Error(`Frozen job access failed: ${response.status}`);
  const job = (await response.json()).data.recruitmentJob;
  let company;
  if (job.companyId) {
    company = companies.get(job.companyId);
    if (!company) {
      const response = await localRequest(
        `/recruiting/companies/${job.companyId}`,
      );
      if (!response.ok)
        throw new Error(`Company context access failed: ${response.status}`);
      company = await response.json();
      companies.set(job.companyId, company);
    }
  }
  jobs[id] = { job, company };
  await writeFile(`${directory}/jobs.json`, JSON.stringify(jobs), {
    mode: 0o600,
  });
}
for (let attempt = 0; attempt < 120; attempt++) {
  let pending = 0;
  for (const task of submissions) {
    if (task.done) continue;
    const response = await localRequest(`/recruiting/match-runs/${task.runId}`);
    if (!response.ok)
      throw new Error(`Frozen match read failed: ${response.status}`);
    const run = await response.json();
    await writeFile(
      `${directory}/${task.candidateId}/match.json`,
      JSON.stringify(run),
      { mode: 0o600 },
    );
    task.done = !['QUEUED', 'PROCESSING'].includes(run.status);
    if (task.done)
      console.log(
        JSON.stringify({
          candidateId: task.candidateId,
          split: task.split,
          status: run.status,
          complete: run.complete,
          counts: run.counts,
        }),
      );
    else pending++;
  }
  if (!pending) break;
  if (attempt === 119)
    throw new Error('Frozen tasks still pending; resume using the stored IDs');
  await new Promise((done) => setTimeout(done, 4000));
}
