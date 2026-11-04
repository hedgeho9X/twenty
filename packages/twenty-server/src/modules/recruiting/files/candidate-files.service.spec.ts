/** Verifies candidate membership and native permissions before any original-byte read. */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { FileFolder } from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type RecruitingRecord } from '../records/records.service';
import { RecruitingCandidateFilesService } from './candidate-files.service';

const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
const setup = () => {
  const bytes = Buffer.from('%PDF-1.7\noriginal');
  const records = {
    list: jest.fn(async () => ({
      records: [
        {
          id: 'candidate',
          contactRoles: ['CANDIDATE'],
          candidateResumes: [
            { fileId: 'resume', label: '简历.pdf', url: 'private-url' },
            { fileId: 'portfolio', label: '作品集.zip' },
            { fileId: 'resume', label: 'duplicate.pdf' },
          ],
        },
      ] as RecruitingRecord[],
    })),
  };
  const files = {
    getFileStreamById: jest.fn(
      async (): Promise<{ stream: Readable; mimeType: string } | null> => ({
        stream: Readable.from(bytes),
        mimeType: 'application/pdf',
      }),
    ),
  };
  const service = new RecruitingCandidateFilesService(
    records as never,
    files as never,
  );
  return { service, records, files, bytes };
};

it('propagates native permission denial without reading file bytes', async () => {
  const { service, records, files } = setup();
  records.list.mockRejectedValue(new ForbiddenException('denied'));
  await expect(service.list(context, 'candidate')).rejects.toThrow(
    ForbiddenException,
  );
  await expect(
    service.download(context, 'candidate', 'resume'),
  ).rejects.toThrow(ForbiddenException);
  expect(files.getFileStreamById).not.toHaveBeenCalled();
});

it('returns 404 for a file outside visible candidateResumes before reading bytes', async () => {
  const { service, records, files } = setup();
  await expect(
    service.download(context, 'candidate', 'another-candidates-file'),
  ).rejects.toThrow(NotFoundException);
  // A native field permission hiding the references must not grant a download.
  records.list.mockResolvedValue({
    records: [{ id: 'candidate', contactRoles: ['CANDIDATE'] }],
  });
  expect(await service.list(context, 'candidate')).toEqual({
    candidateId: 'candidate',
    files: [],
  });
  await expect(
    service.download(context, 'candidate', 'resume'),
  ).rejects.toThrow(NotFoundException);
  expect(files.getFileStreamById).not.toHaveBeenCalled();
});

it('lists only references and streams the original in the authorized workspace/folder', async () => {
  const { service, records, files, bytes } = setup();
  expect(await service.list(context, 'candidate')).toEqual({
    candidateId: 'candidate',
    files: [
      { fileId: 'resume', label: '简历.pdf' },
      { fileId: 'portfolio', label: '作品集.zip' },
    ],
  });
  expect(records.list).toHaveBeenCalledWith(context, 'person', {
    filter: {
      id: { eq: 'candidate' },
      contactRoles: { containsAny: ['CANDIDATE'] },
    },
    limit: 1,
    select: ['id', 'contactRoles', 'candidateResumes'],
  });
  const result = await service.download(context, 'candidate', 'resume');
  expect(result.label).toBe('简历.pdf');
  const chunks: Buffer[] = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(bytes);
  expect(files.getFileStreamById).toHaveBeenCalledWith({
    workspaceId: 'workspace',
    fileId: 'resume',
    allowedFileFolders: [FileFolder.FilesField],
  });
});

it('returns 404 for missing candidates, non-candidates and missing original files', async () => {
  const { service, records, files } = setup();
  files.getFileStreamById.mockResolvedValue(null);
  await expect(
    service.download(context, 'candidate', 'resume'),
  ).rejects.toThrow(NotFoundException);
  records.list.mockResolvedValue({ records: [] });
  await expect(service.list(context, 'candidate')).rejects.toThrow(
    NotFoundException,
  );
  records.list.mockResolvedValue({
    records: [{ id: 'candidate', contactRoles: ['CLIENT'] }],
  });
  await expect(service.list(context, 'candidate')).rejects.toThrow(
    NotFoundException,
  );
  expect(files.getFileStreamById).toHaveBeenCalledTimes(1);
});
