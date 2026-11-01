/** 仅在隔离本地实例迁移当前本人可见的签名邮件归档；默认只读计划，不重新解析、排队、调用模型或删除原文件。 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localRequest } from './local-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const serverDirectory = join(root, 'packages/twenty-server');
const privateDirectory = join(root, '.local/recruiting');
const checkpointPath = join(
  privateDirectory,
  'mail-file-ownership-checkpoint-v1.json',
);
const evidencePath = join(
  privateDirectory,
  'mail-file-ownership-evidence-v1.json',
);
const apply = process.argv.includes('--apply');
const summary = {
  mode: apply ? 'apply' : 'plan',
  scope: 'current_actor_visible_signed_mail_archives',
  workspaceWideCompleteness: false,
  visiblePopulationComplete: false,
  migrationComplete: false,
  archiveCount: 0,
  artifactCount: 0,
  verifiedArchives: 0,
  migrated: 0,
  alreadyOwned: 0,
  plannedMigrations: 0,
  skippedMissingRaw: 0,
  hashMatches: 0,
  rawHashMatches: 0,
  artifactHashMatches: 0,
  pages: 0,
  visibleCountReported: null,
  integrityRejected: 0,
  errors: 0,
  errorCodes: {},
};
let app;
let checkpoint = { version: 1, layoutVersion: 1, archives: {} };

/** 证据只包含聚合数字、归档 ID 与摘要，不保存主题、正文、文件名、账号或下载凭据。 */
const persist = async () => {
  const temporary = `${checkpointPath}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({
      ...checkpoint,
      mode: summary.mode,
      updatedAt: new Date().toISOString(),
    }),
    { mode: 0o600, flag: 'wx' },
  );
  await rename(temporary, checkpointPath);
  await writeFile(evidencePath, JSON.stringify(summary, null, 2), {
    mode: 0o600,
  });
};

/** 原生异常可能包含 SQL 或文件路径，仅记录固定阶段代码。 */
const failure = (code) => {
  summary.errors++;
  summary.errorCodes[code] = (summary.errorCodes[code] ?? 0) + 1;
};

/** 环境 URL 仅在内存中判断，不能将带凭据 URL 放入断言输出。 */
const assertDatabase = (value) => {
  const database = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '25432');
  assert.equal(database.pathname, '/recruiting');
};

/** 避免把本地迁移连接到远程存储，或通过符号链接越出隔离私有目录。 */
const assertStorage = async (type, path) => {
  assert.equal(String(type).toLowerCase(), 'local');
  assert.equal(resolve(path), join(privateDirectory, 'storage'));
  assert.ok(!(await lstat(path)).isSymbolicLink());
  assert.equal(
    await realpath(path),
    join(await realpath(privateDirectory), 'storage'),
  );
};

/** 只计算原件和明确列入清单的材料，不把新的副本标识混入来源不变性摘要。 */
const immutable = (record) => ({
  archiveId: record.id,
  status: record.status,
  sourceHash: record.sourceHash,
  sources: record.payload.sources,
  intakeIds: record.payload.intakeIds,
  autoSubmit: record.payload.autoSubmit,
  metadata: record.payload.metadata,
  parserVersion: record.payload.parserVersion,
  artifacts: record.payload.artifacts.map(
    ({ fileId, ...artifact }) => artifact,
  ),
});

/** 按当前本人权限分页取快照；签名过滤和可见计数不一致时绝不声称覆盖整个工作区。 */
const enumerate = async (records, context, order) => {
  const ids = new Set();
  let scanned = 0;
  let populationStable = true;
  for (let offset = 0; ; offset += 100) {
    assert.ok(summary.pages < 1000, '当前分页范围超过本地迁移护栏');
    const page = await records.list(context, 'recruitingMailArchive', {
      offset,
      limit: 100,
      orderBy: [{ id: order }],
    });
    summary.pages++;
    assert.ok(Number.isInteger(page.count) && page.count >= 0);
    assert.ok(
      Number.isInteger(page.integrityRejected) && page.integrityRejected >= 0,
    );
    if (summary.visibleCountReported === null)
      summary.visibleCountReported = page.count;
    else if (summary.visibleCountReported !== page.count)
      populationStable = false;
    summary.integrityRejected += page.integrityRejected;
    scanned += page.records.length + page.integrityRejected;
    for (const record of page.records) {
      if (ids.has(record.id)) populationStable = false;
      ids.add(record.id);
    }
    if (!page.hasNextPage) break;
  }
  const finalPage = await records.list(context, 'recruitingMailArchive', {
    limit: 1,
  });
  populationStable &&= finalPage.count === summary.visibleCountReported;
  summary.visiblePopulationComplete =
    populationStable &&
    summary.integrityRejected === 0 &&
    scanned === summary.visibleCountReported &&
    ids.size === summary.visibleCountReported;
  summary.archiveCount = ids.size;
  if (!summary.visiblePopulationComplete) failure('VISIBLE_SCOPE_INCOMPLETE');
  return [...ids];
};

/** 读取路径经原生服务授权，输出只保留 SHA 匹配计数。 */
const verifyHashes = async (
  record,
  context,
  actor,
  parser,
  mail,
  before,
  progress,
  rawBytes,
) => {
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const payload = record.payload;
  assert.match(record.sourceHash, /^[a-f0-9]{64}$/i);
  assert.equal(
    sha(rawBytes ?? (await parser.original(actor, payload.rawFile.fileId))),
    record.sourceHash,
  );
  summary.rawHashMatches++;
  summary.hashMatches++;
  progress[before ? 'rawVerifiedBefore' : 'rawVerifiedAfter'] = true;
  for (const artifact of payload.artifacts) {
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/i);
    const value = await mail.artifact(context, record.id, artifact.key);
    assert.equal(sha(value.bytes), artifact.sha256);
    summary.artifactHashMatches++;
    summary.hashMatches++;
    const key = before ? 'artifactsVerifiedBefore' : 'artifactsVerifiedAfter';
    progress[key] = (progress[key] ?? 0) + 1;
    await persist();
  }
};

const main = async () => {
  assert.ok(process.argv.slice(2).every((value) => value === '--apply'));
  const environment = JSON.parse(
    await readFile(join(privateDirectory, 'environment.json'), 'utf8'),
  );
  assertDatabase(environment.PG_DATABASE_URL);
  await assertStorage(environment.STORAGE_TYPE, environment.STORAGE_LOCAL_PATH);
  Object.assign(process.env, environment, {
    RECRUITING_AUTO_MATCH_ENABLED: 'false',
    DISABLE_CRON_JOBS_REGISTRATION: 'true',
    DISABLE_WORKSPACE_CRON_JOBS_REGISTRATION: 'true',
    WORKER_ENABLED_QUEUES: 'recruiting-test-disabled',
  });
  const sourceResponse = await localRequest(
    '/recruiting/resume-intakes/ad90cc91-5efe-5b9b-9c43-b4fd49f70656',
  );
  assert.equal(sourceResponse.status, 200);
  const actor = (await sourceResponse.json()).detail.actor;
  assert.equal(actor.workspaceId, '4cb349cd-5765-4826-a2cb-73e5c5c2d564');
  assert.ok(
    actor.userWorkspaceId &&
      !actor.apiKeyId &&
      !actor.applicationId &&
      !actor.viaApplicationId &&
      !actor.agentId,
  );
  const require = createRequire(join(serverDirectory, 'package.json'));
  process.chdir(serverDirectory);
  assert.equal(process.cwd(), serverDirectory);
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('./dist/app.module.js');
  const load = (file, name) =>
    require(`./dist/modules/recruiting/${file}.js`)[name];
  const Actors = load('auth/actor.service', 'RecruitingActorService');
  const Records = load(
    'records/records.service',
    'RecruitingRecordsService',
  );
  const Mail = load('mail/mail.service', 'RecruitingMailService');
  const Parser = load('files/parser.service', 'RecruitingParserService');
  const { OrderByDirection } = require('twenty-shared/types');
  const {
    contentVersion,
  } = require('./dist/modules/recruiting/matching/domain/match-context.js');
  const {
    RECRUITING_MAIL_FILE_LAYOUT: layout,
  } = require('./dist/modules/recruiting/mail/domain/mail-file-layout.js');
  assert.equal(layout.version, 1);
  assert.equal(layout.perField, 60);
  assert.equal(layout.fields.length, 9);
  const {
    TwentyConfigService,
  } = require('./dist/engine/core-modules/twenty-config/twenty-config.service.js');
  app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const config = app.get(TwentyConfigService);
  assertDatabase(config.get('PG_DATABASE_URL'));
  await assertStorage(
    config.get('STORAGE_TYPE'),
    config.get('STORAGE_LOCAL_PATH'),
  );
  try {
    const previous = JSON.parse(await readFile(checkpointPath, 'utf8'));
    assert.equal(previous.version, 1);
    assert.equal(previous.layoutVersion, layout.version);
    checkpoint = previous;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const actors = app.get(Actors),
    records = app.get(Records),
    mail = app.get(Mail),
    parser = app.get(Parser);
  const ids = await enumerate(
    records,
    await actors.resolve(actor),
    OrderByDirection.AscNullsLast,
  );
  await persist();
  for (const id of ids) {
    let phase = 'READ_ARCHIVE';
    const progress = {
      state: 'STARTED',
      artifactsVerifiedBefore: 0,
      artifactsVerifiedAfter: 0,
    };
    checkpoint.archives[id] = progress;
    await persist();
    try {
      let context = await actors.resolve(actor);
      const original = await records.one(context, 'recruitingMailArchive', id);
      const payload = original.payload;
      assert.equal(payload?.version, 1);
      assert.ok(
        Array.isArray(payload.sources) &&
          Array.isArray(payload.intakeIds) &&
          Array.isArray(payload.artifacts),
      );
      summary.artifactCount += payload.artifacts.length;
      if (!payload.rawFile?.fileId) {
        summary.skippedMissingRaw++;
        progress.state = 'MISSING_RAW_REFERENCE';
        await persist();
        continue;
      }
      phase = 'READ_RAW';
      let rawBytes;
      try {
        rawBytes = await parser.original(actor, payload.rawFile.fileId);
      } catch {
        summary.skippedMissingRaw++;
        progress.state = 'RAW_UNAVAILABLE';
        await persist();
        continue;
      }
      const before = contentVersion(immutable(original));
      progress.immutableDigest = before;
      /** 每个引用只能出现一次；完整性 MAC v1 必须覆盖所有九槽。 */
      const owned = (record) => {
        const references = layout.fields.flatMap((name) => {
          const values = record[name] ?? [];
          assert.ok(Array.isArray(values) && values.length <= layout.perField);
          assert.ok(values.every((value) => typeof value.fileId === 'string'));
          return values;
        });
        const ids = new Set(references.map((value) => value.fileId));
        assert.equal(ids.size, references.length);
        const payload = record.payload;
        return (
          payload.fileOwnershipVersion === layout.version &&
          ids.has(payload.rawFile.fileId) &&
          payload.artifacts.every((artifact) => ids.has(artifact.fileId))
        );
      };
      const wasOwned = owned(original);
      phase = 'VERIFY_BEFORE_HASH';
      await verifyHashes(
        original,
        context,
        actor,
        parser,
        mail,
        true,
        progress,
        rawBytes,
      );
      if (!apply) {
        if (wasOwned) summary.alreadyOwned++;
        else summary.plannedMigrations++;
        progress.state = wasOwned ? 'PLAN_ALREADY_OWNED' : 'PLAN_COPY_REQUIRED';
        await persist();
        continue;
      }
      phase = 'MIGRATE_CANONICAL';
      context = await actors.resolve(actor);
      await mail.ensureCanonicalOwnership(context, id);
      phase = 'VERIFY_OWNERSHIP';
      context = await actors.resolve(actor);
      const updated = await records.one(context, 'recruitingMailArchive', id);
      assert.equal(contentVersion(immutable(updated)), before);
      assert.ok(owned(updated));
      const originalIds = new Set([
        payload.rawFile.fileId,
        ...payload.artifacts.map((value) => value.fileId),
      ]);
      for (const fileId of originalIds) await parser.file(actor, fileId);
      const canonicalIds = new Set([
        updated.payload.rawFile.fileId,
        ...updated.payload.artifacts.map((value) => value.fileId),
      ]);
      for (const fileId of canonicalIds)
        assert.equal(
          (await parser.file(actor, fileId)).settings?.isTemporaryFile,
          false,
        );
      phase = 'VERIFY_AFTER_HASH';
      await verifyHashes(
        updated,
        context,
        actor,
        parser,
        mail,
        false,
        progress,
      );
      if (wasOwned) summary.alreadyOwned++;
      else summary.migrated++;
      summary.verifiedArchives++;
      progress.state = 'OWNED_AND_HASH_VERIFIED';
      await persist();
    } catch {
      failure(phase);
      progress.state = 'FAILED';
      progress.errorCode = phase;
      await persist();
    }
  }
  summary.migrationComplete =
    apply &&
    summary.visiblePopulationComplete &&
    summary.errors === 0 &&
    summary.skippedMissingRaw === 0 &&
    summary.verifiedArchives === summary.archiveCount;
};

try {
  await main();
} catch {
  failure('SETUP_OR_ENUMERATION_FAILED');
} finally {
  if (app) {
    try {
      const require = createRequire(join(serverDirectory, 'package.json'));
      const {
        MetadataEventEmitter,
      } = require('./dist/engine/subscriptions/metadata-event/metadata-event-emitter.js');
      await app.get(MetadataEventEmitter).drain();
    } catch {
      failure('NATIVE_EVENTS_DRAIN_FAILED');
    }
    try {
      await app.close();
    } catch {
      failure('NATIVE_CONTEXT_CLOSE_FAILED');
    }
  }
  summary.migrationComplete &&= summary.errors === 0;
  summary.verifiedAt = new Date().toISOString();
  try {
    await persist();
  } catch {
    failure('EVIDENCE_WRITE_FAILED');
    summary.migrationComplete = false;
  }
  if (summary.errors || summary.skippedMissingRaw) process.exitCode = 1;
  console.log(JSON.stringify(summary));
}
