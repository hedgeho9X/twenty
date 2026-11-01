/** Rechecks existing synthetic intake originals and parent isolation without uploads, retries or model calls. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { localRequest } from './local-api.mjs';

/** Keeps original contents private; only digests and response controls are recorded. */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mailId = '448f5f2c-fe82-5822-a6f7-d172c1f08920';
const jobId = '90dc69ca-da38-5693-8bbf-3a8d1fefc57a';
const evidence = { checkedAt: new Date().toISOString(), downloads: [] };
let resumeFile;
for (const intakeId of [mailId, jobId]) {
  const response = await localRequest(`/recruiting/resume-intakes/${intakeId}`);
  assert.equal(response.status, 200);
  const intake = await response.json();
  const file =
    intakeId === mailId
      ? intake.files.find((item) => /\.pdf$/i.test(item.label))
      : intake.files[0];
  assert.ok(file);
  assert.ok(
    intake.detail.input.files.some((item) => item.fileId === file.fileId),
  );
  const downloaded = await localRequest(
    `/recruiting/resume-intakes/${intakeId}/files/${file.fileId}`,
  );
  assert.equal(downloaded.status, 200);
  assert.equal(
    downloaded.headers.get('content-type'),
    'application/octet-stream',
  );
  assert.ok(
    downloaded.headers.get('content-disposition').startsWith('attachment;'),
  );
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  assert.ok(bytes.length > 0);
  if (intakeId === mailId) {
    const original = await readFile(
      '.local/recruiting/parser-regression-v2/scan-chinese.pdf',
    );
    assert.equal(sha256(bytes), sha256(original));
    resumeFile = file.fileId;
  }
  evidence.downloads.push({
    intakeId,
    fileId: file.fileId,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}
for (const fileId of [resumeFile, randomUUID()]) {
  const denied = await localRequest(
    `/recruiting/resume-intakes/${jobId}/files/${fileId}`,
  );
  assert.equal(denied.status, 404);
}
const anonymous = await fetch(
  `http://127.0.0.1:23001/recruiting/resume-intakes/${mailId}/files/${resumeFile}`,
  { redirect: 'error', signal: AbortSignal.timeout(10_000) },
);
assert.ok([401, 403].includes(anonymous.status));
evidence.crossParentDenied = true;
evidence.unknownFileDenied = true;
evidence.anonymousDenied = true;
evidence.anonymousStatus = anonymous.status;
evidence.archivedPdfBytesIdentical = true;
evidence.newUploads = 0;
evidence.newModelRequests = 0;
await writeFile(
  '.local/recruiting/intake-material-download-evidence.json',
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(evidence));
