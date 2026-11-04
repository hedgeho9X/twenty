/** Rejects ordinary contacts before parsing, task creation or paid extraction can make a misleading successful intake. */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecruitingIntakeService } from './intake.service';
import { RecruitingMatchingService } from '../matching/matching.service';

it.each([undefined, '11111111-1111-4111-8111-111111111111'])(
  'returns a stable job batch identity when the input batch is %s',
  async (batchId) => {
    const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
    const id = '22222222-2222-4222-8222-222222222222';
    const records = {
      one: jest.fn(async () => ({
        id,
        kind: 'JOB',
        employmentType: 'full_time',
        state: 'NEEDS_REVIEW',
        result: {
          schemaVersion: 2,
          input: {
            kind: 'JOB',
            employmentType: 'full_time',
            files: [],
            batchId,
          },
          stage: 'AWAITING_CONFIRMATION',
        },
      })),
    };
    const jobs = {
      preview: () => [],
      describePreview: async () => ({ jobItems: [] }),
    };
    const service = new RecruitingIntakeService(
      records as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      jobs as never,
      {} as never,
      {} as never,
    );
    expect((await service.one(context, id)).batchId).toBe(batchId ?? id);
    expect((await service.one(context, id)).batchId).toBe(batchId ?? id);
  },
);

it.each([
  ['false', 'DISABLED'],
  [undefined, 'QUEUED'],
] as const)(
  'keeps a stored candidate while automatic matching is %s',
  async (setting, expectedStatus) => {
    const previous = process.env.RECRUITING_AUTO_MATCH_ENABLED;
    if (setting === undefined) delete process.env.RECRUITING_AUTO_MATCH_ENABLED;
    else process.env.RECRUITING_AUTO_MATCH_ENABLED = setting;
    try {
      const context = {
        workspace: { id: 'workspace' },
      } as WorkspaceAuthContext;
      const actor = { workspaceId: 'workspace' };
      const candidateId = '00000000-0000-4000-8000-000000000001';
      const profile = {
        materialKind: 'candidate',
        name: '合成',
        summary: '后端工程',
        email: null,
        phone: null,
        skills: ['TypeScript'],
        experience: ['维护后端'],
        education: [],
        expectedRoles: [],
        category: null,
        employmentTypes: [],
        employmentEvidence: null,
        workModes: [],
        workModeEvidence: null,
        locations: [],
        locationEvidence: null,
        identityConflict: false,
        needsReview: false,
        reviewNotes: [],
      };
      let intake: Record<string, unknown> = {
        id: 'intake',
        state: 'READY',
        result: {
          schemaVersion: 2,
          actor,
          inputHash: 'hash',
          stage: 'EXTRACTED',
          input: {
            kind: 'CANDIDATE',
            employmentType: 'full_time',
            source: 'api',
            candidateId,
            files: [{ fileId: 'file', label: 'resume.txt', role: 'primary' }],
          },
          materials: [
            { fileId: 'file', text: 'synthetic', status: 'complete' },
          ],
          candidateFiles: [
            { sourceFileId: 'file', fileId: 'copy', label: 'resume.txt' },
          ],
          extraction: { profile, modelId: 'synthetic' },
        },
      };
      const records = {
        one: jest.fn(async (_context, object: string) =>
          object === 'recruitingIntake'
            ? structuredClone(intake)
            : { id: candidateId, contactRoles: ['CANDIDATE'] },
        ),
        update: jest.fn(async (_context, _object, _id, patch) => {
          intake = { ...intake, ...structuredClone(patch) };
          return structuredClone(intake);
        }),
      };
      const matching = {
        submitForRecord: jest.fn(async () => ({
          runId: 'manual-or-automatic-run',
        })),
      };
      const candidates = { replaceProfile: jest.fn(async () => undefined) };
      const service = new RecruitingIntakeService(
        records as never,
        { resolve: async () => context } as never,
        {} as never,
        {} as never,
        matching as never,
        {} as never,
        {} as never,
        candidates as never,
        {} as never,
      );
      await service.process({ intakeId: 'intake', actor });
      expect(candidates.replaceProfile).toHaveBeenCalledTimes(1);
      expect(intake.state).toBe('COMPLETED');
      expect(intake.targetId).toBe(candidateId);
      expect(intake.result).toMatchObject({
        stage: 'STORED',
        matchingStatus: expectedStatus,
      });
      expect(matching.submitForRecord).toHaveBeenCalledTimes(
        setting === 'false' ? 0 : 1,
      );
    } finally {
      if (previous === undefined)
        delete process.env.RECRUITING_AUTO_MATCH_ENABLED;
      else process.env.RECRUITING_AUTO_MATCH_ENABLED = previous;
    }
  },
);

it('still accepts an authorized manual pair request when automatic matching is explicitly disabled', async () => {
  const previous = process.env.RECRUITING_AUTO_MATCH_ENABLED;
  process.env.RECRUITING_AUTO_MATCH_ENABLED = 'false';
  try {
    const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
    const records = {
      one: jest.fn(async (_context, object: string) => {
        if (object === 'recruitingMatchRun') throw new NotFoundException();
        return { contactRoles: ['CANDIDATE'] };
      }),
      create: jest.fn(async (_context, _object, value) => value),
    };
    const queue = { add: jest.fn(async () => undefined) };
    const service = new RecruitingMatchingService(
      records as never,
      { capture: () => ({ workspaceId: 'workspace' }) } as never,
      {} as never,
      queue as never,
    );
    const result = await service.submit(context, {
      direction: 'PAIR',
      subjectId: '00000000-0000-4000-8000-000000000001',
      jobId: '00000000-0000-4000-8000-000000000002',
    });
    expect(result.status).toBe('QUEUED');
    expect(queue.add).toHaveBeenCalledTimes(1);
  } finally {
    if (previous === undefined)
      delete process.env.RECRUITING_AUTO_MATCH_ENABLED;
    else process.env.RECRUITING_AUTO_MATCH_ENABLED = previous;
  }
});

it('requires an existing candidate role when the API explicitly targets a person', async () => {
  const records = {
    one: jest.fn(async () => ({ contactRoles: ['CLIENT'] })),
    create: jest.fn(),
  };
  const parser = { file: jest.fn() };
  const uploads = { authorize: jest.fn() };
  const service = new RecruitingIntakeService(
    records as never,
    { capture: () => ({ workspaceId: 'workspace' }) } as never,
    parser as never,
    {} as never,
    {} as never,
    uploads as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    service.submit({ workspace: { id: 'workspace' } } as WorkspaceAuthContext, {
      kind: 'CANDIDATE',
      employmentType: 'full_time',
      source: 'api',
      idempotencyKey: 'ordinary-contact-target',
      candidateId: '00000000-0000-4000-8000-000000000001',
      files: [
        {
          fileId: '00000000-0000-4000-8000-000000000002',
          label: 'resume.txt',
          role: 'primary',
          uploadReceipt: 'synthetic',
        },
      ],
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(records.one).toHaveBeenCalledTimes(1);
  expect(parser.file).not.toHaveBeenCalled();
  expect(records.create).not.toHaveBeenCalled();
});

it('stops after inference when queued API authority expires or is revoked, including failure-state writes', async () => {
  let revoked = false;
  const context = {
    type: 'apiKey',
    workspace: { id: 'workspace' },
  } as WorkspaceAuthContext;
  const actor = { workspaceId: 'workspace', apiKeyId: 'key' };
  const actors = {
    resolve: jest.fn(async () => {
      if (revoked) throw new ForbiddenException('任务的 API 授权已失效');
      return context;
    }),
  };
  const records = {
    one: jest.fn(async () => ({
      id: 'intake',
      state: 'READY',
      result: {
        schemaVersion: 2,
        actor,
        inputHash: 'synthetic',
        stage: 'QUEUED',
        input: {
          kind: 'CANDIDATE',
          employmentType: 'full_time',
          source: 'api',
          files: [{ fileId: 'file', label: 'resume.txt', role: 'primary' }],
        },
      },
    })),
    update: jest.fn(async (_context, _object, _id, patch) => patch),
    create: jest.fn(),
  };
  const parser = {
    parse: jest.fn(async () => ({
      fileId: 'file',
      text: 'synthetic career material',
      status: 'complete',
    })),
    copyResumeAttachment: jest.fn(),
  };
  const extractor = {
    candidate: jest.fn(async () => {
      revoked = true;
      return { profile: {}, modelId: 'synthetic' };
    }),
  };
  const candidates = { replaceProfile: jest.fn() };
  const service = new RecruitingIntakeService(
    records as never,
    actors as never,
    parser as never,
    extractor as never,
    {} as never,
    {} as never,
    {} as never,
    candidates as never,
    {} as never,
  );
  await expect(
    service.process({ intakeId: 'intake', actor }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(extractor.candidate).toHaveBeenCalledTimes(1);
  expect(records.update.mock.calls.map((call) => call[3].result.stage)).toEqual(
    ['PARSING', 'PARSING', 'EXTRACTING'],
  );
  expect(parser.copyResumeAttachment).not.toHaveBeenCalled();
  expect(candidates.replaceProfile).not.toHaveBeenCalled();
  expect(records.create).not.toHaveBeenCalled();
});

it('creates extracted job items in the worker without a separate operator confirmation', async () => {
  const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
  const actor = { workspaceId: 'workspace' };
  const draft = { title: '后端工程师', description: '完整职责与要求' };
  const record = {
    id: 'intake',
    state: 'READY',
    result: {
      schemaVersion: 2,
      input: {
        kind: 'JOB',
        employmentType: 'full_time',
        source: 'manual',
        companyId: 'company',
        files: [],
      },
      actor,
      inputHash: 'hash',
      stage: 'EXTRACTED',
      extraction: { profile: { jobs: [draft] } },
    },
  };
  const records = {
    one: jest.fn(async () => structuredClone(record)),
    update: jest.fn(async () => record),
  };
  const jobs = {
    preview: jest.fn(() => [
      { itemId: 'item', jobId: 'job', status: 'DRAFT', draft },
    ]),
    confirm: jest.fn(async () => record),
  };
  const service = new RecruitingIntakeService(
    records as never,
    { resolve: async () => context } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    jobs as never,
    {} as never,
    {} as never,
  );
  await service.process({ intakeId: 'intake', actor });
  expect(jobs.confirm).toHaveBeenCalledWith(
    context,
    'intake',
    {
      items: [{ itemId: 'item', draft }],
    },
    true,
  );
  expect(records.update).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ state: 'NEEDS_REVIEW' }),
  );
});

it.each([null, undefined, []])(
  'returns an empty attachment list for a text-only JD stored with files=%j',
  async (files) => {
    const record = {
      id: 'text-jd',
      kind: 'JOB',
      employmentType: 'full_time',
      state: 'NEEDS_REVIEW',
      files,
      result: {
        schemaVersion: 2,
        input: { kind: 'JOB', employmentType: 'full_time', files: [] },
        stage: 'FAILED',
      },
    };
    const service = new RecruitingIntakeService(
      { one: jest.fn(async () => record) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        preview: () => [],
        describePreview: async () => ({ jobItems: [] }),
      } as never,
      {} as never,
      {} as never,
    );
    expect((await service.one({} as never, 'text-jd')).files).toEqual([]);
  },
);

it('reparses candidate-owned files without attaching them to a different native field', async () => {
  const candidateId = '11111111-1111-4111-8111-111111111111';
  const fileId = '22222222-2222-4222-8222-222222222222';
  const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
  const records = {
    one: jest.fn(async (_ctx, object) => {
      if (object === 'person')
        return { id: candidateId, contactRoles: ['CANDIDATE'] };
      throw new NotFoundException();
    }),
    create: jest.fn(async (_ctx, _object, data) => data),
  };
  const uploads = {
    authorize: jest.fn(),
    fromCandidate: jest.fn(async () => [{ fileId, label: 'resume.pdf' }]),
  };
  const queue = { add: jest.fn() };
  const service = new RecruitingIntakeService(
    records as never,
    { capture: () => ({ workspaceId: 'workspace' }) } as never,
    { file: jest.fn() } as never,
    {} as never,
    {} as never,
    uploads as never,
    {} as never,
    {} as never,
    queue as never,
  );
  await service.reparse(context, candidateId, 'batch');
  expect(records.create).toHaveBeenCalledWith(
    context,
    'recruitingIntake',
    expect.objectContaining({
      files: [],
      result: expect.objectContaining({
        input: expect.objectContaining({
          source: 'reparse',
          candidateId,
          files: [{ fileId, label: 'resume.pdf', role: 'primary' }],
        }),
      }),
    }),
  );
  expect(queue.add).toHaveBeenCalledTimes(1);
});
