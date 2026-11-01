/** Exercises PKCE and verified account binding without a real account or browser. */
import { createHash } from 'node:crypto';
import {
  CodexOAuthProtocol,
  createCodexTransaction,
  codexAuthorizeUrl,
  CODEX_CLIENT_ID,
} from './codex-oauth-protocol';

const identityToken = (accountId = 'account') =>
  [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        'https://api.openai.com/auth': { chatgpt_account_id: accountId },
      }),
    ).toString('base64url'),
    'signature',
  ].join('.');
it('keeps the verifier out of the public authorization URL', () => {
  const transaction = createCodexTransaction('host');
  const url = new URL(codexAuthorizeUrl(transaction));
  expect(url.origin).toBe('https://auth.openai.com');
  expect(url.searchParams.get('client_id')).toBe(CODEX_CLIENT_ID);
  expect(url.searchParams.get('code_challenge')).toBe(
    createHash('sha256').update(transaction.verifier).digest('base64url'),
  );
  expect(url.toString()).not.toContain(transaction.verifier);
});
it('verifies the identity before binding its account and exchanges the exact verifier', async () => {
  const transaction = createCodexTransaction('host');
  const transport = jest.fn(async () =>
    Response.json({
      access_token: 'access-'.repeat(8),
      refresh_token: 'refresh-'.repeat(8),
      id_token: identityToken(),
      expires_in: 3600,
      token_type: 'Bearer',
    }),
  );
  const verifier = {
    identity: jest.fn(async () => ({
      subject: 'subject',
      issuer: 'https://auth.openai.com',
    })),
  };
  const protocol = new CodexOAuthProtocol(
    transport as never,
    verifier as never,
  );
  const result = await protocol.exchange(transaction, 'one-time-code');
  expect(result.identity.accountId).toBe('account');
  expect(verifier.identity).toHaveBeenCalledWith(
    identityToken(),
    CODEX_CLIENT_ID,
    transaction.nonce,
    'access-'.repeat(8),
  );
  const parameters = (
    transport.mock.calls as unknown as [string, RequestInit][]
  )[0][1].body as URLSearchParams;
  expect(parameters.get('code_verifier')).toBe(transaction.verifier);
});
it('does not trust an account id when signature validation fails', async () => {
  const protocol = new CodexOAuthProtocol(
    jest.fn() as never,
    {
      identity: jest.fn(async () => {
        throw new Error('bad-signature');
      }),
    } as never,
  );
  await expect(protocol.identity(identityToken())).rejects.toThrow(
    'bad-signature',
  );
});
