/** Verifies one existing synthetic preview over HTTP/MCP/CLI without extraction, confirmation or model calls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v5 } from 'uuid';
import { localRequest } from './local-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = join(root, '.local/recruiting');
const intakeId = '3b102eea-cf1a-5e4b-8e70-b6e7f5088c2f';
const companyId = '260965cf-a6a7-4c23-aa53-e8b288e2244a';
const fixtureId = v5(
  '4cb349cd-5765-4826-a2cb-73e5c5c2d564:preview-name-fixture-v1',
  v5.URL,
);

/** Keeps response bodies private while checking native HTTP status before use. */
const json = async (path, options = {}) => {
  const response = await localRequest(path, options);
  assert.ok(response.ok, `Local HTTP ${response.status}`);
  return response.json();
};

/** Preview annotations are derived; source and extraction state must stay unchanged across reads. */
const materialVersion = (preview) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        input: preview.detail.input,
        extraction: preview.detail.extraction,
        inputHash: preview.detail.inputHash,
        state: preview.state,
        stage: preview.stage,
        items: preview.detail.jobItems.map(
          ({ itemId, jobId, draft, status }) => ({
            itemId,
            jobId,
            draft,
            status,
          }),
        ),
      }),
    )
    .digest('hex');

const before = await json(`/recruiting/resume-intakes/${intakeId}`);
assert.equal(before.detail.input.companyId, companyId);
assert.equal(before.batchId, intakeId);
const item = before.detail.jobItems.find((row) => row.status === 'DRAFT');
assert.ok(item);
const existing = await localRequest(`/rest/recruitmentJobs/${fixtureId}`);
if (existing.status === 404) {
  const created = await localRequest('/rest/recruitmentJobs', {
    method: 'POST',
    body: JSON.stringify({
      id: fixtureId,
      name: item.draft.title,
      companyId,
      jobStatus: 'CLOSED',
      jobDescription: {
        markdown:
          'Synthetic preview-name-only fixture; not used for recruitment.',
      },
    }),
  });
  assert.ok(created.ok);
} else assert.equal(existing.status, 200);
const fixture = (await json(`/rest/recruitmentJobs/${fixtureId}`)).data
  .recruitmentJob;
assert.equal(fixture.companyId, companyId);
assert.equal(fixture.jobStatus, 'CLOSED');
assert.equal(fixture.name, item.draft.title);

/** Both clients must receive the same stable identity, original source and current visible-name annotation. */
const check = (preview) => {
  assert.equal(preview.intakeId, intakeId);
  assert.equal(preview.batchId, intakeId);
  assert.equal(preview.detail.previewSources.attribution, 'BATCH');
  assert.equal(preview.detail.previewSources.hasText, true);
  assert.equal(preview.detail.duplicateCheck.status, 'COMPLETE');
  assert.ok(
    preview.detail.jobItems
      .find((row) => row.itemId === item.itemId)
      .nameWarnings.some(
        (warning) =>
          warning.source === 'EXISTING' &&
          warning.id === fixtureId &&
          warning.status === 'CLOSED',
      ),
  );
  assert.equal(materialVersion(preview), materialVersion(before));
};
const http = await json(`/recruiting/resume-intakes/${intakeId}`);
check(http);
const keys = JSON.parse(
  await readFile(join(directory, 'agent-integration-keys.json'), 'utf8'),
);
const token = keys[0].token;
assert.ok(token);
const response = await fetch('http://127.0.0.1:23001/mcp?mode=direct', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'recruiting_operations',
      arguments: { operation: 'task_get', kind: 'intake', taskId: intakeId },
    },
  }),
  signal: AbortSignal.timeout(30_000),
});
assert.equal(response.status, 200);
const raw = await response.text();
const rpc = JSON.parse(
  raw.trim().startsWith('{')
    ? raw
    : raw
        .split('\n')
        .find((line) => line.startsWith('data:'))
        .slice(5),
);
assert.ok(!rpc.error && !rpc.result.isError);
const tool =
  rpc.result.structuredContent ??
  JSON.parse(rpc.result.content.find((entry) => entry.type === 'text').text);
assert.equal(tool.success, true);
check(tool.result);
const cli = spawnSync(
  process.execPath,
  [
    'ops/recruiting/cli.mjs',
    'task',
    'get',
    '--kind',
    'intake',
    '--id',
    intakeId,
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TWENTY_API_KEY: token,
      TWENTY_BASE_URL: 'http://127.0.0.1:23001',
    },
  },
);
assert.equal(cli.status, 0);
check(JSON.parse(cli.stdout));
const evidence = {
  checkedAt: new Date().toISOString(),
  intakeId,
  itemId: item.itemId,
  fixtureId,
  fixtureStatus: 'CLOSED',
  batchIdentityStable: true,
  sourcePreserved: true,
  storedMaterialUnchanged: true,
  nameHintOnHttp: true,
  nameHintOnMcp: true,
  nameHintOnCli: true,
  extractionRequested: false,
  matchingRequested: false,
};
await writeFile(
  join(directory, 'job-preview-native-evidence.json'),
  JSON.stringify(evidence),
  { mode: 0o600 },
);
console.log(JSON.stringify(evidence));
