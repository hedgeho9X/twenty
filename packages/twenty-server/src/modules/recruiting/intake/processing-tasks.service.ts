/** Projects material ingestion and its matching children as one operator-visible workflow. */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    const page = await this.records.list(context, 'recruitingIntake', {
      filter,
      offset,
      limit: 50,
      orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
    });
    const rows = [];
    for (const record of page.records as RecruitingRecord[]) {
      const intake = this.intakes.summary(record);
      const ids = [
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
          const match = await this.matching.one(context, id);
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
            !match.complete &&
            ['COMPLETED', 'NO_RESULTS'].includes(String(match.status)),
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
