/** Verifies durable generation, current-source checks and direct-human approval without a model or mail transport. */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { type RecruitingActorService } from './recruiting-actor.service';
import { type RecruitingExtractorService } from './recruiting-extractor.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import { RecruitingDraftsService } from './recruiting-drafts.service';

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
    resolve: jest.fn(async () => context),
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
  const queue = { add: jest.fn() };
  const service = new RecruitingDraftsService(
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
    extractor as unknown as RecruitingExtractorService,
    locks as unknown as PostgresAdvisoryLockService,
    queue as unknown as MessageQueueService,
  );
  return { service, rows, records, actors, extractor, candidate };
};

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
  const { service, records, extractor, rows } = setup();
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

it('does not expose the draft after candidate read access is lost', async () => {
  const { service, rows } = setup();
  const draft = await service.submit(context, input);
  rows.delete(candidateId);
  await expect(service.one(context, draft.draftId)).rejects.toBeInstanceOf(
    NotFoundException,
  );
});
