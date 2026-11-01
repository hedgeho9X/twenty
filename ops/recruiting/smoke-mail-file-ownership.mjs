/** 在隔离本地实例验收 500 附件、独立 intake 副本与旧绑定幂等；worker-mode 由外部原生 worker 处理，不测量后台模型用量。 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  lstat,
  rename,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v5 } from 'uuid';
import { localRequest } from './local-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const serverDirectory = join(root, 'packages/twenty-server');
const privateDirectory = join(root, '.local/recruiting');
const workspaceId = '4cb349cd-5765-4826-a2cb-73e5c5c2d564';
const candidateId = '926eee86-1b7f-5085-82a1-50f164e09124';
const oldIntakeId = 'ead17ffe-3cf0-572f-b4d3-56995621ee0e';
const oldArchiveId = 'f2c854b0-0bf5-5fc1-979a-2440dced6e04';
const legacyNote = '合成邮件端到端验收：将完整自我介绍作为材料保留。';
const processIntakes = process.argv.includes('--process-intakes');
const workerMode = process.argv.includes('--worker-mode');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const summary = {
  success: false,
  phase: 'SETUP',
  errors: 0,
  executionMode: workerMode ? 'native-worker' : 'native-context',
  instrumentationScope: 'verifier-process-only',
  materialProcessingOwner: workerMode
    ? 'external-native-worker'
    : processIntakes
      ? 'verifier-native-context'
      : 'external-worker-if-enabled',
  modelUsageMeasured: false,
  maximumAttachments: 500,
  capacityArtifacts: 0,
  capacitySlotsUsed: 0,
  canonicalFilesVerified: 0,
  artifactHashesVerified: 0,
  intakeCopyHashesVerified: 0,
  dualIntakesAccepted: 0,
  repeatCopiesAdded: 0,
  repeatQueueAdds: 0,
  repeatBindingIdsUnchanged: false,
  legacySameIntake: false,
  legacyCopiesAdded: 0,
  legacyQueueAdds: 0,
  intakeProcessingRequested: processIntakes,
  nativeIntakeProcessInvocations: 0,
  processedIntakesStored: 0,
  matchQueueAddsDuringProcessing: 0,
  matchRunsCreatedDuringProcessing: 0,
  parsingAcceptedOnly: !processIntakes,
};
const evidence = { version: 1, summary, fixtures: {} };
const restores = [];
let app;

/** 轮询时只私存聚合进度，原子替换避免观察进程读到半份 JSON。 */
const saveEvidence = async () => {
  const path = join(privateDirectory, 'mail-file-ownership-smoke-v1.json');
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(evidence, null, 2), {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
};

/** 固定字节同时固定 Message-ID、日期、边界和附件内容，重跑不会生成另一封邮件。 */
const eml = (name, text, html, attachments) => {
  const outer = `ownership-${name}-outer-v1`;
  const body = `ownership-${name}-body-v1`;
  const lines = [
    `Message-ID: <local-mail-ownership-${name}-v1@example.test>`,
    'From: Synthetic Ownership Fixture <fixture@example.test>',
    'To: recruiting@example.test',
    'Date: Sun, 1 Nov 2026 05:00:00 +0800',
    `Subject: [Synthetic local] Mail ownership ${name} v1`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${outer}"`,
    '',
    `--${outer}`,
  ];
  const part = (type, value) => [
    `Content-Type: ${type}; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(value).toString('base64'),
  ];
  if (html) {
    lines.push(
      `Content-Type: multipart/alternative; boundary="${body}"`,
      '',
      `--${body}`,
      ...part('text/plain', text),
      `--${body}`,
      ...part('text/html', html),
      `--${body}--`,
    );
  } else lines.push(...part('text/plain', text));
  for (const attachment of attachments)
    lines.push(
      `--${outer}`,
      'Content-Type: text/plain; charset=utf-8',
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(attachment.text).toString('base64'),
    );
  lines.push(`--${outer}--`, '');
  return Buffer.from(lines.join('\r\n'));
};
const capacityRaw = eml(
  'capacity',
  'Synthetic complete MIME capacity fixture. Preserve all 500 attachments.',
  '<p>Synthetic complete MIME capacity fixture: 500 attachments.</p>',
  Array.from({ length: 500 }, (_, index) => ({
    name: `capacity-${String(index).padStart(3, '0')}.txt`,
    text: `Synthetic ownership capacity attachment ${index}\n`,
  })),
);
const smallRaw = eml(
  'dual-intake',
  '本地合成候选人申请后端工程师岗位，本邮件仅用于文件归属验收。',
  null,
  [
    {
      name: 'synthetic-ownership-resume.txt',
      text: '本地归属验收候选人（合成）\n求职意向：后端工程师，全职远程。\n2024-2026：负责 TypeScript、Node.js API 开发，PostgreSQL 索引和事务优化，BullMQ 队列与自动化测试。\n教育：计算机科学本科。\n',
    },
  ],
);

/** 仅观察真实原生调用，原实现与参数原样执行；用于证明重复请求没有新复制或排队。 */
const countCalls = (target, key) => {
  const original = target[key];
  let count = 0;
  target[key] = function (...args) {
    count++;
    return original.apply(this, args);
  };
  restores.push(() => {
    target[key] = original;
  });
  return () => count;
};

/** URL 只在内存中核对；任何错误都不会打印凭据或材料。 */
const assertLocal = async (databaseUrl, storageType, storagePath) => {
  const database = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '25432');
  assert.equal(database.pathname, '/recruiting');
  assert.equal(String(storageType).toLowerCase(), 'local');
  assert.equal(resolve(storagePath), join(privateDirectory, 'storage'));
  assert.ok(!(await lstat(storagePath)).isSymbolicLink());
  assert.equal(
    await realpath(storagePath),
    join(await realpath(privateDirectory), 'storage'),
  );
};

const main = async () => {
  assert.ok(
    process.argv
      .slice(2)
      .every((value) => ['--process-intakes', '--worker-mode'].includes(value)),
  );
  assert.ok(
    !(processIntakes && workerMode),
    'worker-mode 与 process-intakes 互斥',
  );
  const environment = JSON.parse(
    await readFile(join(privateDirectory, 'environment.json'), 'utf8'),
  );
  await assertLocal(
    environment.PG_DATABASE_URL,
    environment.STORAGE_TYPE,
    environment.STORAGE_LOCAL_PATH,
  );
  Object.assign(process.env, environment, {
    RECRUITING_AUTO_MATCH_ENABLED: 'false',
    DISABLE_CRON_JOBS_REGISTRATION: 'true',
    DISABLE_WORKSPACE_CRON_JOBS_REGISTRATION: 'true',
    WORKER_ENABLED_QUEUES: 'recruiting-test-disabled',
  });
  const response = await localRequest(
    '/recruiting/resume-intakes/ad90cc91-5efe-5b9b-9c43-b4fd49f70656',
  );
  assert.equal(response.status, 200);
  const source = await response.json();
  const actor = source.detail.actor;
  assert.equal(actor.workspaceId, workspaceId);
  assert.equal(source.detail.input.candidateId, candidateId);
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
  const Actors = load('recruiting-actor.service', 'RecruitingActorService');
  const Records = load(
    'recruiting-records.service',
    'RecruitingRecordsService',
  );
  const Mail = load('recruiting-mail.service', 'RecruitingMailService');
  const Intakes = load('recruiting-intake.service', 'RecruitingIntakeService');
  const Parser = load('recruiting-parser.service', 'RecruitingParserService');
  const {
    contentVersion,
  } = require('./dist/modules/recruiting/domain/match-context.js');
  const {
    RECRUITING_MAIL_FILE_LAYOUT: layout,
    MAX_RECRUITING_MAIL_ATTACHMENTS,
    MAX_RECRUITING_MAIL_ARTIFACTS,
  } = require('./dist/modules/recruiting/domain/mail-file-layout.js');
  assert.equal(MAX_RECRUITING_MAIL_ATTACHMENTS, 500);
  assert.equal(MAX_RECRUITING_MAIL_ARTIFACTS, 504);
  assert.equal(layout.version, 1);
  assert.equal(layout.perField, 60);
  assert.equal(layout.fields.length, 9);
  const {
    TwentyConfigService,
  } = require('./dist/engine/core-modules/twenty-config/twenty-config.service.js');
  const {
    WorkspaceCacheService,
  } = require('./dist/engine/workspace-cache/services/workspace-cache.service.js');
  const {
    FilesFieldService,
  } = require('./dist/engine/core-modules/file/files-field/services/files-field.service.js');
  const {
    MessageQueue,
  } = require('./dist/engine/core-modules/message-queue/message-queue.constants.js');
  const {
    getQueueToken,
  } = require('./dist/engine/core-modules/message-queue/utils/get-queue-token.util.js');
  app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const config = app.get(TwentyConfigService);
  await assertLocal(
    config.get('PG_DATABASE_URL'),
    config.get('STORAGE_TYPE'),
    config.get('STORAGE_LOCAL_PATH'),
  );
  const actors = app.get(Actors),
    records = app.get(Records),
    mail = app.get(Mail),
    intakes = app.get(Intakes),
    parser = app.get(Parser);
  const context = await actors.resolve(actor);
  if (processIntakes)
    assert.ok(
      String(intakes.scheduleMatching).includes(
        'RECRUITING_AUTO_MATCH_ENABLED',
      ),
      '当前编译版本未证明显式入库链尊重禁自动匹配，拒绝执行材料处理',
    );
  const copies = countCalls(
    app.get(FilesFieldService),
    'copyFileIntoFilesField',
  );
  const queueAdds = countCalls(
    app.get(getQueueToken(MessageQueue.recruitingQueue)),
    'add',
  );
  const matchAdds = countCalls(
    app.get(getQueueToken(MessageQueue.recruitingMatchQueue)),
    'add',
  );
  const metadata = await app
    .get(WorkspaceCacheService)
    .getOrRecompute(workspaceId, [
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
    ]);
  const objectByName = (name) =>
    Object.values(metadata.flatObjectMetadataMaps.byUniversalIdentifier).find(
      (value) => value?.nameSingular === name,
    );
  const fieldByName = (object, name) =>
    Object.values(metadata.flatFieldMetadataMaps.byUniversalIdentifier).find(
      (value) =>
        value?.objectMetadataId === objectByName(object)?.id &&
        value?.name === name,
    );
  const archiveFields = layout.fields.map((name) =>
    fieldByName('recruitingMailArchive', name),
  );
  for (const field of archiveFields) {
    assert.ok(field && field.type === 'FILES');
    assert.equal(field.settings?.maxNumberOfValues, 60);
  }
  for (const [object, name] of [
    ['recruitingIntake', 'files'],
    ['person', 'candidateResumes'],
  ]) {
    const field = fieldByName(object, name);
    assert.ok(
      field?.type === 'FILES' && field.settings?.maxNumberOfValues >= 30,
    );
  }
  const candidate = (
    await records.list(context, 'person', {
      filter: { id: { eq: candidateId } },
      select: ['id', 'contactRoles', 'candidateResumes'],
      limit: 1,
    })
  ).records[0];
  assert.equal(candidate?.id, candidateId);
  assert.ok(candidate.contactRoles?.includes('CANDIDATE'));
  const originalCandidateFiles = (candidate.candidateResumes ?? []).map(
    (file) => file.fileId,
  );

  /** 每个 canonical 引用同时核对原生字段分区、归属与永久标志。 */
  const verifyCanonical = async (record, raw, expectedArtifacts, allHashes) => {
    assert.equal(record.id, v5(`${workspaceId}:mail:${sha(raw)}`, v5.URL));
    assert.equal(record.sourceHash, sha(raw));
    assert.equal(record.payload.fileOwnershipVersion, 1);
    assert.equal(record.payload.autoSubmit, false);
    assert.ok(['READY', 'NEEDS_SELECTION'].includes(record.status));
    assert.equal(record.payload.artifacts.length, expectedArtifacts);
    const all = [];
    const slotSizes = [];
    for (const [index, name] of layout.fields.entries()) {
      const refs = record[name] ?? [];
      assert.ok(Array.isArray(refs) && refs.length <= 60);
      slotSizes.push(refs.length);
      for (const ref of refs) {
        const file = await parser.file(actor, ref.fileId);
        assert.equal(file.settings?.isTemporaryFile, false);
        assert.equal(file.settings?.toDelete, false);
        assert.equal(file.applicationId, archiveFields[index].applicationId);
        assert.ok(file.path.includes(archiveFields[index].universalIdentifier));
        all.push(ref.fileId);
        summary.canonicalFilesVerified++;
      }
    }
    const owned = new Set(all);
    assert.equal(owned.size, all.length);
    assert.equal(owned.size, expectedArtifacts);
    assert.ok(owned.has(record.payload.rawFile.fileId));
    assert.ok(record.payload.artifacts.every((file) => owned.has(file.fileId)));
    assert.equal(
      sha(await parser.original(actor, record.payload.rawFile.fileId)),
      sha(raw),
    );
    const indices = allHashes
      ? record.payload.artifacts.map((_, index) => index)
      : [
          ...new Set([
            0,
            1,
            2,
            3,
            4,
            59,
            60,
            119,
            120,
            479,
            480,
            expectedArtifacts - 1,
          ]),
        ];
    for (const index of indices) {
      const file = record.payload.artifacts[index];
      assert.equal(
        sha((await mail.artifact(context, record.id, file.key)).bytes),
        file.sha256,
      );
      summary.artifactHashesVerified++;
    }
    return { owned, slotSizes, hashesChecked: indices.length };
  };
  /** worker 模式仅等待真实业务状态，其他模式才在当前原生上下文处理归档。 */
  const receiveAndProcess = async (raw) => {
    const expectedId = v5(`${workspaceId}:mail:${sha(raw)}`, v5.URL);
    const receipt = await mail.receive(
      await actors.resolve(actor),
      raw,
      { transport: 'EML_UPLOAD' },
      false,
    );
    assert.equal(receipt.archiveId, expectedId);
    if (workerMode) {
      const startedAt = Date.now();
      const deadline = startedAt + 10 * 60_000;
      while (true) {
        const observed = await records.one(
          await actors.resolve(actor),
          'recruitingMailArchive',
          expectedId,
        );
        evidence.live = {
          archiveId: expectedId,
          status: observed.status,
          artifactCount: observed.payload.artifacts.length,
          ownedReferences: layout.fields.reduce(
            (total, name) => total + (observed[name]?.length ?? 0),
            0,
          ),
          elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
          observedAt: new Date().toISOString(),
        };
        await saveEvidence();
        if (['READY', 'NEEDS_SELECTION'].includes(observed.status)) break;
        assert.notEqual(
          observed.status,
          'FAILED',
          '外部 worker 归档失败，不予验收',
        );
        assert.ok(
          Date.now() < deadline,
          '外部 worker 十分钟内未完成归档，不予验收',
        );
        await new Promise((done) => setTimeout(done, 2000));
      }
    } else {
      await mail.process({ archiveId: expectedId, actor });
    }
    const record = await records.one(
      await actors.resolve(actor),
      'recruitingMailArchive',
      expectedId,
    );
    assert.ok(
      ['READY', 'NEEDS_SELECTION'].includes(record.status),
      '原生归档展开未成功，不予验收',
    );
    return record;
  };

  summary.phase = 'CAPACITY_500';
  const capacity = await receiveAndProcess(capacityRaw);
  assert.equal(capacity.payload.intakeIds.length, 0);
  const capacityChecked = await verifyCanonical(
    capacity,
    capacityRaw,
    504,
    false,
  );
  assert.deepEqual(
    capacityChecked.slotSizes,
    [60, 60, 60, 60, 60, 60, 60, 60, 24],
  );
  assert.equal(
    capacity.payload.artifacts.filter((file) => file.kind === 'attachment')
      .length,
    500,
  );
  summary.capacityArtifacts = 504;
  summary.capacitySlotsUsed = capacityChecked.slotSizes.filter(
    (size) => size > 0,
  ).length;
  evidence.fixtures.capacity = {
    archiveId: capacity.id,
    rawSha256: sha(capacityRaw),
    slotSizes: capacityChecked.slotSizes,
    hashesChecked: capacityChecked.hashesChecked,
  };

  summary.phase = 'DUAL_INTAKE_OWNERSHIP';
  let small = await receiveAndProcess(smallRaw);
  const smallChecked = await verifyCanonical(small, smallRaw, 4, true);
  const resume = small.payload.artifacts.find(
    (file) => file.suggestedResume && file.kind === 'attachment',
  );
  assert.ok(resume);
  const notes = [
    '合成文件归属验收 A：同一简历的独立投递副本。',
    '合成文件归属验收 B：保留另一份独立投递说明。',
  ];
  const expectedKeys = small.payload.artifacts.map((file) => file.key).sort();
  const expectedKinds = small.payload.artifacts.map((file) => file.kind).sort();
  assert.deepEqual(expectedKinds, ['attachment', 'metadata', 'raw', 'text']);
  const submit = (note) =>
    mail.submitIntake(context, small.id, {
      artifactKeys: [resume.key],
      candidateId,
      note,
    });
  const accepted = [];
  for (const note of notes) {
    const value = await submit(note);
    const digest = contentVersion({
      selection: [resume.key],
      candidateId,
      note,
    });
    const expectedId = v5(
      `${workspaceId}:CANDIDATE:email:mail:${small.id}:${digest}`,
      v5.URL,
    );
    assert.equal(value.intakeId, expectedId);
    accepted.push({ id: value.intakeId, digest });
  }
  assert.notEqual(accepted[0].id, accepted[1].id);
  const bindingDigest = (record) =>
    contentVersion(
      accepted.map(({ id, digest }) => ({
        intakeId: id,
        files: record.payload.intakeCopies[digest].map(({ key, fileId }) => ({
          key,
          fileId,
        })),
      })),
    );
  const beforeBinding = bindingDigest(
    await records.one(context, 'recruitingMailArchive', small.id),
  );
  const beforeRepeat = { copies: copies(), queue: queueAdds() };
  for (const [index, note] of notes.entries())
    assert.equal((await submit(note)).intakeId, accepted[index].id);
  summary.repeatCopiesAdded = copies() - beforeRepeat.copies;
  summary.repeatQueueAdds = queueAdds() - beforeRepeat.queue;
  assert.equal(summary.repeatCopiesAdded, 0);
  assert.equal(summary.repeatQueueAdds, 0);
  small = await records.one(context, 'recruitingMailArchive', small.id);
  assert.equal(bindingDigest(small), beforeBinding);
  summary.repeatBindingIdsUnchanged = true;
  const intakeFiles = [];
  for (const item of accepted) {
    const record = await records.one(context, 'recruitingIntake', item.id);
    const input = record.result.input;
    assert.equal(input.candidateId, candidateId);
    assert.equal(input.mail.archiveId, small.id);
    assert.equal(input.mail.sourceHash, sha(smallRaw));
    const bound = small.payload.intakeCopies[item.digest];
    assert.deepEqual(bound.map((file) => file.key).sort(), expectedKeys);
    const ids = new Set(record.files.map((file) => file.fileId));
    assert.equal(ids.size, expectedKeys.length);
    assert.ok(
      input.files.every((file) => ids.has(file.fileId)) &&
        input.files.length === ids.size,
    );
    assert.ok(bound.every((file) => ids.has(file.fileId)));
    assert.ok([...ids].every((id) => !smallChecked.owned.has(id)));
    for (const boundFile of bound) {
      const artifact = small.payload.artifacts.find(
        (file) => file.key === boundFile.key,
      );
      const native = await parser.file(actor, boundFile.fileId);
      assert.equal(native.settings?.isTemporaryFile, false);
      assert.equal(native.settings?.toDelete, false);
      assert.ok(
        native.path.includes(
          fieldByName('recruitingIntake', 'files').universalIdentifier,
        ),
      );
      assert.equal(
        sha(await parser.original(actor, boundFile.fileId)),
        artifact.sha256,
      );
      summary.intakeCopyHashesVerified++;
    }
    intakeFiles.push(ids);
  }
  assert.ok([...intakeFiles[0]].every((id) => !intakeFiles[1].has(id)));
  summary.dualIntakesAccepted = 2;
  evidence.fixtures.dualIntake = {
    archiveId: small.id,
    rawSha256: sha(smallRaw),
    intakeIds: accepted.map((item) => item.id),
    filesPerIntake: intakeFiles.map((ids) => ids.size),
    canonicalDisjoint: true,
    pairwiseDisjoint: true,
  };

  summary.phase = 'LEGACY_BINDING';
  const oldIntake = await records.one(context, 'recruitingIntake', oldIntakeId);
  const legacyInput = oldIntake.result.input;
  assert.equal(legacyInput.mail.archiveId, oldArchiveId);
  assert.equal(legacyInput.candidateId, candidateId);
  assert.equal(oldIntake.state, 'COMPLETED');
  const legacy = await records.one(
    context,
    'recruitingMailArchive',
    legacyInput.mail.archiveId,
  );
  assert.equal(
    legacy.id,
    v5(`${workspaceId}:mail:${legacyInput.mail.sourceHash}`, v5.URL),
  );
  assert.equal(legacy.sourceHash, legacyInput.mail.sourceHash);
  assert.equal(
    sha(await parser.original(actor, legacy.payload.rawFile.fileId)),
    legacy.sourceHash,
  );
  const oldResume = legacy.payload.artifacts.find(
    (file) => file.suggestedResume,
  );
  assert.ok(oldResume && legacy.payload.intakeIds.includes(oldIntakeId));
  // 原生读取会补充短期下载 URL，幂等比较只使用持久字段和原始文件引用。
  const reference = ({ fileId, label }) => ({ fileId, label });
  const archiveDigest = (record) =>
    contentVersion({
      id: record.id,
      status: record.status,
      sourceHash: record.sourceHash,
      payload: record.payload,
      files: layout.fields.map((name) => ({
        name,
        refs: (record[name] ?? []).map(reference),
      })),
    });
  const intakeDigest = (record) =>
    contentVersion({
      id: record.id,
      state: record.state,
      targetId: record.targetId,
      result: record.result,
      files: record.files.map(reference),
    });
  const beforeLegacy = {
    copies: copies(),
    queue: queueAdds(),
    archive: archiveDigest(legacy),
    intake: intakeDigest(oldIntake),
  };
  const oldResult = await mail.submitIntake(context, legacy.id, {
    artifactKeys: [oldResume.key],
    candidateId,
    note: legacyNote,
  });
  assert.equal(oldResult.intakeId, oldIntakeId);
  summary.legacyCopiesAdded = copies() - beforeLegacy.copies;
  summary.legacyQueueAdds = queueAdds() - beforeLegacy.queue;
  assert.equal(summary.legacyCopiesAdded, 0);
  assert.equal(summary.legacyQueueAdds, 0);
  assert.equal(
    archiveDigest(
      await records.one(context, 'recruitingMailArchive', legacy.id),
    ),
    beforeLegacy.archive,
  );
  assert.equal(
    intakeDigest(await records.one(context, 'recruitingIntake', oldIntakeId)),
    beforeLegacy.intake,
  );
  summary.legacySameIntake = true;

  if (processIntakes) {
    summary.phase = 'PROCESS_TWO_INTAKES';
    const before = matchAdds();
    const beforeRuns = (
      await records.list(context, 'recruitingMatchRun', {
        filter: { subjectId: { eq: candidateId } },
        limit: 1,
      })
    ).count;
    for (const item of accepted) {
      await intakes.process({ intakeId: item.id, actor });
      summary.nativeIntakeProcessInvocations++;
      const stored = await records.one(
        await actors.resolve(actor),
        'recruitingIntake',
        item.id,
      );
      assert.equal(stored.state, 'COMPLETED');
      assert.equal(stored.targetId, candidateId);
      assert.equal(stored.result.stage, 'STORED');
      assert.equal(stored.result.matchingStatus, 'DISABLED');
      summary.processedIntakesStored++;
    }
    summary.matchQueueAddsDuringProcessing = matchAdds() - before;
    assert.equal(summary.matchQueueAddsDuringProcessing, 0);
    summary.matchRunsCreatedDuringProcessing =
      (
        await records.list(context, 'recruitingMatchRun', {
          filter: { subjectId: { eq: candidateId } },
          limit: 1,
        })
      ).count - beforeRuns;
    assert.equal(summary.matchRunsCreatedDuringProcessing, 0);
    const freshCandidate = (
      await records.list(context, 'person', {
        filter: { id: { eq: candidateId } },
        select: ['id', 'candidateResumes'],
        limit: 1,
      })
    ).records[0];
    const retained = new Set(
      freshCandidate.candidateResumes.map((file) => file.fileId),
    );
    assert.ok(originalCandidateFiles.every((id) => retained.has(id)));
  }
  await mkdir(join(privateDirectory, 'fixtures'), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    join(privateDirectory, 'fixtures/mail-ownership-capacity-v1.eml'),
    capacityRaw,
    { mode: 0o600 },
  );
  await writeFile(
    join(privateDirectory, 'fixtures/mail-ownership-dual-intake-v1.eml'),
    smallRaw,
    { mode: 0o600 },
  );
  summary.phase = 'VERIFIED';
  summary.success = true;
};

try {
  await main();
} catch (error) {
  summary.errors++;
  evidence.failure = { phase: summary.phase, type: error?.name ?? 'Error' };
  process.exitCode = 1;
} finally {
  for (const restore of restores.reverse()) restore();
  if (app) {
    try {
      const require = createRequire(join(serverDirectory, 'package.json'));
      const {
        MetadataEventEmitter,
      } = require('./dist/engine/subscriptions/metadata-event/metadata-event-emitter.js');
      await app.get(MetadataEventEmitter).drain();
    } catch {
      summary.errors++;
    }
    try {
      await app.close();
    } catch {
      summary.errors++;
    }
  }
  summary.success &&= summary.errors === 0;
  evidence.verifiedAt = new Date().toISOString();
  try {
    await saveEvidence();
  } catch {
    summary.errors++;
    summary.success = false;
  }
  if (!summary.success) process.exitCode = 1;
  console.log(JSON.stringify(summary));
}
