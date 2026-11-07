/** Projects material ingestion and its matching children as one operator-visible workflow. */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { OrderByDirection } from 'twenty-shared/types';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from '../records/records.service';
import { RecruitingIntakeService } from './intake.service';
import { RecruitingMatchingService } from '../matching/matching.service';

@Injectable()
/** Retains independent worker retries while exposing one durable business task. */
export class ProcessingTasksService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly intakes: RecruitingIntakeService,
    private readonly matching: RecruitingMatchingService,
    @Optional() private readonly orm?: WorkspaceOrmManager,
  ) {}

  /** Filters before pagination and resolves child states using the current caller's permissions. */
  async list(context: WorkspaceAuthContext, offset = 0, direction?: string) {
    if (
      direction &&
      !['CANDIDATE_TO_JOBS', 'JOB_TO_CANDIDATES'].includes(direction)
    )
      throw new BadRequestException('任务类型无效');
    const filter = {
      and: [
        { name: { ilike: '[recruiting-v2]%' } },
        ...(direction === 'CANDIDATE_TO_JOBS'
          ? [{ kind: { eq: 'CANDIDATE' } }]
          : direction === 'JOB_TO_CANDIDATES'
            ? [{ kind: { eq: 'JOB' } }]
            : []),
      ],
    };
    let page = this.orm
      ? {
          records: [] as RecruitingRecord[],
          count: 0,
          hasNextPage: false,
          integrityRejected: 0,
        }
      : await this.records.list(context, 'recruitingIntake', {
          filter,
          offset,
          limit: 50,
          orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
        });
    if (this.orm) {
      const group = `CASE WHEN "intake"."kind" = 'CANDIDATE' THEN COALESCE(NULLIF("intake"."targetId"::text, ''), "intake"."id"::text) ELSE "intake"."id"::text END`;
      const latest = await this.orm.executeInWorkspaceContext(async () => {
        const query = this.orm!.getRepositoryWithContextPermissions(
          'recruitingIntake',
        )
          .createQueryBuilder('intake')
          .select('intake.id', 'id')
          .addSelect('intake.createdAt', 'createdAt')
          .where('"intake"."name" ILIKE :prefix', {
            prefix: '[recruiting-v2]%',
          });
        if (direction)
          query.andWhere('"intake"."kind" = :kind', {
            kind: direction === 'CANDIDATE_TO_JOBS' ? 'CANDIDATE' : 'JOB',
          });
        return query
          .distinctOn([group])
          .orderBy(group, 'ASC')
          .addOrderBy('intake.createdAt', 'DESC')
          .addOrderBy('intake.id', 'DESC')
          .getRawMany<{ id: string; createdAt: string }>();
      }, context);
      latest.sort(
        (a, b) =>
          Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
          b.id.localeCompare(a.id),
      );
      const ids = latest.slice(offset, offset + 50).map((row) => row.id);
      page = ids.length
        ? await this.records.list(context, 'recruitingIntake', {
            filter: { id: { in: ids } },
            limit: 50,
            orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
          })
        : { ...page, records: [] };
      page = {
        ...page,
        count: latest.length,
        hasNextPage: offset + 50 < latest.length,
      };
    }
    const candidateIds = (page.records as RecruitingRecord[])
      .filter(
        (record) =>
          record.kind === 'CANDIDATE' && typeof record.targetId === 'string',
      )
      .map((record) => String(record.targetId));
    const latestMatches = new Map<string, string>();
    if (this.orm && candidateIds.length) {
      const matches = await this.orm.executeInWorkspaceContext(
        async () =>
          this.orm!.getRepositoryWithContextPermissions('recruitingMatchRun')
            .createQueryBuilder('run')
            .select('run.id', 'id')
            .addSelect('run.subjectId', 'subjectId')
            .where('"run"."direction" = :direction', {
              direction: 'CANDIDATE_TO_JOBS',
            })
            .andWhere('"run"."subjectId" IN (:...candidateIds)', {
              candidateIds,
            })
            .distinctOn(['run.subjectId'])
            .orderBy('run.subjectId', 'ASC')
            .addOrderBy('run.createdAt', 'DESC')
            .addOrderBy('run.id', 'DESC')
            .getRawMany<{ id: string; subjectId: string }>(),
        context,
      );
      for (const match of matches) latestMatches.set(match.subjectId, match.id);
    }
    const rows = [];
    for (const record of page.records as RecruitingRecord[]) {
      const intake = this.intakes.summary(record);
      const currentMatch = latestMatches.get(String(record.targetId));
      const ids = currentMatch
        ? [currentMatch]
        : [
            ...new Set([
              ...(intake.matchingRunIds ?? []),
              ...(intake.items ?? []).flatMap((item) =>
                item.matchingRunId ? [item.matchingRunId] : [],
              ),
            ]),
          ];
      let stage = intake.stage;
      let retryPath = `resume-intakes/${intake.intakeId}/retry`;
      const progress = { processed: 0, total: 0 };
      const matches = [];
      let missing = false;
      for (const id of ids) {
        try {
          const match = await this.matching.summary(context, id);
          matches.push(match);
          progress.processed += match.counts.processed;
          progress.total += match.counts.total;
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
          missing = true;
        }
      }
      if (intake.state === 'COMPLETED' && matches.length) {
        retryPath = `match-runs/${matches[0].runId}/retry`;
        const failed = matches.find((match) =>
          ['FAILED', 'PARTIAL'].includes(String(match.status)),
        );
        const stale = matches.find(
          (match) =>
            match.status === 'SUPERSEDED' ||
            (!match.complete &&
              ['COMPLETED', 'NO_RESULTS'].includes(String(match.status))),
        );
        if (failed) {
          stage = 'MATCH_FAILED';
          retryPath = `match-runs/${failed.runId}/retry`;
        } else if (stale) {
          stage = 'MATCH_STALE';
          retryPath = `match-runs/${stale.runId}/retry`;
        } else if (matches.every((match) => match.complete))
          stage = matches.every((match) => match.status === 'NO_RESULTS')
            ? 'NO_RESULTS'
            : 'COMPLETED';
        else stage = 'MATCHING';
      } else if (
        intake.state === 'COMPLETED' &&
        intake.matchingStatus === 'FAILED_TO_QUEUE'
      )
        stage = 'MATCH_FAILED';
      if (intake.state === 'COMPLETED' && !matches.length && !missing) {
        if (intake.matchingStatus === 'DISABLED') stage = 'MATCH_DISABLED';
        else if (intake.matchingStatus === 'QUEUED') stage = 'MATCHING';
      }
      if (missing) stage = 'IDENTITY_REVIEW';
      const state = ['COMPLETED', 'NO_RESULTS', 'MATCH_DISABLED'].includes(
        stage,
      )
        ? 'COMPLETED'
        : ['FAILED', 'MATCH_FAILED'].includes(stage)
          ? 'FAILED'
          : ['MATCH_STALE', 'IDENTITY_REVIEW', 'MATERIAL_REVIEW'].includes(
                stage,
              )
            ? 'NEEDS_REVIEW'
            : 'PROCESSING';
      rows.push({
        ...intake,
        matchingRunIds: ids,
        intakeState: intake.state,
        state,
        stage,
        retryPath,
        progress,
      });
    }
    return { ...page, records: rows };
  }
}
