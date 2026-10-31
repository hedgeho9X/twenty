/** Verifies scoped anonymous access and revocable sharing using only the existing local synthetic candidate. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { localRequest } from './local-api.mjs';

const candidateId = '926eee86-1b7f-5085-82a1-50f164e09124';
const jobId = '3aafb953-d524-5ee4-868e-6b246920adf1';
const run = Date.now().toString();
const checks = [];
/** Stores only statuses in logs; URLs and capabilities stay in private evidence. */
const checked = async (label, response, expected) => {
  checks.push({ label, status: response.status, expected });
  if (response.status !== expected) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `${label}: HTTP ${response.status}; ${error.message ?? ''}`,
    );
  }
  return response;
};
/** Uses the authenticated recruitment boundary only for operator actions. */
const create = async (kind, suffix, expected = 201) => {
  const response = await localRequest('/recruiting/portal-invites', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      candidateId,
      jobIds: [jobId],
      expiresInDays: 1,
      idempotencyKey: `portal-smoke:${run}:${suffix}`,
    }),
  });
  await checked(`create_${suffix}`, response, expected);
  return expected === 201 ? response.json() : undefined;
};
/** Sends no native cookie, Authorization header or token-bearing URL. */
const action = async (invite, value, expected = 201) => {
  const token = new URLSearchParams(new URL(invite.url).hash.slice(1)).get(
    'access',
  );
  return checked(
    value.action,
    await fetch('http://127.0.0.1:23001/recruiting-portal', {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...value }),
    }),
    expected,
  );
};

const candidate = await create('CANDIDATE', 'candidate');
const initial = await (await action(candidate, { action: 'view' })).json();
assert.equal(initial.kind, 'CANDIDATE');
assert.equal(JSON.stringify(initial).includes('uploadReceipt'), false);
assert.ok(initial.files.length > 0);
await action(candidate, { action: 'consent', jobId, choice: 'WITHDRAW' });
await create('COMPANY', 'before', 403);
await action(candidate, { action: 'intent', jobId, interested: true });
await action(candidate, {
  action: 'consent',
  jobId,
  choice: 'CONFIRM',
  fileIds: [initial.files[0].fileId],
});
const company = await create('COMPANY', 'company');
const shared = await (await action(company, { action: 'view' })).json();
assert.equal(shared.kind, 'COMPANY');
assert.equal(shared.files.length, 1);
await action(company, { action: 'download', fileId: shared.files[0].fileId });
await action(company, { action: 'profile_save', profile: {} }, 400);
await action(candidate, { action: 'consent', jobId, choice: 'WITHDRAW' });
await action(company, { action: 'view' }, 403);
await action(
  company,
  { action: 'download', fileId: shared.files[0].fileId },
  403,
);
await action(candidate, {
  action: 'consent',
  jobId,
  choice: 'CONFIRM',
  fileIds: [initial.files[0].fileId],
});
await action(company, { action: 'view' }, 403);
const renewed = await create('COMPANY', 'renewed');
await action(renewed, { action: 'view' });
const profile = {
  fullName: initial.profile.name,
  email: initial.profile.email,
  phone: initial.profile.phone,
  summary: '本地门户合成资料验收',
  skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
  expectedRoles: ['后端工程师'],
  employmentTypes: ['full_time'],
  strictEmployment: true,
  workModes: ['remote'],
  strictWorkMode: true,
  locations: [],
  note: '合成测试，无外部联系。',
};
await action(candidate, { action: 'profile_save', profile });
const viewed = await (await action(candidate, { action: 'view' })).json();
assert.deepEqual(viewed.selfProfile, profile);
const bytes = Buffer.from(
  '合成候选人\n求职意向：后端工程师，全职远程。\n2024-2026：TypeScript、Node.js API、PostgreSQL索引与事务优化，BullMQ队列和自动化测试。\n计算机科学本科。',
);
const target = await (
  await action(candidate, {
    action: 'upload_target',
    filename: 'synthetic-portal-resume.txt',
    size: bytes.length,
  })
).json();
assert.equal('uploadReceipt' in target, false);
const uploadUrl = new URL(target.uploadUrl);
assert.ok(['localhost', '127.0.0.1'].includes(uploadUrl.hostname));
uploadUrl.hostname = '127.0.0.1';
uploadUrl.port = '23001';
await checked(
  'native_upload',
  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': target.contentType },
    body: bytes,
    redirect: 'error',
  }),
  204,
);
await action(candidate, { action: 'upload_complete', fileId: target.fileId });
const submission = {
  action: 'resume_submit',
  fileIds: [target.fileId],
  note: '合成门户上传：后端工程师，全职远程。',
  idempotencyKey: `upload:${run}`,
};
const intake = await (await action(candidate, submission)).json();
const repeated = await (await action(candidate, submission)).json();
assert.equal(intake.intakeId, repeated.intakeId);
await action(candidate, {
  action: 'intake_progress',
  intakeId: intake.intakeId,
});
await checked(
  'revoke',
  await localRequest(
    `/recruiting/portal-invites/${candidate.inviteId}/revoke`,
    { method: 'POST' },
  ),
  201,
);
await action(renewed, { action: 'view' }, 403);
await action(candidate, { action: 'view' }, 403);
await checked(
  'invalid',
  await fetch('http://127.0.0.1:23001/recruiting-portal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'invalid', action: 'view' }),
  }),
  403,
);
await writeFile(
  '.local/recruiting/portal-http-smoke.json',
  JSON.stringify({ candidate, company, renewed, intake, checks }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    checks,
    inviteId: candidate.inviteId,
    intakeId: intake.intakeId,
  }),
);
