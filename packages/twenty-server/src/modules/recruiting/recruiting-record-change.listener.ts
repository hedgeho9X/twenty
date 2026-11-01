/** Schedules incremental ranking from committed native record events under the original caller's current permissions. */
import { Injectable, Logger } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { RecruitingActorService } from './recruiting-actor.service';
import { RecruitingMatchingService } from './recruiting-matching.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from './recruiting-records.service';
import {
  buildCandidateMatchContext,
  buildCompanyMatchContext,
  buildJobMatchContext,
  contentVersion,
} from './domain/match-context';

/** Event snapshots stay in process; queues carry only source identities and actor references. */
type RecruitingRecordEvent =
  | ObjectRecordCreateEvent<RecruitingRecord>
  | ObjectRecordUpdateEvent<RecruitingRecord>;

@Injectable()
/** Does not grant system access to background writes and never lets model failure undo the originating record. */
export class RecruitingRecordChangeListener {
  private readonly logger = new Logger(RecruitingRecordChangeListener.name);
  constructor(
    private readonly actors: RecruitingActorService,
    private readonly records: RecruitingRecordsService,
    private readonly matching: RecruitingMatchingService,
  ) {}

  /** Filters non-recruiting updates before any database or queue work. */
  @OnDatabaseBatchEvent('*', DatabaseEventAction.CREATED)
  @OnDatabaseBatchEvent('*', DatabaseEventAction.UPDATED)
  async changed(payload: WorkspaceEventBatch<RecruitingRecordEvent>) {
    if (process.env.RECRUITING_AUTO_MATCH_ENABLED !== 'true' || !payload.actor)
      return;
    const object = payload.objectMetadata.nameSingular;
    if (!['person', 'recruitmentJob', 'company'].includes(object)) return;
    const events = payload.events.filter((event) => {
      const after = event.properties.after;
      const before =
        'before' in event.properties ? event.properties.before : undefined;
      if (!after || after.deletedAt) return false;
      if (object === 'person') {
        if (
          !Array.isArray(after.contactRoles) ||
          !after.contactRoles.includes('CANDIDATE')
        )
          return false;
        const current = buildCandidateMatchContext(after);
        return (
          !current.issue &&
          (!before ||
            current.version !== buildCandidateMatchContext(before).version)
        );
      }
      if (object === 'recruitmentJob') {
        const current = buildJobMatchContext(after);
        return (
          after.jobStatus === 'RECRUITING' &&
          !current.issue &&
          (!before ||
            before.companyId !== after.companyId ||
            current.version !== buildJobMatchContext(before).version)
        );
      }
      const companyVersion = (record: RecruitingRecord) =>
        contentVersion(buildCompanyMatchContext(record));
      return Boolean(
        before && companyVersion(before) !== companyVersion(after),
      );
    });
    if (!events.length) return;
    try {
      const context = await this.actors.resolve({
        workspaceId: payload.workspaceId,
        ...payload.actor,
      });
      for (const event of events) {
        const after = event.properties.after!;
        if (object === 'company') {
          const jobs = await this.records.all(context, 'recruitmentJob', {
            and: [
              { companyId: { eq: after.id } },
              { jobStatus: { eq: 'RECRUITING' } },
            ],
          });
          for (const job of jobs)
            await this.matching.submitForRecord(
              context,
              'recruitmentJob',
              job.id,
            );
        } else
          await this.matching.submitForRecord(
            context,
            object === 'person' ? 'person' : 'recruitmentJob',
            after.id,
          );
      }
    } catch {
      // Native data has already committed. A current authorized operator can resubmit matching independently.
      this.logger.warn(
        'Recruiting record saved; automatic matching could not be queued. Check actor access and queue health.',
      );
    }
  }
}
