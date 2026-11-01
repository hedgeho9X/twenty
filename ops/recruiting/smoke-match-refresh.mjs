/** 验证本地全池重试与未查看恢复；仅使用身份冲突合成候选人，评分前必须停止于待核对状态。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v5 } from 'uuid';
import { localRequest } from './local-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const serverDirectory = join(root, 'packages/twenty-server');
const privateDirectory = join(root, '.local/recruiting');
const workspaceId = '4cb349cd-5765-4826-a2cb-73e5c5c2d564';
const companyId = '260965cf-a6a7-4c23-aa53-e8b288e2244a';
const candidateId = v5(`${workspaceId}:native-cas-fixture-v1`, v5.URL);
const jobId = v5(`${workspaceId}:match-refresh-job-fixture-v1`, v5.URL);
const jobName = '合成匹配刷新验收岗位（不用于招聘）';
const jobMarker = 'Synthetic match-refresh-only fixture';
const evidencePath = join(privateDirectory, 'match-refresh-native-evidence.json');
const environment = JSON.parse(
  await readFile(join(privateDirectory, 'environment.json'), 'utf8'),
);
const database = new URL(environment.PG_DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '25432');
assert.equal(database.pathname, '/recruiting');
Object.assign(process.env, environment, {
  RECRUITING_AUTO_MATCH_ENABLED: 'false',
  DISABLE_CRON_JOBS_REGISTRATION: 'true',
  DISABLE_WORKSPACE_CRON_JOBS_REGISTRATION: 'true',
  WORKER_ENABLED_QUEUES: 'recruiting-test-disabled',
});
const require = createRequire(join(serverDirectory, 'package.json'));
// 原生实体发现依赖 server cwd；该上下文不启动 worker 或 cron。
process.chdir(serverDirectory);
assert.equal(process.cwd(), serverDirectory);
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { NotFoundException } = require('@nestjs/common');
const { AppModule } = require('./dist/app.module.js');
const load = (file, name) =>
  require(`./dist/modules/recruiting/${file}.js`)[name];
const Actors = load('auth/actor.service', 'RecruitingActorService');
const Records = load('records/records.service', 'RecruitingRecordsService');
const { buildCandidateMatchContext } = require(
  './dist/modules/recruiting/matching/domain/match-context.js',
);
const { MetadataEventEmitter } = require(
  './dist/engine/subscriptions/metadata-event/metadata-event-emitter.js',
);

/** 只返回固定本地路由的 JSON，错误不打印响应正文或身份凭据。 */
const requestJson = async (path, options = {}, expectedStatus = 200) => {
  const response = await localRequest(path, options);
  assert.equal(response.status, expectedStatus, `本地请求失败：${path}`);
  return response.json();
};

/** 终态后仍逐项核对覆盖，不能用 PARTIAL 冒充评分完整。 */
const waitForRun = async (runId) => {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const run = await requestJson(`/recruiting/match-runs/${runId}`);
    if (!['QUEUED', 'PROCESSING'].includes(run.status)) return run;
    await new Promise((done) => setTimeout(done, 5000));
  }
  throw new Error('本地匹配任务未在五分钟内进入终态');
};

/** 身份冲突必须在模型调用前阻断；不接受任何已评分、失败或缺失的组合。 */
const assertReviewCoverage = (run, total) => {
  assert.equal(run.status, 'PARTIAL');
  assert.equal(run.counts.total, total);
  assert.equal(run.counts.processed, total);
  assert.equal(run.counts.needsReview, total);
  assert.equal(run.counts.scored, 0);
  assert.equal(run.counts.failed, 0);
  assert.equal(run.counts.excluded, 0);
  assert.equal(run.counts.unavailable, 0);
  assert.equal(run.counts.pending, 0);
  assert.equal(run.results.length, total);
  assert.ok(run.results.every((pair) => pair.status === 'NEEDS_REVIEW'));
  assert.ok(run.results.every((pair) => pair.score === undefined));
  assert.equal(run.stale, 0);
  assert.equal(run.inaccessible, 0);
  assert.equal(run.poolChanged, false);
  assert.equal(run.currentPoolCount, total);
  assert.equal(run.complete, false);
  assert.equal(run.top.length, 0);
};

const source = await requestJson(
  '/recruiting/resume-intakes/ad90cc91-5efe-5b9b-9c43-b4fd49f70656',
);
const actor = source.detail.actor;
assert.equal(actor.workspaceId, workspaceId);
assert.ok(
  actor.userWorkspaceId &&
    !actor.apiKeyId &&
    !actor.applicationId &&
    !actor.viaApplicationId &&
    !actor.agentId,
  '验收必须绑定现有直接本人会话',
);
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const records = app.get(Records);
  const context = await app.get(Actors).resolve(actor);
  /** 每次排队前确认同一固定合成资料仍会在 Jev 调用前被拒绝评分。 */
  const assertNoPaidEvaluation = async () => {
    const candidate = await records.one(context, 'person', candidateId);
    assert.ok(
      candidate.recruitingProfile?.sourceText?.includes(
        'Synthetic CAS-only fixture',
      ),
      '只允许使用固定的合成 CAS 候选人',
    );
    assert.equal(candidate.recruitingProfile?.identityConflict, true);
    assert.equal(candidate.recruitingProfile?.needsReview, true);
    assert.ok(candidate.contactRoles?.includes('CANDIDATE'));
    assert.equal(
      buildCandidateMatchContext(candidate).issue,
      '候选人材料存在身份冲突',
      '缺少模型前置阻断条件，拒绝运行验收',
    );
  };
  await assertNoPaidEvaluation();
  await records.one(context, 'company', companyId);
  const fixture = {
    name: jobName,
    companyId,
    jobStatus: 'CLOSED',
    jobDescription: {
      markdown: `${jobMarker}\n合成服务层回归资料，不对应真实招聘需求。`,
      blocknote: null,
    },
    recruitingProfile: {
      description: jobMarker,
      employmentTypes: [],
      workModes: [],
      locations: [],
    },
  };
  let existing;
  try {
    existing = await records.one(context, 'recruitmentJob', jobId);
  } catch (error) {
    if (!(error instanceof NotFoundException)) throw error;
  }
  if (existing) {
    assert.equal(existing.name, jobName);
    assert.equal(existing.companyId, companyId);
    assert.equal(existing.recruitingProfile?.description, jobMarker);
    await records.update(context, 'recruitmentJob', jobId, fixture);
  } else {
    await records.create(context, 'recruitmentJob', { id: jobId, ...fixture });
  }
  const initialPool = await records.list(context, 'recruitmentJob', {
    filter: { jobStatus: { eq: 'RECRUITING' } },
    select: ['id'],
    limit: 1,
  });
  assert.ok(initialPool.count > 0, '现有全池不能为空，否则不能验证刷新扩容');
  await assertNoPaidEvaluation();
  const submitted = await requestJson(
    '/recruiting/match-runs',
    {
      method: 'POST',
      body: JSON.stringify({
        direction: 'CANDIDATE_TO_JOBS',
        subjectId: candidateId,
        idempotencyKey: `native-match-refresh-v1:${randomUUID()}`,
      }),
    },
    202,
  );
  assert.match(submitted.runId, /^[a-f0-9-]{36}$/i);
  const first = await waitForRun(submitted.runId);
  assertReviewCoverage(first, initialPool.count);
  assert.ok(first.results.every((pair) => pair.jobId !== jobId));
  await requestJson(
    `/recruiting/match-runs/${submitted.runId}/reviewed`,
    { method: 'POST', body: '{}' },
    201,
  );
  const reviewed = await requestJson(
    `/recruiting/match-runs/${submitted.runId}`,
  );
  assert.ok(reviewed.reviewedAt, '首次结果必须先进入已查看状态');

  await assertNoPaidEvaluation();
  await records.update(context, 'recruitmentJob', jobId, {
    jobStatus: 'RECRUITING',
  });
  await assertNoPaidEvaluation();
  const retried = await requestJson(
    `/recruiting/match-runs/${submitted.runId}/retry`,
    { method: 'POST', body: '{}' },
    202,
  );
  assert.equal(retried.runId, submitted.runId);
  assert.ok(!retried.reviewedAt, '重试回执必须清除已查看状态');
  const second = await waitForRun(submitted.runId);
  assertReviewCoverage(second, first.counts.total + 1);
  assert.ok(second.results.some((pair) => pair.jobId === jobId));
  assert.ok(!second.reviewedAt, '刷新终态必须继续显示为未查看');

  const evidence = {
    success: true,
    verifiedAt: new Date().toISOString(),
    runId: submitted.runId,
    candidateId,
    fixtureJobId: jobId,
    initialTotal: first.counts.total,
    refreshedTotal: second.counts.total,
    refreshedProcessed: second.counts.processed,
    refreshedNeedsReview: second.counts.needsReview,
    newFixtureIncluded: true,
    reviewedCleared: true,
    poolChanged: second.poolChanged,
    stale: second.stale,
    inaccessible: second.inaccessible,
    scored: second.counts.scored,
    failed: second.counts.failed,
    status: second.status,
    complete: second.complete,
    coverageComplete: true,
    scoringComplete: false,
    evaluationGuard: 'candidate_identity_conflict',
  };
  await writeFile(evidencePath, JSON.stringify(evidence), { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  await app.get(MetadataEventEmitter).drain();
  await app.close();
}
