/** Verifies independent event/business dedupe and MIME recovery with synthetic email bytes only. */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import {
  type RecruitingActor,
  type RecruitingActorService,
} from './recruiting-actor.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import { type RecruitingUploadService } from './recruiting-upload.service';
import { type RecruitingParserService } from './recruiting-parser.service';
import { type RecruitingIntakeService } from './recruiting-intake.service';
import { type RecruitingMailFilesService } from './recruiting-mail-files.service';
import { v5 } from 'uuid';
import { contentVersion } from './domain/match-context';
import {
  RecruitingMailService,
  type RecruitingMailJobData,
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
    capture: jest.fn(() => actor),
    resolve: jest.fn(async (_actor: RecruitingActor) => context),
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
    mailBinding: jest.fn(async () => ({
      intakeId: 'legacy-intake',
      state: 'COMPLETED',
    })),
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
  const queue = {
    add: jest.fn(),
    getInFlightJobs: jest.fn(
      async () => [] as { id: string; data: RecruitingMailJobData }[],
    ),
  };
  const mailFiles = {
    upload: jest.fn(
      async (
        caller: WorkspaceAuthContext,
        _id: string,
        file: { originalname: string },
      ) => uploads.buffer(caller, file),
    ),
    ensureCanonicalOwnership: jest.fn(
      async (caller: WorkspaceAuthContext, id: string) =>
        records.one(caller, 'recruitingMailArchive', id),
    ),
    intakeFiles: jest.fn(
      async (
        caller: WorkspaceAuthContext,
        id: string,
        _binding: string,
        keys: string[],
      ) => uploads.fromMailArchive(caller, id, keys),
    ),
  };
  const service = new RecruitingMailService(
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
    uploads as unknown as RecruitingUploadService,
    parser as unknown as RecruitingParserService,
    intakes as unknown as RecruitingIntakeService,
    locks as unknown as PostgresAdvisoryLockService,
    queue as unknown as MessageQueueService,
    mailFiles as unknown as RecruitingMailFilesService,
  );
  return {
    service,
    records,
    rows,
    uploads,
    parser,
    intakes,
    actors,
    locks,
    queue,
    mailFiles,
  };
};

it('releases the receiving archive lock before a newly queued worker can start', async () => {
  const { service, locks, queue } = setup();
  const held = new Set<string>();
  jest.spyOn(locks, 'tryWithLock').mockImplementation(async (key, callback) => {
    if (held.has(key)) return { acquired: false, value: undefined };
    held.add(key);
    try {
      return { acquired: true, value: await callback() };
    } finally {
      held.delete(key);
    }
  });
  queue.add.mockImplementation(async (_name, data: RecruitingMailJobData) => {
    expect(held.has(`recruiting-mail:${data.archiveId}`)).toBe(false);
    await service.process(data);
  });
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  expect((await service.one(context, archive.archiveId)).status).toBe(
    'NEEDS_SELECTION',
  );
});

it('rejects a busy archive for bounded queue backoff and processes it after the lock clears', async () => {
  const { service, locks, queue, uploads } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  const data = { archiveId: archive.archiveId, actor };
  const lock = jest
    .spyOn(locks, 'tryWithLock')
    .mockResolvedValueOnce({ acquired: false } as never);
  await expect(service.process(data)).rejects.toBeInstanceOf(ConflictException);
  expect((await service.one(context, archive.archiveId)).status).toBe('QUEUED');
  expect(uploads.buffer).toHaveBeenCalledTimes(1);
  expect(queue.add).toHaveBeenCalledWith(
    'RecruitingMailJob',
    data,
    expect.objectContaining({
      retryLimit: 6,
      backoff: { strategy: 'exponential', initialDelayMilliseconds: 5_000 },
    }),
  );
  lock.mockRestore();
  await service.process(data);
  expect((await service.one(context, archive.archiveId)).status).toBe(
    'NEEDS_SELECTION',
  );
});

it('recovers a queue acceptance failure without reuploading or losing the IMAP source binding', async () => {
  const { service, queue, uploads } = setup();
  queue.add.mockRejectedValueOnce(new Error('queue unavailable'));
  await expect(service.receive(context, raw, source)).rejects.toThrow(
    'queue unavailable',
  );
  queue.add.mockImplementation(async (_name, data: RecruitingMailJobData) => {
    await service.process(data);
  });
  const archive = await service.receive(context, raw, source);
  const final = await service.one(context, archive.archiveId);
  expect(final.status).toBe('READY');
  expect(final.intakeIds).toEqual(['stable-intake']);
  expect(final.detail.sources).toEqual([source]);
  expect(
    uploads.buffer.mock.calls.filter(
      (call) => call[1].originalname === 'original.eml',
    ),
  ).toHaveLength(1);
});

it('stops after attachment I/O when authority is revoked without checkpointing or writing FAILED under the old context', async () => {
  const { service, uploads, actors, records, intakes } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  const original = uploads.buffer.getMockImplementation()!;
  uploads.buffer.mockImplementation(async (...args) => {
    const file = await original(...args);
    if (args[1].originalname === 'mail-metadata.json')
      actors.resolve.mockRejectedValue(new ForbiddenException('Key revoked'));
    return file;
  });
  records.update.mockClear();
  await expect(
    service.process({ archiveId: archive.archiveId, actor }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const current = await service.one(context, archive.archiveId);
  expect(current.status).toBe('EXPANDING');
  expect(current.detail.artifacts.map((file) => file.kind)).toEqual(['raw']);
  expect(
    records.update.mock.calls.some((call) => call[3].status === 'FAILED'),
  ).toBe(false);
  expect(intakes.submit).not.toHaveBeenCalled();
});

it('does not rebind or overwrite archive checkpoints while its queue job is still in flight', async () => {
  const { service, records, rows, queue } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  await service.process({ archiveId: archive.archiveId, actor });
  await records.update(context, 'recruitingMailArchive', archive.archiveId, {
    status: 'EXPANDING',
  });
  queue.getInFlightJobs.mockResolvedValue([
    { id: 'running-mail', data: { archiveId: archive.archiveId, actor } },
  ]);
  const key = `recruitingMailArchive:${archive.archiveId}`;
  const checkpoint = structuredClone(rows.get(key));
  records.update.mockClear();
  queue.add.mockClear();
  expect((await service.retry(context, archive.archiveId)).status).toBe(
    'EXPANDING',
  );
  expect(rows.get(key)).toEqual(checkpoint);
  expect(records.update).not.toHaveBeenCalled();
  expect(queue.add).not.toHaveBeenCalled();
});

it('recovers a stopped archive under a new authorized caller and reuses completed MIME checkpoints', async () => {
  const { service, records, actors, uploads, queue, locks } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  const upload = uploads.buffer.getMockImplementation()!;
  uploads.buffer.mockImplementation(async (...args) => {
    const file = await upload(...args);
    if (args[1].originalname === 'mail-body.txt')
      actors.resolve.mockRejectedValue(new ForbiddenException('Key revoked'));
    return file;
  });
  await expect(
    service.process({ archiveId: archive.archiveId, actor }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const recoveryActor = { ...actor, userWorkspaceId: 'recovery-member' };
  const recoveryContext = {
    ...context,
    type: 'user',
    userWorkspaceId: recoveryActor.userWorkspaceId,
  } as WorkspaceAuthContext;
  actors.capture.mockReturnValue(recoveryActor);
  actors.resolve.mockImplementation(async (principal) => {
    if (principal.userWorkspaceId !== recoveryActor.userWorkspaceId)
      throw new ForbiddenException('Key revoked');
    return recoveryContext;
  });
  uploads.buffer.mockImplementation(upload);
  let locked = false;
  jest
    .spyOn(locks, 'tryWithLock')
    .mockImplementation(async (_key, callback) => {
      expect(locked).toBe(false);
      locked = true;
      try {
        return { acquired: true, value: await callback() };
      } finally {
        locked = false;
      }
    });
  queue.add.mockImplementation(async (_name, data: RecruitingMailJobData) => {
    expect(locked).toBe(false);
    expect(data.actor).toEqual(recoveryActor);
    await service.process(data);
  });
  await service.retry(recoveryContext, archive.archiveId);
  const final = await service.one(recoveryContext, archive.archiveId);
  expect(final.status).toBe('NEEDS_SELECTION');
  expect(
    uploads.buffer.mock.calls.filter(
      (call) => call[1].originalname === 'mail-metadata.json',
    ),
  ).toHaveLength(1);
  expect(records.update).toHaveBeenCalledWith(
    recoveryContext,
    'recruitingMailArchive',
    archive.archiveId,
    expect.objectContaining({ status: 'QUEUED' }),
  );
});

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
  await service.receive(context, raw, source);
  expect(
    (await service.one(context, archive.archiveId)).detail.sources,
  ).toHaveLength(2);
  await service.submitIntake(context, archive.archiveId, {
    artifactKeys: [selected.key],
    note: 'Optional instruction',
  });
  expect(
    (intakes.submit.mock.calls[1][1] as unknown as { idempotencyKey: string })
      .idempotencyKey,
  ).toBe(previous);
  expect((intakes.submit.mock.calls[1][1] as { mail: unknown }).mail).toEqual(
    request.mail,
  );
  await expect(
    service.submitIntake(context, archive.archiveId, {
      artifactKeys: ['foreign-file'],
    }),
  ).rejects.toThrow('不属于');
  expect(uploads.fromMailArchive).toHaveBeenCalledTimes(2);
});

it('reuses one intake with identical ordered files when the same material selection arrives in reverse order', async () => {
  const { service, intakes } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  await service.process({ archiveId: archive.archiveId, actor });
  const detail = (await service.one(context, archive.archiveId)).detail;
  const keys = detail.artifacts
    .filter((file) => ['text', 'attachment'].includes(file.kind))
    .map((file) => file.key);
  expect(keys).toHaveLength(2);
  const first = await service.submitIntake(context, archive.archiveId, {
    artifactKeys: keys,
  });
  const repeated = await service.submitIntake(context, archive.archiveId, {
    artifactKeys: [...keys].reverse(),
  });
  expect(repeated.intakeId).toBe(first.intakeId);
  // The real intake hashes ordered file references, so a stable key alone is insufficient for idempotency.
  expect(intakes.submit).toHaveBeenNthCalledWith(
    2,
    context,
    intakes.submit.mock.calls[0][1],
  );
  expect((await service.one(context, archive.archiveId)).intakeIds).toEqual([
    first.intakeId,
  ]);
});

it('returns only an archive-accepted legacy binding after canonical file IDs change', async () => {
  const { service, records, intakes, mailFiles } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  await service.process({ archiveId: archive.archiveId, actor });
  const detail = (await service.one(context, archive.archiveId)).detail;
  const selected = detail.artifacts.find((file) => file.kind === 'attachment')!;
  const digest = contentVersion({
    selection: [selected.key],
    candidateId: undefined,
    note: '',
  });
  const key = `mail:${archive.archiveId}:${digest}`;
  const id = v5(`workspace:CANDIDATE:email:${key}`, v5.URL);
  const record = await records.one(
    context,
    'recruitingMailArchive',
    archive.archiveId,
  );
  const payload = record.payload as {
    artifacts: { fileId: string }[];
    intakeIds: string[];
  };
  await records.update(context, 'recruitingMailArchive', archive.archiveId, {
    payload: {
      ...payload,
      artifacts: payload.artifacts.map((file) => ({
        ...file,
        fileId: `migrated-${file.fileId}`,
      })),
      intakeIds: [id],
    },
  });
  mailFiles.intakeFiles.mockClear();
  const receipt = await service.submitIntake(context, archive.archiveId, {
    artifactKeys: [selected.key],
  });
  expect(receipt.intakeId).toBe('legacy-intake');
  expect(intakes.mailBinding).toHaveBeenCalledWith(context, id, {
    archiveId: archive.archiveId,
    sourceHash: record.sourceHash,
    idempotencyKey: key,
  });
  expect(intakes.submit).not.toHaveBeenCalled();
  expect(mailFiles.intakeFiles).not.toHaveBeenCalled();
});

it('does not adopt a child merely because it claimed the deterministic email source key', async () => {
  const { service, intakes } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  await service.process({ archiveId: archive.archiveId, actor });
  const selected = (
    await service.one(context, archive.archiveId)
  ).detail.artifacts.find((file) => file.kind === 'attachment')!;
  intakes.submit.mockRejectedValue(
    new ConflictException('key already belongs to different files'),
  );
  await expect(
    service.submitIntake(context, archive.archiveId, {
      artifactKeys: [selected.key],
    }),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(intakes.mailBinding).not.toHaveBeenCalled();
  expect((await service.one(context, archive.archiveId)).intakeIds).toEqual([]);
});

it('uses different copy bindings for different notes and retries an interrupted intake receipt with the same copies', async () => {
  const { service, mailFiles, intakes, records } = setup();
  const archive = await service.receive(context, raw, {
    transport: 'EML_UPLOAD',
  });
  await service.process({ archiveId: archive.archiveId, actor });
  const selected = (
    await service.one(context, archive.archiveId)
  ).detail.artifacts.find((file) => file.kind === 'attachment')!;
  mailFiles.intakeFiles.mockImplementation(
    async (_caller, _id, binding, keys) =>
      keys.map((key) => ({
        fileId: `${binding}:${key}`,
        label: key,
        uploadReceipt: 'proof',
      })),
  );
  const original = records.update.getMockImplementation()!;
  let interrupted = false;
  records.update.mockImplementation(async (...args) => {
    if (
      !interrupted &&
      (args[3].payload as { intakeIds?: string[] } | undefined)?.intakeIds
        ?.length
    ) {
      interrupted = true;
      throw new Error('receipt interrupted');
    }
    return original(...args);
  });
  await expect(
    service.submitIntake(context, archive.archiveId, {
      artifactKeys: [selected.key],
      note: 'first',
    }),
  ).rejects.toThrow('receipt interrupted');
  await service.submitIntake(context, archive.archiveId, {
    artifactKeys: [selected.key],
    note: 'first',
  });
  await service.submitIntake(context, archive.archiveId, {
    artifactKeys: [selected.key],
    note: 'second',
  });
  expect(intakes.submit.mock.calls[1][1]).toEqual(
    intakes.submit.mock.calls[0][1],
  );
  expect(
    (intakes.submit.mock.calls[2][1] as { files: unknown[] }).files,
  ).not.toEqual(
    (intakes.submit.mock.calls[0][1] as { files: unknown[] }).files,
  );
  expect(intakes.mailBinding).not.toHaveBeenCalled();
});

it('automatically submits body and every attachment including inline images for incoming IMAP mail', async () => {
  const { service, intakes, parser } = setup();
  const message = Buffer.from(
    [
      'From: Candidate <candidate@example.test>',
      'Subject: Candidate introduction',
      'Content-Type: multipart/mixed; boundary="all"',
      '',
      '--all',
      'Content-Type: text/plain',
      '',
      'Looking for TypeScript roles.',
      '--all',
      'Content-Type: image/png',
      'Content-Disposition: inline; filename="profile.png"',
      'Content-Transfer-Encoding: base64',
      '',
      'aW1hZ2U=',
      '--all--',
      '',
    ].join('\r\n'),
  );
  parser.original.mockResolvedValue(message);
  const archive = await service.receive(context, message, source, false);
  await service.process({ archiveId: archive.archiveId, actor });
  const detail = await service.one(context, archive.archiveId);
  expect(detail.attachmentCount).toBe(1);
  expect(intakes.submit).toHaveBeenCalledWith(
    context,
    expect.objectContaining({
      kind: 'CANDIDATE',
      source: 'email',
      files: expect.arrayContaining([
        expect.objectContaining({ label: 'profile.png', role: 'primary' }),
        expect.objectContaining({ label: 'mail-body.txt', role: 'primary' }),
        expect.objectContaining({ label: 'original.eml', role: 'archive' }),
      ]),
    }),
  );
  await service.process({ archiveId: archive.archiveId, actor });
  expect(intakes.submit).toHaveBeenCalledTimes(1);
});

it('accepts a body-only candidate email without requiring a resume attachment', async () => {
  const { service, intakes, parser } = setup();
  const message = Buffer.from(
    'Subject: Self introduction\r\nContent-Type: text/plain\r\n\r\nCandidate experience and expected roles',
  );
  parser.original.mockResolvedValue(message);
  const archive = await service.receive(context, message, source);
  await service.process({ archiveId: archive.archiveId, actor });
  expect((await service.one(context, archive.archiveId)).attachmentCount).toBe(
    0,
  );
  expect(intakes.submit).toHaveBeenCalledTimes(1);
});
