import {
  CODEX_CLIENT_VERSION,
  CodexOAuthProtocol,
} from './codex-oauth-protocol';
/** Stores encrypted SIWC registrations and serializes rotating-token refresh across the API and workers. */
import { Injectable } from '@nestjs/common';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { v5 } from 'uuid';
import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type PlaintextString } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  createSubscriptionTransport,
  type SubscriptionCredential,
} from './subscription-fetch';
import {
  SIWC_PLAN_SCOPE,
  SiwcProtocol,
  type SiwcIdentity,
  type SiwcTokens,
} from './siwc-protocol';

/** A registration's client/account mapping survives sign-out; renewable credentials do not. */
export type SiwcConnection = {
  id: string;
  protocol?: 'codex' | 'siwc';
  accountId?: string;
  hostId: string;
  clientId: string;
  subject: string;
  email?: string;
  label: string;
  status: 'READY' | 'MISSING_PLAN_PERMISSION' | 'SIGNED_OUT' | 'NEEDS_AUTH';
  scopes: string[];
  expiresAt: number;
  updatedAt: string;
  tokens?: SiwcTokens;
};
const identity =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const encryptionScope = { workspaceId: 'chatgpt-subscription-registrations' };

@Injectable()
/** Uses native authenticated encryption and advisory locks, never the Codex credential file or another service. */
export class SiwcStoreService {
  readonly protocol: SiwcProtocol;
  readonly codexProtocol: CodexOAuthProtocol;
  constructor(
    private readonly encryption: SecretEncryptionService,
    private readonly config: TwentyConfigService,
    private readonly locks: PostgresAdvisoryLockService,
  ) {
    this.protocol = new SiwcProtocol(
      createSubscriptionTransport(process.env.RECRUITING_MODEL_PROXY_URL),
    );
    this.codexProtocol = new CodexOAuthProtocol(
      createSubscriptionTransport(process.env.RECRUITING_MODEL_PROXY_URL),
      this.protocol,
    );
  }

  /** Returns a stable host identity under the same cross-process lock used for first-time creation. */
  async hostId() {
    return this.lock('host', async () => {
      const previous = await this.readOptional<{ hostId: string }>('host');
      if (previous) return previous.hostId;
      const hostId = `urn:uuid:${randomUUID()}`;
      await this.write('host', { hostId });
      return hostId;
    });
  }
  /** Lists only recognizable account labels and connection state, never credentials or ID-token hints. */
  async list() {
    const root = await this.root();
    const values = [];
    for (const file of await readdir(root)) {
      const id = file.replace(/\.enc$/, '');
      if (!identity.test(id) || file !== `${id}.enc`) continue;
      const connection = await this.read(id);
      values.push(this.view(connection));
    }
    return values;
  }
  /** Reads a registration internally for reauthorization; callers must already enforce administrator ownership. */
  async read(id: string) {
    if (!identity.test(id))
      throw new Error('Subscription connection is unavailable');
    const value = await this.readOptional<SiwcConnection>(id);
    if (!value || value.id !== id)
      throw new Error('Subscription connection is unavailable');
    return value;
  }
  /** Commits a validated new identity/token set together so it cannot replace another registered account. */
  async save(
    hostId: string,
    clientId: string,
    account: SiwcIdentity,
    tokens: SiwcTokens,
    previousId?: string,
    protocol: 'codex' | 'siwc' = 'siwc',
    accountId?: string,
  ) {
    const id =
      previousId ?? v5(`${hostId}:${clientId}:${account.subject}`, v5.URL);
    return this.lock(id, async () => {
      if (previousId) {
        const previous = await this.read(previousId);
        if (
          previous.subject !== account.subject ||
          previous.clientId !== clientId ||
          previous.hostId !== hostId
        )
          throw new Error('Subscription account identity changed');
      }
      const scopes = tokens.scope.split(/\s+/).filter(Boolean);
      const connection: SiwcConnection = {
        id,
        protocol,
        accountId,
        hostId,
        clientId,
        subject: account.subject,
        email: account.email,
        label: `${account.email || 'ChatGPT'} · ${id.slice(0, 8)}`,
        scopes,
        status: (
          protocol === 'codex'
            ? Boolean(accountId)
            : scopes.includes(SIWC_PLAN_SCOPE)
        )
          ? 'READY'
          : 'MISSING_PLAN_PERMISSION',
        expiresAt: Date.now() + tokens.expires_in * 1000,
        updatedAt: new Date().toISOString(),
        tokens,
      };
      await this.write(id, connection);
      return this.view(connection);
    });
  }
  /** Re-reads inside the global connection lock; one process refreshes while all others consume its atomic replacement. */
  async credential(
    id: string,
    forceRefresh = false,
  ): Promise<SubscriptionCredential> {
    return this.lock(id, async () => {
      let connection = await this.read(id);
      if (connection.status !== 'READY' || !connection.tokens?.access_token)
        throw new Error('ChatGPT subscription requires authorization');
      if (forceRefresh || connection.expiresAt <= Date.now() + 30000) {
        if (!connection.tokens.refresh_token)
          throw new Error(
            'ChatGPT subscription requires renewed authorization',
          );
        let rotated = false;
        try {
          const tokens =
            connection.protocol === 'codex'
              ? await this.codexProtocol.refresh(
                  connection.tokens.refresh_token,
                )
              : await this.protocol.refresh(
                  connection.clientId,
                  connection.tokens.refresh_token,
                );
          rotated = true;
          if (!tokens.refresh_token && connection.protocol !== 'codex')
            throw new Error('SIWC_REAUTH_REQUIRED');
          if (tokens.id_token) {
            const account =
              connection.protocol === 'codex'
                ? await this.codexProtocol.identity(
                    tokens.id_token,
                    undefined,
                    tokens.access_token,
                  )
                : await this.protocol.identity(
                    tokens.id_token,
                    connection.clientId,
                    undefined,
                    tokens.access_token,
                  );
            if (
              'accountId' in account &&
              account.accountId !== connection.accountId
            )
              throw new Error('SIWC_REAUTH_REQUIRED');
            if (account.subject !== connection.subject)
              throw new Error('SIWC_REAUTH_REQUIRED');
          }
          const scopes = tokens.scope.split(/\s+/).filter(Boolean);
          connection = {
            ...connection,
            tokens: {
              ...tokens,
              refresh_token:
                tokens.refresh_token ?? connection.tokens.refresh_token,
              id_token: tokens.id_token ?? connection.tokens.id_token,
            },
            scopes,
            status:
              connection.protocol === 'codex' ||
              scopes.includes(SIWC_PLAN_SCOPE)
                ? 'READY'
                : 'MISSING_PLAN_PERMISSION',
            expiresAt: Date.now() + tokens.expires_in * 1000,
            updatedAt: new Date().toISOString(),
          };
          await this.write(id, connection);
        } catch (error) {
          if (
            rotated ||
            (error instanceof Error && error.message === 'SIWC_REAUTH_REQUIRED')
          )
            await this.write(id, {
              ...connection,
              status: 'NEEDS_AUTH',
              tokens: undefined,
              updatedAt: new Date().toISOString(),
            });
          throw new Error(
            'ChatGPT subscription renewal failed; reconnect this account',
          );
        }
      }
      if (connection.status !== 'READY' || !connection.tokens)
        throw new Error('ChatGPT plan permission is missing');
      return {
        accessToken: connection.tokens.access_token,
        protocol: connection.protocol ?? 'siwc',
        accountId: connection.accountId,
        ...(connection.protocol === 'codex'
          ? { clientVersion: CODEX_CLIENT_VERSION }
          : {}),
      };
    });
  }
  /** Reads the selected account's catalog with its current credential rather than a guessed bundled model list. */
  async models(id: string) {
    const credential = await this.credential(id);
    return this.protocol.catalog(credential.accessToken);
  }
  /** Revokes if possible, then atomically clears local secrets while preserving the registration mapping. */
  async disconnect(id: string) {
    return this.lock(id, async () => {
      const connection = await this.read(id);
      let remoteRevocationConfirmed: boolean | null = null;
      if (connection.tokens?.refresh_token)
        try {
          remoteRevocationConfirmed = await this.protocol.revoke(
            connection.clientId,
            connection.tokens.refresh_token,
          );
        } catch {
          remoteRevocationConfirmed = false;
        }
      const next: SiwcConnection = {
        ...connection,
        tokens: undefined,
        status: 'SIGNED_OUT',
        updatedAt: new Date().toISOString(),
      };
      await this.write(id, next);
      return { ...this.view(next), remoteRevocationConfirmed };
    });
  }
  /** Resolves only the private server-owned sibling directory, outside native file-serving storage. */
  private async root() {
    const path = resolve(
      process.env.RECRUITING_CHATGPT_CONNECTIONS_PATH ??
        join(
          this.config.get('STORAGE_LOCAL_PATH'),
          '..',
          'chatgpt-subscriptions',
        ),
    );
    await mkdir(path, { recursive: true, mode: 0o700 });
    await this.ownerOnly(path, true);
    return path;
  }
  /** Rejects symlinks, wrong owners and permissive modes before reading even encrypted content. */
  private async ownerOnly(path: string, directory = false) {
    const info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      (directory ? !info.isDirectory() : !info.isFile()) ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error('Subscription storage permissions are invalid');
  }
  /** Decrypts authenticated native envelopes; missing records are different from unreadable/tampered ones. */
  private async readOptional<T>(id: string): Promise<T | undefined> {
    const path = join(await this.root(), `${id}.enc`);
    try {
      await this.ownerOnly(path);
      const encrypted = await readFile(path, 'utf8');
      return JSON.parse(
        this.encryption.decryptVersionedOrThrow(
          encrypted as EncryptedString,
          encryptionScope,
        ),
      ) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  /** Replaces the entire encrypted token set through an owner-only temporary file and atomic rename. */
  private async write(id: string, value: object) {
    if (id !== 'host' && !identity.test(id))
      throw new Error('Subscription connection is unavailable');
    const root = await this.root();
    const temporary = join(root, `${randomUUID()}.tmp`);
    const encrypted = this.encryption.encryptVersioned(
      JSON.stringify(value) as PlaintextString,
      encryptionScope,
    );
    await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(root, `${id}.enc`));
  }
  /** Native PostgreSQL locks serialize API/worker refresh without a new process or service. */
  private async lock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 45000;
    do {
      const result = await this.locks.tryWithLock(
        `chatgpt-subscription:${id}`,
        action,
      );
      if (result.acquired) return result.value;
      await new Promise((done) => setTimeout(done, 100));
    } while (Date.now() < deadline);
    throw new Error('Subscription connection is busy; retry shortly');
  }
  /** Explicit projection prevents an administrator settings poll from serializing credentials. */
  private view(connection: SiwcConnection) {
    return {
      id: connection.id,
      protocol: connection.protocol ?? 'siwc',
      label: connection.label,
      email: connection.email,
      status: connection.status,
      expiresAt: connection.expiresAt,
      updatedAt: connection.updatedAt,
      canRefresh: Boolean(connection.tokens?.refresh_token),
      planUsageEnabled:
        connection.protocol === 'codex' ||
        connection.scopes.includes(SIWC_PLAN_SCOPE),
    };
  }
}
