/** Tests public-client OAuth using locally signed synthetic ID tokens, never a real account or login exchange. */
import { createHash, generateKeyPairSync } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import {
  createSiwcTransaction,
  siwcAuthorizeUrl,
  SiwcProtocol,
} from './siwc-protocol';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const clientId = 'oaiapp_syntheticClient';
const discovery = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
  token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
};
/** Signs an independent token so tests exercise signature/claim validation, not a decode-only stub. */
const token = (nonce = 'nonce', options: Record<string, unknown> = {}) =>
  sign({ nonce, email: 'synthetic@example.test', ...options }, privateKey, {
    algorithm: 'RS256',
    keyid: 'synthetic-key',
    issuer: discovery.issuer,
    audience: clientId,
    subject: 'synthetic-subject',
    ...(options.exp === undefined ? { expiresIn: 3600 } : {}),
  });
/** Routes only fixed official endpoints while collecting form requests for protocol assertions. */
const setup = (credentials: Record<string, unknown> = {}) => {
  const transport = jest.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('openid-configuration')) return Response.json(discovery);
      if (url.endsWith('jwks.json'))
        return Response.json({
          keys: [
            {
              ...publicKey.export({ format: 'jwk' }),
              kid: 'synthetic-key',
              use: 'sig',
              alg: 'RS256',
            },
          ],
        });
      if (url.endsWith('/models'))
        return Response.json({
          models: [
            { slug: 'model-a', display_name: 'Model A', visibility: 'list' },
            { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
          ],
        });
      if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
      return Response.json({
        access_token: 'a'.repeat(40),
        refresh_token: 'r'.repeat(40),
        id_token: token(),
        token_type: 'Bearer',
        expires_in: 3600,
        scope:
          'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        ...credentials,
      });
    },
  );
  return { protocol: new SiwcProtocol(transport as typeof fetch), transport };
};

describe('SIWC protocol', () => {
  it('uses fresh PKCE and a strict loopback callback, without sending account tokens to frontend JavaScript', () => {
    const first = createSiwcTransaction(
      'http://127.0.0.1:1455/auth/callback',
      'urn:uuid:host',
    );
    const second = createSiwcTransaction(
      'http://127.0.0.1:1456/auth/callback',
      'urn:uuid:host',
      clientId,
    );
    expect(first.state).not.toBe(second.state);
    const url = new URL(siwcAuthorizeUrl(first));
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(first.verifier).digest('base64url'),
    );
    expect(url.searchParams.get('agent_name_hint')).toBe('Twenty Recruiting');
    expect(
      new URL(siwcAuthorizeUrl(second)).searchParams.has('agent_name_hint'),
    ).toBe(false);
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(() =>
      createSiwcTransaction('http://localhost:1455/auth/callback', 'host'),
    ).toThrow('callback');
  });
  it('requires the issued registration client ID and exchanges the exact verifier/callback', async () => {
    const { protocol, transport } = setup();
    const attempt = {
      ...createSiwcTransaction('http://127.0.0.1:1455/auth/callback', 'host'),
      nonce: 'nonce',
    };
    await expect(protocol.exchange(attempt, 'code')).rejects.toThrow(
      'registration',
    );
    expect(transport).not.toHaveBeenCalled();
    const result = await protocol.exchange(attempt, 'code', clientId);
    expect(result.identity.subject).toBe('synthetic-subject');
    const request = transport.mock.calls.find(([input]) =>
      String(input).endsWith('/token'),
    )!;
    const form = new URLSearchParams(request[1]?.body as URLSearchParams);
    expect(form.get('client_id')).toBe(clientId);
    expect(form.get('code_verifier')).toBe(attempt.verifier);
    expect(form.get('redirect_uri')).toBe(attempt.redirectUri);
    expect(form.has('client_secret')).toBe(false);
  });
  it('rejects wrong nonce, audience, expired claims and a switched returning identity', async () => {
    const { protocol } = setup();
    await expect(
      protocol.identity(token(), clientId, 'different'),
    ).rejects.toThrow();
    await expect(
      protocol.identity(token(), 'oaiapp_different', 'nonce'),
    ).rejects.toThrow();
    await expect(
      protocol.identity(token('nonce', { exp: 1, iat: 0 }), clientId, 'nonce'),
    ).rejects.toThrow();
    const returning = {
      ...createSiwcTransaction(
        'http://127.0.0.1:1455/auth/callback',
        'host',
        clientId,
        'other-subject',
      ),
      nonce: 'nonce',
    };
    await expect(protocol.exchange(returning, 'code')).rejects.toThrow(
      'identity changed',
    );
  });
  it('checks at_hash when present instead of mixing a valid identity with another access token', async () => {
    const { protocol } = setup();
    await expect(
      protocol.identity(
        token('nonce', { at_hash: 'unrelated' }),
        clientId,
        'nonce',
        'access',
      ),
    ).rejects.toThrow('binding');
  });

  it('rejects a modified signature and a valid token issued under another issuer', async () => {
    const { protocol } = setup();
    const [header, payload, signature] = token().split('.');
    const changed = `${header}.${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
    await expect(
      protocol.identity(changed, clientId, 'nonce'),
    ).rejects.toThrow();
    const foreign = sign({ nonce: 'nonce' }, privateKey, {
      algorithm: 'RS256',
      keyid: 'synthetic-key',
      issuer: 'https://other.example.test',
      audience: clientId,
      subject: 'synthetic-subject',
      expiresIn: 3600,
    });
    await expect(
      protocol.identity(foreign, clientId, 'nonce'),
    ).rejects.toThrow();
  });
  it('preserves the registered client and original grant during refresh', async () => {
    const { protocol, transport } = setup();
    await protocol.refresh(clientId, 'old-refresh');
    const request = transport.mock.calls.find(([input]) =>
      String(input).endsWith('/token'),
    )!;
    const form = new URLSearchParams(request[1]?.body as URLSearchParams);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('client_id')).toBe(clientId);
    expect(form.has('scope')).toBe(false);
  });
  it('keeps identity-only grants distinguishable from ChatGPT plan permission', async () => {
    const { protocol } = setup({ scope: 'openid profile email' });
    const attempt = {
      ...createSiwcTransaction('http://127.0.0.1:1455/auth/callback', 'host'),
      nonce: 'nonce',
    };
    expect(
      (await protocol.exchange(attempt, 'code', clientId)).tokens.scope,
    ).not.toContain('chatgpt.tokens.use.direct');
  });
  it('filters the selected account catalog and acknowledges renewable-session revocation', async () => {
    const { protocol } = setup();
    expect(await protocol.catalog('synthetic-access')).toEqual([
      { id: 'model-a', label: 'Model A' },
    ]);
    expect(await protocol.revoke(clientId, 'refresh')).toBe(true);
  });
  it('rejects cross-origin discovery endpoints before sending credentials', async () => {
    const transport = jest.fn(async () =>
      Response.json({
        ...discovery,
        token_endpoint: 'https://other.example.test/token',
      }),
    );
    await expect(
      new SiwcProtocol(transport).refresh(clientId, 'refresh'),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
