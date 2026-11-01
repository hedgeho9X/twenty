/** Exercises native candidate compare-and-swap against the isolated local fixture; no parser, model or external messaging is invoked. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localRequest } from './local-api.mjs';
import { v5 } from 'uuid';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDirectory = join(root, '.local/recruiting');
const environment = JSON.parse(
  await readFile(join(privateDirectory, 'environment.json'), 'utf8'),
);
const database = new URL(environment.PG_DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '25432');
assert.equal(database.pathname, '/recruiting');
const response = await localRequest(
  '/recruiting/resume-intakes/ad90cc91-5efe-5b9b-9c43-b4fd49f70656',
);
assert.equal(response.status, 200);
const actor = (await response.json()).detail.actor;
assert.equal(actor.workspaceId, '4cb349cd-5765-4826-a2cb-73e5c5c2d564');
assert.ok(
  actor.userWorkspaceId &&
    !actor.apiKeyId &&
    !actor.applicationId &&
    !actor.viaApplicationId &&
    !actor.agentId,
);
Object.assign(process.env, environment, {
  RECRUITING_AUTO_MATCH_ENABLED: 'false',
  DISABLE_CRON_JOBS_REGISTRATION: 'true',
  DISABLE_WORKSPACE_CRON_JOBS_REGISTRATION: 'true',
  WORKER_ENABLED_QUEUES: 'recruiting-test-disabled',
});
const require = createRequire(
  join(root, 'packages/twenty-server/package.json'),
);
// Official entity discovery resolves dist paths from the server package directory.
process.chdir(join(root, 'packages/twenty-server'));
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { NotFoundException } = require('@nestjs/common');
const { AppModule } = require('./dist/app.module.js');
const load = (file, name) =>
  require(`./dist/modules/recruiting/${file}.js`)[name];
const {
  WorkspaceOrmManager,
} = require('./dist/engine/twenty-orm/workspace-orm.manager.js');
const {
  MetadataEventEmitter,
} = require('./dist/engine/subscriptions/metadata-event/metadata-event-emitter.js');
const Actors = load('recruiting-actor.service', 'RecruitingActorService');
const Records = load('recruiting-records.service', 'RecruitingRecordsService');
const Uploads = load('recruiting-upload.service', 'RecruitingUploadService');
const Parser = load('recruiting-parser.service', 'RecruitingParserService');
const Candidates = load(
  'recruiting-candidate-records.service',
  'RecruitingCandidateRecordsService',
);
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const context = await app.get(Actors).resolve(actor);
  const records = app.get(Records),
    native = app.get(WorkspaceOrmManager);
  const candidateId = v5(`${actor.workspaceId}:native-cas-fixture-v1`, v5.URL);
  const checkpoint = join(privateDirectory, 'candidate-cas-files.json');
  let files;
  try {
    files = JSON.parse(await readFile(checkpoint, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!files) {
    files = [];
    for (const label of ['A', 'B']) {
      const uploaded = await app.get(Uploads).buffer(context, {
        buffer: Buffer.from(`Synthetic CAS attachment ${label}`),
        originalname: `synthetic-cas-${label}.txt`,
      });
      const copied = await app
        .get(Parser)
        .copyResumeAttachment(actor, uploaded.fileId);
      files.push({ fileId: copied.id, label: `synthetic-cas-${label}.txt` });
    }
    await writeFile(checkpoint, JSON.stringify(files), {
      mode: 0o600,
      flag: 'wx',
    });
  }
  if (files.length === 2) {
    const uploaded = await app.get(Uploads).buffer(context, {
      buffer: Buffer.from('Synthetic original CAS attachment'),
      originalname: 'synthetic-cas-original.txt',
    });
    const copied = await app
      .get(Parser)
      .copyResumeAttachment(actor, uploaded.fileId);
    files.push({ fileId: copied.id, label: 'synthetic-cas-original.txt' });
    await writeFile(checkpoint, JSON.stringify(files), { mode: 0o600 });
  }
  assert.equal(files.length, 3);
  let original;
  try {
    original = await records.one(context, 'person', candidateId);
  } catch (error) {
    if (!(error instanceof NotFoundException)) throw error;
    await records.create(context, 'person', {
      id: candidateId,
      name: { firstName: '合成并发附件验收', lastName: '' },
      contactRoles: ['CANDIDATE'],
      candidateResumes: [files[2]],
      recruitingProfile: {
        summary: '合成服务层回归资料，不对应真实候选人',
        sourceText: 'Synthetic CAS-only fixture',
        skills: [],
        experience: [],
        education: [],
        expectedRoles: [],
        category: null,
        identityConflict: true,
        needsReview: true,
        reviewNotes: ['合成服务层回归资料，不用于真实推荐'],
      },
    });
    original = await records.one(context, 'person', candidateId);
  }
  assert.ok(
    /Synthetic CAS-only fixture/.test(
      original.recruitingProfile?.sourceText ?? '',
    ),
    'Only this synthetic service fixture may be updated',
  );
  if (original.recruitingProfile.identityConflict !== true) {
    await records.update(context, 'person', candidateId, {
      recruitingProfile: {
        ...original.recruitingProfile,
        identityConflict: true,
        needsReview: true,
        reviewNotes: ['合成服务层回归资料，不用于真实推荐'],
      },
    });
    original = await records.one(context, 'person', candidateId);
  }
  const originalIds = original.candidateResumes.map((file) => file.fileId);
  // An earlier failed smoke may have left its own unattached copies permanent; create fresh native copies without changing flags.
  for (let index = 0; index < 2; index++) {
    const file = await app.get(Parser).file(actor, files[index].fileId);
    if (!originalIds.includes(file.id) && !file.settings?.isTemporaryFile) {
      const copy = await app.get(Parser).copyResumeAttachment(actor, file.id);
      files[index] = { ...files[index], fileId: copy.id };
    }
  }
  await writeFile(checkpoint, JSON.stringify(files), { mode: 0o600 });
  let reads = 0,
    mutations = 0,
    release = () => {};
  const versionChecks = [],
    mutationCounts = [];
  const barrier = new Promise((resolveBarrier) => {
    release = resolveBarrier;
  });
  /** Makes two genuine reads observe one revision before either genuine mutation, without mocking PostgreSQL or native permissions. */
  const testOrm = {
    executeInWorkspaceContext: native.executeInWorkspaceContext.bind(native),
    getRepositoryWithContextPermissions: (...args) => {
      const repository = native.getRepositoryWithContextPermissions(...args);
      return {
        createQueryBuilder: (...builderArgs) => {
          const builder = repository.createQueryBuilder(...builderArgs);
          const read = builder.getRawAndEntities.bind(builder);
          builder.getRawAndEntities = async (...readArgs) => {
            const value = await read(...readArgs);
            const version = value.raw[0]?.person_updatedAt;
            const matches = await repository
              .createQueryBuilder('person')
              .where({ id: candidateId })
              .andWhere(
                '"person"."updatedAt" = CAST(:version AS timestamptz)',
                { version },
              )
              .getCount();
            versionChecks.push({ version, matches });
            if (reads < 2) {
              if (++reads === 2) release();
              await barrier;
            }
            return value;
          };
          return builder;
        },
        runMutation: async (options) => {
          mutations++;
          const value = await repository.runMutation(options);
          mutationCounts.push(value.length);
          return value;
        },
      };
    },
  };
  const writer = new Candidates(testOrm);
  const outcomes = await Promise.allSettled(
    files
      .slice(0, 2)
      .map((file) =>
        writer.replaceProfile(
          context,
          candidateId,
          original.recruitingProfile,
          [file],
        ),
      ),
  );
  await writeFile(
    join(privateDirectory, 'candidate-cas-probe.json'),
    JSON.stringify({
      versionChecks,
      mutationCounts,
      failures: outcomes
        .filter((value) => value.status === 'rejected')
        .map((value) => ({
          code: value.reason.code,
          message: value.reason.message,
        })),
    }),
    { mode: 0o600 },
  );
  const failure = outcomes.find((value) => value.status === 'rejected');
  if (failure) throw failure.reason;
  const updated = await records.one(context, 'person', candidateId);
  const ids = new Set(updated.candidateResumes.map((file) => file.fileId));
  for (const id of [...originalIds, ...files.map((file) => file.fileId)])
    assert.ok(ids.has(id));
  assert.equal(mutations, 3);
  assert.equal(mutationCounts.filter((count) => count === 0).length, 1);
  for (const file of files) {
    assert.equal(
      (await app.get(Parser).file(actor, file.fileId)).settings.isTemporaryFile,
      false,
    );
  }
  assert.deepEqual(updated.recruitingProfile, original.recruitingProfile);
  const evidence = {
    candidateId,
    previousReferences: originalIds.length,
    resultingReferences: ids.size,
    retainedOriginals: true,
    appendedBoth: true,
    forcedNativeConflict: true,
    mutations,
    modelCalls: 0,
  };
  await writeFile(
    join(privateDirectory, 'candidate-cas-native-evidence.json'),
    JSON.stringify(evidence),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
} finally {
  await app.get(MetadataEventEmitter).drain();
  await app.close();
}
