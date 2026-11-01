/** Generates local MinIO credentials once and keeps them outside version control. */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const ensureMinioConfig = async (privateDirectory) => {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const path = join(privateDirectory, 'minio.json');
  let config;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = {
      endpoint: 'http://127.0.0.1:23004',
      bucket: 'twenty-local',
      region: 'us-east-1',
      accessKeyId: 'twenty-local',
      secretAccessKey: randomBytes(32).toString('hex'),
    };
    await writeFile(path, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  }
  await writeFile(
    join(privateDirectory, 'minio.env'),
    `MINIO_ROOT_USER=${config.accessKeyId}\nMINIO_ROOT_PASSWORD=${config.secretAccessKey}\nMINIO_BROWSER_REDIRECT_URL=http://localhost:23005\nMINIO_UPDATE=off\n`,
    { mode: 0o600 },
  );
  return config;
};
