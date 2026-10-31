/** Implements the official public-client SIWC protocol, keeping identity validation separate from plan-usage permission. */
import {
  createHash,
  createPublicKey,
  randomBytes,
  type JsonWebKey,
} from 'node:crypto';
import { decode, verify, type JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';

const origin = 'https://auth.openai.com';
export const SIWC_RESOURCE = 'https://api.openai.com/v1';
export const SIWC_PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const tokensSchema = z.object({
  access_token: z.string().min(32).max(50_000),
  refresh_token: z.string().min(16).max(50_000).optional(),
  id_token: z.string().min(32).max(50_000).optional(),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().positive().max(86400),
  scope: z.string().max(5000),
});
/** Credentials remain server-side and are encrypted together by the connection store. */
export type SiwcTokens = z.infer<typeof tokensSchema>;
/** A transaction owns a fresh verifier, state and OIDC nonce, never returned as general application authentication. */
export type SiwcTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  hostId: string;
  subject?: string;
};
/** Only validated identity claims may label or replace an account registration. */
export type SiwcIdentity = { subject: string; email?: string; issuer: string };

/** Generates a new one-attempt PKCE tuple; the callback port may vary but the loopback host/path are fixed. */
export const createSiwcTransaction = (
  redirectUri: string,
  hostId: string,
  clientId = 'dynamic_agent_client',
  subject?: string,
): SiwcTransaction => {
  const url = new URL(redirectUri);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/auth/callback' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Invalid SIWC callback');
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
    redirectUri,
    clientId,
    hostId,
    subject,
  };
};
/** Builds a browser URL without access/refresh/ID-token hints, which must never enter frontend JavaScript. */
export const siwcAuthorizeUrl = (attempt: SiwcTransaction) => {
  const url = new URL(`${origin}/api/accounts/authorize`);
  const parameters = {
    client_id: attempt.clientId,
    ext_agent_host_id: attempt.hostId,
    response_type: 'code',
    redirect_uri: attempt.redirectUri,
    scope: `openid profile email offline_access resource.invoke ${SIWC_PLAN_SCOPE}`,
    resource: SIWC_RESOURCE,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256')
      .update(attempt.verifier)
      .digest('base64url'),
  };
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  if (attempt.clientId === 'dynamic_agent_client')
    url.searchParams.set('agent_name_hint', 'Twenty Recruiting');
  return url.toString();
};

/** Uses one explicitly scoped transport; endpoints are pinned to OpenAI discovery, never supplied by a client. */
export class SiwcProtocol {
  private discovery?: { expiresAt: number; value: Record<string, string> };
  private keys?: { expiresAt: number; value: JsonWebKey[] };
  constructor(private readonly transport: typeof fetch = fetch) {}

  /** Exchanges a one-use code with the exact issued client ID, verifier and callback URI. */
  async exchange(
    attempt: SiwcTransaction,
    code: string,
    issuedClientId?: string,
  ) {
    const clientId =
      attempt.clientId === 'dynamic_agent_client'
        ? issuedClientId
        : attempt.clientId;
    if (
      !clientId ||
      clientId === 'dynamic_agent_client' ||
      !/^oaiapp_[A-Za-z0-9_-]{4,200}$/.test(clientId) ||
      (issuedClientId && issuedClientId !== clientId)
    )
      throw new Error('SIWC registration was not completed');
    const tokens = await this.token({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: attempt.verifier,
      redirect_uri: attempt.redirectUri,
      resource: SIWC_RESOURCE,
    });
    if (!tokens.id_token) throw new Error('SIWC identity token is missing');
    const identity = await this.identity(
      tokens.id_token,
      clientId,
      attempt.nonce,
      tokens.access_token,
    );
    if (attempt.subject && attempt.subject !== identity.subject)
      throw new Error('SIWC account identity changed');
    return { clientId, tokens, identity };
  }
  /** Refreshes a registered session; callers serialize rotation and replace the entire token set atomically. */
  async refresh(clientId: string, refreshToken: string) {
    return this.token({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      resource: SIWC_RESOURCE,
    });
  }
  /** Verifies a signed ID token before trusting subject/email; refreshes may omit an ID token entirely. */
  async identity(
    idToken: string,
    clientId: string,
    nonce?: string,
    accessToken?: string,
  ): Promise<SiwcIdentity> {
    const header = decode(idToken, { complete: true })?.header;
    if (header?.alg !== 'RS256' || !header.kid)
      throw new Error('SIWC identity signature is unavailable');
    let keys = await this.jwks();
    let key = keys.find((item) => item.kid === header.kid);
    if (!key) {
      keys = await this.jwks(true);
      key = keys.find((item) => item.kid === header.kid);
    }
    if (!key) throw new Error('SIWC identity signing key is unavailable');
    const payload = verify(idToken, createPublicKey({ key, format: 'jwk' }), {
      algorithms: ['RS256'],
      issuer: origin,
      audience: clientId,
      clockTolerance: 5,
      ...(nonce ? { nonce } : {}),
    }) as JwtPayload;
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      payload.iat > Date.now() / 1000 + 5
    )
      throw new Error('SIWC identity claims are invalid');
    if (
      accessToken &&
      typeof payload.at_hash === 'string' &&
      payload.at_hash !==
        createHash('sha256')
          .update(accessToken)
          .digest()
          .subarray(0, 16)
          .toString('base64url')
    )
      throw new Error('SIWC access-token binding is invalid');
    return {
      subject: payload.sub,
      issuer: origin,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    };
  }
  /** Lists only account-visible models from the public SIWC API, independently from the Codex backend catalog. */
  async catalog(accessToken: string) {
    const response = await this.transport(`${SIWC_RESOURCE}/models`, {
      headers: { authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('SIWC model discovery is unavailable');
    const value = z
      .object({
        models: z
          .array(
            z.object({
              slug: z.string().min(1),
              display_name: z.string(),
              visibility: z.string(),
            }),
          )
          .max(1000),
      })
      .parse(await response.json());
    return value.models
      .filter((model) => model.visibility === 'list')
      .map((model) => ({ id: model.slug, label: model.display_name }));
  }
  /** Attempts remote renewable-session revocation; local sign-out remains explicit if remote acknowledgement is unavailable. */
  async revoke(clientId: string, refreshToken: string) {
    const metadata = await this.configuration();
    if (!metadata.revocation_endpoint) return false;
    const response = await this.transport(metadata.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    return response.status === 200;
  }
  /** Validates response envelopes while exposing only a fixed recovery code, never raw OAuth responses. */
  private async token(parameters: Record<string, string>) {
    const metadata = await this.configuration();
    const response = await this.transport(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw new Error(
        value?.error === 'invalid_grant'
          ? 'SIWC_REAUTH_REQUIRED'
          : 'SIWC_TOKEN_EXCHANGE_UNAVAILABLE',
      );
    }
    return tokensSchema.parse(await response.json());
  }
  /** Caches pinned production metadata; discovery cannot redirect credential-bearing requests to another origin. */
  private async configuration() {
    if (this.discovery && this.discovery.expiresAt > Date.now())
      return this.discovery.value;
    const response = await this.transport(
      `${origin}/.well-known/openid-configuration`,
      { redirect: 'error', signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw new Error('SIWC discovery is unavailable');
    const value = z
      .object({
        issuer: z.literal(origin),
        authorization_endpoint: z.literal(`${origin}/api/accounts/authorize`),
        token_endpoint: z.literal(`${origin}/api/accounts/oauth/token`),
        jwks_uri: z.string().url(),
        revocation_endpoint: z.string().url().optional(),
      })
      .parse(await response.json());
    for (const endpoint of [value.jwks_uri, value.revocation_endpoint].filter(
      Boolean,
    )) {
      const url = new URL(endpoint!);
      if (url.origin !== origin || url.username || url.password || url.hash)
        throw new Error('Invalid SIWC discovery endpoint');
    }
    this.discovery = { expiresAt: Date.now() + 300000, value };
    return value;
  }
  /** Refreshes cached public signing keys on an unfamiliar kid while bounding the accepted key set. */
  private async jwks(force = false) {
    if (!force && this.keys && this.keys.expiresAt > Date.now())
      return this.keys.value;
    const metadata = await this.configuration();
    const response = await this.transport(metadata.jwks_uri, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('SIWC signing keys are unavailable');
    const value = z
      .object({
        keys: z
          .array(
            z
              .object({
                kty: z.literal('RSA'),
                kid: z.string(),
                n: z.string(),
                e: z.string(),
                use: z.literal('sig').optional(),
                alg: z.literal('RS256').optional(),
              })
              .passthrough(),
          )
          .max(30),
      })
      .parse(await response.json());
    this.keys = { expiresAt: Date.now() + 300000, value: value.keys };
    return this.keys.value;
  }
}
