/** Checks read-only preview provenance, company-scoped name hints and explicit partial/unavailable states. */
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type IntakeEnvelope } from './intake.service';
import { RecruitingJobConfirmationService } from './job-confirmation.service';

/** Supplies immutable synthetic source material and complete enough job facts for the existing preview schema. */
const envelope = (): IntakeEnvelope => ({
  schemaVersion: 2,
  actor: { workspaceId: 'workspace' },
  inputHash: 'hash',
  stage: 'AWAITING_CONFIRMATION',
  input: {
    kind: 'JOB',
    source: 'api',
    companyId: 'company',
    text: '岗位原文',
    note: '补充说明',
    files: [{ fileId: 'file', label: 'source.txt', role: 'primary' }],
  },
  extraction: {
    profile: {
      needsReview: false,
      reviewNotes: [],
      jobs: [
        {
          title: '后端工程师',
          description: '维护服务',
          preferences: '',
          category: null,
          employmentTypes: [],
          workModes: [],
          locations: [],
          needsReview: false,
          reviewNotes: [],
        },
        {
          title: '后端工程师',
          description: '另一个地点的服务',
          preferences: '',
          category: null,
          employmentTypes: [],
          workModes: [],
          locations: [],
          needsReview: false,
          reviewNotes: [],
        },
      ],
    },
  },
});
const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;

it('retains source identities and returns same-name hints without changing the submitted envelope', async () => {
  const input = envelope();
  const before = structuredClone(input);
  const records = {
    list: jest.fn(async () => ({
      records: [
        {
          id: 'existing',
          name: '后端工程师',
          companyId: 'company',
          jobStatus: 'CLOSED',
        },
      ],
      count: 1,
      hasNextPage: false,
    })),
  };
  const service = new RecruitingJobConfirmationService(
    records as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await service.describePreview(context, 'intake', input);
  expect(records.list).toHaveBeenCalledWith(
    context,
    'recruitmentJob',
    expect.objectContaining({
      filter: { companyId: { eq: 'company' } },
      select: ['id', 'name', 'companyId', 'jobStatus'],
      limit: 200,
    }),
  );
  expect(result.duplicateCheck).toEqual({
    status: 'COMPLETE',
    checked: 1,
    total: 1,
  });
  expect(result.jobItems[0].nameWarnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'EXISTING', id: 'existing' }),
      expect.objectContaining({ source: 'BATCH' }),
    ]),
  );
  expect(result.jobItems[0].missingFields).toContain('locations');
  expect(result.previewSources).toEqual({
    attribution: 'BATCH',
    files: [{ fileId: 'file', label: 'source.txt' }],
    hasText: true,
    hasNote: true,
  });
  expect(input).toEqual(before);
});

it('does not expose foreign-company or unreadable names as checked records', async () => {
  const records = {
    list: async () => ({
      records: [
        { id: 'foreign', name: '后端工程师', companyId: 'other' },
        { id: 'hidden-name', companyId: 'company' },
      ],
      count: 2,
      hasNextPage: false,
    }),
  };
  const service = new RecruitingJobConfirmationService(
    records as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await service.describePreview(context, 'intake', envelope());
  expect(result.previewExistingJobs).toEqual([]);
  expect(result.duplicateCheck).toEqual({
    status: 'PARTIAL',
    checked: 0,
    total: 2,
  });
  expect(
    result.jobItems[0].nameWarnings.every((row) => row.source === 'BATCH'),
  ).toBe(true);
});

it('marks a failed existing-job check as unavailable while preserving the preview', async () => {
  const service = new RecruitingJobConfirmationService(
    {
      list: async () => {
        throw new Error('denied');
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await service.describePreview(context, 'intake', envelope());
  expect(result.duplicateCheck).toEqual({ status: 'UNAVAILABLE', checked: 0 });
  expect(result.jobItems).toHaveLength(2);
  expect(result.previewSources.files).toHaveLength(1);
});

it('keeps a truncated directory check partial instead of certifying absence of duplicates', async () => {
  const service = new RecruitingJobConfirmationService(
    {
      list: async () => ({ records: [], count: 250, hasNextPage: true }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await service.describePreview(context, 'intake', envelope());
  expect(result.duplicateCheck.status).toBe('PARTIAL');
});

it('never widens a legacy preview without a company into an all-company query', async () => {
  const input = envelope();
  input.input.companyId = undefined;
  const records = { list: jest.fn() };
  const service = new RecruitingJobConfirmationService(
    records as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await service.describePreview(context, 'intake', input);
  expect(records.list).not.toHaveBeenCalled();
  expect(result.duplicateCheck.status).toBe('UNAVAILABLE');
  expect(result.previewExistingJobs).toEqual([]);
});
