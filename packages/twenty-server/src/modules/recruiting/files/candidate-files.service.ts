/** Reads candidate originals only through visible native record references. */
import { Injectable, NotFoundException } from '@nestjs/common';
import { FileFolder } from 'twenty-shared/types';
import { isPlainObject } from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { FileService } from 'src/engine/core-modules/file/services/file.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from '../records/records.service';

@Injectable()
export class RecruitingCandidateFilesService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly files: FileService,
  ) {}

  /** Native selection retains row and field permissions; URLs are never returned. */
  async list(context: WorkspaceAuthContext, candidateId: string) {
    const page = await this.records.list(context, 'person', {
      filter: {
        id: { eq: candidateId },
        contactRoles: { containsAny: ['CANDIDATE'] },
      },
      limit: 1,
      select: ['id', 'contactRoles', 'candidateResumes'],
    });
    const candidate = page.records[0] as RecruitingRecord | undefined;
    if (
      !candidate ||
      !Array.isArray(candidate.contactRoles) ||
      !candidate.contactRoles.includes('CANDIDATE')
    )
      throw new NotFoundException('候选人不存在或当前无权访问');
    const references: unknown[] = Array.isArray(candidate.candidateResumes)
      ? candidate.candidateResumes
      : [];
    const files = references.flatMap((file) =>
      isPlainObject(file) &&
      typeof file.fileId === 'string' &&
      file.fileId.length > 0 &&
      typeof file.label === 'string'
        ? [{ fileId: file.fileId, label: file.label }]
        : [],
    );
    return {
      candidateId,
      files: files.filter(
        (file, index) =>
          files.findIndex((entry) => entry.fileId === file.fileId) === index,
      ),
    };
  }

  /** Rechecks membership before reading uploaded bytes in this workspace only. */
  async download(
    context: WorkspaceAuthContext,
    candidateId: string,
    fileId: string,
  ) {
    const { files } = await this.list(context, candidateId);
    const reference = files.find((file) => file.fileId === fileId);
    if (!reference) throw new NotFoundException('候选人没有可读取的这份材料');
    const file = await this.files.getFileStreamById({
      workspaceId: context.workspace.id,
      fileId,
      allowedFileFolders: [FileFolder.FilesField],
    });
    if (!file) throw new NotFoundException('候选人没有可读取的这份材料');
    return { label: reference.label, stream: file.stream };
  }
}
