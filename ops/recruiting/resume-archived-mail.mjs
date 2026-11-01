/** Resumes only local legacy mail archives without candidate tasks; apply is explicit and idempotent. */
import { localRequest } from './local-api.mjs';
import { writeFile } from 'node:fs/promises';

/** Uses the existing authorized recovery API rather than changing archive payloads directly. */
const candidates = [];
let offset = 0;
for (;;) {
  const response = await localRequest(
    `/recruiting/mail-archives?offset=${offset}`,
  );
  if (!response.ok)
    throw new Error(`Local archive listing failed: ${response.status}`);
  const page = await response.json();
  candidates.push(
    ...page.records.filter(
      (mail) =>
        mail.status === 'NEEDS_SELECTION' && mail.intakeIds.length === 0,
    ),
  );
  if (!page.hasNextPage) break;
  offset += page.records.length;
}
const result = {
  observedAt: new Date().toISOString(),
  apply: process.argv.includes('--apply'),
  eligible: candidates.length,
  accepted: [],
};
if (result.apply) {
  for (const mail of candidates) {
    const response = await localRequest(
      `/recruiting/mail-archives/${mail.archiveId}/retry`,
      { method: 'POST', body: '{}' },
    );
    if (!response.ok)
      throw new Error(`Local archive recovery failed: ${response.status}`);
    result.accepted.push({
      archiveId: mail.archiveId,
      status: (await response.json()).status,
    });
  }
  await writeFile(
    '.local/recruiting/legacy-mail-resume.json',
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
}
console.log(JSON.stringify(result, null, 2));
