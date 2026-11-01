/** Appends material references with native optimistic concurrency while replacing only generated career facts. */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isPlainObject } from 'twenty-shared/utils';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { type RecruitingRecord } from './recruiting-records.service';

@Injectable()
/** Retains original attachment references even when another intake, portal or native editor updates the same person. */
export class RecruitingCandidateRecordsService {
  constructor(private readonly orm: WorkspaceOrmManager) {}

  /** Re-reads and merges after each native version conflict, never holding a database lock during parsing or inference. */
  async replaceProfile(
    context: WorkspaceAuthContext,
    id: string,
    recruitingProfile: Record<string, unknown>,
    files: { fileId: string; label: string }[],
  ) {
    return this.orm.executeInWorkspaceContext(async () => {
      const repository = this.orm.getRepositoryWithContextPermissions('person');
      for (let attempt = 0; attempt < 5; attempt++) {
        const result = await repository
          .createQueryBuilder('person')
          .select(['id', 'updatedAt', 'contactRoles', 'candidateResumes'])
          .where({ id })
          .getRawAndEntities<RecruitingRecord>();
        const candidate = result.entities[0];
        const version = result.raw[0]?.person_updatedAt;
        if (!candidate || typeof version !== 'string')
          throw new NotFoundException('候选人不存在或当前无权访问');
        if (
          !Array.isArray(candidate.contactRoles) ||
          !candidate.contactRoles.includes('CANDIDATE')
        )
          throw new BadRequestException(
            '目标联系人已不属于候选人，请核对后重新提交',
          );
        const previous = Array.isArray(candidate.candidateResumes)
          ? candidate.candidateResumes
          : [];
        const resumes = previous
          .filter(
            (old) =>
              !files.some(
                (file) => isPlainObject(old) && old.fileId === file.fileId,
              ),
          )
          .map((old) => {
            if (
              !isPlainObject(old) ||
              typeof old.fileId !== 'string' ||
              typeof old.label !== 'string'
            )
              throw new BadRequestException(
                '既有简历附件引用需要核对，系统未覆盖原有附件',
              );
            return { fileId: old.fileId, label: old.label };
          });
        const query = repository
          .createQueryBuilder('person')
          .where({ id })
          .andWhere(
            '"person"."updatedAt" = CAST(:expectedVersion AS timestamptz)',
            { expectedVersion: version },
          );
        const updated = await repository.runMutation({
          selectQueryBuilder: query,
          rowLevelPermissionsApplied: false,
          kind: 'update',
          columnsToReturn: ['id'],
          data: { recruitingProfile, candidateResumes: [...resumes, ...files] },
        });
        if (updated.length === 1) return;
      }
      throw new ConflictException(
        '候选人资料正在被修改，原件已保留，请稍后重试',
      );
    }, context);
  }
}
