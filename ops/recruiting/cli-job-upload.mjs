/** Retains completed JD upload capabilities in an owner-only cache so the same explicit key survives client restarts. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
  link,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/** Hashes complete source bytes without retaining an entire multi-file batch in memory. */
const digestFile = async (path) => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
};
/** Requires caller ownership and private permissions before trusting cached submission capabilities. */
const assertPrivate = async (path, directory = false) => {
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    (process.getuid && info.uid !== process.getuid()) ||
    info.mode & 0o077
  )
    throw new Error(
      'Recruiting CLI cache must be private and owned by the current user',
    );
};
/** Atomically publishes an immutable slot; competing callers always use the same winning upload reference. */
const publish = async (path, value) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), {
    mode: 0o600,
    flag: 'wx',
  });
  try {
    await link(temporary, path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await unlink(temporary);
  }
  await assertPrivate(path);
  return JSON.parse(await readFile(path, 'utf8'));
};
/** Reads an immutable completed slot; malformed or unsafe entries fail closed instead of uploading different references. */
const existing = async (path) => {
  try {
    await assertPrivate(path);
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};

/** Uses current server authorization even when a task receipt is cached; no API key or source text is written locally. */
export const submitJobMaterials = async ({
  client,
  filenames,
  request,
  baseUrl,
  token,
  persistent = true,
  stateDirectory = process.env.TWENTY_CLI_STATE_DIR ??
    join(homedir(), '.cache', 'twenty-recruiting'),
  fetcher = fetch,
}) => {
  if (filenames.length > 30)
    throw new Error('A JD batch supports at most 30 files');
  const files = [];
  for (const filename of filenames) {
    const path = resolve(filename);
    const info = await lstat(path);
    if (!info.isFile() || info.size < 1 || info.size > 50 * 1024 * 1024)
      throw new Error('JD files must be regular files between 1 byte and 50MB');
    files.push({
      path,
      label: basename(path),
      hash: await digestFile(path),
      size: info.size,
    });
  }
  const digest = (value) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const inputHash = digest({
    request,
    files: files.map(({ label, hash, size }) => ({ label, hash, size })),
  });
  let directory;
  if (persistent && files.length) {
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await assertPrivate(stateDirectory, true);
    directory = join(
      stateDirectory,
      digest({
        origin: new URL(baseUrl).origin,
        credential: digest(token),
        key: request.idempotencyKey,
      }),
    );
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await assertPrivate(directory, true);
    const manifest = await publish(join(directory, 'manifest.json'), {
      version: 1,
      inputHash,
    });
    if (manifest.inputHash !== inputHash)
      throw new Error(
        'This JD key already identifies different materials or instructions; use a new key',
      );
    const receipt = await existing(join(directory, 'task.json'));
    if (receipt) {
      if (!/^[a-f0-9-]{36}$/i.test(receipt.intakeId))
        throw new Error('Invalid cached JD task reference');
      return client.request(`/recruiting/resume-intakes/${receipt.intakeId}`);
    }
  }
  const references = [];
  for (const [index, file] of files.entries()) {
    const path = directory
      ? join(directory, `upload-${index}.json`)
      : undefined;
    let completed = path ? await existing(path) : undefined;
    if (!completed) {
      const bytes = await readFile(file.path);
      if (createHash('sha256').update(bytes).digest('hex') !== file.hash)
        throw new Error(
          'A JD file changed during upload; retry with stable materials',
        );
      const target = await client.post('uploads/targets', {
        filename: file.label,
        size: bytes.length,
      });
      const url = new URL(target.uploadUrl);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error('Invalid upload target');
      if (
        url.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )
        throw new Error('Refusing a plaintext remote upload target');
      const uploaded = await fetcher(url, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': target.contentType },
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      });
      if (!uploaded.ok) throw new Error(`Upload failed (${uploaded.status})`);
      completed = await client.post('uploads/complete', {
        uploadReceipt: target.uploadReceipt,
      });
      if (path) completed = await publish(path, completed);
    }
    if (
      completed.label !== file.label ||
      typeof completed.uploadReceipt !== 'string' ||
      !completed.fileId
    )
      throw new Error(
        'Invalid cached upload capability; inspect the retained task before replacing its key',
      );
    references.push(completed);
  }
  const result = await client.post('job-intakes', {
    ...request,
    files: references,
  });
  if (directory && result.intakeId)
    await publish(join(directory, 'task.json'), { intakeId: result.intakeId });
  return result;
};
