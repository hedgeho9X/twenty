/** Runs synthetic SMTP -> native IMAP timer -> archive -> intake -> matching, then verifies duplicate delivery. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { v5 } from 'uuid';
import { ensureLocalMailAccount } from './local-mail-account.mjs';
import { localRequest } from './local-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = join(root, '.local/recruiting/mail-test');
const statePath = join(directory, 'reception-state-v1.json');
const reportPath = join(directory, 'reception-evidence-v1.json');
const workspaceId = '4cb349cd-5765-4826-a2cb-73e5c5c2d564';
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
let existing;
try {
  existing = JSON.parse(await readFile(statePath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
assert.ok(process.argv.slice(2).every((value) => value === '--new-case'));
if (existing && !process.argv.includes('--new-case')) {
  assert.equal(
    existing.phase,
    'VERIFIED',
    'Inspect the saved native task IDs before retrying an incomplete scenario',
  );
  const archiveResponse = await localRequest(
    `/recruiting/mail-archives/${existing.archiveId}`,
  );
  assert.equal(archiveResponse.status, 200);
  const archive = await archiveResponse.json();
  assert.deepEqual(archive.intakeIds, [existing.intakeId]);
  const intakeResponse = await localRequest(
    `/recruiting/resume-intakes/${existing.intakeId}`,
  );
  assert.equal(intakeResponse.status, 200);
  assert.equal((await intakeResponse.json()).state, 'COMPLETED');
  const matchResponse = await localRequest(
    `/recruiting/match-runs/${existing.matchingRunId}`,
  );
  assert.equal(matchResponse.status, 200);
  assert.equal(
    (await matchResponse.json()).complete,
    true,
    'Existing evidence is stale; do not report a fresh execution',
  );
  console.log(
    JSON.stringify({
      mode: 'verify-existing',
      archiveId: existing.archiveId,
      intakeId: existing.intakeId,
      nativeTasksStillValid: true,
      newDeliveries: 0,
      newModelRequests: 0,
    }),
  );
  process.exit(0);
}
if (existing) {
  await mkdir(join(directory, 'history'), { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, 'history', `${existing.runId}.json`),
    JSON.stringify(existing, null, 2),
    { mode: 0o600, flag: 'wx' },
  );
}
const account = await ensureLocalMailAccount();
const runId = randomUUID();
const runDirectory = join(directory, 'runs', runId);
await mkdir(runDirectory, { recursive: true, mode: 0o700 });
const state = {
  runId,
  startedAt: new Date().toISOString(),
  connectedAccountId: account.connectedAccountId,
  oldMessageId: `<local-old-${runId}@recruiting.local.invalid>`,
  newMessageId: `<local-resume-${runId}@recruiting.local.invalid>`,
  pdfPath: join(
    root,
    '.local/recruiting/parser-regression-v2/scan-chinese.pdf',
  ),
  serverRawPath: join(runDirectory, 'received-original.eml'),
  phase: 'PREFLIGHT',
};

/** Stores recoverable native task IDs and aggregate assertions; passwords and MIME bodies stay out of reports. */
const save = () =>
  writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });

/** The independent Python client receives credentials through stdin and is restricted to fixed loopback ports. */
const protocol = (action) => {
  const result = spawnSync(
    'python3',
    [join(root, 'ops/recruiting/mail-test-protocol.py'), action],
    {
      input: JSON.stringify({ account, state }),
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  if (result.status !== 0) throw new Error(`Local protocol ${action} failed`);
  return JSON.parse(result.stdout);
};

/** Calls only local-B recruiting APIs and allows cleanup after an interrupted observation. */
const request = async (path, body, cleanup = false) => {
  const response = await localRequest(`/recruiting/${path}`, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: cleanup
      ? AbortSignal.timeout(20_000)
      : AbortSignal.any([stop.signal, AbortSignal.timeout(20_000)]),
  });
  assert.ok(response.ok, `Local ${path.split('/')[0]} HTTP ${response.status}`);
  return response.json();
};

/** Waits for the exact native resource; transient absence never resubmits a mail or restarts a worker. */
const waitFor = async (label, read, ready, seconds = 240) => {
  const deadline = Date.now() + seconds * 1000;
  let announced = 0;
  while (Date.now() < deadline && !stop.signal.aborted) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() - announced > 30_000) {
      console.log(JSON.stringify({ phase: state.phase, waitingFor: label }));
      announced = Date.now();
    }
    await delay(3000, undefined, { signal: stop.signal });
  }
  throw new Error(`Local ${label} did not reach its expected state`);
};

let configured = false;
try {
  await request('mailboxes/configure', {
    connectedAccountId: account.connectedAccountId,
    enabled: false,
    autoSubmit: true,
  });
  state.oldSeed = protocol('seed-old');
  state.phase = 'BASELINE_READY';
  await save();
  await request('mailboxes/configure', {
    connectedAccountId: account.connectedAccountId,
    enabled: true,
    autoSubmit: true,
  });
  configured = true;
  state.delivery = protocol('send-new');
  assert.equal(state.delivery.seen, false);
  state.archiveId = v5(
    `${workspaceId}:mail:${state.delivery.rawSha256}`,
    v5.URL,
  );
  state.phase = 'WAITING_NATIVE_TIMER';
  await save();
  const archive = await waitFor(
    'mail archive',
    async () => {
      const response = await localRequest(
        `/recruiting/mail-archives/${state.archiveId}`,
      );
      if (response.status === 404) return undefined;
      assert.equal(response.status, 200);
      return response.json();
    },
    (value) =>
      value && ['READY', 'NEEDS_SELECTION', 'FAILED'].includes(value.status),
  );
  assert.equal(archive.status, 'READY');
  assert.equal(archive.intakeIds.length, 1);
  assert.equal(archive.artifactCount, 6);
  const source = archive.detail.sources.find(
    (row) => row.connectedAccountId === account.connectedAccountId,
  );
  assert.equal(source.transport, 'IMAP');
  assert.ok(source.uid > Math.max(...state.oldSeed.uids));
  state.firstSourceUid = source.uid;
  const kinds = archive.detail.artifacts.map((item) => item.kind);
  assert.ok(
    ['raw', 'metadata', 'text', 'html'].every((kind) => kinds.includes(kind)),
  );
  assert.equal(
    archive.detail.artifacts.filter((item) => item.kind === 'attachment')
      .length,
    2,
  );
  const original = archive.detail.artifacts.find((item) => item.kind === 'raw');
  const bytes = await localRequest(original.downloadPath);
  assert.equal(bytes.status, 200);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await bytes.arrayBuffer()))
      .digest('hex'),
    state.delivery.rawSha256,
  );
  const body = archive.detail.artifacts.find((item) => item.kind === 'text');
  const bodyResponse = await localRequest(body.downloadPath);
  assert.equal(bodyResponse.status, 200);
  assert.ok((await bodyResponse.text()).includes('ORIGINAL_QUOTED_BLOCK'));
  state.intakeId = archive.intakeIds[0];
  state.phase = 'WAITING_INTAKE';
  await save();
  const intake = await waitFor(
    'candidate intake',
    () => request(`resume-intakes/${state.intakeId}`),
    (value) => ['COMPLETED', 'NEEDS_REVIEW'].includes(value.state),
  );
  assert.equal(intake.state, 'COMPLETED');
  assert.equal(intake.stage, 'STORED');
  assert.ok(intake.recordUrl?.startsWith('/object/person/'));
  state.candidateUrl = intake.recordUrl;
  state.materialPages = intake.detail.materials
    .filter((item) => item.pages)
    .map((item) => item.pages);
  assert.deepEqual(state.materialPages, [2]);
  state.expectedRoles = intake.detail.extraction.profile.expectedRoles;
  assert.ok(state.expectedRoles.length > 0);
  assert.equal(intake.matchingRunIds.length, 1);
  state.matchingRunId = intake.matchingRunIds[0];
  state.phase = 'WAITING_MATCHING';
  await save();
  const matching = await waitFor(
    'matching',
    () => request(`match-runs/${state.matchingRunId}`),
    (value) => !['QUEUED', 'PROCESSING'].includes(value.status),
  );
  assert.equal(matching.complete, true);
  assert.equal(matching.counts.total, 46);
  assert.equal(matching.counts.failed, 0);
  state.matching = {
    status: matching.status,
    complete: matching.complete,
    counts: matching.counts,
    topCount: matching.top.length,
  };
  state.phase = 'DUPLICATE_DELIVERY';
  const copies = protocol('append-copy');
  state.duplicateUids = copies.uids;
  await save();
  const repeated = await waitFor(
    'duplicate IMAP alias',
    () => request(`mail-archives/${state.archiveId}`),
    (value) =>
      value.detail.sources.filter(
        (row) => row.connectedAccountId === account.connectedAccountId,
      ).length === 2,
  );
  assert.deepEqual(repeated.intakeIds, archive.intakeIds);
  assert.equal(repeated.artifactCount, archive.artifactCount);
  const finalIntake = await request(`resume-intakes/${state.intakeId}`);
  assert.deepEqual(finalIntake.matchingRunIds, intake.matchingRunIds);
  const finalFlags = protocol('snapshot');
  assert.equal(finalFlags.seen, false);
  assert.equal(finalFlags.rawSha256, state.delivery.rawSha256);
  const all = await request('mail-archives');
  let oldArchived = false;
  for (const row of all.records) {
    const detail = await request(`mail-archives/${row.archiveId}`);
    if (
      detail.detail.sources.some(
        (entry) =>
          entry.connectedAccountId === account.connectedAccountId &&
          state.oldSeed.uids.includes(entry.uid),
      )
    )
      oldArchived = true;
  }
  assert.equal(oldArchived, false);
  state.checks = {
    smtpDelivered: true,
    nativeTimerReceived: true,
    completeRawHash: true,
    bodyHistoryPreserved: true,
    sixArtifactsPreserved: true,
    oldMailNotReplayed: !oldArchived,
    candidateStored: true,
    matchingComplete: true,
    duplicateArchiveReused: true,
    duplicateIntakeReused: true,
    duplicateMatchingReused: true,
    seenFlagPreserved: true,
  };
  state.phase = 'VERIFIED';
} catch (error) {
  state.phase = 'FAILED';
  state.failure = error.message;
  throw error;
} finally {
  if (configured) {
    state.captureDisabled = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await request(
          'mailboxes/configure',
          {
            connectedAccountId: account.connectedAccountId,
            enabled: false,
            autoSubmit: true,
          },
          true,
        );
        const settings = await request('mailboxes', undefined, true);
        state.captureDisabled =
          settings.connections.find(
            (row) => row.connectedAccountId === account.connectedAccountId,
          )?.enabled === false;
        assert.equal(state.captureDisabled, true);
        break;
      } catch {
        if (attempt < 19) await delay(2000);
      }
    }
  }
  state.verifiedAt = new Date().toISOString();
  await save();
  await writeFile(reportPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      phase: state.phase,
      archiveId: state.archiveId,
      intakeId: state.intakeId,
      matching: state.matching,
      checks: state.checks,
      captureDisabled: state.captureDisabled,
    }),
  );
}
assert.equal(state.captureDisabled, true);
