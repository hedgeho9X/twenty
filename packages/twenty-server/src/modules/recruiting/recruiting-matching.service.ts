/** Coordinates independent matching runs; stored candidates are never rolled back by scoring failures. */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { v4, v5 } from 'uuid';
import { z } from 'zod';
import { OrderByDirection } from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  RecruitingActorService,
  type RecruitingActor,
} from './recruiting-actor.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from './recruiting-records.service';
import {
  RecruitingPairEvaluatorService,
  RecruitingEvaluationAuthError,
  type RecruitingPairResult,
} from './recruiting-pair-evaluator.service';
import {
  buildCandidateMatchContext,
  buildJobMatchContext,
  contentVersion,
} from './domain/match-context';
import { RECRUITING_MATCH_PROTOCOL } from './domain/match-protocol';

/** Explicit target IDs narrow a run; their absence selects the complete permitted current pool. */
export const recruitingMatchInputSchema = z
  .object({
    direction: z.enum(['CANDIDATE_TO_JOBS', 'JOB_TO_CANDIDATES', 'PAIR']),
    subjectId: z.string().uuid(),
    jobId: z.string().uuid().optional(),
    targetIds: z.array(z.string().uuid()).max(2000).optional(),
    idempotencyKey: z.string().min(1).max(256).optional(),
  })
  .strict()
  .refine((input) => input.direction !== 'PAIR' || Boolean(input.jobId), {
    message: '指定匹配需要岗位 ID',
  });

/** Persistent progress and model evidence outlive Redis cleanup and worker restarts. */
type MatchRunPayload = {
  version: 1;
  input: z.infer<typeof recruitingMatchInputSchema>;
  inputHash: string;
  actor: RecruitingActor;
  targetIds?: string[];
  results: RecruitingPairResult[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
  reviewedAt?: string;
};

/** Queue data refers to native records and a revalidated actor, never access tokens. */
export type RecruitingMatchJobData = { runId: string; actor: RecruitingActor };

@Injectable()
/** Both ranking views and manual pair evaluation use the same versioned evaluator. */
export class RecruitingMatchingService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
    private readonly evaluator: RecruitingPairEvaluatorService,
    @InjectMessageQueue(MessageQueue.recruitingMatchQueue)
    private readonly queue: MessageQueueService,
  ) {}

  /** Gives intake and native record events one content-based automatic-run identity. */
  async submitForRecord(
    context: WorkspaceAuthContext,
    object: 'person' | 'recruitmentJob',
    id: string,
  ) {
    const record = await this.records.one(context, object, id);
    if (object === 'person')
      return this.submit(context, {
        direction: 'CANDIDATE_TO_JOBS',
        subjectId: id,
        idempotencyKey: `candidate:${id}:${buildCandidateMatchContext(record).version}`,
      });
    const company =
      typeof record.companyId === 'string'
        ? await this.records.one(context, 'company', record.companyId)
        : undefined;
    const prepared = buildJobMatchContext(record, company);
    return this.submit(context, {
      direction: 'JOB_TO_CANDIDATES',
      subjectId: id,
      idempotencyKey: `job:${id}:${prepared.version}:${prepared.companyVersion}`,
    });
  }

  /** Persists and queues an authorized run before returning HTTP 202. */
  async submit(context: WorkspaceAuthContext, value: unknown) {
    const parsed = recruitingMatchInputSchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请指定有效的匹配方向和来源记录');
    const input = parsed.data;
    const subject = await this.records.one(
      context,
      input.direction === 'JOB_TO_CANDIDATES' ? 'recruitmentJob' : 'person',
      input.subjectId,
    );
    if (input.direction !== 'JOB_TO_CANDIDATES' && !this.isCandidate(subject))
      throw new BadRequestException('请先把联系人设为候选人');
    if (input.direction === 'PAIR')
      await this.records.one(context, 'recruitmentJob', input.jobId!);
    const actor = this.actors.capture(context);
    const inputHash = contentVersion(input);
    const id = input.idempotencyKey
      ? v5(`${actor.workspaceId}:match:${input.idempotencyKey}`, v5.URL)
      : v4();
    const existing = await this.optional(context, id);
    if (existing) {
      if (this.payload(existing).inputHash !== inputHash)
        throw new BadRequestException('匹配提交标识已对应其他输入');
      if (existing.status === 'QUEUED') await this.enqueue(id, actor);
      return this.receipt(existing);
    }
    const payload: MatchRunPayload = {
      version: 1,
      input,
      inputHash,
      actor,
      results: [],
    };
    let run;
    try {
      run = await this.records.create(context, 'recruitingMatchRun', {
        id,
        name: '招聘匹配',
        direction: input.direction,
        subjectId: input.subjectId,
        status: 'QUEUED',
        payload,
      });
    } catch (error) {
      run = await this.optional(context, id);
      if (!run || this.payload(run).inputHash !== inputHash) throw error;
    }
    await this.enqueue(id, actor);
    return this.receipt(run);
  }

  /** Returns small queue rows; a detail request revalidates the underlying record permissions. */
  async list(context: WorkspaceAuthContext, offset = 0) {
    const page = await this.records.list(context, 'recruitingMatchRun', {
      offset,
      limit: 50,
      orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
    });
    const visible = [];
    for (const record of page.records as RecruitingRecord[]) {
      const payload = this.payload(record);
      try {
        await this.records.one(
          context,
          payload.input.direction === 'JOB_TO_CANDIDATES'
            ? 'recruitmentJob'
            : 'person',
          payload.input.subjectId,
        );
        visible.push(this.receipt(record));
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return { ...page, records: visible };
  }

  /** Excludes stale and now-inaccessible pairs from the current top five without claiming full coverage. */
  async one(context: WorkspaceAuthContext, id: string) {
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    const payload = this.payload(run);
    await this.records.one(
      context,
      payload.input.direction === 'JOB_TO_CANDIDATES'
        ? 'recruitmentJob'
        : 'person',
      payload.input.subjectId,
    );
    const recordCache = new Map<string, RecruitingRecord>();
    const read = async (object: string, recordId: string) => {
      const key = `${object}:${recordId}`;
      if (!recordCache.has(key))
        recordCache.set(key, await this.records.one(context, object, recordId));
      return recordCache.get(key)!;
    };
    let stale = 0;
    let inaccessible = 0;
    const results = [];
    for (const result of payload.results) {
      try {
        const candidate = await read('person', result.candidateId);
        if (!this.isCandidate(candidate)) {
          stale++;
          continue;
        }
        const job = await read('recruitmentJob', result.jobId);
        const company =
          typeof job.companyId === 'string'
            ? await read('company', job.companyId)
            : undefined;
        const prepared = this.evaluator.prepare(
          context,
          candidate,
          job,
          company,
        );
        if (prepared.cacheKey !== result.cacheKey) {
          stale++;
          continue;
        }
        results.push({
          ...result,
          intent: {
            expectedRoles: prepared.candidate.context.expectedRoles,
            status: prepared.candidate.context.expectedRoles.length
              ? ('declared' as const)
              : ('unspecified' as const),
            requiresConfirmation: true,
          },
          candidateLabel: prepared.candidate.label,
          jobLabel: prepared.job.label,
          candidateUrl: `/object/person/${result.candidateId}`,
          jobUrl: `/object/recruitmentJob/${result.jobId}`,
        });
      } catch (error) {
        if (error instanceof NotFoundException) inaccessible++;
        else throw error;
      }
    }
    const ranked = results
      .filter((row) => row.status === 'SCORED')
      .sort(
        (a, b) =>
          (b.score ?? 0) - (a.score ?? 0) ||
          (payload.input.direction === 'JOB_TO_CANDIDATES'
            ? a.candidateId.localeCompare(b.candidateId, 'en')
            : a.jobId.localeCompare(b.jobId, 'en')),
      );
    const duplicates = new Set<string>();
    const top = ranked
      .filter((row) => {
        const key =
          payload.input.direction === 'JOB_TO_CANDIDATES'
            ? row.candidateId
            : row.duplicateKey;
        if (duplicates.has(key)) return false;
        duplicates.add(key);
        return true;
      })
      .slice(0, 5);
    const wholePool =
      payload.input.direction !== 'PAIR' && !payload.input.targetIds;
    const currentPool = wholePool
      ? await this.records.list(
          context,
          payload.input.direction === 'JOB_TO_CANDIDATES'
            ? 'person'
            : 'recruitmentJob',
          {
            filter:
              payload.input.direction === 'JOB_TO_CANDIDATES'
                ? { contactRoles: { containsAny: ['CANDIDATE'] } }
                : { jobStatus: { eq: 'RECRUITING' } },
            limit: 1,
            select: ['id'],
          },
        )
      : undefined;
    const poolChanged = Boolean(
      currentPool &&
      payload.targetIds &&
      currentPool.count !== payload.targetIds.length,
    );
    return {
      ...this.receipt(run),
      results,
      top,
      stale,
      inaccessible,
      poolChanged,
      poolCapturedAt: payload.startedAt,
      currentPoolCount: currentPool?.count,
      complete:
        ['COMPLETED', 'NO_RESULTS'].includes(String(run.status)) &&
        !stale &&
        !inaccessible &&
        !poolChanged,
      protocol: RECRUITING_MATCH_PROTOCOL.version,
      notice:
        '相对前五仅表示能力排序；意向和未知条件需人工确认，不能直接作为录用或推荐决定。',
    };
  }

  /** Retries through cache under the current caller; completed runs can be refreshed after source changes. */
  async retry(context: WorkspaceAuthContext, id: string) {
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    if (['QUEUED', 'PROCESSING'].includes(String(run.status))) {
      const active = await this.queue.getInFlightJobs<RecruitingMatchJobData>();
      if (
        active.some(
          (entry) =>
            entry.data.runId === id &&
            entry.data.actor.workspaceId === context.workspace.id,
        )
      )
        return this.receipt(run);
    }
    const actor = this.actors.capture(context);
    const updated = await this.records.update(
      context,
      'recruitingMatchRun',
      id,
      {
        status: 'QUEUED',
        payload: {
          ...this.payload(run),
          actor,
          results: [],
          error: undefined,
          completedAt: undefined,
        },
      },
    );
    await this.enqueue(id, actor);
    return this.receipt(updated);
  }

  /** Marks review as an operator action and leaves actual contact/recommendation state untouched. */
  async reviewed(context: WorkspaceAuthContext, id: string) {
    await this.one(context, id);
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    return this.receipt(
      await this.records.update(context, 'recruitingMatchRun', id, {
        payload: { ...this.payload(run), reviewedAt: new Date().toISOString() },
      }),
    );
  }

  /** Runs bounded local evaluators instead of waiting for child jobs on an occupied parent queue. */
  async process(data: RecruitingMatchJobData) {
    let context = await this.actors.resolve(data.actor);
    const run = await this.records.one(
      context,
      'recruitingMatchRun',
      data.runId,
    );
    if (['COMPLETED', 'NO_RESULTS'].includes(String(run.status))) return;
    let payload = this.payload(run);
    const save = async (
      status: string,
      patch: Partial<MatchRunPayload> = {},
    ) => {
      payload = { ...payload, ...patch };
      await this.records.update(context, 'recruitingMatchRun', run.id, {
        status,
        payload,
      });
    };
    try {
      const { input } = payload;
      const jobFirst = input.direction === 'JOB_TO_CANDIDATES';
      const subject = await this.records.one(
        context,
        jobFirst ? 'recruitmentJob' : 'person',
        input.subjectId,
      );
      if (!jobFirst && !this.isCandidate(subject))
        throw new BadRequestException('来源联系人已不再是候选人');
      const pool =
        input.direction === 'PAIR'
          ? [await this.records.one(context, 'recruitmentJob', input.jobId!)]
          : await this.records.all(
              context,
              jobFirst ? 'person' : 'recruitmentJob',
              jobFirst
                ? { contactRoles: { containsAny: ['CANDIDATE'] } }
                : { jobStatus: { eq: 'RECRUITING' } },
            );
      const ids =
        payload.targetIds ?? input.targetIds ?? pool.map((entry) => entry.id);
      const selected = [...new Set(ids)];
      const companies = new Map(
        (await this.records.all(context, 'company')).map((entry) => [
          entry.id,
          entry,
        ]),
      );
      const poolMap = new Map(pool.map((entry) => [entry.id, entry]));
      const results: RecruitingPairResult[] = [];
      let providerAuthorizationFailed = false;
      await save('PROCESSING', {
        targetIds: selected,
        results: [],
        startedAt: new Date().toISOString(),
        error: undefined,
      });
      for (let offset = 0; offset < selected.length; offset += 3) {
        context = await this.actors.resolve(data.actor);
        const chunk = await Promise.all(
          selected.slice(offset, offset + 3).map(async (targetId) => {
            const target = poolMap.get(targetId);
            const candidate = jobFirst ? target : subject;
            const job = jobFirst ? subject : target;
            if (!candidate || !job || !this.isCandidate(candidate))
              return undefined;
            const company =
              typeof job.companyId === 'string'
                ? companies.get(job.companyId)
                : undefined;
            try {
              if (providerAuthorizationFailed)
                throw new RecruitingEvaluationAuthError();
              return await this.evaluator.run(context, candidate, job, company);
            } catch (error) {
              if (error instanceof RecruitingEvaluationAuthError)
                providerAuthorizationFailed = true;
              const prepared = this.evaluator.prepare(
                context,
                candidate,
                job,
                company,
              );
              return {
                candidateId: candidate.id,
                jobId: job.id,
                candidateLabel: prepared.candidate.label,
                jobLabel: prepared.job.label,
                cacheId: prepared.cacheId,
                cacheKey: prepared.cacheKey,
                modelId: prepared.modelId,
                duplicateKey: prepared.job.duplicateKey,
                cached: false,
                evaluatedAt: new Date().toISOString(),
                status: 'FAILED' as const,
                eligibility: {
                  status: 'needs_confirmation' as const,
                  reasons: [],
                },
                error:
                  error instanceof BadRequestException ||
                  error instanceof RecruitingEvaluationAuthError
                    ? error.message
                    : '评分暂时失败，可重试；未计为零分',
              };
            }
          }),
        );
        results.push(
          ...chunk.filter(
            (entry): entry is RecruitingPairResult => entry !== undefined,
          ),
        );
        await save('PROCESSING', { results: [...results] });
      }
      const incomplete =
        results.length < selected.length ||
        results.some((entry) =>
          ['FAILED', 'NEEDS_REVIEW'].includes(entry.status),
        );
      await save(
        incomplete
          ? 'PARTIAL'
          : results.some((entry) => entry.status === 'SCORED')
            ? 'COMPLETED'
            : 'NO_RESULTS',
        { completedAt: new Date().toISOString() },
      );
    } catch (error) {
      await save('FAILED', {
        error:
          error instanceof BadRequestException
            ? error.message
            : '匹配任务失败，请核对来源及权限后重试',
      });
    }
  }

  /** Reuses native durable queue bookkeeping while avoiding completed job-ID collisions on retry. */
  private enqueue(runId: string, actor: RecruitingActor) {
    return this.queue.add(
      'RecruitingMatchJob',
      { runId, actor },
      {
        id: `recruiting-match-${runId}-${v4()}`,
        deduplication: { id: `recruiting-match-${runId}` },
        isWorkspaceJob: true,
        workspaceId: actor.workspaceId,
        retryLimit: 1,
        broadcastTo: {
          workspaceId: actor.workspaceId,
          userWorkspaceId: actor.userWorkspaceId,
        },
      },
    );
  }

  /** Presents coverage separately from rank and contact status. */
  private receipt(run: RecruitingRecord) {
    const payload = this.payload(run);
    const counts = {
      total: payload.targetIds?.length ?? 0,
      processed: payload.results.length,
      scored: 0,
      excluded: 0,
      needsReview: 0,
      failed: 0,
      cached: 0,
      unavailable: ['COMPLETED', 'PARTIAL', 'FAILED', 'NO_RESULTS'].includes(
        String(run.status),
      )
        ? Math.max(0, (payload.targetIds?.length ?? 0) - payload.results.length)
        : 0,
      pending: ['QUEUED', 'PROCESSING'].includes(String(run.status))
        ? Math.max(0, (payload.targetIds?.length ?? 0) - payload.results.length)
        : 0,
    };
    for (const row of payload.results) {
      if (row.status === 'SCORED') counts.scored++;
      if (row.status === 'EXCLUDED') counts.excluded++;
      if (row.status === 'NEEDS_REVIEW') counts.needsReview++;
      if (row.status === 'FAILED') counts.failed++;
      if (row.cached) counts.cached++;
    }
    return {
      runId: run.id,
      direction: run.direction,
      subjectId: run.subjectId,
      status: run.status,
      counts,
      error: payload.error,
      createdAt: run.createdAt,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt,
      reviewedAt: payload.reviewedAt,
    };
  }

  /** Historical rows cannot be executed as current queue envelopes. */
  private payload(run: RecruitingRecord): MatchRunPayload {
    const payload = run.payload as MatchRunPayload | undefined;
    if (payload?.version !== 1)
      throw new BadRequestException('匹配任务版本不兼容');
    return payload;
  }

  /** Recognizes candidates explicitly, not by the presence of any personal information. */
  private isCandidate(record: RecruitingRecord) {
    return (
      Array.isArray(record.contactRoles) &&
      record.contactRoles.includes('CANDIDATE')
    );
  }

  /** Only a genuinely missing or inaccessible record is treated as absent. */
  private async optional(context: WorkspaceAuthContext, id: string) {
    try {
      return await this.records.one(context, 'recruitingMatchRun', id);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
}
