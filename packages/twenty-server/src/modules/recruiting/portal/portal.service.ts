/** Issues scoped portal links, rehydrates their original principal, and serializes candidate-bound mutations. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { v5 } from 'uuid';
import { OrderByDirection } from 'twenty-shared/types';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import {
  RecruitingActorService,
  type RecruitingActor,
} from '../auth/actor.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from '../records/records.service';
import { RecruitingShareConsentService } from './share-consent.service';
import { RECRUITING_ADVISORY_LOCK } from '../shared/locking/advisory-lock.constant';
import {
  signPortalAccess,
  verifyPortalAccess,
  type RecruitingPortalAccess,
} from './domain/portal-access';
import { portalInviteInputSchema } from './domain/portal-schemas';
import { contentVersion } from '../matching/domain/match-context';

/** Native upload receipts stay server-side; the anonymous client gets only the presigned transfer target. */
export type PortalUpload = {
  fileId: string;
  label: string;
  uploadReceipt: string;
  size: number;
  completed?: boolean;
};
/** Internal invitation state is authenticated by RecruitingRecordsService. */
export type PortalInvitePayload = {
  version: 1;
  actor: RecruitingActor;
  nonce: string;
  inputHash: string;
  jobIds: string[];
  uploads: PortalUpload[];
  intakeIds: string[];
  intents?: Record<string, boolean>;
  consentGrantId?: string;
};
/** A public request gains access to one candidate under the creator's still-current native permissions. */
export type PortalSession = {
  scope: RecruitingPortalAccess;
  context: WorkspaceAuthContext;
  invite: RecruitingRecord;
  payload: PortalInvitePayload;
  candidate: RecruitingRecord;
};

@Injectable()
/** A portal capability is never a native JWT, administrator token or general record API credential. */
export class RecruitingPortalService {
  private readonly logger = new Logger(RecruitingPortalService.name);
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
    private readonly consents: RecruitingShareConsentService,
    private readonly config: TwentyConfigService,
    @Inject(RECRUITING_ADVISORY_LOCK)
    private readonly locks: PostgresAdvisoryLockService,
    @Inject(CacheStorageNamespace.ModuleApplications)
    private readonly cache: CacheStorageService,
  ) {}

  /** Creates a link only after current source access and, for company views, candidate sharing consent. */
  async create(context: WorkspaceAuthContext, value: unknown) {
    const parsed = portalInviteInputSchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请选择候选人、访问对象及最多5个岗位');
    const input = parsed.data;
    const actor = this.actors.capture(context);
    const id = v5(
      `${context.workspace.id}:portal:${contentVersion(actor)}:${input.idempotencyKey}`,
      v5.URL,
    );
    return this.lock(context.workspace.id, input.candidateId, async () => {
      const candidate = await this.candidate(context, input.candidateId);
      for (const jobId of input.jobIds) await this.consents.job(context, jobId);
      const consent =
        input.kind === 'COMPANY'
          ? await this.consents.assertAllowed(
              context,
              input.candidateId,
              input.jobIds[0],
            )
          : undefined;
      const hash = contentVersion({ input, consentGrantId: consent?.grantId });
      let existing = await this.optional(context, id);
      if (
        existing &&
        (existing.payload as PortalInvitePayload).inputHash !== hash
      )
        throw new ConflictException('此创建标识已对应其他门户范围');
      if (!existing) {
        let expiresAt = Date.now() + input.expiresInDays * 24 * 60 * 60_000;
        if (consent) expiresAt = Math.min(expiresAt, consent.sourceExpiresAt);
        if (context.type === 'apiKey')
          expiresAt = Math.min(
            expiresAt,
            new Date(context.apiKey.expiresAt).getTime(),
          );
        existing = await this.records.create(
          context,
          'recruitingPortalInvite',
          {
            id,
            name:
              input.kind === 'CANDIDATE'
                ? '候选人资料入口'
                : '企业推荐资料预览',
            kind: input.kind,
            candidateId: candidate.id,
            status: 'ACTIVE',
            expiresAt: String(expiresAt),
            payload: {
              version: 1,
              actor,
              nonce: randomBytes(32).toString('hex'),
              inputHash: hash,
              jobIds: input.jobIds,
              uploads: [],
              intakeIds: [],
              ...(consent ? { consentGrantId: consent.grantId } : {}),
            },
          },
        );
      }
      return this.link(context, existing);
    });
  }

  /** Lists only metadata; nonce, capabilities and owner-bound upload receipts never enter polling responses. */
  async list(context: WorkspaceAuthContext, offset = 0) {
    const page = await this.records.list(context, 'recruitingPortalInvite', {
      offset,
      limit: 30,
      orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
    });
    const rows = [];
    for (const record of page.records as RecruitingRecord[]) {
      try {
        const candidate = await this.candidate(
          context,
          String(record.candidateId),
        );
        const name = candidate.name as
          | { firstName?: string; lastName?: string }
          | undefined;
        rows.push({
          ...this.receipt(record),
          candidateLabel:
            [name?.firstName, name?.lastName].filter(Boolean).join(' ') ||
            '候选人',
          candidateUrl: `/object/person/${candidate.id}`,
        });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return { ...page, records: rows };
  }

  /** Returns the same deterministic link only to the same principal that originally granted it. */
  async copyLink(context: WorkspaceAuthContext, id: string) {
    const invite = await this.records.one(
      context,
      'recruitingPortalInvite',
      id,
    );
    await this.candidate(context, String(invite.candidateId));
    return this.link(context, invite);
  }
  /** Stops future portal access without deleting candidate files, consent history or contact receipts. */
  async revoke(context: WorkspaceAuthContext, id: string) {
    const invite = await this.records.one(
      context,
      'recruitingPortalInvite',
      id,
    );
    return this.lock(
      context.workspace.id,
      String(invite.candidateId),
      async () => {
        await this.candidate(context, String(invite.candidateId));
        return this.receipt(
          await this.records.update(context, 'recruitingPortalInvite', id, {
            status: 'REVOKED',
          }),
        );
      },
    );
  }

  /** Verifies the cheap capability before rate admission, membership resolution or record access. */
  async resolve(token: string): Promise<PortalSession> {
    let scope;
    try {
      scope = verifyPortalAccess(token, this.config.get('APP_SECRET'));
    } catch {
      throw new ForbiddenException('链接已失效或当前无权访问');
    }
    const bucket = `recruiting-portal:${scope.actor.workspaceId}:${scope.inviteId}:${Math.floor(Date.now() / 60_000)}`;
    await this.cache.setIfAbsent(bucket, 0, 120_000);
    if ((await this.cache.incrBy(bucket, 1)) > 60)
      throw new HttpException('访问过于频繁，请稍后重试', 429);
    return this.read(scope);
  }

  /** Uses one candidate lock for all portal writes, avoiding nested lock-pool acquisition. */
  async mutate<T>(
    session: PortalSession,
    action: (current: PortalSession) => Promise<T>,
  ) {
    return this.lock(
      session.scope.actor.workspaceId,
      session.candidate.id,
      async () => action(await this.read(session.scope)),
    );
  }

  /** Revalidates revocation, expiry, original principal and candidate role on every read and download. */
  private async read(scope: RecruitingPortalAccess): Promise<PortalSession> {
    let stage = 'principal';
    try {
      const context = await this.actors.resolve(scope.actor);
      stage = 'invitation';
      const invite = await this.records.one(
        context,
        'recruitingPortalInvite',
        scope.inviteId,
      );
      const payload = invite.payload as PortalInvitePayload;
      stage = 'scope';
      if (
        invite.status !== 'ACTIVE' ||
        Number(invite.expiresAt) !== scope.expiresAt ||
        scope.expiresAt <= Date.now() ||
        payload.nonce !== scope.nonce ||
        contentVersion(payload.actor) !== contentVersion(scope.actor)
      )
        throw new ForbiddenException();
      stage = 'candidate';
      const candidate = await this.candidate(
        context,
        String(invite.candidateId),
      );
      return { scope, context, invite, payload, candidate };
    } catch (error) {
      this.logger.warn(
        `Portal access rejected at ${stage}: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw new ForbiddenException('链接已失效或当前无权访问');
    }
  }
  /** Refuses capability reissuance under another actor, even if that actor can read invitation metadata. */
  private link(context: WorkspaceAuthContext, invite: RecruitingRecord) {
    const payload = invite.payload as PortalInvitePayload;
    if (
      contentVersion(this.actors.capture(context)) !==
      contentVersion(payload.actor)
    )
      throw new ForbiddenException(
        '请由原创建者复制链接，或用自己的授权重新创建',
      );
    if (invite.status !== 'ACTIVE' || Number(invite.expiresAt) <= Date.now())
      throw new ConflictException('此链接已撤销或过期，请重新创建');
    const token = signPortalAccess(
      {
        version: 1,
        purpose: 'recruiting-portal',
        inviteId: invite.id,
        actor: payload.actor,
        nonce: payload.nonce,
        expiresAt: Number(invite.expiresAt),
      },
      this.config.get('APP_SECRET'),
    );
    return {
      ...this.receipt(invite),
      url: `${this.config.get('FRONTEND_URL').replace(/\/$/, '')}/candidate-portal#access=${encodeURIComponent(token)}`,
    };
  }
  /** Exposes status rather than internal authorizations or stored snapshots. */
  private receipt(invite: RecruitingRecord) {
    return {
      inviteId: invite.id,
      name: invite.name,
      kind: invite.kind,
      candidateId: invite.candidateId,
      status: invite.status,
      expired: Number(invite.expiresAt) <= Date.now(),
      expiresAt: new Date(Number(invite.expiresAt)).toISOString(),
      createdAt: invite.createdAt,
      jobIds: (invite.payload as PortalInvitePayload).jobIds,
    };
  }
  /** Ensures a contact that is no longer a candidate cannot retain an active candidate portal. */
  private async candidate(context: WorkspaceAuthContext, id: string) {
    const record = await this.records.one(context, 'person', id);
    if (
      !Array.isArray(record.contactRoles) ||
      !record.contactRoles.includes('CANDIDATE')
    )
      throw new NotFoundException('候选人不存在或当前无权访问');
    return record;
  }
  /** Preserves permission and storage failures rather than treating them as a missing invitation. */
  private async optional(context: WorkspaceAuthContext, id: string) {
    try {
      return await this.records.one(context, 'recruitingPortalInvite', id);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
  /** Native advisory sessions are isolated from ordinary query connections by RecruitingLockModule. */
  private async lock<T>(
    workspaceId: string,
    candidateId: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const result = await this.locks.tryWithLock(
      `recruiting-portal-candidate:${workspaceId}:${candidateId}`,
      callback,
    );
    if (!result.acquired)
      throw new ConflictException('资料正在保存，请稍后重试');
    return result.value;
  }
}
