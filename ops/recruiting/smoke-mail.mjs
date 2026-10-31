/** Exercises only local-B synthetic EML archiving and intake; it does not connect a mailbox or send email. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { localRequest } from './local-api.mjs';

const candidateId = '926eee86-1b7f-5085-82a1-50f164e09124';
const directory = '.local/recruiting/fixtures';
const body =
  '我在申请后端工程师岗位，希望全职远程，主要经验是TypeScript、Node.js和PostgreSQL。\n> 以前的邮件引用也必须完整保留。';
const cv =
  '本地邮件验收候选人（合成）\n求职意向：后端工程师，全职远程。\n2024-2026：负责TypeScript和Node.js API开发、PostgreSQL索引及事务优化、BullMQ异步队列和自动化测试。\n教育：计算机科学本科。\n';
const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
const raw = Buffer.from(
  [
    'Message-ID: <local-full-mail-smoke-v1@example.test>',
    'From: Synthetic Candidate <candidate@example.test>',
    'To: recruiting@example.test',
    'Date: Sun, 1 Nov 2026 04:30:00 +0800',
    'Subject: [Synthetic local] Resume intake',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    '--outer',
    'Content-Type: multipart/alternative; boundary="body"',
    '',
    '--body',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64'),
    '--body',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(
      '<p>完整自我介绍与求职意向</p><img src="cid:logo"><blockquote>保留的历史引用</blockquote>',
    ).toString('base64'),
    '--body--',
    '--outer',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Disposition: attachment; filename="synthetic-resume.txt"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(cv).toString('base64'),
    '--outer',
    'Content-Type: image/png',
    'Content-Disposition: inline; filename="logo.png"',
    'Content-ID: <logo>',
    'Content-Transfer-Encoding: base64',
    '',
    image,
    '--outer--',
    '',
  ].join('\r\n'),
);

/** Waits on persistent archive state and never treats HTTP202 as success. */
const waitArchive = async (id) => {
  for (let index = 0; index < 60; index++) {
    const response = await localRequest(`/recruiting/mail-archives/${id}`);
    const value = await response.json();
    if (value.status === 'FAILED') throw new Error('Archive expansion failed');
    if (['READY', 'NEEDS_SELECTION'].includes(value.status)) return value;
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error('Archive still processing; query its ID again');
};

/** Reuses exact original bytes so reruns verify archive-level deduplication before file allocation. */
const upload = async () => {
  const form = new FormData();
  form.append('file', new Blob([raw]), 'synthetic-full-mail.eml');
  const response = await localRequest('/recruiting/mail-archives/upload', {
    method: 'POST',
    body: form,
  });
  if (!response.ok)
    throw new Error(`Archive upload failed (${response.status})`);
  return response.json();
};

await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(`${directory}/synthetic-full-mail.eml`, raw, { mode: 0o600 });
const receipt = await upload();
const repeated = await upload();
if (receipt.archiveId !== repeated.archiveId)
  throw new Error('Archive idempotency failed');
const archive = await waitArchive(receipt.archiveId);
const checks = [];
for (const file of archive.detail.artifacts) {
  const response = await localRequest(
    `/recruiting/mail-archives/${receipt.archiveId}/artifacts/${encodeURIComponent(file.key)}`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  checks.push({
    kind: file.kind,
    inline: file.inline,
    hashMatches:
      createHash('sha256').update(bytes).digest('hex') === file.sha256,
    status: response.status,
  });
}
if (checks.some((check) => !check.hashMatches || check.status !== 200))
  throw new Error('MIME artifact hash mismatch');
const selected = archive.detail.artifacts.find((file) => file.suggestedResume);

/** Selection uses the same shared intake contract and explicit existing fixture target. */
const submit = async () => {
  const response = await localRequest(
    `/recruiting/mail-archives/${receipt.archiveId}/intakes`,
    {
      method: 'POST',
      body: JSON.stringify({
        artifactKeys: [selected.key],
        candidateId,
        note: '合成邮件端到端验收：将完整自我介绍作为材料保留。',
      }),
    },
  );
  if (!response.ok) throw new Error(`Mail intake failed (${response.status})`);
  return response.json();
};
const intake = await submit();
const again = await submit();
if (again.intakeId !== intake.intakeId)
  throw new Error('Business idempotency failed');
const report = {
  archiveId: receipt.archiveId,
  intakeId: intake.intakeId,
  checks,
  archive,
};
await writeFile(
  '.local/recruiting/mail-archive-smoke.json',
  JSON.stringify(report),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    archiveId: receipt.archiveId,
    intakeId: intake.intakeId,
    artifactCount: checks.length,
    allHashesMatch: checks.every((check) => check.hashMatches),
    inlineArchived: checks.some((check) => check.inline),
    duplicateSameIntake: true,
  }),
);
