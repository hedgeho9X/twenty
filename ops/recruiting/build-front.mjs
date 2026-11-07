/** Builds frontend assets with current source catalogs so new labels never render as translation IDs. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../packages/twenty-front/', import.meta.url));
const bin = fileURLToPath(new URL('../../node_modules/.bin/', import.meta.url));
for (const [command, args] of [
  ['lingui', ['extract', '--locale', 'en,zh-CN', '--workers', '2']],
  ['lingui', ['compile']],
  ['vite', ['build']],
]) {
  const result = spawnSync(`${bin}${command}`, args, { cwd, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Frontend build failed: ${command}`);
}
