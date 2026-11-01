/** Verifies permission-before-allocation and caller-bound completion without transmitting files. */
import { ForbiddenException } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FileUploadService } from 'src/engine/core-modules/file/file-upload/services/file-upload.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import {
  type RecruitingActorService,
  type RecruitingActor,
} from './recruiting-actor.service';
import { RecruitingUploadService } from './recruiting-upload.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import { RECRUITING_MAIL_FILE_LAYOUT } from './domain/mail-file-layout';

const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;

/** Mirrors native interfaces with isolated values and no actual credentials. */
const setup = () => {
  const native = {
    receiveFileStream: jest.fn(async () => undefined),
    createFileUpload: jest.fn(async () => ({
      fileId: 'new-file',
      uploadUrl: 'https://storage.example.test/upload',
      contentType: 'application/octet-stream',
    })),
    completeFileUpload: jest.fn(async () => ({
      id: 'new-file',
      url: 'private-download-url',
    })),
  };
  const actors = {
    capture: jest.fn((): RecruitingActor => ({
      workspaceId: 'workspace',
      userWorkspaceId: 'caller',
    })),
  };
  const permissions = {
    userHasWorkspaceSettingPermission: jest.fn(
      async (_input: { applicationId?: string }) => true,
    ),
  };
  const cache = {
    getOrRecompute: async () => ({
      flatObjectMetadataMaps: {
        byUniversalIdentifier: {
          intake: { id: 'intake', nameSingular: 'recruitingIntake' },
          archive: { id: 'archive', nameSingular: 'recruitingMailArchive' },
        },
      },
      flatFieldMetadataMaps: {
        byUniversalIdentifier: {
          files: { id: 'field', objectMetadataId: 'intake', name: 'files' },
          ...Object.fromEntries(
            RECRUITING_MAIL_FILE_LAYOUT.fields.map((name) => [
              name,
              { id: `field-${name}`, objectMetadataId: 'archive', name },
            ]),
          ),
        },
      },
    }),
  };
  const records = { one: jest.fn() };
  const service = new RecruitingUploadService(
    native as unknown as FileUploadService,
    actors as unknown as RecruitingActorService,
    permissions as unknown as PermissionsService,
    cache as unknown as WorkspaceCacheService,
    { get: () => 'test-only-secret' } as unknown as TwentyConfigService,
    records as unknown as RecruitingRecordsService,
  );
  return { service, native, actors, permissions, records };
};

describe('recruiting native upload boundary', () => {
  it('uploads canonical bytes only to a fixed archive slot and refuses arbitrary target fields', async () => {
    const { service, native } = setup();
    await service.bufferForMailArchive(
      context,
      { buffer: Buffer.from('raw'), originalname: 'original.eml' },
      'sourceFiles2',
    );
    expect(native.createFileUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldMetadataId: 'field-sourceFiles2',
        fileFolder: 'files-field',
      }),
    );
    expect(native.receiveFileStream).toHaveBeenCalledTimes(1);
    await expect(
      service.bufferForMailArchive(
        context,
        { buffer: Buffer.from('raw'), originalname: 'original.eml' },
        'otherField',
      ),
    ).rejects.toThrow('字段无效');
    expect(native.createFileUpload).toHaveBeenCalledTimes(1);
  });

  it('issues intake submission proofs only for checkpointed copies of the authorized parent archive', async () => {
    const { service, records } = setup();
    records.one.mockResolvedValue({
      payload: {
        artifacts: [{ key: 'owned', fileId: 'canonical', label: 'resume.pdf' }],
        intakeCopies: {
          binding: [
            { key: 'owned', fileId: 'intake-copy', label: 'resume.pdf' },
          ],
        },
      },
    });
    const refs = await service.fromMailArchive(
      context,
      'mail',
      ['owned'],
      'binding',
    );
    expect(refs[0].fileId).toBe('intake-copy');
    expect(() => service.authorize(context, refs[0])).not.toThrow();
    await expect(
      service.fromMailArchive(context, 'mail', ['owned'], 'fake-binding'),
    ).rejects.toThrow('不属于');
    await expect(
      service.fromMailArchive(context, 'mail', ['foreign'], 'binding'),
    ).rejects.toThrow('不属于');
  });
  it('rebinds only artifacts of a readable signed archive, never a supplied foreign file ID', async () => {
    const { service, records } = setup();
    records.one.mockResolvedValue({
      payload: {
        artifacts: [
          { key: 'owned', fileId: 'owned-file', label: 'resume.pdf' },
        ],
      },
    });
    const refs = await service.fromMailArchive(context, 'mail', ['owned']);
    expect(refs[0]).toMatchObject({
      fileId: 'owned-file',
      label: 'resume.pdf',
    });
    expect(() => service.authorize(context, refs[0])).not.toThrow();
    await expect(
      service.fromMailArchive(context, 'mail', ['foreign-file']),
    ).rejects.toThrow('不属于');
    records.one.mockRejectedValue(new ForbiddenException());
    await expect(
      service.fromMailArchive(context, 'mail', ['owned']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires upload permission before creating a pending file', async () => {
    const { service, permissions, native } = setup();
    permissions.userHasWorkspaceSettingPermission.mockResolvedValue(false);
    await expect(
      service.target(context, { filename: 'resume.pdf', size: 100 }),
    ).rejects.toThrow(ForbiddenException);
    expect(native.createFileUpload).not.toHaveBeenCalled();
  });

  it('completes only the claimed identity and does not return a download capability', async () => {
    const { service } = setup();
    const target = await service.target(context, {
      filename: 'resume.pdf',
      size: 100,
    });
    const file = await service.complete(context, {
      uploadReceipt: target.uploadReceipt,
    });
    expect(file.fileId).toBe('new-file');
    expect(file.label).toBe('resume.pdf');
    expect(JSON.stringify(file)).not.toContain('private-download-url');
    expect(() => service.authorize(context, file)).not.toThrow();
    expect(() =>
      service.authorize(context, { ...file, fileId: 'other-file' }),
    ).toThrow();
    expect(() =>
      service.authorize(context, { ...file, label: 'changed.docx' }),
    ).toThrow();
    expect(() =>
      service.authorize(context, { fileId: 'new-file', label: 'resume.pdf' }),
    ).toThrow();
  });

  it('prevents another caller from completing or submitting a known file ID', async () => {
    const { service, actors, native } = setup();
    const target = await service.target(context, {
      filename: 'resume.pdf',
      size: 100,
    });
    actors.capture.mockReturnValue({
      workspaceId: 'workspace',
      userWorkspaceId: 'other-caller',
    });
    await expect(
      service.complete(context, { uploadReceipt: target.uploadReceipt }),
    ).rejects.toThrow();
    expect(native.completeFileUpload).not.toHaveBeenCalled();
  });

  it('checks the delegated application in addition to the primary application', async () => {
    const { service, actors, permissions, native } = setup();
    actors.capture.mockReturnValue({
      workspaceId: 'workspace',
      userWorkspaceId: 'caller',
      applicationId: 'primary',
      viaApplicationId: 'delegated',
    });
    permissions.userHasWorkspaceSettingPermission.mockImplementation(
      async ({ applicationId }) => applicationId !== 'delegated',
    );
    await expect(
      service.target(context, { filename: 'resume.pdf', size: 100 }),
    ).rejects.toThrow(ForbiddenException);
    expect(native.createFileUpload).not.toHaveBeenCalled();
  });
});
