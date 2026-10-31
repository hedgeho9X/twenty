/** Adds recruiting fields through official metadata APIs; legacy records stay intact. */
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

import { localGraphql } from './local-api.mjs';

/** Retries only the native pre-mutation deferred-action guard; uncertain mutation results are never blindly retried. */
const mutateMetadata = async (query, variables) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await localGraphql(query, variables);
    } catch (error) {
      if (
        attempt >= 20 ||
        !/deferred schema action\(s\) are still running/.test(error.message)
      )
        throw error;
      await new Promise((done) => setTimeout(done, 500));
    }
  }
};

/** Reads metadata identities from the dedicated local database without exporting record content. */
const inspect = () => {
  const query = `SELECT json_build_object('objects',(SELECT json_agg(json_build_object('id',id,'name',"nameSingular")) FROM core."objectMetadata" WHERE "workspaceId"='4cb349cd-5765-4826-a2cb-73e5c5c2d564'),'fields',(SELECT json_agg(json_build_object('objectId',"objectMetadataId",'name',name,'type',type)) FROM core."fieldMetadata" WHERE "workspaceId"='4cb349cd-5765-4826-a2cb-73e5c5c2d564'));`;
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'twenty-recruiting-db-1',
      'psql',
      '-U',
      'twenty',
      '-d',
      'recruiting',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error('Local schema inspection failed');
  return JSON.parse(result.stdout);
};

let metadata = inspect();
const created = [];
for (const object of [
  {
    nameSingular: 'recruitingMailEvent',
    namePlural: 'recruitingMailEvents',
    labelSingular: '邮件来源事件',
    labelPlural: '邮件来源事件',
    icon: 'IconMail',
  },
  {
    nameSingular: 'recruitingMailArchive',
    namePlural: 'recruitingMailArchives',
    labelSingular: '招聘邮件归档',
    labelPlural: '招聘邮件归档',
    icon: 'IconMail',
  },
  {
    nameSingular: 'recruitingDraft',
    namePlural: 'recruitingDrafts',
    labelSingular: '招聘草稿',
    labelPlural: '招聘草稿',
    icon: 'IconFilePencil',
  },
  {
    nameSingular: 'recruitingMatchRun',
    namePlural: 'recruitingMatchRuns',
    labelSingular: '匹配任务',
    labelPlural: '匹配任务',
    icon: 'IconArrowsShuffle',
  },
  {
    nameSingular: 'recruitingPairEvaluation',
    namePlural: 'recruitingPairEvaluations',
    labelSingular: '人岗评分',
    labelPlural: '人岗评分',
    icon: 'IconChartBar',
  },
  {
    nameSingular: 'recruitingProfileVersion',
    namePlural: 'recruitingProfileVersions',
    labelSingular: '材料版本',
    labelPlural: '材料版本',
    icon: 'IconHistory',
  },
]) {
  if (metadata.objects.some((entry) => entry.name === object.nameSingular))
    continue;
  await mutateMetadata(
    'mutation Create($input:CreateOneObjectInput!){createOneObject(input:$input){id}}',
    { input: { object: { ...object, isLabelSyncedWithName: false } } },
  );
  created.push(`object:${object.nameSingular}`);
  metadata = inspect();
}

const fields = [
  ['recruitingMailEvent', 'sourceKey', 'TEXT', '接收事件'],
  ['recruitingMailEvent', 'sourceHash', 'TEXT', '原文摘要'],
  ['recruitingMailEvent', 'archiveId', 'UUID', '归档记录'],
  ['recruitingMailEvent', 'payload', 'RAW_JSON', '可信来源'],
  ['recruitingMailArchive', 'status', 'TEXT', '归档状态'],
  ['recruitingMailArchive', 'sourceHash', 'TEXT', '原文摘要'],
  ['recruitingMailArchive', 'payload', 'RAW_JSON', '完整来源与材料'],
  ['recruitingMailArchive', 'error', 'TEXT', '处理说明'],
  ['recruitingDraft', 'kind', 'TEXT', '草稿类型'],
  ['recruitingDraft', 'candidateId', 'UUID', '候选人记录'],
  ['recruitingDraft', 'jobId', 'UUID', '岗位记录'],
  ['recruitingDraft', 'status', 'TEXT', '草稿状态'],
  ['recruitingDraft', 'payload', 'RAW_JSON', '生成记录'],
  ['recruitingDraft', 'title', 'TEXT', '标题'],
  ['recruitingDraft', 'body', 'TEXT', '正文'],
  ['recruitingDraft', 'error', 'TEXT', '错误说明'],
  ['recruitingContact', 'recruitingReceipt', 'RAW_JSON', '人工操作凭据'],
  ['company', 'recruitingDescription', 'TEXT', '公司简介'],
  ['person', 'recruitingProfile', 'RAW_JSON', '招聘资料'],
  ['recruitmentJob', 'recruitingProfile', 'RAW_JSON', '岗位资料'],
  ['recruitingMatchRun', 'direction', 'TEXT', '匹配方向'],
  ['recruitingMatchRun', 'subjectId', 'TEXT', '发起记录'],
  ['recruitingMatchRun', 'status', 'TEXT', '处理状态'],
  ['recruitingMatchRun', 'payload', 'RAW_JSON', '任务详情'],
  ['recruitingPairEvaluation', 'candidateId', 'TEXT', '候选人记录'],
  ['recruitingPairEvaluation', 'jobId', 'TEXT', '岗位记录'],
  ['recruitingPairEvaluation', 'status', 'TEXT', '评分状态'],
  ['recruitingPairEvaluation', 'score', 'NUMBER', '能力分'],
  ['recruitingPairEvaluation', 'payload', 'RAW_JSON', '评分详情'],
  ['recruitingProfileVersion', 'subjectId', 'TEXT', '来源记录'],
  ['recruitingProfileVersion', 'kind', 'TEXT', '材料类型'],
  ['recruitingProfileVersion', 'payload', 'RAW_JSON', '版本内容'],
];
for (const [objectName, name, type, label] of fields) {
  const objectId = metadata.objects.find(
    (entry) => entry.name === objectName,
  )?.id;
  if (!objectId) throw new Error(`Required object is absent: ${objectName}`);
  const existing = metadata.fields.find(
    (entry) => entry.objectId === objectId && entry.name === name,
  );
  if (existing) {
    if (existing.type !== type)
      throw new Error(`Conflicting field type: ${objectName}.${name}`);
    continue;
  }
  await mutateMetadata(
    'mutation Create($input:CreateOneFieldMetadataInput!){createOneField(input:$input){id}}',
    {
      input: {
        field: {
          objectMetadataId: objectId,
          name,
          label,
          type,
          isActive: true,
          isNullable: true,
          isLabelSyncedWithName: false,
        },
      },
    },
  );
  created.push(`field:${objectName}.${name}`);
}
await writeFile(
  '.local/recruiting/schema-bootstrap-report.json',
  JSON.stringify({ created }, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify({ created: created.length, items: created }));
