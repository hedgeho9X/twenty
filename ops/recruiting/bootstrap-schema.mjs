/** Adds recruiting fields through official metadata APIs; legacy records stay intact. */
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

import { localGraphql } from './local-api.mjs';

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
  await localGraphql(
    'mutation Create($input:CreateOneObjectInput!){createOneObject(input:$input){id}}',
    { input: { object: { ...object, isLabelSyncedWithName: false } } },
  );
  created.push(`object:${object.nameSingular}`);
  metadata = inspect();
}

const fields = [
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
  await localGraphql(
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
