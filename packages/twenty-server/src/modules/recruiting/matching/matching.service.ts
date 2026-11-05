import { getMatchBilling } from './domain/match-billing';
/** Coordinates independent matching runs; stored candidates are never rolled back by scoring failures. */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
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
} from '../auth/actor.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from '../records/records.service';
import {
  RecruitingPairEvaluatorService,
  RecruitingEvaluationAuthError,
  type RecruitingPairResult,
} from './pair-evaluator.service';
import {
  buildCandidateMatchContext,
  buildJobMatchContext,
  contentVersion,
} from './domain/match-context';
import { recruitingLikePattern } from '../records/domain/search';
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
  protocolVersion?: string;
  source?: 'manual' | 'api' | 'email' | 'system';
  input: z.infer<typeof recruitingMatchInputSchema>;
  inputHash: string;
  sourceVersion?: string;
  actor: RecruitingActor;
  targetIds?: string[];
  results: RecruitingPairResult[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
  reviewedAt?: string;
  reviewedBy?: Record<string, string>;
  followUpStatus?: string;
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
    @Optional() private readonly orm?: WorkspaceOrmManager,
  ) {}

  /** Gives intake and native record events one content-based automatic-run identity. */
  async submitForRecord(
    context: WorkspaceAuthContext,
    object: 'person' | 'recruitmentJob',
    id: string,
    source: 'manual' | 'api' | 'email' | 'system' = 'system',
  ) {
    const record = await this.records.one(context, object, id);
    if (object === 'person')
      return this.submit(
        context,
        {
          direction: 'CANDIDATE_TO_JOBS',
          subjectId: id,
          idempotencyKey: `candidate:${id}:${buildCandidateMatchContext(record).version}`,
        },
        source,
      );
    const company =
      typeof record.companyId === 'string'
        ? await this.records.one(context, 'company', record.companyId)
        : undefined;
    const prepared = buildJobMatchContext(record, company);
    return this.submit(
      context,
      {
        direction: 'JOB_TO_CANDIDATES',
        subjectId: id,
        idempotencyKey: `job:${id}:${prepared.version}:${prepared.companyVersion}`,
      },
      source,
    );
  }

  /** Persists and queues an authorized run before returning HTTP 202. */
  async submit(
    context: WorkspaceAuthContext,
    value: unknown,
    source?: 'manual' | 'api' | 'email' | 'system',
  ) {
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
      protocolVersion: RECRUITING_MATCH_PROTOCOL.version,
      source:
        source ??
        (actor.apiKeyId ||
        actor.applicationId ||
        actor.viaApplicationId ||
        actor.agentId
          ? 'api'
          : 'manual'),
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

  /** Pages full-subject results instead of exposing the batch engine's individual pair receipts. */
  async listGrouped(
    context: WorkspaceAuthContext,
    direction: string,
    offset: number,
    limit: number,
    search = '',
    filters: {
      read?: string;
      followUp?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    if (
      !['CANDIDATE_TO_JOBS', 'JOB_TO_CANDIDATES'].includes(direction) ||
      !this.orm
    )
      throw new BadRequestException('匹配方向无效');
    for (const date of [filters.from, filters.to])
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(`${date}T00:00:00+08:00`)))
      )
        throw new BadRequestException('日期无效');
    const descriptors = await this.orm.executeInWorkspaceContext(async () => {
      return this.orm!.getRepositoryWithContextPermissions('recruitingMatchRun')
        .createQueryBuilder('run')
        .select('run.id', 'id')
        .addSelect('run.subjectId', 'subjectId')
        .addSelect('run.createdAt', 'createdAt')
        .addSelect(`"run"."payload" -> 'reviewedBy'`, 'reviewedBy')
        .addSelect(`"run"."payload" ->> 'followUpStatus'`, 'followUpStatus')
        .addSelect(
          `jsonb_path_query_array("run"."payload", '$.results[*].jobId')`,
          'jobIds',
        )
        .where('"run"."direction" = :direction', { direction })
        .andWhere('"run"."status" IN (:...states)', {
          states: [
            'COMPLETED',
            'PARTIAL',
            'NO_RESULTS',
            'FAILED',
            'SUPERSEDED',
          ],
        })
        .distinctOn(['run.subjectId'])
        .orderBy('run.subjectId', 'ASC')
        .addOrderBy('run.createdAt', 'DESC')
        .addOrderBy('run.id', 'DESC')
        .getRawMany<{
          id: string;
          subjectId: string;
          createdAt: string;
          reviewedBy?: Record<string, string>;
          followUpStatus?: string;
          jobIds?: string[];
        }>();
    }, context);
    const subjectIds = descriptors.map((row) => row.subjectId);
    if (!subjectIds.length)
      return { records: [], count: 0, hasNextPage: false };
    const subjects = new Map<string, RecruitingRecord>();
    const object =
      direction === 'JOB_TO_CANDIDATES' ? 'recruitmentJob' : 'person';
    for (let start = 0; start < subjectIds.length; start += 100) {
      const page = await this.records.list(context, object, {
        filter: { id: { in: subjectIds.slice(start, start + 100) } },
        select:
          object === 'person' ? ['id', 'name', 'jobTitle'] : ['id', 'name'],
        limit: 100,
      });
      for (const record of page.records as RecruitingRecord[])
        subjects.set(record.id, record);
    }
    const query = search.trim().toLocaleLowerCase();
    const matchingJobIds = new Set<string>();
    if (query) {
      const pattern = recruitingLikePattern(search.trim());
      const companies = await this.records.all(context, 'company', {
        name: { ilike: pattern },
      });
      const jobFilter = {
        or: [
          { name: { ilike: pattern } },
          ...(companies.length
            ? [{ companyId: { in: companies.map((row) => row.id) } }]
            : []),
        ],
      };
      for (let offset = 0; ; offset += 100) {
        const page = await this.records.list(context, 'recruitmentJob', {
          filter: jobFilter,
          select: ['id'],
          offset,
          limit: 100,
        });
        for (const row of page.records as RecruitingRecord[])
          matchingJobIds.add(row.id);
        if (!page.hasNextPage) break;
      }
    }
    const viewer = contentVersion(this.actors.capture(context));
    const visible = descriptors
      .filter((row) => {
        const created = new Date(row.createdAt).getTime();
        if (
          filters.from &&
          created < Date.parse(`${filters.from}T00:00:00+08:00`)
        )
          return false;
        if (
          filters.to &&
          created >= Date.parse(`${filters.to}T00:00:00+08:00`) + 86400000
        )
          return false;
        const subject = subjects.get(row.subjectId);
        const read = Boolean(row.reviewedBy?.[viewer]);
        if (
          (filters.read === 'unread' && read) ||
          (filters.read === 'read' && !read)
        )
          return false;
        if (
          filters.followUp &&
          (row.followUpStatus ?? 'TODO') !== filters.followUp
        )
          return false;
        return (
          subject &&
          (!query ||
            JSON.stringify([subject.name, subject.jobTitle])
              .toLocaleLowerCase()
              .includes(query) ||
            row.jobIds?.some((id) => matchingJobIds.has(id)))
        );
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
          a.id.localeCompare(b.id),
      );
    const selected = visible.slice(offset, offset + limit);
    if (!selected.length)
      return { records: [], count: visible.length, hasNextPage: false };
    const result = await this.list(context, 0, direction, false, true, {
      ids: selected.map((row) => row.id),
      limit,
    });
    return {
      ...result,
      count: visible.length,
      hasNextPage: offset + limit < visible.length,
    };
  }

  /** Updates explicit operator workflow state without sending messages or changing scores. */
  async workflow(context: WorkspaceAuthContext, id: string, status: string) {
    if (!['TODO', 'TO_CONTACT', 'CONTACTED', 'DISMISSED'].includes(status))
      throw new BadRequestException('跟进状态无效');
    await this.summary(context, id);
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    return this.receipt(
      await this.records.update(context, 'recruitingMatchRun', id, {
        payload: { ...this.payload(run), followUpStatus: status },
      }),
      context,
    );
  }

  /** Returns small queue rows; a detail request revalidates the underlying record permissions. */
  async list(
    context: WorkspaceAuthContext,
    offset = 0,
    direction?: string,
    completedOnly = false,
    terminalHistory = false,
    options?: { ids: string[]; limit: number },
  ) {
    if (
      direction &&
      !['CANDIDATE_TO_JOBS', 'JOB_TO_CANDIDATES'].includes(direction)
    )
      throw new BadRequestException('匹配方向无效');
    const filters: Record<string, unknown>[] = [];
    if (direction)
      filters.push(
        direction === 'CANDIDATE_TO_JOBS'
          ? {
              or: [
                { direction: { eq: 'CANDIDATE_TO_JOBS' } },
                { direction: { eq: 'PAIR' } },
              ],
            }
          : { direction: { eq: direction } },
      );
    if (options) filters.push({ id: { in: options.ids } });
    if (completedOnly) filters.push({ status: { eq: 'COMPLETED' } });
    else if (terminalHistory)
      filters.push({
        or: ['COMPLETED', 'PARTIAL', 'NO_RESULTS', 'FAILED', 'SUPERSEDED'].map(
          (status) => ({ status: { eq: status } }),
        ),
      });
    const page = await this.records.list(context, 'recruitingMatchRun', {
      ...(filters.length
        ? { filter: filters.length === 1 ? filters[0] : { and: filters } }
        : {}),
      offset,
      limit: options?.limit ?? 50,
      orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
    });
    const runs = (page.records as RecruitingRecord[]).map((record) => ({
      record,
      payload: this.payload(record),
    }));
    if (!runs.length) return { ...page, records: [] };
    const [candidates, jobs] = await Promise.all([
      this.records.byIds(
        context,
        'person',
        runs
          .filter(
            ({ payload }) => payload.input.direction !== 'JOB_TO_CANDIDATES',
          )
          .map(({ payload }) => payload.input.subjectId),
      ),
      this.records.byIds(
        context,
        'recruitmentJob',
        runs
          .filter(
            ({ payload }) => payload.input.direction === 'JOB_TO_CANDIDATES',
          )
          .map(({ payload }) => payload.input.subjectId),
      ),
    ]);
    const visible = [];
    for (const { record, payload } of runs) {
      const subject = (
        payload.input.direction === 'JOB_TO_CANDIDATES' ? jobs : candidates
      ).get(payload.input.subjectId);
      if (subject) {
        visible.push({
          ...this.receipt(record, context),
          expectedRoles:
            payload.input.direction === 'JOB_TO_CANDIDATES'
              ? []
              : buildCandidateMatchContext(subject).context.expectedRoles,
          subjectLabel:
            payload.input.direction === 'JOB_TO_CANDIDATES'
              ? buildJobMatchContext(subject).label
              : buildCandidateMatchContext(subject).label,
        });
      }
    }
    return { ...page, records: visible };
  }

  /** Loads the header without hydrating or re-evaluating the target pool. */
  async summary(context: WorkspaceAuthContext, id: string) {
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    const payload = this.payload(run);
    const object =
      payload.input.direction === 'JOB_TO_CANDIDATES'
        ? 'recruitmentJob'
        : 'person';
    const subjects = await this.metadataByIds(context, object, [
      payload.input.subjectId,
    ]);
    const subject = subjects.get(payload.input.subjectId);
    if (!subject) throw new NotFoundException('来源记录不存在或当前无权访问');
    let sourceChanged = false;
    if (payload.sourceVersion) {
      const current = await this.records.one(
        context,
        object,
        payload.input.subjectId,
      );
      const company =
        object === 'recruitmentJob' && typeof current.companyId === 'string'
          ? await this.records.one(context, 'company', current.companyId)
          : undefined;
      const version =
        object === 'recruitmentJob'
          ? contentVersion(buildJobMatchContext(current, company))
          : buildCandidateMatchContext(current).version;
      sourceChanged = version !== payload.sourceVersion;
    }
    return {
      ...this.receipt(run, context),
      subjectLabel: this.recordLabel(subject.name),
      executionComplete: !['QUEUED', 'PROCESSING'].includes(String(run.status)),
      sourceChanged,
      complete:
        ['COMPLETED', 'NO_RESULTS'].includes(String(run.status)) &&
        !sourceChanged,
    };
  }

  /** Fetches only lightweight identity fields while retaining native row and field permissions. */
  private async metadataByIds(
    context: WorkspaceAuthContext,
    object: string,
    ids: string[],
  ) {
    const result = new Map<string, RecruitingRecord>();
    const unique = [...new Set(ids)];
    const select =
      object === 'person'
        ? ['id', 'name', 'contactRoles']
        : object === 'recruitmentJob'
          ? ['id', 'name', 'companyId']
          : ['id', 'name'];
    for (let index = 0; index < unique.length; index += 100) {
      const page = await this.records.list(context, object, {
        filter: { id: { in: unique.slice(index, index + 100) } },
        select,
        limit: 100,
      });
      for (const row of page.records as RecruitingRecord[])
        result.set(row.id, row);
    }
    return result;
  }

  /** Formats native names without loading resume bodies for search. */
  private recordLabel(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    const name = value as { firstName?: string; lastName?: string };
    return [name.firstName, name.lastName].filter(Boolean).join(' ');
  }

  /** Searches lightweight identities and validates full source versions only for the requested page. */
  async resultPage(
    context: WorkspaceAuthContext,
    id: string,
    offset = 0,
    limit = 20,
    search = '',
    status = 'ALL',
  ) {
    if (
      !['ALL', 'SCORED', 'EXCLUDED', 'NEEDS_REVIEW', 'FAILED'].includes(status)
    )
      throw new BadRequestException('结果状态无效');
    offset = Math.max(0, Math.floor(offset));
    limit = Math.min(100, Math.max(1, Math.floor(limit)));
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    const payload = this.payload(run);
    await this.records.one(
      context,
      payload.input.direction === 'JOB_TO_CANDIDATES'
        ? 'recruitmentJob'
        : 'person',
      payload.input.subjectId,
    );
    const raw = payload.results.filter(
      (row) => status === 'ALL' || row.status === status,
    );
    const [candidateMetadata, jobMetadata] = await Promise.all([
      this.metadataByIds(
        context,
        'person',
        raw.map((row) => row.candidateId),
      ),
      this.metadataByIds(
        context,
        'recruitmentJob',
        raw.map((row) => row.jobId),
      ),
    ]);
    const companyMetadata = await this.metadataByIds(
      context,
      'company',
      [...jobMetadata.values()].flatMap((row) =>
        typeof row.companyId === 'string' ? [row.companyId] : [],
      ),
    );
    const query = search.trim().toLocaleLowerCase();
    const visible = raw
      .filter((row) => {
        const person = candidateMetadata.get(row.candidateId),
          job = jobMetadata.get(row.jobId);
        if (!person || !this.isCandidate(person) || !job) return false;
        const company =
          typeof job.companyId === 'string'
            ? companyMetadata.get(job.companyId)
            : undefined;
        if (job.companyId && !company) return false;
        return (
          !query ||
          [
            this.recordLabel(person.name),
            this.recordLabel(job.name),
            this.recordLabel(company?.name),
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)
        );
      })
      .sort(
        (a, b) =>
          (b.score ?? -1) - (a.score ?? -1) ||
          a.candidateId.localeCompare(b.candidateId) ||
          a.jobId.localeCompare(b.jobId),
      );
    const selected = visible.slice(offset, offset + limit);
    const records = await this.currentPairs(context, selected);
    return {
      runId: id,
      records,
      count: visible.length,
      hasNextPage: offset + limit < visible.length,
      staleOnPage: records.filter((row) => row.status === 'STALE').length,
    };
  }

  /** Hydrates and rechecks only the selected result page. */
  private async currentPairs(
    context: WorkspaceAuthContext,
    selected: RecruitingPairResult[],
  ) {
    const [candidates, jobs] = await Promise.all([
      this.records.byIds(
        context,
        'person',
        selected.map((row) => row.candidateId),
      ),
      this.records.byIds(
        context,
        'recruitmentJob',
        selected.map((row) => row.jobId),
      ),
    ]);
    const companies = await this.records.byIds(
      context,
      'company',
      [...jobs.values()].flatMap((row) =>
        typeof row.companyId === 'string' ? [row.companyId] : [],
      ),
    );
    return selected.flatMap((row) => {
      const person = candidates.get(row.candidateId),
        job = jobs.get(row.jobId);
      if (!person || !this.isCandidate(person) || !job) return [];
      const company =
        typeof job.companyId === 'string'
          ? companies.get(job.companyId)
          : undefined;
      if (job.companyId && !company) return [];
      const prepared = this.evaluator.prepare(context, person, job, company);
      const stale = prepared.cacheKey !== row.cacheKey;
      return [
        {
          ...row,
          ...(stale
            ? { status: 'STALE', storedStatus: row.status, score: undefined }
            : {}),
          candidateLabel: prepared.candidate.label,
          jobLabel: prepared.job.label,
          companyId: company?.id,
          companyLabel: this.recordLabel(company?.name),
          candidateUrl: `/object/person/${row.candidateId}`,
          jobUrl: `/object/recruitmentJob/${row.jobId}`,
        },
      ];
    });
  }

  /** Allows usable selections from partial runs while rejecting stale or unscored targets. */
  async selection(
    context: WorkspaceAuthContext,
    id: string,
    selectedIds: string[],
  ) {
    const wanted = new Set(selectedIds);
    if (!wanted.size || wanted.size > 10)
      throw new BadRequestException('请选择一至十项匹配结果');
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    const payload = this.payload(run);
    const selected = payload.results.filter(
      (row) =>
        row.status === 'SCORED' &&
        wanted.has(
          payload.input.direction === 'JOB_TO_CANDIDATES'
            ? row.candidateId
            : row.jobId,
        ),
    );
    const results = await this.currentPairs(context, selected);
    if (
      results.length !== wanted.size ||
      results.some((row) => row.status !== 'SCORED')
    )
      throw new ConflictException('所选匹配结果已变化，请刷新后重新选择');
    const summary = await this.summary(context, id);
    return { ...summary, results };
  }

  /** Excludes stale and now-inaccessible pairs from the current top five without claiming full coverage. */
  async one(context: WorkspaceAuthContext, id: string) {
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    const payload = this.payload(run);
    const subject = await this.records.one(
      context,
      payload.input.direction === 'JOB_TO_CANDIDATES'
        ? 'recruitmentJob'
        : 'person',
      payload.input.subjectId,
    );
    const [candidates, jobs] = await Promise.all([
      this.records.byIds(
        context,
        'person',
        payload.results.map((result) => result.candidateId),
      ),
      this.records.byIds(
        context,
        'recruitmentJob',
        payload.results.map((result) => result.jobId),
      ),
    ]);
    const companies = await this.records.byIds(
      context,
      'company',
      [...jobs.values()].flatMap((job) =>
        typeof job.companyId === 'string' ? [job.companyId] : [],
      ),
    );
    let stale = 0;
    let inaccessible = 0;
    const results = [];
    for (const result of payload.results) {
      try {
        const candidate = candidates.get(result.candidateId);
        if (!candidate) throw new NotFoundException();
        if (!this.isCandidate(candidate)) {
          stale++;
          continue;
        }
        const job = jobs.get(result.jobId);
        if (!job) throw new NotFoundException();
        const company =
          typeof job.companyId === 'string'
            ? companies.get(job.companyId)
            : undefined;
        if (typeof job.companyId === 'string' && !company)
          throw new NotFoundException();
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
          companyId: company?.id,
          companyLabel:
            typeof company?.name === 'string' ? company.name : undefined,
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
      .slice(0, 10);
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
      ...this.receipt(run, context),
      subjectLabel:
        payload.input.direction === 'JOB_TO_CANDIDATES'
          ? buildJobMatchContext(subject).label
          : buildCandidateMatchContext(subject).label,
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
      protocol: payload.protocolVersion ?? 'legacy/unrecorded',
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
    const payload = this.payload(run);
    const updated = await this.records.update(
      context,
      'recruitingMatchRun',
      id,
      {
        status: 'QUEUED',
        payload: {
          ...payload,
          actor,
          targetIds:
            payload.input.direction !== 'PAIR' && !payload.input.targetIds
              ? undefined
              : payload.targetIds,
          results: [],
          sourceVersion: undefined,
          error: undefined,
          completedAt: undefined,
          reviewedAt: undefined,
          reviewedBy: undefined,
        },
      },
    );
    await this.enqueue(id, actor);
    return this.receipt(updated);
  }

  /** Marks review as an operator action and leaves actual contact/recommendation state untouched. */
  async reviewed(context: WorkspaceAuthContext, id: string) {
    await this.summary(context, id);
    const run = await this.records.one(context, 'recruitingMatchRun', id);
    return this.receipt(
      await this.records.update(context, 'recruitingMatchRun', id, {
        payload: {
          ...this.payload(run),
          reviewedAt: new Date().toISOString(),
          reviewedBy: {
            ...this.payload(run).reviewedBy,
            [contentVersion(this.actors.capture(context))]:
              new Date().toISOString(),
          },
        },
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
          : input.targetIds
            ? [
                ...(
                  await this.records.byIds(
                    context,
                    jobFirst ? 'person' : 'recruitmentJob',
                    input.targetIds,
                  )
                ).values(),
              ]
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
      const sourceVersion = jobFirst
        ? contentVersion(
            buildJobMatchContext(
              subject,
              companies.get(String(subject.companyId)),
            ),
          )
        : buildCandidateMatchContext(subject).version;
      payload = { ...payload, sourceVersion };
      if (jobFirst && this.evaluator.reusePool) {
        const reusable = await this.evaluator.reusePool(
          context,
          pool.filter((candidate) => this.isCandidate(candidate)),
          subject,
          companies.get(String(subject.companyId)),
        );
        if (selected.length && selected.every((id) => reusable.has(id))) {
          context = await this.actors.resolve(data.actor);
          const current = await this.records.one(
            context,
            'recruitmentJob',
            input.subjectId,
          );
          const company =
            typeof current.companyId === 'string'
              ? await this.records.one(context, 'company', current.companyId)
              : undefined;
          if (
            contentVersion(buildJobMatchContext(current, company)) !==
            sourceVersion
          ) {
            await save('SUPERSEDED', {
              error: '来源资料已更新，请重新匹配',
              completedAt: new Date().toISOString(),
            });
            return;
          }
          const results = selected.map((id) => reusable.get(id)!);
          // Full source versions are also checked when a result page is opened or shared.
          await save(
            results.some((row) => row.status === 'SCORED')
              ? 'COMPLETED'
              : 'NO_RESULTS',
            {
              targetIds: selected,
              results,
              completedAt: new Date().toISOString(),
              error: undefined,
            },
          );
          return;
        }
      }
      const results: RecruitingPairResult[] = [];
      let providerAuthorizationFailed = false;
      await save('PROCESSING', {
        protocolVersion: RECRUITING_MATCH_PROTOCOL.version,
        targetIds: selected,
        results: [],
        startedAt: new Date().toISOString(),
        error: undefined,
      });
      for (let offset = 0; offset < selected.length; offset += 3) {
        context = await this.actors.resolve(data.actor);
        const currentSource = await this.records.one(
          context,
          jobFirst ? 'recruitmentJob' : 'person',
          input.subjectId,
        );
        const currentCompany =
          jobFirst && typeof currentSource.companyId === 'string'
            ? await this.records.one(
                context,
                'company',
                currentSource.companyId,
              )
            : undefined;
        const currentVersion = jobFirst
          ? contentVersion(buildJobMatchContext(currentSource, currentCompany))
          : buildCandidateMatchContext(currentSource).version;
        if (
          currentVersion !== sourceVersion ||
          (!jobFirst && !this.isCandidate(currentSource))
        ) {
          await save('SUPERSEDED', {
            error: '来源资料已更新，旧任务停止评分；请查看新任务',
            completedAt: new Date().toISOString(),
          });
          return;
        }
        const chunk = await Promise.all(
          selected.slice(offset, offset + 3).map(async (targetId) => {
            if (!poolMap.has(targetId)) return undefined;
            let target;
            try {
              target = await this.records.one(
                context,
                jobFirst ? 'person' : 'recruitmentJob',
                targetId,
              );
            } catch (error) {
              if (error instanceof NotFoundException) return undefined;
              throw error;
            }
            const candidate = jobFirst ? target : subject;
            const job = jobFirst ? subject : target;
            if (!candidate || !job || !this.isCandidate(candidate))
              return undefined;
            const company = jobFirst
              ? currentCompany
              : typeof job.companyId === 'string'
                ? await this.records.one(context, 'company', job.companyId)
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
      context = await this.actors.resolve(data.actor);
      const finalSource = await this.records.one(
        context,
        jobFirst ? 'recruitmentJob' : 'person',
        input.subjectId,
      );
      const finalCompany =
        jobFirst && typeof finalSource.companyId === 'string'
          ? await this.records.one(context, 'company', finalSource.companyId)
          : undefined;
      const finalVersion = jobFirst
        ? contentVersion(buildJobMatchContext(finalSource, finalCompany))
        : buildCandidateMatchContext(finalSource).version;
      if (
        finalVersion !== sourceVersion ||
        (!jobFirst && !this.isCandidate(finalSource))
      ) {
        await save('SUPERSEDED', {
          error: '来源资料已更新，请按最新资料重新匹配',
          completedAt: new Date().toISOString(),
        });
        return;
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
  private receipt(run: RecruitingRecord, context?: WorkspaceAuthContext) {
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
      source: payload.source,
      subjectId: run.subjectId,
      status: run.status,
      counts,
      billing: getMatchBilling(
        payload.results,
        this.evaluator.inputPricePerMillion?.() ?? null,
      ),
      error: payload.error,
      createdAt: run.createdAt,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt,
      reviewedAt: context
        ? payload.reviewedBy?.[contentVersion(this.actors.capture(context))]
        : payload.reviewedAt,
      followUpStatus: payload.followUpStatus ?? 'TODO',
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
