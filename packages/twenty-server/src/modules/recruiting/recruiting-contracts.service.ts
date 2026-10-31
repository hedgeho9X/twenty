/** Preserves owner-managed company contract data and internal reminders without calling a signing platform. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isPlainObject } from 'twenty-shared/utils';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecruitingContractRecordsService } from './recruiting-contract-records.service';
import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from './recruiting-records.service';
import { RecruitingDraftsService } from './recruiting-drafts.service';
import { RECRUITING_ADVISORY_LOCK } from './recruiting-advisory-lock.constant';

const detailsSchema = z
  .object({
    legalName: z.string().max(500),
    creditCode: z.string().max(500),
    address: z.string().max(500),
    contactName: z.string().max(500),
    phone: z.string().max(500),
  })
  .strict();
const inputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('DETAILS'),
      version: z.string().min(1).max(100),
      details: detailsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('STATUS'),
      version: z.string().min(1).max(100),
      status: z.enum(['SENT', 'SIGNED']),
    })
    .strict(),
]);
/** Uses stable company reminder identities so retries cannot create another internal task. */
export const contractReminderId = (value: string) => {
  const hash = createHash('sha256')
    .update(`fanhan-contract-v1:${value}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

@Injectable()
/** Generic CRM fields remain readable; actual signed/sent declarations require the current owner in a direct human session. */
export class RecruitingContractsService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly updates: RecruitingContractRecordsService,
    private readonly drafts: RecruitingDraftsService,
    @Inject(RECRUITING_ADVISORY_LOCK)
    private readonly locks: PostgresAdvisoryLockService,
  ) {}
  /** Shows existing manual status and template data without inventing an external draft, link or signing result. */
  async one(context: WorkspaceAuthContext, id: string) {
    const { company, version } = await this.updates.one(context, id);
    return { ...this.view(context, company), version };
  }
  /** Applies a version/owner compare-and-swap through native permission-aware bulk update, narrowed to exactly one company. */
  async update(context: WorkspaceAuthContext, id: string, value: unknown) {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请核对合同资料及记录版本');
    this.drafts.requireHuman(context);
    const { company, version } = await this.updates.one(context, id);
    this.owner(context, company);
    if (version !== parsed.data.version)
      throw new ConflictException('公司资料已变化，请刷新后核对');
    let patch: Record<string, unknown>;
    if (parsed.data.action === 'DETAILS') {
      if (!this.detailsEditable(company))
        throw new ConflictException(
          '已有签约或外部草稿状态，请先核对原合同，暂不覆盖资料',
        );
      patch = { contractDetails: parsed.data.details };
    } else {
      if (
        company.contractStatus === 'SIGNED' &&
        parsed.data.status !== 'SIGNED'
      )
        throw new ConflictException('已签署状态不能在此降回已发起');
      patch = { contractStatus: parsed.data.status };
    }
    const updated = await this.updates.update(
      context,
      id,
      version,
      patch,
      context.type === 'user' ? context.workspaceMemberId : undefined,
    );
    if (!updated)
      throw new ConflictException('公司负责人或资料已变化，请刷新后核对');
    let taskNeedsReview = false;
    if (parsed.data.action === 'STATUS')
      try {
        const task = await this.records.one(
          context,
          'task',
          contractReminderId(id),
        );
        if (task.status !== 'DONE')
          await this.records.update(context, 'task', task.id, {
            status: 'DONE',
          });
      } catch (error) {
        taskNeedsReview = !(error instanceof NotFoundException);
      }
    return { ...(await this.one(context, id)), taskNeedsReview };
  }
  /** Creates a company-level internal TODO and relation only; sending/signing, signing dates and external drafts remain human/platform actions. */
  async remind(context: WorkspaceAuthContext, id: string) {
    const result = await this.locks.tryWithLock(
      `recruiting-contract:${context.workspace.id}:${id}`,
      async () => {
        const { company, version } = await this.updates.one(context, id);
        if (['SENT', 'SIGNED'].includes(String(company.contractStatus)))
          return {
            ...this.view(context, company),
            version,
            alreadyInProgress: true,
          };
        const jobs = await this.records.list(context, 'recruitmentJob', {
          filter: {
            and: [
              { companyId: { eq: id } },
              {
                or: [
                  { jobStatus: { eq: 'RECRUITING' } },
                  { jobStatus: { eq: 'NEEDS_DETAILS' } },
                ],
              },
            ],
          },
          limit: 1,
        });
        if (!String(company.name ?? '').trim() || !jobs.records.length)
          throw new BadRequestException('请先填写公司名称并关联岗位');
        const taskId = contractReminderId(id);
        await this.ensure(context, 'task', taskId, {
          title: `请联系 ${company.name} 签署招聘服务协议`,
          status: 'TODO',
          assigneeId: company.accountOwnerId ?? null,
          bodyV2: {
            markdown:
              '请核对关联公司的合同资料，由公司负责人联系对方并在实际发起/签署后手工确认状态。当前本地环境未连接签约平台。',
          },
        });
        await this.ensure(
          context,
          'taskTarget',
          contractReminderId(`target:${id}`),
          { taskId, targetCompanyId: id },
        );
        let statusSyncPending = false;
        if (!company.contractStatus)
          try {
            statusSyncPending = !(await this.updates.update(
              context,
              id,
              version,
              { contractStatus: 'PENDING' },
            ));
          } catch {
            statusSyncPending = true;
          }
        return {
          ...(await this.one(context, id)),
          taskId,
          taskUrl: `/object/task/${taskId}`,
          assigned: Boolean(company.accountOwnerId),
          statusSyncPending,
        };
      },
    );
    if (!result.acquired)
      throw new ConflictException('正在准备内部提醒，请稍后重试');
    return result.value;
  }
  /** Only current source permission and exact existing identity are reused after a concurrent create. */
  private async ensure(
    context: WorkspaceAuthContext,
    object: string,
    id: string,
    data: Record<string, unknown>,
  ) {
    try {
      return await this.records.one(context, object, id);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    try {
      return await this.records.create(context, object, { id, ...data });
    } catch (error) {
      try {
        return await this.records.one(context, object, id);
      } catch {
        throw error;
      }
    }
  }
  /** Does not grant owner authority to API keys, applications, Agent delegation or administrators impersonating another member. */
  private owner(context: WorkspaceAuthContext, company: RecruitingRecord) {
    if (
      context.type !== 'user' ||
      context.application ||
      context.viaApplication ||
      context.agentId ||
      company.accountOwnerId !== context.workspaceMemberId
    )
      throw new ForbiddenException('合同资料和实际状态需要公司负责人本人确认');
  }
  /** Submitted/signed or externally frozen material is not silently rewritten. */
  private detailsEditable(company: RecruitingRecord) {
    return (
      !company.contractDraftId &&
      !['CREATING', 'CHECK_REQUIRED', 'READY'].includes(
        String(company.contractPreparation),
      ) &&
      !['SENT', 'SIGNED'].includes(String(company.contractStatus))
    );
  }
  /** Returns only the five template fields and compatibility state, with no signing links or credentials. */
  private view(context: WorkspaceAuthContext, company: RecruitingRecord) {
    const raw = isPlainObject(company.contractDetails)
      ? company.contractDetails
      : {};
    const details = Object.fromEntries(
      Object.keys(detailsSchema.shape).map((key) => [
        key,
        typeof raw[key] === 'string'
          ? raw[key]
          : key === 'legalName'
            ? String(company.name ?? '')
            : '',
      ]),
    );
    const canEdit =
      context.type === 'user' &&
      !context.application &&
      !context.viaApplication &&
      !context.agentId &&
      company.accountOwnerId === context.workspaceMemberId;
    return {
      companyId: company.id,
      companyName: company.name,
      updatedAt: company.updatedAt,
      status: company.contractStatus ?? 'NOT_STARTED',
      preparation: company.contractPreparation ?? '',
      hasExternalDraft: Boolean(company.contractDraftId),
      externalSigningAvailable: false,
      details,
      canEdit,
      canEditDetails: canEdit && this.detailsEditable(company),
      companyUrl: `/object/company/${company.id}`,
    };
  }
}
