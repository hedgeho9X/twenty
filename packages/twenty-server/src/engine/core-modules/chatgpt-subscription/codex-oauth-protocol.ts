import { createHash } from 'node:crypto';
/** Implements the Codex public-client OAuth grant independently of local Codex files and processes. */
import { decode } from 'jsonwebtoken';
import { z } from 'zod';
import {
  createSiwcTransaction,
  type SiwcTransaction,
  SiwcProtocol,
} from './siwc-protocol';

export const CODEX_CLIENT_VERSION = '0.166.0';
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const tokenSchema = z.object({
  access_token: z.string().min(32),
  refresh_token: z.string().min(16).optional(),
  id_token: z.string().min(32).optional(),
  expires_in: z.number().positive(),
  token_type: z.string().regex(/^bearer$/i),
  scope: z.string().default('openid profile email offline_access'),
});

export const createCodexTransaction = (
  hostId: string,
  subject?: string,
): SiwcTransaction => ({
  ...createSiwcTransaction(
    'http://127.0.0.1:1455/auth/callback',
    hostId,
    CODEX_CLIENT_ID,
    subject,
  ),
  redirectUri: CODEX_REDIRECT_URI,
});
export const codexAuthorizeUrl = (transaction: SiwcTransaction) => {
  const url = new URL('https://auth.openai.com/oauth/authorize');
  const publicParameters = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: transaction.redirectUri,
    scope: 'openid profile email offline_access',
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: createHash('sha256')
      .update(transaction.verifier)
      .digest('base64url'),
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  });
  url.search = publicParameters.toString();
  return url.toString();
};

export class CodexOAuthProtocol {
  constructor(
    private readonly transport: typeof fetch,
    private readonly verifier: SiwcProtocol,
  ) {}

  /** Account claims are decoded only after signature, audience and subject validation. */
  async identity(idToken: string, nonce?: string, accessToken?: string) {
    const identity = await this.verifier.identity(
      idToken,
      CODEX_CLIENT_ID,
      nonce,
      accessToken,
    );
    const claims = z
      .object({
        'https://api.openai.com/auth': z.object({
          chatgpt_account_id: z.string().min(1),
        }),
      })
      .parse(decode(idToken));
    return {
      ...identity,
      accountId: claims['https://api.openai.com/auth'].chatgpt_account_id,
    };
  }
  async exchange(transaction: SiwcTransaction, code: string) {
    const tokens = await this.token({
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      code,
      code_verifier: transaction.verifier,
      redirect_uri: transaction.redirectUri,
    });
    if (!tokens.id_token) throw new Error('CODEX_IDENTITY_MISSING');
    const identity = await this.identity(
      tokens.id_token,
      transaction.nonce,
      tokens.access_token,
    );
    if (transaction.subject && transaction.subject !== identity.subject)
      throw new Error('CODEX_ACCOUNT_CHANGED');
    return { clientId: CODEX_CLIENT_ID, tokens, identity };
  }
  async refresh(refreshToken: string) {
    return this.token({
      grant_type: 'refresh_token',
      client_id: CODEX_CLIENT_ID,
      refresh_token: refreshToken,
    });
  }
  private async token(parameters: Record<string, string>) {
    const response = await this.transport(
      'https://auth.openai.com/oauth/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parameters),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error?.error === 'invalid_grant'
          ? 'SIWC_REAUTH_REQUIRED'
          : 'CODEX_TOKEN_EXCHANGE_UNAVAILABLE',
      );
    }
    return tokenSchema.parse(await response.json());
  }
}
