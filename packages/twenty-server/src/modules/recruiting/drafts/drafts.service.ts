/** Persists resumable text drafts and keeps generation distinct from real-world human actions. */
import { buildMatchBrief } from './domain/match-brief';
import { RecruitingJobPageService } from '../portal/job-page.service';
import { RecruitingMatchingService } from '../matching/matching.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { RECRUITING_ADVISORY_LOCK } from '../shared/locking/advisory-lock.constant';
import { v4, v5 } from 'uuid';
import { z } from 'zod';
import { OrderByDirection } from 'twenty-shared/types';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import {
  RecruitingActorService,
  type RecruitingActor,
} from '../auth/actor.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from '../records/records.service';
import { RecruitingExtractorService } from '../ai/extractor.service';
import {
  buildCandidateMatchContext,
  buildJobMatchContext,
  contentVersion,
} from '../matching/domain/match-context';

/** Inputs select sources and an optional writing instruction; only people confirm actual actions. */
export const recruitingDraftInputSchema = z
  .object({
    kind: z.enum(['GREETING', 'JOB_PUBLICATION']),
    candidateId: z.string().uuid().optional(),
    matchRunId: z.string().uuid().optional(),
    selectedIds: z.array(z.string().uuid()).min(1).max(10).optional(),
    jobId: z.string().uuid().optional(),
    note: z.string().max(50_000).default(''),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict()
  .refine(
    (input) =>
      input.kind === 'GREETING'
        ? Boolean(
            input.candidateId ||
            (input.matchRunId && input.selectedIds?.length),
          )
        : Boolean(input.jobId),
    '请选择草稿对应的候选人或岗位',
  );

/** Credentials never enter queued tasks or draft checkpoints. */
export type RecruitingDraftJobData = {
  draftId: string;
  actor: RecruitingActor;
};
type DraftPayload = {
  version: 1;
  input: z.infer<typeof recruitingDraftInputSchema>;
  inputHash: string;
  actor: RecruitingActor;
  sourceVersion: string;
  jobPageUrl?: string;
  generation?: Awaited<ReturnType<RecruitingExtractorService['draft']>>;
  approvedAt?: string;
};

@Injectable()
/** Shares one permission-aware implementation across HTTP, native tools and the queue. */
export class RecruitingDraftsService {
  private readonly logger = new Logger(RecruitingDraftsService.name);
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
    private readonly extractor: RecruitingExtractorService,
    @Inject(RECRUITING_ADVISORY_LOCK)
    private readonly locks: PostgresAdvisoryLockService,
    @InjectMessageQueue(MessageQueue.recruitingQueue)
    private readonly queue: MessageQueueService,
    @Optional() private readonly matching?: RecruitingMatchingService,
    @Optional() private readonly jobPages?: RecruitingJobPageService,
  ) {}

  /** Tests unsaved templates against caller-supplied synthetic context without creating drafts or shares. */
  async testTemplate(value: unknown) {
    const input = z
      .object({
        templates: z.object({
          candidate: z.string().max(20000),
          company: z.string().max(20000),
        }),
        context: z.record(z.string(), z.unknown()),
      })
      .parse(value);
    if (JSON.stringify(input.context).length > 30000)
      throw new BadRequestException('测试数据过长');
    return (
      await this.extractor.draft(
        'MATCH_BRIEF',
        JSON.stringify(input.context),
        '',
        input.templates,
      )
    ).profile;
  }

  /** Creates a durable draft before any model call and reuses an identical submission. */
  async submit(context: WorkspaceAuthContext, value: unknown) {
    const parsed = recruitingDraftInputSchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请选择有效的草稿类型和对应记录');
    const input = parsed.data;
    const source = await this.source(context, input);
    const actor = this.actors.capture(context);
    const id = v5(`${actor.workspaceId}:draft:${input.idempotencyKey}`, v5.URL);
    const inputHash = contentVersion(input);
    let record = await this.optional(context, id);
    if (record && this.payload(record).inputHash !== inputHash)
      throw new ConflictException('该提交标识已用于其他草稿');
    if (!record) {
      try {
        record = await this.records.create(context, 'recruitingDraft', {
          id,
          name: source.label,
          kind: input.kind,
          candidateId: input.candidateId ?? null,
          jobId: input.jobId ?? null,
          status: 'QUEUED',
          payload: {
            version: 1,
            input,
            inputHash,
            actor,
            sourceVersion: source.version,
          },
        });
      } catch (error) {
        record = await this.optional(context, id);
        if (!record || this.payload(record).inputHash !== inputHash)
          throw error;
      }
    }
    if (input.matchRunId) {
      const run = await this.records.one(
        context,
        'recruitingMatchRun',
        input.matchRunId,
      );
      await this.records.update(context, 'recruitingMatchRun', run.id, {
        payload: { ...(run.payload as object), matchDraftId: id },
      });
    }
    if (record.status === 'QUEUED') await this.enqueue(id, actor);
    return this.receipt(record);
  }

  /** Revalidates underlying source access before returning potentially private text. */
  async one(context: WorkspaceAuthContext, id: string) {
    const record = await this.records.one(context, 'recruitingDraft', id);
    const payload = this.payload(record);
    const source = await this.source(context, payload.input);
    return {
      ...this.receipt(record),
      title: record.title,
      body: record.body,
      note: payload.input.note,
      selectedIds: payload.input.selectedIds,
      jobPageUrl: payload.jobPageUrl,
      stale: payload.sourceVersion !== source.version,
      generation: payload.generation,
      approvedAt: payload.approvedAt,
      source: source.links,
    };
  }

  /** Lists bounded drafts, omitting sources whose current record permissions were removed. */
  async list(context: WorkspaceAuthContext, offset = 0) {
    const page = await this.records.list(context, 'recruitingDraft', {
      offset,
      limit: 30,
      orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
    });
    const visible = [];
    for (const record of page.records as RecruitingRecord[]) {
      try {
        await this.source(context, this.payload(record).input);
        visible.push(this.receipt(record));
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return { ...page, records: visible };
  }

  /** Retries generation under current authority while preserving approved human text despite source changes. */
  async retry(context: WorkspaceAuthContext, id: string) {
    const actor = this.actors.capture(context);
    const locked = await this.locks.tryWithLock(
      `recruiting-draft:${context.workspace.id}:${id}`,
      async () => {
        const record = await this.records.one(context, 'recruitingDraft', id);
        const payload = this.payload(record);
        const source = await this.source(context, payload.input);
        if (
          record.status === 'APPROVED' ||
          (record.status === 'READY' &&
            source.version === payload.sourceVersion)
        )
          return { record, enqueue: false };
        const active =
          await this.queue.getInFlightJobs<RecruitingDraftJobData>();
        if (
          active.some(
            (entry) =>
              entry.data.draftId === id &&
              entry.data.actor.workspaceId === context.workspace.id,
          )
        )
          return { record, enqueue: false };
        const authorized = await this.actors.resolve(actor);
        const updated = await this.records.update(
          authorized,
          'recruitingDraft',
          id,
          {
            status: 'QUEUED',
            error: '',
            payload: {
              ...payload,
              actor,
              approvedAt: undefined,
              sourceVersion: source.version,
              generation:
                source.version === payload.sourceVersion
                  ? payload.generation
                  : undefined,
            },
          },
        );
        return { record: updated, enqueue: true };
      },
    );
    if (!locked.acquired)
      throw new ConflictException('草稿正在处理，请稍后重试');
    if (locked.value.enqueue) await this.enqueue(id, actor);
    return this.receipt(locked.value.record);
  }

  /** Allows editable approval without changing publication, consent, recommendation or sent state. */
  async review(context: WorkspaceAuthContext, id: string, value: unknown) {
    const parsed = z
      .object({
        title: z.string().max(1000),
        body: z.string().min(1).max(100_000),
        approve: z.boolean().default(false),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请填写有效的草稿标题与正文');
    if (parsed.data.approve) this.requireHuman(context);
    const record = await this.records.one(context, 'recruitingDraft', id);
    if (!['READY', 'APPROVED', 'NEEDS_REVIEW'].includes(String(record.status)))
      throw new BadRequestException('请等待草稿生成完成');
    const payload = this.payload(record);
    const source = await this.source(context, payload.input);
    if (source.version !== payload.sourceVersion)
      throw new ConflictException('来源资料已变化，请重新生成后核对');
    await this.records.update(context, 'recruitingDraft', id, {
      title: parsed.data.title,
      body: parsed.data.body,
      status: parsed.data.approve ? 'APPROVED' : 'READY',
      payload: {
        ...payload,
        approvedAt: parsed.data.approve ? new Date().toISOString() : undefined,
      },
    });
    return this.one(context, id);
  }

  /** Executes once per lock, checkpoints successful model output before writing display fields, and never sends messages. */
  async process(data: RecruitingDraftJobData) {
    const locked = await this.locks.tryWithLock(
      `recruiting-draft:${data.actor.workspaceId}:${data.draftId}`,
      async () => {
        let context = await this.actors.resolve(data.actor);
        const record = await this.records.one(
          context,
          'recruitingDraft',
          data.draftId,
        );
        if (['READY', 'APPROVED'].includes(String(record.status))) return;
        let payload = this.payload(record);
        /** Rebuilds current authority after long operations, including failure-state persistence. */
        const update = async (patch: Record<string, unknown>) => {
          context = await this.actors.resolve(data.actor);
          return this.records.update(
            context,
            'recruitingDraft',
            record.id,
            patch,
          );
        };
        await update({
          status: 'PROCESSING',
          error: '',
        });
        try {
          const source = await this.source(context, payload.input);
          if (source.version !== payload.sourceVersion)
            throw new ConflictException();
          if (payload.input.matchRunId && !payload.jobPageUrl) {
            if (!this.jobPages)
              throw new BadRequestException('岗位介绍服务未就绪');
            const ids = 'jobIds' in source ? source.jobIds : [];
            payload = {
              ...payload,
              jobPageUrl: await this.jobPages.create(
                context,
                ids,
                'candidateIds' in source &&
                  source.context.direction === 'JOB_TO_CANDIDATES'
                  ? source.candidateIds
                  : [],
              ),
            };
            await update({ payload });
          }
          if (!payload.generation) {
            const generation = await this.extractor.draft(
              payload.input.matchRunId ? 'MATCH_BRIEF' : payload.input.kind,
              JSON.stringify({
                ...source.context,
                jobPageUrl: payload.jobPageUrl,
              }),
              payload.input.note,
            );
            payload = { ...payload, generation };
            await update({
              payload,
            });
          }
          const current = await this.source(context, payload.input);
          const stale = current.version !== payload.sourceVersion;
          const profile = payload.generation!.profile;
          await update({
            status: stale || profile.needsReview ? 'NEEDS_REVIEW' : 'READY',
            title: profile.title,
            body:
              payload.jobPageUrl && !profile.body.includes(payload.jobPageUrl)
                ? `${profile.body}

岗位介绍：${payload.jobPageUrl}`
                : profile.body,
            error: stale ? '来源资料已更新，请重新生成并核对' : '',
            payload,
          });
        } catch (error) {
          this.logger.error({
            draftId: record.id,
            error: error instanceof Error ? error.message : 'unknown',
          });
          await update({
            status: 'FAILED',
            error:
              error instanceof Error &&
              /server_is_overloaded|server_error/.test(error.message)
                ? '模型服务繁忙，请稍后重试'
                : error instanceof ConflictException
                  ? '来源资料已更新，请重试生成'
                  : error instanceof Error &&
                      /ECONNREFUSED|Cannot connect/.test(error.message)
                    ? '无法连接文案模型，请检查模型代理和网络后重试'
                    : error instanceof BadRequestException
                      ? error.message
                      : '草稿生成未完成，请检查模型配置或稍后重试',
            payload,
          });
        }
      },
    );
    if (!locked.acquired)
      throw new ConflictException('草稿正在处理，稍后自动重试');
  }

  /** Rejects API keys, apps and agent-delegated sessions for declarations that a real-world action happened. */
  requireHuman(context: WorkspaceAuthContext) {
    if (
      context.type !== 'user' ||
      context.application ||
      context.viaApplication ||
      context.agentId
    )
      throw new ForbiddenException('此状态需要运营人员在页面亲自确认');
  }

  /** Retrieves the most recent saved result draft, including operator edits. */
  async latestForMatch(context: WorkspaceAuthContext, id: string) {
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    const draftId = (run.payload as { matchDraftId?: string }).matchDraftId;
    return draftId ? this.one(context, draftId) : null;
  }

  /** Loads only explicitly selected current results, preserving their source versions. */
  private async matchSource(
    context: WorkspaceAuthContext,
    input: z.infer<typeof recruitingDraftInputSchema>,
  ) {
    if (!this.matching) throw new BadRequestException('匹配服务未就绪');
    const run = await this.matching.one(context, input.matchRunId!);
    if (!run.complete)
      throw new ConflictException('匹配结果已变化，请重新匹配后生成');
    const wanted = new Set(input.selectedIds);
    const selected = run.top.filter((pair) =>
      wanted.has(
        run.direction === 'JOB_TO_CANDIDATES' ? pair.candidateId : pair.jobId,
      ),
    );
    if (!selected.length || selected.length !== wanted.size)
      throw new BadRequestException('请选择当前匹配结果中的记录');
    const brief = await buildMatchBrief(
      String(run.direction),
      selected,
      (kind, id) => this.records.one(context, kind, id),
    );
    return {
      label: `${run.subjectLabel} · 匹配沟通文案`,
      ...brief,
      version: contentVersion({
        source: brief.version,
        templates: this.extractor.briefTemplateVersion?.(),
      }),
      links: { candidateUrl: undefined, jobUrl: undefined },
    };
  }

  /** Builds only relevant source facts; publication never includes candidate data. */
  private async source(
    context: WorkspaceAuthContext,
    input: z.infer<typeof recruitingDraftInputSchema>,
  ) {
    if (input.matchRunId) return this.matchSource(context, input);
    const candidate =
      input.kind === 'GREETING'
        ? await this.records.one(context, 'person', input.candidateId!)
        : undefined;
    if (
      candidate &&
      (!Array.isArray(candidate.contactRoles) ||
        !candidate.contactRoles.includes('CANDIDATE'))
    )
      throw new BadRequestException('所选联系人不是候选人');
    const job = input.jobId
      ? await this.records.one(context, 'recruitmentJob', input.jobId)
      : undefined;
    const company =
      typeof job?.companyId === 'string'
        ? await this.records.one(context, 'company', job.companyId)
        : undefined;
    const person = candidate
      ? buildCandidateMatchContext(candidate)
      : undefined;
    const vacancy = job ? buildJobMatchContext(job, company) : undefined;
    return {
      label:
        input.kind === 'GREETING'
          ? `${person?.label ?? '候选人'} · 问候草稿`
          : `${vacancy?.label ?? '岗位'} · 发布草稿`,
      context: {
        candidate: person
          ? { name: person.label, ...person.context }
          : undefined,
        job: vacancy?.context,
        company: vacancy?.company,
      },
      version: contentVersion({
        person: person?.version,
        job: vacancy?.version,
        company: vacancy?.companyVersion,
      }),
      links: {
        candidateUrl: candidate ? `/object/person/${candidate.id}` : undefined,
        jobUrl: job ? `/object/recruitmentJob/${job.id}` : undefined,
      },
    };
  }

  /** Keeps list receipts free of raw materials and model context. */
  private receipt(record: RecruitingRecord) {
    return {
      draftId: record.id,
      name: record.name,
      kind: record.kind,
      candidateId: record.candidateId,
      jobId: record.jobId,
      status: record.status,
      error: record.error,
      createdAt: record.createdAt,
    };
  }
  /** Reads only a verified internal envelope supplied by RecruitingRecordsService. */
  private payload(record: RecruitingRecord) {
    return record.payload as DraftPayload;
  }
  /** Only absence permits creation; permission and storage errors remain visible. */
  private async optional(context: WorkspaceAuthContext, id: string) {
    try {
      return await this.records.one(context, 'recruitingDraft', id);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
  /** Returns immediately after durable queue acceptance. */
  private async enqueue(id: string, actor: RecruitingActor) {
    await this.queue.add(
      'RecruitingDraftJob',
      { draftId: id, actor },
      {
        id: `recruiting-draft-${id}-${v4()}`,
        isWorkspaceJob: true,
        workspaceId: actor.workspaceId,
        retryLimit: 6,
        backoff: {
          strategy: 'exponential',
          initialDelayMilliseconds: 5_000,
        },
        deduplication: { id: `recruiting-draft-${id}` },
      },
    );
  }
}
