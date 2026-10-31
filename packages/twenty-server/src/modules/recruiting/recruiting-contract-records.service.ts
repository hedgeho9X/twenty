/** Uses the official ORM's raw/entity read to retain PostgreSQL revision precision without bypassing role or row permissions. */
import { Injectable, NotFoundException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { type RecruitingRecord } from './recruiting-records.service';

const fields = [
  'id',
  'name',
  'updatedAt',
  'accountOwnerId',
  'contractStatus',
  'contractDetails',
  'contractDraftId',
  'contractPreparation',
];
@Injectable()
/** Keeps version guards in the same permission-aware native UPDATE predicate as the target and current owner. */
export class RecruitingContractRecordsService {
  constructor(private readonly orm: WorkspaceOrmManager) {}
  /** Reads data and its microsecond timestamp in one query; JavaScript Date must not round the revision guard. */
  async one(context: WorkspaceAuthContext, id: string) {
    return this.orm.executeInWorkspaceContext(async () => {
      const repository =
        this.orm.getRepositoryWithContextPermissions('company');
      const result = await repository
        .createQueryBuilder('company')
        .select(fields)
        .where({ id })
        .getRawAndEntities<RecruitingRecord>();
      const company = result.entities[0];
      const version = result.raw[0]?.company_updatedAt;
      if (!company || typeof version !== 'string')
        throw new NotFoundException('合同记录不存在或当前无权访问');
      return { company, version };
    }, context);
  }
  /** Native mutation retains validation, row/field access, event emission and atomic PostgreSQL timestamp equality. */
  async update(
    context: WorkspaceAuthContext,
    id: string,
    version: string,
    data: Record<string, unknown>,
    ownerId?: string,
  ) {
    return this.orm.executeInWorkspaceContext(async () => {
      const repository =
        this.orm.getRepositoryWithContextPermissions('company');
      const query = repository
        .createQueryBuilder('company')
        .where({ id })
        .andWhere(
          '"company"."updatedAt" = CAST(:expectedVersion AS timestamptz)',
          { expectedVersion: version },
        );
      if (ownerId)
        query.andWhere('"company"."accountOwnerId" = :ownerId', { ownerId });
      const records = await repository.runMutation({
        selectQueryBuilder: query,
        rowLevelPermissionsApplied: false,
        kind: 'update',
        columnsToReturn: ['id'],
        data,
      });
      return records.length === 1;
    }, context);
  }
}
