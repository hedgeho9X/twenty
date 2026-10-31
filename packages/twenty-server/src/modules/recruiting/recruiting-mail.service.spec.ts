/** Verifies independent event/business dedupe and MIME recovery with synthetic email bytes only. */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { type RecruitingActorService } from './recruiting-actor.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import { type RecruitingUploadService } from './recruiting-upload.service';
import { type RecruitingParserService } from './recruiting-parser.service';
import { type RecruitingIntakeService } from './recruiting-intake.service';
import {
  RecruitingMailService,
  type RecruitingMailSource,
} from './recruiting-mail.service';

const context = {
  type: 'user',
  workspace: { id: 'workspace' },
  userWorkspaceId: 'member',
} as WorkspaceAuthContext;
const actor = { workspaceId: 'workspace', userWorkspaceId: 'member' };
const source: RecruitingMailSource = {
  transport: 'IMAP',
  connectedAccountId: 'account',
  folder: 'INBOX',
  uidValidity: '99',
  uid: 123,
  flags: [],
};
const raw = Buffer.from(
  [
    'Message-ID: <test@example.test>',
    'Subject: Complete test',
    'Content-Type: multipart/mixed; boundary="parts"',
    '',
    '--parts',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Full introduction and old quoted history.',
    '--parts',
    'Content-Type: text/plain',
    'Content-Disposition: attachment; filename="resume.txt"',
    '',
    'Resume with TypeScript and PostgreSQL.',
    '--parts--',
    '',
  ].join('\r\n'),
);

/** Native-like storage preserves all checkpoints while allowing a single asset write to fail. */
const setup = () => {
  const rows = new Map<string, Record<string, unknown>>();
  const records = {
    one: jest.fn(async (_context, object: string, id: string) => {
      const value = rows.get(`${object}:${id}`);
      if (!value) throw new NotFoundException();
      return value;
    }),
    create: jest.fn(
      async (
        _context,
        object: string,
        data: Record<string, unknown> & { id: string },
      ) => {
        rows.set(`${object}:${data.id}`, structuredClone(data));
        return rows.get(`${object}:${data.id}`)!;
      },
    ),
    update: jest.fn(
      async (
        _context,
        object: string,
        id: string,
        patch: Record<string, unknown>,
      ) => {
        const value = {
          ...rows.get(`${object}:${id}`),
          ...structuredClone(patch),
        };
        rows.set(`${object}:${id}`, value);
        return value;
      },
    ),
  };
  const actors = {
    capture: () => actor,
    resolve: jest.fn(async () => context),
  };
  const uploads = {
    buffer: jest.fn(async (_context, file: { originalname: string }) => ({
      fileId: `file-${file.originalname}`,
      label: file.originalname,
    })),
    fromMailArchive: jest.fn(async (_context, id: string, keys: string[]) => {
      const payload = rows.get(`recruitingMailArchive:${id}`)!.payload as {
        artifacts: { key: string; fileId: string; label: string }[];
      };
      return keys.map((key) => {
        const file = payload.artifacts.find((entry) => entry.key === key)!;
        return {
          fileId: file.fileId,
          label: file.label,
          uploadReceipt: 'scoped-proof',
        };
      });
    }),
  };
  const parser = { original: jest.fn(async () => raw) };
  const intakes = {
    submit: jest.fn(
      async (_context: WorkspaceAuthContext, _request: unknown) => ({
        intakeId: 'stable-intake',
      }),
    ),
  };
  const locks = {
    tryWithLock: async (_key: string, callback: () => Promise<unknown>) => ({
      acquired: true,
      value: await callback(),
    }),
  };
  const queue = { add: jest.fn() };
  const service = new RecruitingMailService(
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
    uploads as unknown as RecruitingUploadService,
    parser as unknown as RecruitingParserService,
    intakes as unknown as RecruitingIntakeService,
    locks as unknown as PostgresAdvisoryLockService,
    queue as unknown as MessageQueueService,
  );
  return { service, records, rows, uploads, parser, intakes, actors, locks };
};

it('returns the accepted receipt when an identical upload arrives during MIME processing', async () => {
  const { service, records, locks, uploads } = setup();
  const first = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  await records.update(context, 'recruitingMailArchive', first.archiveId, {
    status: 'EXPANDING',
  });
  const lock = jest
    .spyOn(locks, 'tryWithLock')
    .mockResolvedValue({ acquired: false } as never);
  expect(
    (await service.receive(context, raw, { transport: 'EML_UPLOAD' }))
      .archiveId,
  ).toBe(first.archiveId);
  expect(lock).not.toHaveBeenCalled();
  expect(uploads.buffer).toHaveBeenCalledTimes(1);
});

it('deduplicates event delivery and raw bytes independently, including flag changes and copied folders', async () => {
  const { service, uploads } = setup();
  const first = await service.receive(context, raw, source);
  const repeated = await service.receive(context, raw, {
    ...source,
    flags: ['\\Seen'],
  });
  expect(repeated.archiveId).toBe(first.archiveId);
  expect(uploads.buffer).toHaveBeenCalledTimes(1);
  expect(
    (await service.one(context, first.archiveId)).detail.sources,
  ).toHaveLength(1);
  await service.receive(context, raw, { ...source, folder: 'Applications' });
  expect(
    (await service.one(context, first.archiveId)).detail.sources,
  ).toHaveLength(2);
  await expect(
    service.receive(
      context,
      Buffer.from(raw.toString().replace('Complete test', 'Changed content')),
      source,
    ),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(uploads.buffer).toHaveBeenCalledTimes(1);
});

it('retains the original EML and completed assets when expansion fails, then resumes missing uploads', async () => {
  const { service, uploads } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  const original = uploads.buffer.getMockImplementation()!;
  uploads.buffer.mockImplementation(async (...args) => {
    if (args[1].originalname === 'mail-body.txt') {
      uploads.buffer.mockImplementation(original);
      throw new Error('temporary storage failure');
    }
    return original(...args);
  });
  await service.process({ archiveId: archive.archiveId, actor });
  expect((await service.one(context, archive.archiveId)).status).toBe('FAILED');
  await service.retry(context, archive.archiveId);
  await service.process({ archiveId: archive.archiveId, actor });
  const final = await service.one(context, archive.archiveId);
  expect(final.status).toBe('NEEDS_SELECTION');
  expect(final.detail.artifacts.map((file) => file.kind)).toEqual([
    'raw',
    'metadata',
    'text',
    'attachment',
  ]);
  expect(
    uploads.buffer.mock.calls.filter(
      (call) => call[1].originalname === 'original.eml',
    ),
  ).toHaveLength(1);
  expect(
    uploads.buffer.mock.calls.filter(
      (call) => call[1].originalname === 'mail-metadata.json',
    ),
  ).toHaveLength(1);
});

it('hands owned resume, complete body and source archives into the existing intake service', async () => {
  const { service, intakes, uploads } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  await service.process({ archiveId: archive.archiveId, actor });
  const detail = (await service.one(context, archive.archiveId)).detail;
  const selected = detail.artifacts.find((file) => file.kind === 'attachment')!;
  await service.submitIntake(context, archive.archiveId, {
    artifactKeys: [selected.key],
    note: 'Optional instruction',
  });
  const request = intakes.submit.mock.calls[0][1] as unknown as {
    source: string;
    mail: { archiveId: string };
    files: { label: string; role: string }[];
    idempotencyKey: string;
    note: string;
  };
  expect(request.source).toBe('email');
  expect(request.mail.archiveId).toBe(archive.archiveId);
  expect(request.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: 'resume.txt', role: 'primary' }),
      expect.objectContaining({ label: 'mail-body.txt', role: 'supplement' }),
      expect.objectContaining({ label: 'original.eml', role: 'archive' }),
    ]),
  );
  expect(request.note).toContain('Optional instruction');
  const previous = request.idempotencyKey;
  await service.submitIntake(context, archive.archiveId, {
    artifactKeys: [selected.key],
    note: 'Optional instruction',
  });
  expect(
    (intakes.submit.mock.calls[1][1] as unknown as { idempotencyKey: string })
      .idempotencyKey,
  ).toBe(previous);
  await expect(
    service.submitIntake(context, archive.archiveId, {
      artifactKeys: ['foreign-file'],
    }),
  ).rejects.toThrow('不属于');
  expect(uploads.fromMailArchive).toHaveBeenCalledTimes(2);
});
