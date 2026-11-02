/** Packages only allowlisted CLI sources and the recruiting skill for a public release. */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.argv[2] ?? `${root}/.local/recruiting/release`);
await mkdir(output, { recursive: true, mode: 0o700 });

/** Stops packaging immediately when an external archiver fails. */
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr}`);
  return result.stdout;
};
const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', output], `${root}/ops/recruiting`));
await rename(`${output}/${packed[0].filename}`, `${output}/fanhan-cli.tgz`);
run('zip', ['-r', `${output}/fanhan-recruiting-skill.zip`, 'fanhan-recruiting', '-x', '*/.DS_Store', '*/__pycache__/*'], `${root}/.agents/skills`);
const artifacts = ['fanhan-cli.tgz', 'fanhan-recruiting-skill.zip'];
const checksums = [];
for (const name of artifacts) {
  checksums.push(`${createHash('sha256').update(await readFile(`${output}/${name}`)).digest('hex')}  ${name}`);
}
await writeFile(`${output}/SHA256SUMS`, checksums.join('\n') + '\n');
console.log(JSON.stringify({ version: packed[0].version, artifacts: [...artifacts, 'SHA256SUMS'] }));
