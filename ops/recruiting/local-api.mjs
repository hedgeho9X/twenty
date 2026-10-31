/** Calls only the isolated local instance, retaining session credentials in private storage. */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
      ...(options.body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
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
  const response = await localRequest('/recruiting/uploads/targets', {
    method: 'POST',
    body: JSON.stringify({ filename, size: bytes.length }),
  });
  if (!response.ok)
    throw new Error(`Recruiting upload target failed (${response.status})`);
  const target = await response.json();
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
  const completed = await localRequest('/recruiting/uploads/complete', {
    method: 'POST',
    body: JSON.stringify({ uploadReceipt: target.uploadReceipt }),
  });
  if (!completed.ok)
    throw new Error(
      `Recruiting upload completion failed (${completed.status})`,
    );
  return completed.json();
};
