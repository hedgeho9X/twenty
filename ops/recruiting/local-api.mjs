/** Calls only the isolated local instance, retaining session credentials in private storage. */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sessionPath = join(repository, '.local/recruiting/session.json');
const baseUrl = 'http://127.0.0.1:23001';

/** Refreshes the local credential when necessary; never logs token responses. */
const getSession = async () => {
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  if (Date.parse(session.expiresAt) > Date.now() + 60_000) return session;
  if (!session.refreshToken) throw new Error('Local session requires sign-in');
  const response = await fetch(`${baseUrl}/metadata`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query:
        'mutation Refresh($appToken:String!){renewToken(appToken:$appToken){tokens{accessOrWorkspaceAgnosticToken{token expiresAt} refreshToken{token expiresAt}}}}',
      variables: { appToken: session.refreshToken },
    }),
  });
  const body = await response.json();
  if (body.errors) throw new Error('Local session refresh failed');
  const tokens = body.data.renewToken.tokens;
  const next = {
    ...session,
    token: tokens.accessOrWorkspaceAgnosticToken.token,
    expiresAt: tokens.accessOrWorkspaceAgnosticToken.expiresAt,
    refreshToken: tokens.refreshToken.token,
  };
  await writeFile(sessionPath, JSON.stringify(next), { mode: 0o600 });
  return next;
};

/** Sends an authenticated local request with an explicit timeout and no redirects. */
export const localRequest = async (path, options = {}) => {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new Error('Expected a local API path');
  const session = await getSession();
  return fetch(`${baseUrl}${path}`, {
    ...options,
    redirect: 'error',
    signal: options.signal ?? AbortSignal.timeout(60_000),
    headers: {
      'content-type': 'application/json',
      origin: session.origin,
      ...options.headers,
      authorization: `Bearer ${session.token}`,
    },
  });
};

/** Returns GraphQL data while exposing only error codes and messages, never extensions or headers. */
export const localGraphql = async (
  query,
  variables = {},
  path = '/metadata',
) => {
  const response = await localRequest(path, {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors)
    throw new Error(body.errors.map((error) => error.message).join('; '));
  return body.data;
};

/** Uploads through official targets and completion before submitting a recruiting task. */
export const localUpload = async (filePath) => {
  const filename = basename(filePath);
  const bytes = await readFile(filePath);
  const metadata = spawnSync(
    'docker',
    [
      'exec',
      'twenty-recruiting-db-1',
      'psql',
      '-U',
      'twenty',
      '-d',
      'recruiting',
      '-X',
      '-Atc',
      `SELECT f.id FROM core."fieldMetadata" f JOIN core."objectMetadata" o ON o.id=f."objectMetadataId" WHERE o."nameSingular"='recruitingIntake' AND f.name='files' AND o."workspaceId"='4cb349cd-5765-4826-a2cb-73e5c5c2d564';`,
    ],
    { encoding: 'utf8' },
  );
  if (metadata.status !== 0 || !metadata.stdout.trim())
    throw new Error('Intake upload field is unavailable');
  const result = await localGraphql(
    'mutation Upload($filename:String!,$size:Float!,$fieldId:String!){createFileUpload(filename:$filename,size:$size,fileFolder:FilesField,fieldMetadataId:$fieldId){fileId uploadUrl contentType}}',
    { filename, size: bytes.length, fieldId: metadata.stdout.trim() },
  );
  const target = result.createFileUpload;
  const url = new URL(target.uploadUrl);
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Refusing a nonlocal upload target');
  url.hostname = '127.0.0.1';
  url.port = '23001';
  const uploaded = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': target.contentType },
    body: bytes,
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if (!uploaded.ok)
    throw new Error(`Native upload failed (${uploaded.status})`);
  await localGraphql(
    'mutation Complete($fileId:String!){completeFileUpload(fileId:$fileId){id size}}',
    { fileId: target.fileId },
  );
  return { fileId: target.fileId, label: filename, role: 'primary' };
};
