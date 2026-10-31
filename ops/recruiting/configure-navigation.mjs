/** Hides migrated legacy launchers and internal task tables through native metadata, only in the isolated local instance. */
import { readFile, writeFile } from 'node:fs/promises';
import { localGraphql } from './local-api.mjs';

const backupPath = '.local/recruiting/navigation-backup.json';
const fields =
  'id name type link icon color folderId pageLayoutId position targetRecordId targetObjectMetadataId viewId userWorkspaceId';
const internalObjects = new Set([
  '946f4072-87a6-45cc-bdf3-ddfcfb279c95',
  '2beb1a06-a638-4a14-b411-9e26635c8a0f',
  'ce85096f-8c9a-4f23-8f86-0555751aeae3',
  '00419050-26ce-41a8-80be-d797aa85a4bf',
]);
const legacyLabels = new Set([
  '匹配跟进 · 复制话术',
  '候选人页面展示',
  '候选人沟通页',
]);

/** Restores backed-up native entries without touching any business record or workflow. */
const restore = async () => {
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  const current = await localGraphql(`{navigationMenuItems{${fields}}}`);
  for (const item of backup.navigation) {
    if (current.navigationMenuItems.some((entry) => entry.id === item.id))
      continue;
    await localGraphql(
      'mutation Restore($input:CreateNavigationMenuItemInput!){createNavigationMenuItem(input:$input){id}}',
      { input: item },
    );
  }
  for (const item of backup.commands)
    await localGraphql(
      'mutation Restore($id:UUID!){resetCommandMenuItem(id:$id){id}}',
      { id: item.id },
    );
  console.log(
    JSON.stringify({
      restoredNavigation: backup.navigation.length,
      resetCommands: backup.commands.length,
    }),
  );
};

if (process.argv.includes('--restore')) {
  await restore();
} else {
  const data = await localGraphql(
    `{navigationMenuItems{${fields}} commandMenuItems{id label applicationId isActive}}`,
  );
  const navigation = data.navigationMenuItems.filter(
    (item) =>
      internalObjects.has(item.targetObjectMetadataId) ||
      ['运营工作台', 'Agent Skill / CLI'].includes(item.name),
  );
  const commands = data.commandMenuItems.filter(
    (item) =>
      item.isActive && item.applicationId && legacyLabels.has(item.label),
  );
  // Never overwrite the first rollback snapshot on an idempotent second run.
  try {
    await writeFile(backupPath, JSON.stringify({ navigation, commands }), {
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  for (const item of navigation)
    await localGraphql(
      'mutation Hide($id:UUID!){deleteNavigationMenuItem(id:$id){id}}',
      { id: item.id },
    );
  for (const item of commands)
    await localGraphql(
      'mutation Hide($id:UUID!){deleteCommandMenuItem(id:$id){id}}',
      { id: item.id },
    );
  console.log(
    JSON.stringify({
      hiddenNavigation: navigation.length,
      deactivatedCommands: commands.length,
    }),
  );
}
