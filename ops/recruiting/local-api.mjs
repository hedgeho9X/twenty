/** Calls only the isolated local instance, retaining session credentials in private storage. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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
        'mutation Refresh($refreshToken:String!,$origin:String!){getAuthTokensFromRefreshToken(refreshToken:$refreshToken,origin:$origin){tokens{accessOrWorkspaceAgnosticToken{token expiresAt} refreshToken{token expiresAt}}}}',
      variables: { refreshToken: session.refreshToken, origin: session.origin },
    }),
  });
  const body = await response.json();
  if (body.errors) throw new Error('Local session refresh failed');
  const tokens = body.data.getAuthTokensFromRefreshToken.tokens;
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
