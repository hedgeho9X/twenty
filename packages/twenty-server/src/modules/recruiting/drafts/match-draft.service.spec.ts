/** Verifies selection-bound drafting loads current full context and persists the result association. */
import { NotFoundException } from '@nestjs/common';
import { RecruitingDraftsService } from './drafts.service';
const candidateId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const setup = () => {
  const rows = new Map<string, any>([
    [runId, { id: runId, payload: { version: 1 } }],
    [
      candidateId,
      {
        id: candidateId,
        name: { firstName: '候选人' },
        contactRoles: ['CANDIDATE'],
        recruitingProfile: { skills: ['TypeScript'] },
      },
    ],
    [
      jobId,
      {
        id: jobId,
        name: '后端岗位',
        companyId: 'company',
        jobDescription: '负责API开发',
      },
    ],
    [
      'company',
      { id: 'company', name: '公司', recruitingDescription: '软件公司' },
    ],
  ]);
  const records = {
    one: jest.fn(async (_c, _o, id) => {
      if (!rows.has(id)) throw new NotFoundException();
      return rows.get(id);
    }),
    create: jest.fn(async (_c, _o, data) => {
      rows.set(data.id, data);
      return data;
    }),
    update: jest.fn(async (_c, _o, id, patch) => {
      const next = { ...rows.get(id), ...patch };
      rows.set(id, next);
      return next;
    }),
  };
  const actors = {
    capture: () => ({ workspaceId: 'workspace' }),
    resolve: async () => ({}),
  };
  const queue = { add: jest.fn() };
  const matching = {
    one: jest.fn(async () => ({
      complete: true,
      subjectLabel: '候选人',
      direction: 'CANDIDATE_TO_JOBS',
      top: [{ candidateId, jobId, score: 3 }],
    })),
  };
  const service = new RecruitingDraftsService(
    records as never,
    actors as never,
    {} as never,
    {} as never,
    queue as never,
    matching as never,
  );
  return { service, records, rows, queue };
};
it('binds a selected current result to a saved draft and reloads it', async () => {
  const { service, rows } = setup();
  const receipt = await service.submit(
    { workspace: { id: 'workspace' } } as never,
    {
      kind: 'GREETING',
      matchRunId: runId,
      selectedIds: [jobId],
      idempotencyKey: 'draft',
    },
  );
  expect(rows.get(runId).payload.matchDraftId).toBe(receipt.draftId);
  const saved = await service.latestForMatch({} as never, runId);
  expect(saved?.draftId).toBe(receipt.draftId);
});
it('rejects a record not present in the current ranked results before creation', async () => {
  const { service, records, queue } = setup();
  await expect(
    service.submit({} as never, {
      kind: 'GREETING',
      matchRunId: runId,
      selectedIds: [candidateId],
      idempotencyKey: 'bad',
    }),
  ).rejects.toThrow('请选择当前匹配结果');
  expect(records.create).not.toHaveBeenCalled();
  expect(queue.add).not.toHaveBeenCalled();
});
