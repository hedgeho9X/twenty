/** 通过原生元数据 API 准备招聘 FILES 字段；默认只读计划，显式 --apply 才修改并先备份原设置。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localRequest } from './local-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDirectory = join(root, '.local/recruiting');
const workspaceId = '4cb349cd-5765-4826-a2cb-73e5c5c2d564';
const apply = process.argv.includes('--apply');
const intakeOnly = process.argv.includes('--intake-only');
assert.ok(
  process.argv
    .slice(2)
    .every((value) => ['--apply', '--intake-only'].includes(value)),
  '只支持 --apply 与 --intake-only；不传 --apply 只读取计划',
);
const environment = JSON.parse(
  await readFile(join(privateDirectory, 'environment.json'), 'utf8'),
);
const database = new URL(environment.PG_DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '25432');
assert.equal(database.pathname, '/recruiting');
const require = createRequire(
  join(root, 'packages/twenty-server/package.json'),
);
const {
  FILES_FIELD_MAX_NUMBER_OF_VALUES: nativeMaximum,
} = require('twenty-shared/constants');
const {
  RECRUITING_MAIL_FILE_LAYOUT: layout,
  MAX_RECRUITING_MAIL_ATTACHMENTS: maximumAttachments,
  MAX_RECRUITING_MAIL_ARTIFACTS: maximumArtifacts,
} = require(
  join(
    root,
    'packages/twenty-server/dist/modules/recruiting/domain/mail-file-layout.js',
  ),
);
assert.equal(layout.version, 1);
assert.equal(layout.perField, 60);
assert.deepEqual(layout.fields, [
  'sourceFiles',
  ...Array.from({ length: 8 }, (_, index) => `sourceFiles${index + 2}`),
]);
assert.equal(maximumArtifacts, maximumAttachments + 4);
assert.ok(layout.fields.length * layout.perField >= maximumArtifacts);
const targets = [
  ...(intakeOnly
    ? []
    : layout.fields.map((name) => ({
        object: 'recruitingMailArchive',
        name,
        minimum: layout.perField,
      }))),
  { object: 'recruitingIntake', name: 'files', minimum: 30 },
  { object: 'person', name: 'candidateResumes', minimum: 30 },
];
assert.ok(
  targets.every((target) => target.minimum <= nativeMaximum),
  '编译后的原生 FILES 上限低于领域布局要求；请核对共享包与 API 版本',
);

/** 只对明确未执行 mutation 的原生 deferred guard 有界重试，未知网络结果立即停止。 */
const metadata = async (query, variables = {}, mutation = false) => {
  for (let attempt = 0; ; attempt++) {
    const response = await localRequest('/metadata', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    assert.equal(response.status, 200, '本地元数据 API 请求失败');
    const body = await response.json();
    if (!body.errors?.length) return body.data;
    const deferredGuard =
      mutation &&
      body.errors.length === 1 &&
      body.errors[0].extensions?.subCode ===
        'DEFERRED_WORKSPACE_MIGRATION_ACTIONS_IN_PROGRESS';
    if (deferredGuard && attempt < 20) {
      await new Promise((done) => setTimeout(done, 500));
      continue;
    }
    const code =
      body.errors[0].extensions?.subCode ?? body.errors[0].extensions?.code;
    throw new Error(
      deferredGuard
        ? '原生 schema deferred 操作尚未完成；等待专用 workspace 队列处理后重新运行'
        : `元数据操作失败（${code ?? 'UNKNOWN'}）；未自动重试不确定写入`,
    );
  }
};

/** 兼容原生 REST 元数据的直出和 legacy 包装，并完整读取游标分页。 */
const objects = async () => {
  const values = [];
  let cursor;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('starting_after', cursor);
    const response = await localRequest(`/rest/metadata/objects?${query}`);
    assert.equal(response.status, 200, '无法读取本地对象元数据');
    const body = await response.json();
    const page = Array.isArray(body.data) ? body.data : body.data?.objects;
    assert.ok(Array.isArray(page), '未知的原生对象元数据响应');
    values.push(...page);
    if (!body.pageInfo?.hasNextPage) break;
    assert.ok(body.pageInfo.endCursor && body.pageInfo.endCursor !== cursor);
    cursor = body.pageInfo.endCursor;
  } while (true);
  return values;
};

const current = await metadata(
  '{currentWorkspace{id workspaceCustomApplication{id universalIdentifier}}}',
);
assert.equal(current.currentWorkspace.id, workspaceId);
const applicationId = current.currentWorkspace.workspaceCustomApplication?.id;
assert.ok(applicationId, '工作区缺少原生自定义应用归属');
const initialObjects = await objects();
const plan = targets.map((target) => {
  const object = initialObjects.find(
    (entry) => entry.nameSingular === target.object,
  );
  assert.ok(object, `缺少目标对象 ${target.object}`);
  const field = object.fields.find((entry) => entry.name === target.name);
  if (field) {
    assert.equal(
      field.type,
      'FILES',
      `字段类型冲突：${target.object}.${target.name}`,
    );
    assert.ok(
      field.settings == null ||
        (typeof field.settings === 'object' && !Array.isArray(field.settings)),
      '未知的 FILES settings 形状',
    );
  } else {
    assert.equal(
      target.object,
      'recruitingMailArchive',
      '现有材料字段缺失，不自动重建',
    );
    assert.equal(
      object.applicationId,
      applicationId,
      '归档对象必须由工作区自定义应用拥有',
    );
  }
  const previous = field?.settings?.maxNumberOfValues;
  assert.ok(previous == null || (Number.isInteger(previous) && previous > 0));
  const nextMaximum = Math.max(previous ?? 0, target.minimum);
  assert.ok(
    nextMaximum <= nativeMaximum,
    '保留原容量后超出当前原生上限，拒绝降级',
  );
  const action = !field
    ? 'create'
    : previous < target.minimum || previous == null
      ? 'update'
      : 'unchanged';
  if (target.object === 'recruitingMailArchive')
    assert.equal(nextMaximum, layout.perField, '原有邮件槽容量与固定布局冲突');
  if (action === 'update')
    assert.equal(
      field.applicationId,
      applicationId,
      '需更新的字段由其他应用拥有，拒绝冒充归属',
    );
  return {
    ...target,
    objectId: object.id,
    before: field ?? null,
    settings: { ...(field?.settings ?? {}), maxNumberOfValues: nextMaximum },
    action,
  };
});
const summary = plan.map((entry) => ({
  field: `${entry.object}.${entry.name}`,
  action: entry.action,
  previousMaximum: entry.before?.settings?.maxNumberOfValues ?? null,
  maximum: entry.settings.maxNumberOfValues,
  ownerPreserved: Boolean(entry.before),
}));
if (!apply) {
  console.log(
    JSON.stringify({
      mode: 'plan',
      nativeMaximum,
      layoutVersion: layout.version,
      layoutCapacity: layout.fields.length * layout.perField,
      maximumArtifacts,
      fields: summary,
    }),
  );
} else {
  const backupPath = join(
    privateDirectory,
    `mail-file-fields-${intakeOnly ? 'intake' : 'all'}-backup-v1.json`,
  );
  const backup = {
    workspaceId,
    applicationId,
    createdAt: new Date().toISOString(),
    fields: plan.map(({ object, name, objectId, before }) => ({
      object,
      name,
      objectId,
      before,
    })),
  };
  try {
    await writeFile(backupPath, JSON.stringify(backup, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(backupPath, 'utf8'));
    assert.equal(previous.workspaceId, workspaceId);
    assert.equal(previous.applicationId, applicationId);
    for (const entry of plan)
      assert.ok(
        previous.fields.some(
          (saved) =>
            saved.objectId === entry.objectId && saved.name === entry.name,
        ),
      );
  }
  for (const entry of plan) {
    if (entry.action === 'unchanged') continue;
    // settings 整体替换，所以必须将原有其他设置一并原样带回。
    if (entry.before) {
      await metadata(
        'mutation Update($input:UpdateOneFieldMetadataInput!){updateOneField(input:$input){id}}',
        {
          input: { id: entry.before.id, update: { settings: entry.settings } },
        },
        true,
      );
    } else {
      await metadata(
        'mutation Create($input:CreateOneFieldMetadataInput!){createOneField(input:$input){id}}',
        {
          input: {
            field: {
              objectMetadataId: entry.objectId,
              name: entry.name,
              label: `邮件归档原生文件 ${layout.fields.indexOf(entry.name) + 1}`,
              type: 'FILES',
              isActive: true,
              isNullable: true,
              isLabelSyncedWithName: false,
              settings: entry.settings,
            },
          },
        },
        true,
      );
    }
  }
  const updatedObjects = await objects();
  for (const entry of plan) {
    const field = updatedObjects
      .find((object) => object.id === entry.objectId)
      ?.fields.find((field) => field.name === entry.name);
    assert.ok(field, '元数据写入后目标字段不可回读');
    assert.equal(field.type, 'FILES');
    assert.equal(
      field.applicationId,
      entry.before?.applicationId ?? applicationId,
    );
    assert.deepEqual(field.settings, entry.settings);
  }
  const report = {
    mode: 'applied',
    verifiedAt: new Date().toISOString(),
    nativeMaximum,
    layoutVersion: layout.version,
    layoutCapacity: layout.fields.length * layout.perField,
    maximumArtifacts,
    fields: summary,
    metadataReadbackVerified: true,
    archiveSlotsVerified: !intakeOnly,
    deferredActionsVerified: false,
  };
  await writeFile(
    join(
      privateDirectory,
      `mail-file-fields-${intakeOnly ? 'intake' : 'all'}-report.json`,
    ),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
