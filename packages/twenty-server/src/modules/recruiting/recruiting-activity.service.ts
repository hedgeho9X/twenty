/** Records explicit human follow-up receipts without sending messages, recommending automatically or publishing content. */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { v5 } from 'uuid';
import { OrderByDirection } from 'twenty-shared/types';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from './recruiting-records.service';
import { RecruitingActorService } from './recruiting-actor.service';
import { RecruitingDraftsService } from './recruiting-drafts.service';
import { RecruitingShareConsentService } from './recruiting-share-consent.service';
import { contentVersion } from './domain/match-context';
import {
  sealRecruitingRecord,
  verifyRecruitingRecord,
} from './domain/record-integrity';

/** Notes are Agent-compatible; assertions about external actions require a direct human session. */
export const recruitingActivitySchema = z
  .object({
    action: z.enum([
      'NOTE',
      'CANDIDATE_CONTACTED',
      'COMPANY_RECOMMENDED',
      'JOB_PUBLISHED',
    ]),
    candidateId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    note: z.string().trim().min(1).max(10_000),
    channel: z.string().trim().max(300).default(''),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict()
  .refine((value) =>
    value.action === 'JOB_PUBLISHED'
      ? Boolean(value.jobId)
      : Boolean(value.candidateId),
  );

@Injectable()
/** The existing contact object retains legacy history; only this service can issue a verified new receipt. */
export class RecruitingActivityService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
    private readonly drafts: RecruitingDraftsService,
    private readonly consents: RecruitingShareConsentService,
    private readonly config: TwentyConfigService,
  ) {}

  /** Persists one idempotent append-only event, validating source access before inspecting any existing receipt. */
  async record(context: WorkspaceAuthContext, value: unknown) {
    const parsed = recruitingActivitySchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请选择操作对象并填写实际跟进说明');
    const input = parsed.data;
    if (input.action !== 'NOTE') this.drafts.requireHuman(context);
    const person = input.candidateId
      ? await this.records.one(context, 'person', input.candidateId)
      : undefined;
    if (
      person &&
      (!Array.isArray(person.contactRoles) ||
        !person.contactRoles.includes('CANDIDATE'))
    )
      throw new BadRequestException('请选择当前候选人');
    const job = input.jobId
      ? await this.records.one(context, 'recruitmentJob', input.jobId)
      : undefined;
    if (input.action === 'COMPANY_RECOMMENDED' && !job)
      throw new BadRequestException('推荐回执必须关联岗位');
    const actor = this.actors.capture(context);
    const id = v5(
      `${context.workspace.id}:activity:${contentVersion(actor)}:${input.idempotencyKey}`,
      v5.URL,
    );
    const inputHash = contentVersion(input);
    let previous;
    try {
      previous = await this.records.one(context, 'recruitingContact', id);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    if (previous) {
      const receipt = previous.recruitingReceipt as
        | { inputHash?: string }
        | undefined;
      if (!this.verified(context, previous) || receipt?.inputHash !== inputHash)
        throw new ConflictException('此操作标识已经用于其他记录');
      return this.view(context, previous);
    }
    if (input.action === 'COMPANY_RECOMMENDED')
      await this.consents.assertAllowed(
        context,
        input.candidateId!,
        input.jobId!,
      );
    const data = sealRecruitingRecord(
      context.workspace.id,
      'recruitingActivityReceipt',
      {
        id,
        name: input.action === 'NOTE' ? '跟进备注' : '人工确认回执',
        personId: person?.id,
        vacancyId: job?.id,
        companyId: job?.companyId,
        audience:
          input.action === 'COMPANY_RECOMMENDED'
            ? 'COMPANY'
            : input.action === 'JOB_PUBLISHED'
              ? 'PUBLICATION'
              : 'CANDIDATE',
        sent: input.action !== 'NOTE',
        followedAt: new Date().toISOString(),
        followUpAction: input.action,
        followUpNote: input.note,
        followUpState: input.action === 'NOTE' ? 'NOTE' : 'HUMAN_CONFIRMED',
        recruitingReceipt: {
          version: 1,
          inputHash,
          actor,
          channel: input.channel,
        },
      },
      this.key(),
    );
    return this.view(
      context,
      await this.records.create(context, 'recruitingContact', data),
    );
  }

  /** Includes legacy records as unverified history; it never infers that an old sent boolean is a new human confirmation. */
  async list(context: WorkspaceAuthContext, candidateId?: string, offset = 0) {
    if (candidateId) await this.records.one(context, 'person', candidateId);
    const page = await this.records.list(context, 'recruitingContact', {
      offset,
      limit: 30,
      filter: candidateId ? { personId: { eq: candidateId } } : undefined,
      orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
    });
    return {
      ...page,
      records: (page.records as RecruitingRecord[]).map((row) =>
        this.view(context, row),
      ),
    };
  }
  /** Native CRUD edits remain readable but invalidate the service-issued external-action assertion. */
  private verified(context: WorkspaceAuthContext, row: RecruitingRecord) {
    return verifyRecruitingRecord(
      context.workspace.id,
      'recruitingActivityReceipt',
      row,
      this.key(),
    );
  }
  /** Returns only business history; stored principal references and integrity internals remain server-side. */
  private view(context: WorkspaceAuthContext, row: RecruitingRecord) {
    const verified = this.verified(context, row);
    const receipt = row.recruitingReceipt as { channel?: string } | undefined;
    return {
      activityId: row.id,
      candidateId: row.personId,
      jobId: row.vacancyId,
      action: row.followUpAction,
      note: row.followUpNote,
      at: row.followedAt || row.createdAt,
      channel: receipt?.channel ?? '',
      verified,
      humanConfirmed: verified && row.sent === true,
    };
  }
  /** Shares the stable task-state secret without depending on native JWT rotation. */
  private key() {
    return (
      process.env.RECRUITING_STATE_SIGNING_KEY || this.config.get('APP_SECRET')
    );
  }
}
