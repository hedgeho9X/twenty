/** Runs upstream build targets directly when local Nx project discovery cannot bootstrap. */
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const environment = {
  ...process.env,
  PATH: [
    join(repository, 'node_modules/.bin'),
    join(repository, 'ops/recruiting/bin'),
    dirname(process.execPath),
    process.env.PATH,
  ].join(delimiter),
  NX_NO_CLOUD: 'true',
};

/** Uses only checked-in project commands, preserving their package working directory. */
const runTarget = async (packageName, targetName) => {
  const projectRoot = `packages/${packageName}`;
  const project = JSON.parse(
    await readFile(join(repository, projectRoot, 'project.json'), 'utf8'),
  );
  const options = project.targets[targetName]?.options;
  if (!options)
    throw new Error(
      `No explicit upstream target: ${packageName}:${targetName}`,
    );
  const commands = options.commands ?? [options.command];
  const replace = (value) =>
    value
      .replaceAll('{projectRoot}', projectRoot)
      .replaceAll('{workspaceRoot}', repository);
  const cwd = resolve(repository, replace(options.cwd ?? '.'));
  if (cwd !== repository && !cwd.startsWith(repository + '/'))
    throw new Error('Build cwd must remain in the checkout');

  for (const command of commands) {
    if (typeof command !== 'string')
      throw new Error('Unsupported upstream build command format');
    console.log(`Building ${packageName}:${targetName}`);
    const result = spawnSync('/bin/sh', ['-c', replace(command)], {
      cwd,
      env: environment,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Upstream build failed: ${packageName}:${targetName} (${result.status ?? result.signal})`,
      );
  }
};

await runTarget('twenty-shared', 'generateBarrels');
await runTarget('twenty-shared', 'build');
await runTarget('twenty-client-sdk', 'build');
await runTarget('twenty-emails', 'lingui:compile');
await runTarget('twenty-emails', 'build');
await runTarget('twenty-server', 'lingui:compile');
await runTarget('twenty-server', 'build');
