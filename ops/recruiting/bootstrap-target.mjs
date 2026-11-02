/** Plans or applies additive recruiting metadata on an explicitly verified workspace. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { localRequest } from './local-api.mjs';
import {
  recruitingObjects,
  recruitingFields,
} from './backups/metadata-blueprint.mjs';
import {
  createMetadataClient,
  planMetadata,
} from './backups/target-metadata.mjs';
const args = process.argv.slice(2);
const value = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--apply') continue;
  if (
    !['--target', '--workspace-id', '--report'].includes(args[i]) ||
    !args[++i] ||
    args[i].startsWith('--')
  )
    throw new Error(
      'Usage: [--target HTTPS_ORIGIN --workspace-id UUID] [--apply] [--report PATH]',
    );
}
const target = value('--target') ?? 'http://127.0.0.1:23001';
const workspaceId =
  value('--workspace-id') ??
  (value('--target') ? undefined : '4cb349cd-5765-4826-a2cb-73e5c5c2d564');
const apply = args.includes('--apply');
const client = createMetadataClient({
  target,
  workspaceId,
  token: process.env.FANHAN_API_KEY ?? process.env.TWENTY_API_KEY,
  ...(value('--target') ? {} : { localRequest }),
});
const objects = [
  ...recruitingObjects,
  {
    nameSingular: 'recruitingIntake',
    namePlural: 'recruitingIntakes',
    labelSingular: '资料处理',
    labelPlural: '资料处理',
    icon: 'IconFiles',
  },
];
const intake = JSON.parse(
  await readFile(
    new URL('./backups/intake-blueprint.json', import.meta.url),
    'utf8',
  ),
);
const fields = recruitingFields.map(([object, name, type, label]) => [
  object,
  { name, type, label },
]);
fields.push(
  ...intake.map((field) => [
    'recruitingIntake',
    {
      ...field,
      ...(field.options
        ? { options: field.options.map((o) => ({ ...o, id: randomUUID() })) }
        : {}),
    },
  ]),
);
for (let i = 0; i < 9; i++)
  fields.push([
    'recruitingMailArchive',
    {
      name: i ? `sourceFiles${i + 1}` : 'sourceFiles',
      type: 'FILES',
      label: `邮件原始文件 ${i + 1}`,
      settings: { maxNumberOfValues: 60 },
    },
  ]);
fields.push([
  'person',
  {
    name: 'candidateResumes',
    type: 'FILES',
    label: '简历',
    settings: { maxNumberOfValues: 30 },
  },
]);
let current = await client.inspect();
const initial = planMetadata(current, objects, fields);
const report = {
  target,
  workspaceId,
  mode: apply ? 'apply' : 'plan',
  actions: initial,
  before: current,
  completed: [],
};
const path = resolve(
  value('--report') ?? '.local/recruiting/metadata-target-report.json',
);
await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
await writeFile(path, JSON.stringify({ ...report, before: current }, null, 2), {
  mode: 0o600,
});
if (apply) {
  for (const item of initial.filter((item) => item.action === 'createObject')) {
    await client.graphql(
      'mutation Create($input:CreateOneObjectInput!){createOneObject(input:$input){id}}',
      { input: { object: { ...item.object, isLabelSyncedWithName: false } } },
    );
    report.completed.push(`object:${item.object.nameSingular}`);
  }
  current = await client.inspect();
  for (const item of planMetadata(current, objects, fields)) {
    if (item.action === 'createObject')
      throw new Error(
        'Created object not visible; stop before dependent writes',
      );
    if (item.action === 'createField') {
      const objectMetadataId = current.find(
        (o) => o.nameSingular === item.objectName,
      ).id;
      await client.graphql(
        'mutation Create($input:CreateOneFieldMetadataInput!){createOneField(input:$input){id}}',
        {
          input: {
            field: {
              ...item.field,
              objectMetadataId,
              isActive: true,
              isNullable: true,
              isLabelSyncedWithName: false,
            },
          },
        },
      );
    } else
      await client.graphql(
        'mutation Update($input:UpdateOneFieldMetadataInput!){updateOneField(input:$input){id}}',
        { input: { id: item.id, update: item.update } },
      );
    report.completed.push(
      `${item.action}:${item.objectName}.${item.field?.name ?? item.name}`,
    );
  }
  const remaining = planMetadata(await client.inspect(), objects, fields);
  if (remaining.length)
    throw new Error(
      'Metadata readback is incomplete; inspect report and rerun plan',
    );
  report.verified = true;
  await writeFile(path, JSON.stringify(report, null, 2), { mode: 0o600 });
}
console.log(
  JSON.stringify({
    target,
    workspaceId,
    mode: report.mode,
    planned: initial.length,
    completed: report.completed.length,
    verified: report.verified ?? false,
    report: path,
  }),
);
