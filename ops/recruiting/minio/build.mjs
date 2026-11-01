/** Builds the pinned official MinIO source into an isolated local-only container image. */
import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const version = 'v0.0.0-20260212201848-7aac2a2c5b7c';
const workspace = join(root, '.local/recruiting/minio-build');
/** Fails before image creation if the compiler or container runtime rejects the build. */
const run = (command, args, env = process.env) => {
  const r = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) throw Error(command + ' failed');
};
const binary = join(workspace, 'bin/linux_arm64/minio');
const exists = await stat(binary).then(
  () => true,
  () => false,
);
if (!exists)
  run('go', ['install', 'github.com/minio/minio@' + version], {
    ...process.env,
    GOOS: 'linux',
    GOARCH: 'arm64',
    CGO_ENABLED: '0',
    GOPATH: workspace,
  });
const check = spawnSync('go', ['version', '-m', binary], { encoding: 'utf8' });
if (!check.stdout.includes(version))
  throw Error('Unexpected MinIO source version');
const context = join(workspace, 'container');
await mkdir(context, { recursive: true });
await copyFile(binary, join(context, 'minio'));
await copyFile(
  join(workspace, 'pkg/mod/github.com/minio/minio@' + version, 'LICENSE'),
  join(context, 'LICENSE'),
);
run('docker', [
  'build',
  '--platform',
  'linux/arm64',
  '-f',
  'ops/recruiting/minio/Dockerfile',
  '-t',
  'twenty-recruiting/minio:7aac2a2c5b7c',
  context,
]);
