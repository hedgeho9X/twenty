/** Verifies durable generation, current-source checks and direct-human approval without a model or mail transport. */
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
import { type RecruitingExtractorService } from './recruiting-extractor.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import {
  RecruitingDraftsService,
  type RecruitingDraftJobData,
} from './recruiting-drafts.service';

const candidateId = '9ee9152a-7015-4685-8948-3c9035312b9e';
const actor = { workspaceId: 'workspace', userWorkspaceId: 'member' };
const context = {
  type: 'user',
  workspace: { id: 'workspace' },
  userWorkspaceId: 'member',
} as WorkspaceAuthContext;
const input = { kind: 'GREETING', candidateId, idempotencyKey: 'draft-test' };

/** Native-like records retain checkpoints across service calls and expose no transport or outbound operation. */
const setup = () => {
  const candidate = {
    id: candidateId,
    name: { firstName: '合成' },
    contactRoles: ['CANDIDATE'],
    recruitingProfile: { summary: '维护后端与数据库', skills: ['TypeScript'] },
  };
  const rows = new Map<string, Record<string, unknown>>([
    [candidateId, candidate],
  ]);
  const records = {
    one: jest.fn(async (_context, _object, id: string) => {
      if (!rows.has(id)) throw new NotFoundException();
      return rows.get(id)!;
    }),
    create: jest.fn(
      async (
        _context,
        _object,
        data: Record<string, unknown> & { id: string },
      ) => {
        rows.set(data.id, structuredClone(data));
        return rows.get(data.id)!;
      },
    ),
    update: jest.fn(
      async (_context, _object, id: string, data: Record<string, unknown>) => {
        rows.set(id, { ...rows.get(id), ...structuredClone(data) });
        return rows.get(id)!;
      },
    ),
  };
  const actors = {
    capture: jest.fn(() => actor),
    resolve: jest.fn(async (_actor: RecruitingActor) => context),
  };
  const extractor = {
    draft: jest.fn(async () => ({
      profile: {
        title: '问候',
        body: '您好，想了解当前求职方向。',
        needsReview: false,
        reviewNotes: [],
      },
      modelId: 'test',
      usage: { totalTokens: 10 },
    })),
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
      async () => [] as { id: string; data: RecruitingDraftJobData }[],
    ),
  };
  const service = new RecruitingDraftsService(
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
    extractor as unknown as RecruitingExtractorService,
    locks as unknown as PostgresAdvisoryLockService,
    queue as unknown as MessageQueueService,
  );
  return { service, rows, records, actors, extractor, candidate, locks, queue };
};

it('rejects a busy draft for bounded queue backoff without generating until the lock clears', async () => {
  const { service, locks, queue, extractor, rows } = setup();
  const draft = await service.submit(context, input);
  const data = { draftId: draft.draftId, actor };
  const lock = jest
    .spyOn(locks, 'tryWithLock')
    .mockResolvedValueOnce({ acquired: false } as never);
  await expect(service.process(data)).rejects.toBeInstanceOf(ConflictException);
  expect(rows.get(draft.draftId)?.status).toBe('QUEUED');
  expect(extractor.draft).not.toHaveBeenCalled();
  expect(queue.add).toHaveBeenCalledWith(
    'RecruitingDraftJob',
    data,
    expect.objectContaining({
      retryLimit: 6,
      backoff: { strategy: 'exponential', initialDelayMilliseconds: 5_000 },
    }),
  );
  lock.mockRestore();
  await service.process(data);
  await service.process(data);
  expect(rows.get(draft.draftId)?.status).toBe('READY');
  expect(extractor.draft).toHaveBeenCalledTimes(1);
});

it('rejects authority revoked during generation without storing the model response or a stale-context failure', async () => {
  const { service, actors, extractor, records, rows } = setup();
  const draft = await service.submit(context, input);
  const original = extractor.draft.getMockImplementation()!;
  extractor.draft.mockImplementation(async () => {
    const result = await original();
    actors.resolve.mockRejectedValue(new ForbiddenException('Key revoked'));
    return result;
  });
  await expect(
    service.process({ draftId: draft.draftId, actor }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const current = rows.get(draft.draftId)!;
  expect(current.status).toBe('PROCESSING');
  expect(current.title).toBeUndefined();
  expect(current.body).toBeUndefined();
  expect(current.payload).not.toHaveProperty('generation');
  expect(
    records.update.mock.calls.some((call) => call[3].status === 'FAILED'),
  ).toBe(false);
  expect(extractor.draft).toHaveBeenCalledTimes(1);
});

it('preserves a draft checkpoint and actor while its queue job remains in flight', async () => {
  const { service, rows, records, queue } = setup();
  const draft = await service.submit(context, input);
  await service.process({ draftId: draft.draftId, actor });
  await records.update(context, 'recruitingDraft', draft.draftId, {
    status: 'PROCESSING',
  });
  queue.getInFlightJobs.mockResolvedValue([
    { id: 'running-draft', data: { draftId: draft.draftId, actor } },
  ]);
  const checkpoint = structuredClone(rows.get(draft.draftId));
  records.update.mockClear();
  queue.add.mockClear();
  expect((await service.retry(context, draft.draftId)).status).toBe(
    'PROCESSING',
  );
  expect(rows.get(draft.draftId)).toEqual(checkpoint);
  expect(records.update).not.toHaveBeenCalled();
  expect(queue.add).not.toHaveBeenCalled();
});

it('lets a new authorized caller resume a stopped draft without generating its saved model response again', async () => {
  const { service, actors, records, rows, extractor, queue, locks } = setup();
  const draft = await service.submit(context, input);
  const update = records.update.getMockImplementation()!;
  records.update.mockImplementation(async (...args) => {
    const record = await update(...args);
    if ((args[3].payload as { generation?: unknown } | undefined)?.generation)
      actors.resolve.mockRejectedValue(new ForbiddenException('Key revoked'));
    return record;
  });
  await expect(
    service.process({ draftId: draft.draftId, actor }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(rows.get(draft.draftId)?.status).toBe('PROCESSING');
  expect(rows.get(draft.draftId)?.payload).toHaveProperty('generation');
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
  records.update.mockImplementation(update);
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
  queue.add.mockImplementation(async (_name, data: RecruitingDraftJobData) => {
    expect(locked).toBe(false);
    expect(data.actor).toEqual(recoveryActor);
    await service.process(data);
  });
  await service.retry(recoveryContext, draft.draftId);
  expect(rows.get(draft.draftId)?.status).toBe('READY');
  expect(extractor.draft).toHaveBeenCalledTimes(1);
});

it('reuses identical submissions but refuses changed material under the same key', async () => {
  const { service, records, extractor } = setup();
  const first = await service.submit(context, input);
  expect(await service.submit(context, input)).toEqual(first);
  expect(records.create).toHaveBeenCalledTimes(1);
  expect(extractor.draft).not.toHaveBeenCalled();
  await expect(
    service.submit(context, { ...input, note: 'changed' }),
  ).rejects.toBeInstanceOf(ConflictException);
});

it('checkpoints generated text before a display write fails and reuses it on retry', async () => {
  const { service, records, extractor, rows, locks } = setup();
  const draft = await service.submit(context, input);
  const original = records.update.getMockImplementation()!;
  records.update.mockImplementation(async (...args) => {
    if (args[3].status === 'READY') {
      records.update.mockImplementation(original);
      throw new Error('write interrupted');
    }
    return original(...args);
  });
  await service.process({ draftId: draft.draftId, actor });
  expect(rows.get(draft.draftId)?.status).toBe('FAILED');
  await service.retry(context, draft.draftId);
  jest
    .spyOn(locks, 'tryWithLock')
    .mockResolvedValueOnce({ acquired: false } as never);
  await expect(
    service.process({ draftId: draft.draftId, actor }),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(extractor.draft).toHaveBeenCalledTimes(1);
  await service.process({ draftId: draft.draftId, actor });
  expect(extractor.draft).toHaveBeenCalledTimes(1);
  expect(rows.get(draft.draftId)?.status).toBe('READY');
});

it('marks generation stale when source facts change while the model is running', async () => {
  const { service, extractor, candidate } = setup();
  const draft = await service.submit(context, input);
  const original = extractor.draft.getMockImplementation()!;
  extractor.draft.mockImplementation(async () => {
    candidate.recruitingProfile.skills.push('Go');
    return original();
  });
  await service.process({ draftId: draft.draftId, actor });
  expect(await service.one(context, draft.draftId)).toMatchObject({
    status: 'NEEDS_REVIEW',
    stale: true,
  });
});

it('refuses API-key approval and preserves a human-edited approved draft on retry', async () => {
  const { service } = setup();
  const draft = await service.submit(context, input);
  await service.process({ draftId: draft.draftId, actor });
  const review = {
    title: '已修改',
    body: '运营人员核对后的正文',
    approve: true,
  };
  await expect(
    service.review(
      { type: 'apiKey' } as WorkspaceAuthContext,
      draft.draftId,
      review,
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await service.review(context, draft.draftId, review);
  await service.retry(context, draft.draftId);
  expect(await service.one(context, draft.draftId)).toMatchObject({
    status: 'APPROVED',
    body: review.body,
  });
});

it('preserves approved human text after source changes and returns only the original writing note for a new draft', async () => {
  const { service, candidate, records, rows, queue, extractor } = setup();
  const note = '自然简洁地询问当前求职方向';
  const draft = await service.submit(context, { ...input, note });
  await service.process({ draftId: draft.draftId, actor });
  await service.review(context, draft.draftId, {
    title: '人工核对标题',
    body: '人工核对正文',
    approve: true,
  });
  const approved = await service.one(context, draft.draftId);
  const stored = structuredClone(rows.get(draft.draftId));
  candidate.recruitingProfile.skills.push('Go');
  records.update.mockClear();
  queue.add.mockClear();
  expect(await service.retry(context, draft.draftId)).toMatchObject({
    draftId: draft.draftId,
    status: 'APPROVED',
  });
  expect(await service.one(context, draft.draftId)).toMatchObject({
    title: approved.title,
    body: approved.body,
    approvedAt: approved.approvedAt,
    note,
    stale: true,
  });
  expect(rows.get(draft.draftId)).toEqual(stored);
  expect(records.update).not.toHaveBeenCalled();
  expect(queue.add).not.toHaveBeenCalled();
  expect(extractor.draft).toHaveBeenCalledTimes(1);
  rows.delete(candidateId);
  await expect(service.retry(context, draft.draftId)).rejects.toBeInstanceOf(
    NotFoundException,
  );
  expect(queue.add).not.toHaveBeenCalled();
});

it('does not expose the draft after candidate read access is lost', async () => {
  const { service, rows } = setup();
  const draft = await service.submit(context, input);
  rows.delete(candidateId);
  await expect(service.one(context, draft.draftId)).rejects.toBeInstanceOf(
    NotFoundException,
  );
});
