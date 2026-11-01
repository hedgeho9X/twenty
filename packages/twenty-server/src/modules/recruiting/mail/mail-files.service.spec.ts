/** Exercises native ownership partitions and interrupted copy checkpoints without storage, network or model calls. */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type FilesFieldService } from 'src/engine/core-modules/file/files-field/services/files-field.service';
import { type RecruitingRecordsService } from '../records/records.service';
import { type RecruitingActorService } from '../auth/actor.service';
import { type RecruitingParserService } from '../files/parser.service';
import { type RecruitingUploadService } from '../files/upload.service';
import { type MailPayload } from './mail.service';
import { RecruitingMailFilesService } from './mail-files.service';
import {
  RECRUITING_MAIL_FILE_LAYOUT,
  MAX_RECRUITING_MAIL_ARTIFACTS,
} from './domain/mail-file-layout';

const context = {
  type: 'user',
  workspace: { id: 'workspace' },
  userWorkspaceId: 'owner',
} as WorkspaceAuthContext;
type FileState = {
  id: string;
  path: string;
  status: string;
  settings: { isTemporaryFile: boolean };
};

/** A native-like file repository refuses sharing permanent IDs and checks target field partitions on every binding. */
const setup = (count = 2) => {
  let sequence = 0;
  const files = new Map<string, FileState>();
  const fields = [
    ...RECRUITING_MAIL_FILE_LAYOUT.fields.map((name) => ({
      id: `field-${name}`,
      universalIdentifier: `uid-${name}`,
      objectMetadataId: 'archive',
      name,
    })),
    {
      id: 'field-intake',
      universalIdentifier: 'uid-intake',
      objectMetadataId: 'intake',
      name: 'files',
    },
  ];
  const artifacts = Array.from({ length: count }, (_, index) => {
    const id = `legacy-${index}`;
    files.set(id, {
      id,
      path: 'files-field/uid-intake/' + id,
      status: 'UPLOADED',
      settings: { isTemporaryFile: false },
    });
    return {
      key: `key-${index}`,
      fileId: id,
      label: `${index}.txt`,
      kind: 'attachment' as const,
      mimeType: 'text/plain',
      inline: false,
      suggestedResume: true,
      sha256: `sha-${index}`,
    };
  });
  let record: Record<string, unknown> & { id: string } = {
    id: 'mail',
    status: 'NEEDS_SELECTION',
    sourceHash: 'raw-sha',
    payload: {
      version: 1,
      actor: { workspaceId: 'workspace', userWorkspaceId: 'owner' },
      sources: [],
      artifacts,
      rawFile: artifacts[0]
        ? { fileId: artifacts[0].fileId, label: artifacts[0].label }
        : undefined,
      autoSubmit: false,
      intakeIds: ['legacy-intake'],
    } satisfies MailPayload,
  };
  const records = {
    one: jest.fn(async () => structuredClone(record)),
    update: jest.fn(
      async (
        _context: WorkspaceAuthContext,
        _object: string,
        _id: string,
        patch: Record<string, unknown>,
      ) => {
        for (const field of fields.filter(
          (value) => value.objectMetadataId === 'archive',
        )) {
          if (!Array.isArray(patch[field.name])) continue;
          const existing = (record[field.name] ?? []) as { fileId: string }[];
          for (const ref of patch[field.name] as { fileId: string }[]) {
            const file = files.get(ref.fileId)!;
            if (!file.path.includes(field.universalIdentifier))
              throw new BadRequestException('Wrong native field');
            if (
              !existing.some((old) => old.fileId === ref.fileId) &&
              !file.settings.isTemporaryFile
            )
              throw new BadRequestException(
                'Permanent file cannot have a second owner',
              );
            file.settings.isTemporaryFile = false;
          }
        }
        record = { ...record, ...structuredClone(patch) };
        return structuredClone(record);
      },
    ),
  };
  const actors = {
    capture: () => ({ workspaceId: 'workspace', userWorkspaceId: 'owner' }),
    resolve: jest.fn(async () => context),
  };
  const cache = {
    getOrRecompute: async () => ({
      flatObjectMetadataMaps: {
        byUniversalIdentifier: {
          archive: { id: 'archive', nameSingular: 'recruitingMailArchive' },
          intake: { id: 'intake', nameSingular: 'recruitingIntake' },
        },
      },
      flatFieldMetadataMaps: {
        byUniversalIdentifier: Object.fromEntries(
          fields.map((field) => [field.id, field]),
        ),
      },
    }),
  };
  const native = {
    copyFileIntoFilesField: jest.fn(
      async (input: {
        fileId: string;
        fieldMetadataId: string;
        workspaceId: string;
      }) => {
        const source = files.get(input.fileId);
        if (!source) throw new Error('Missing source');
        const field = fields.find(
          (value) => value.id === input.fieldMetadataId,
        )!;
        const copy = {
          ...structuredClone(source),
          id: `copy-${++sequence}`,
          path: `files-field/${field.universalIdentifier}/copy-${sequence}`,
          settings: { isTemporaryFile: true },
        };
        files.set(copy.id, copy);
        return copy;
      },
    ),
  };
  const parser = {
    file: jest.fn(async (_actor, id: string) => files.get(id)!),
  };
  const uploads = {
    assertUploadPermission: jest.fn(async () => undefined),
    fromMailArchive: jest.fn(
      async (
        _context: WorkspaceAuthContext,
        _id: string,
        keys: string[],
        binding: string,
      ) => {
        const payload = record.payload as MailPayload;
        return keys.map((key) => ({
          ...payload.intakeCopies![binding].find((file) => file.key === key)!,
          uploadReceipt: 'proof',
        }));
      },
    ),
    bufferForMailArchive: jest.fn(),
  };
  const service = new RecruitingMailFilesService(
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
    cache as unknown as WorkspaceCacheService,
    native as unknown as FilesFieldService,
    parser as unknown as RecruitingParserService,
    uploads as unknown as RecruitingUploadService,
  );
  return {
    service,
    records,
    native,
    files,
    record: () => record,
    uploads,
    actors,
  };
};

it('refuses expired authority before allocating another canonical artifact', async () => {
  const { service, actors, records, uploads } = setup();
  actors.resolve.mockRejectedValue(new ForbiddenException('expired authority'));
  await expect(
    service.upload(context, 'mail', {
      buffer: Buffer.from('artifact'),
      originalname: 'resume.txt',
    }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(records.one).not.toHaveBeenCalled();
  expect(uploads.bufferForMailArchive).not.toHaveBeenCalled();
});

it('migrates canonical ownership without stealing permanent legacy intake files and keeps source keys and hashes', async () => {
  const { service, native, files } = setup();
  const migrated = await service.ensureCanonicalOwnership(context, 'mail');
  const payload = migrated.payload as MailPayload;
  expect(payload.intakeIds).toEqual(['legacy-intake']);
  expect(payload.artifacts.map((file) => file.key)).toEqual(['key-0', 'key-1']);
  expect(payload.artifacts.map((file) => file.sha256)).toEqual([
    'sha-0',
    'sha-1',
  ]);
  expect(payload.rawFile?.fileId).toBe(payload.artifacts[0].fileId);
  expect(
    payload.artifacts.every((file) => file.fileId.startsWith('copy-')),
  ).toBe(true);
  expect(files.get('legacy-0')?.settings.isTemporaryFile).toBe(false);
  expect(native.copyFileIntoFilesField).toHaveBeenCalledTimes(2);
  expect(
    native.copyFileIntoFilesField.mock.calls.every(
      (call) => call[0].fieldMetadataId === 'field-sourceFiles',
    ),
  ).toBe(true);
  await service.ensureCanonicalOwnership(context, 'mail');
  expect(native.copyFileIntoFilesField).toHaveBeenCalledTimes(2);
});

it('resumes a copied canonical file after its native binding checkpoint fails', async () => {
  const { service, native, records } = setup(1);
  const update = records.update.getMockImplementation()!;
  records.update
    .mockImplementationOnce(async (...args) => update(...args))
    .mockImplementationOnce(async () => {
      throw new Error('binding interrupted');
    });
  await expect(
    service.ensureCanonicalOwnership(context, 'mail'),
  ).rejects.toThrow('binding interrupted');
  await service.ensureCanonicalOwnership(context, 'mail');
  expect(native.copyFileIntoFilesField).toHaveBeenCalledTimes(1);
});

it('uses independent intake copies per business binding and reuses partial and completed copy checkpoints', async () => {
  const { service, native, files } = setup();
  await service.ensureCanonicalOwnership(context, 'mail');
  const copy = native.copyFileIntoFilesField.getMockImplementation()!;
  let intakeCalls = 0;
  native.copyFileIntoFilesField.mockImplementation(async (input) => {
    if (input.fieldMetadataId === 'field-intake' && ++intakeCalls === 2)
      throw new Error('copy interrupted');
    return copy(input);
  });
  await expect(
    service.intakeFiles(context, 'mail', 'first-note', ['key-0', 'key-1']),
  ).rejects.toThrow('copy interrupted');
  const first = await service.intakeFiles(context, 'mail', 'first-note', [
    'key-0',
    'key-1',
  ]);
  for (const file of first)
    files.get(file.fileId)!.settings.isTemporaryFile = false;
  const repeated = await service.intakeFiles(context, 'mail', 'first-note', [
    'key-0',
    'key-1',
  ]);
  expect(repeated).toEqual(first);
  const second = await service.intakeFiles(context, 'mail', 'second-note', [
    'key-0',
    'key-1',
  ]);
  expect(
    second.every((file) => !first.some((old) => old.fileId === file.fileId)),
  ).toBe(true);
  expect(
    second.every((file) => files.get(file.fileId)?.settings.isTemporaryFile),
  ).toBe(true);
  expect(
    native.copyFileIntoFilesField.mock.calls
      .slice(2)
      .every((call) => call[0].fieldMetadataId === 'field-intake'),
  ).toBe(true);
});

it('spans native slots without exceeding sixty values and covers every supported MIME artifact', async () => {
  const { service, record, native } = setup(MAX_RECRUITING_MAIL_ARTIFACTS);
  await service.ensureCanonicalOwnership(context, 'mail');
  const saved = record();
  const slots = RECRUITING_MAIL_FILE_LAYOUT.fields.map(
    (name) => saved[name] as { fileId: string }[] | undefined,
  );
  expect(slots.reduce((sum, slot) => sum + (slot?.length ?? 0), 0)).toBe(
    MAX_RECRUITING_MAIL_ARTIFACTS,
  );
  expect(slots.every((slot) => (slot?.length ?? 0) <= 60)).toBe(true);
  expect(
    native.copyFileIntoFilesField.mock.calls[
      native.copyFileIntoFilesField.mock.calls.length - 1
    ]?.[0].fieldMetadataId,
  ).toBe('field-sourceFiles9');
});
