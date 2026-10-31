/** Owns short-lived loopback OAuth attempts without changing an active registration before verified authorization completes. */
import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { userIsFullAdmin } from 'src/engine/core-modules/impersonation/utils/user-is-full-admin.util';
import { SiwcStoreService } from './siwc-store.service';
import {
  createSiwcTransaction,
  siwcAuthorizeUrl,
  type SiwcTransaction,
} from './siwc-protocol';

/** Verifiers and nonces remain in this process and are discarded on timeout, cancellation, failure or shutdown. */
type Attempt = {
  id: string;
  ownerId: string;
  connectionId?: string;
  status:
    | 'PENDING'
    | 'PROCESSING'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'FAILED';
  expiresAt: number;
  server: Server;
  timer: NodeJS.Timeout;
  transaction: SiwcTransaction;
  completedConnectionId?: string;
};

@Injectable()
/** Loopback listeners exist only while a specific authenticated administrator is authorizing an account. */
export class SiwcLoginService implements OnModuleDestroy {
  private readonly attempts = new Map<string, Attempt>();
  constructor(
    private readonly store: SiwcStoreService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  /** Binds one local listener and fresh PKCE transaction before returning the authorization URL for an explicit user click. */
  async start(ownerId: string, connectionId?: string) {
    await this.owner(ownerId);
    if (
      [...this.attempts.values()].some(
        (attempt) =>
          attempt.ownerId === ownerId &&
          ['PENDING', 'PROCESSING'].includes(attempt.status),
      )
    )
      throw new ConflictException('已有授权正在进行，请完成或取消后重试');
    if (this.attempts.size >= 20)
      throw new BadRequestException('授权请求过多，请稍后重试');
    const previous = connectionId
      ? await this.store.read(connectionId)
      : undefined;
    const hostId = previous?.hostId ?? (await this.store.hostId());
    const id = randomUUID();
    const server = createServer((request, response) => {
      void this.callback(id, request, response).catch(() => {
        if (!response.writableEnded) {
          response.statusCode = 400;
          response.end('授权请求不可用');
        }
      });
    });
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        done();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('无法启动本机授权回调');
    }
    const transaction = createSiwcTransaction(
      `http://127.0.0.1:${address.port}/auth/callback`,
      hostId,
      previous?.clientId,
      previous?.subject,
    );
    const timer = setTimeout(() => {
      const attempt = this.attempts.get(id);
      if (attempt && attempt.status === 'PENDING')
        this.finish(attempt, 'EXPIRED');
    }, 10 * 60_000);
    timer.unref();
    const attempt: Attempt = {
      id,
      ownerId,
      connectionId,
      status: 'PENDING',
      expiresAt: Date.now() + 10 * 60_000,
      server,
      timer,
      transaction,
    };
    this.attempts.set(id, attempt);
    return {
      attemptId: id,
      expiresAt: attempt.expiresAt,
      authorizeUrl: siwcAuthorizeUrl(transaction),
    };
  }
  /** Polls only sanitized state for the same administrator; credentials never appear in status responses. */
  status(ownerId: string, id: string) {
    const attempt = this.owned(ownerId, id);
    return {
      attemptId: attempt.id,
      status: attempt.status,
      expiresAt: attempt.expiresAt,
      connectionId: attempt.completedConnectionId,
    };
  }
  /** Restores the same owner's live attempt after a settings refresh without another registration. */
  active(ownerId: string) {
    const attempt = [...this.attempts.values()].find(
      (value) =>
        value.ownerId === ownerId &&
        ['PENDING', 'PROCESSING'].includes(value.status),
    );
    if (!attempt) return undefined;
    return {
      ...this.status(ownerId, attempt.id),
      ...(attempt.status === 'PENDING'
        ? { authorizeUrl: siwcAuthorizeUrl(attempt.transaction) }
        : {}),
    };
  }
  /** Cancels an unused browser attempt; a consumed authorization is already committing. */
  cancel(ownerId: string, id: string) {
    const attempt = this.owned(ownerId, id);
    if (attempt.status === 'PROCESSING')
      throw new ConflictException('授权正在校验，请稍后查看结果');
    if (attempt.status === 'PENDING') this.finish(attempt, 'CANCELLED');
    return this.status(ownerId, id);
  }
  /** Closes only this module's listeners during API shutdown. */
  onModuleDestroy() {
    for (const attempt of this.attempts.values()) {
      attempt.status = 'CANCELLED';
      clearTimeout(attempt.timer);
      attempt.server.close();
    }
    this.attempts.clear();
  }
  /** Consumes one state before code exchange, then revalidates the original administrator before committing tokens. */
  private async callback(
    id: string,
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const attempt = this.attempts.get(id);
    if (
      !attempt ||
      request.method !== 'GET' ||
      (request.url?.length ?? 0) > 8192
    ) {
      response.statusCode = 400;
      response.end('授权请求不可用');
      return;
    }
    const expected = new URL(attempt.transaction.redirectUri);
    const url = new URL(request.url ?? '/', expected.origin);
    const state = url.searchParams.get('state') ?? '';
    if (
      request.headers.host !== expected.host ||
      url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      ['state', 'code', 'client_id', 'error'].some(
        (name) => url.searchParams.getAll(name).length > 1,
      ) ||
      state.length !== attempt.transaction.state.length ||
      !/^[A-Za-z0-9_-]+$/.test(state) ||
      !timingSafeEqual(
        Buffer.from(state),
        Buffer.from(attempt.transaction.state),
      ) ||
      attempt.status !== 'PENDING' ||
      attempt.expiresAt <= Date.now()
    ) {
      response.statusCode = 400;
      response.end('授权请求已失效，请返回Twenty重试');
      return;
    }
    attempt.status = 'PROCESSING';
    let issuedSession: { clientId: string; refreshToken?: string } | undefined;
    try {
      if (url.searchParams.has('error'))
        throw new Error('authorization_denied');
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) throw new Error('code_missing');
      const result = await this.store.protocol.exchange(
        attempt.transaction,
        code,
        url.searchParams.get('client_id') ?? undefined,
      );
      issuedSession = {
        clientId: result.clientId,
        refreshToken: result.tokens.refresh_token,
      };
      if (attempt.status !== 'PROCESSING') {
        if (result.tokens.refresh_token)
          await this.store.protocol
            .revoke(result.clientId, result.tokens.refresh_token)
            .catch(() => false);
        response.statusCode = 400;
        response.end('此授权已取消或超时，请返回Twenty重试');
        return;
      }
      await this.owner(attempt.ownerId);
      const connection = await this.store.save(
        attempt.transaction.hostId,
        result.clientId,
        result.identity,
        result.tokens,
        attempt.connectionId,
      );
      attempt.completedConnectionId = connection.id;
      this.finish(attempt, 'COMPLETED');
      response.end(
        connection.status === 'READY'
          ? '授权已完成，请返回Twenty选择模型。'
          : '账号身份已确认，但未授权使用ChatGPT订阅，请返回Twenty重新授权。',
      );
    } catch {
      if (issuedSession?.refreshToken)
        await this.store.protocol
          .revoke(issuedSession.clientId, issuedSession.refreshToken)
          .catch(() => false);
      if (attempt.status === 'PROCESSING') this.finish(attempt, 'FAILED');
      response.statusCode = 400;
      response.end('授权未完成，请返回Twenty重试。已有模型连接未被替换。');
    }
  }
  /** Rejects another administrator's transaction even though both may manage instance providers. */
  private owned(ownerId: string, id: string) {
    const attempt = this.attempts.get(id);
    if (!attempt || attempt.ownerId !== ownerId)
      throw new NotFoundException('授权请求不存在或已过期');
    return attempt;
  }
  /** Clears secrets and listeners immediately, retaining only brief completion status for the polling UI. */
  private finish(attempt: Attempt, status: Attempt['status']) {
    attempt.status = status;
    clearTimeout(attempt.timer);
    attempt.server.close();
    attempt.transaction = {
      ...attempt.transaction,
      verifier: '',
      nonce: '',
      state: '',
    };
    const cleanup = setTimeout(
      () => this.attempts.delete(attempt.id),
      5 * 60_000,
    );
    cleanup.unref();
  }
  /** A disabled/deleted/demoted administrator cannot complete an earlier pending authorization. */
  private async owner(id: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user || user.disabled || user.deletedAt || !userIsFullAdmin(user))
      throw new ForbiddenException('请由当前实例管理员本人完成授权');
  }
}
