/** Exercises stable batch identities, independent failure recovery and protection of manual edits. */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import { type RecruitingMatchingService } from './recruiting-matching.service';
import { type IntakeEnvelope } from './recruiting-intake.service';
import { type RecruitingJobProfile } from './recruiting-schemas';
import { RecruitingJobConfirmationService } from './recruiting-job-confirmation.service';

const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
const draft = (title: string): RecruitingJobProfile => ({
  title,
  description: '维护实际业务系统',
  preferences: '',
  category: 'engineering',
  employmentTypes: ['full_time'],
  workModes: ['onsite'],
  locations: [],
  needsReview: false,
  reviewNotes: [],
});

/** Retains native-like rows so retries must reconcile persisted state rather than an in-memory loop index. */
const setup = () => {
  const envelope: IntakeEnvelope = {
    schemaVersion: 2,
    input: { kind: 'JOB', source: 'api', files: [], companyId: 'company' },
    actor: { workspaceId: 'workspace' },
    inputHash: 'hash',
    stage: 'AWAITING_CONFIRMATION',
    extraction: {
      profile: {
        jobs: [draft('A'), draft('B'), draft('C')],
        needsReview: false,
        reviewNotes: [],
      },
    },
  };
  let intake: Record<string, unknown> = {
    id: 'intake',
    kind: 'JOB',
    result: envelope,
    state: 'NEEDS_REVIEW',
  };
  const jobs = new Map<string, Record<string, unknown>>();
  const records = {
    one: jest.fn(async (_context, object: string, id: string) => {
      if (object === 'company') return { id: 'company' };
      if (object === 'recruitingIntake') return structuredClone(intake);
      if (!jobs.has(id)) throw new NotFoundException();
      return structuredClone(jobs.get(id)!);
    }),
    create: jest.fn(
      async (
        _context,
        _object,
        data: Record<string, unknown> & { id: string },
      ) => {
        if (data.name === 'B') throw new BadRequestException('模拟字段错误');
        if (jobs.has(data.id)) throw new Error('duplicate');
        jobs.set(data.id, structuredClone(data));
        return data;
      },
    ),
    update: jest.fn(
      async (_context, _object, _id, data: Record<string, unknown>) => {
        intake = { ...intake, ...structuredClone(data) };
        return structuredClone(intake);
      },
    ),
  };
  const matching = {
    submitForRecord: jest.fn(async (_context, _object, id: string) => ({
      runId: `match-${id}`,
    })),
  };
  const cache = {
    getOrRecompute: async () => ({
      flatObjectMetadataMaps: {
        byUniversalIdentifier: {
          jobs: { id: 'jobs', nameSingular: 'recruitmentJob' },
        },
      },
      flatFieldMetadataMaps: {
        byUniversalIdentifier: {
          attrs: {
            objectMetadataId: 'jobs',
            name: 'jobAttributes',
            options: [{ value: 'FULL_TIME' }, { value: 'ONSITE' }],
          },
        },
      },
    }),
  };
  const locks = {
    tryWithLock: async (_key: string, callback: () => Promise<unknown>) => ({
      acquired: true,
      value: await callback(),
    }),
  };
  const service = new RecruitingJobConfirmationService(
    records as unknown as RecruitingRecordsService,
    matching as unknown as RecruitingMatchingService,
    cache as unknown as WorkspaceCacheService,
    locks as unknown as PostgresAdvisoryLockService,
  );
  return { service, records, jobs, matching, envelope, intake: () => intake };
};

describe('company-bound job confirmation', () => {
  it('stores confirmed jobs with DISABLED matching receipts when automatic scheduling is explicitly off', async () => {
    const previous = process.env.RECRUITING_AUTO_MATCH_ENABLED;
    process.env.RECRUITING_AUTO_MATCH_ENABLED = 'false';
    try {
      const { service, envelope, jobs, matching } = setup();
      const [item, ...discarded] = service.preview('intake', envelope);
      const result = await service.confirm(context, 'intake', {
        items: [{ itemId: item.itemId, draft: item.draft }],
        discardedItemIds: discarded.map((entry) => entry.itemId),
      });
      expect(jobs.has(item.jobId)).toBe(true);
      expect((result.result as IntakeEnvelope).jobItems?.[0].status).toBe(
        'CREATED',
      );
      expect(result.state).toBe('COMPLETED');
      expect((result.result as IntakeEnvelope).stage).toBe('STORED');
      expect((result.result as IntakeEnvelope).matchingStatus).toBe('DISABLED');
      expect(matching.submitForRecord).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined)
        delete process.env.RECRUITING_AUTO_MATCH_ENABLED;
      else process.env.RECRUITING_AUTO_MATCH_ENABLED = previous;
    }
  });
  it('keeps stable IDs after reordering and saves good rows despite a failed sibling', async () => {
    const { service, envelope, jobs, intake } = setup();
    const items = service.preview('intake', envelope);
    await service.confirm(context, 'intake', {
      items: [...items]
        .reverse()
        .map((item) => ({ itemId: item.itemId, draft: item.draft })),
    });
    const current = intake().result as IntakeEnvelope;
    expect(current.jobItems?.map((item) => item.status)).toEqual([
      'CREATED',
      'FAILED',
      'CREATED',
    ]);
    expect(jobs.get(items[0].jobId)?.name).toBe('A');
    expect(jobs.get(items[2].jobId)?.name).toBe('C');
    expect(intake().state).toBe('NEEDS_REVIEW');
  });

  it('retries only the failed item and never rewrites already created jobs', async () => {
    const { service, envelope, jobs, matching } = setup();
    const items = service.preview('intake', envelope);
    await service.confirm(context, 'intake', {
      items: items.map((item) => ({ itemId: item.itemId, draft: item.draft })),
    });
    jobs.get(items[0].jobId)!.name = '人工修订A';
    const result = await service.confirm(context, 'intake', {
      items: [{ itemId: items[1].itemId, draft: draft('修正B') }],
    });
    expect(result.state).toBe('COMPLETED');
    expect(jobs.size).toBe(3);
    expect(jobs.get(items[0].jobId)?.name).toBe('人工修订A');
    expect(jobs.get(items[1].jobId)?.name).toBe('修正B');
    expect(matching.submitForRecord).toHaveBeenCalledTimes(3);
    await expect(
      service.confirm(context, 'intake', {
        items: [{ itemId: items[0].itemId, draft: draft('覆盖A') }],
      }),
    ).rejects.toThrow('已经创建');
    expect(jobs.get(items[0].jobId)?.name).toBe('人工修订A');
  });

  it('records discarded items explicitly and rejects foreign or duplicate item identities', async () => {
    const { service, envelope, jobs } = setup();
    const items = service.preview('intake', envelope);
    await expect(
      service.confirm(context, 'intake', {
        items: [{ itemId: 'foreign', draft: draft('X') }],
      }),
    ).rejects.toThrow('标识');
    const result = await service.confirm(context, 'intake', {
      items: [{ itemId: items[0].itemId, draft: items[0].draft }],
      discardedItemIds: [items[1].itemId, items[2].itemId],
    });
    expect(result.state).toBe('COMPLETED');
    expect(jobs.size).toBe(1);
    expect(
      (result.result as IntakeEnvelope).jobItems?.map((item) => item.status),
    ).toEqual(['CREATED', 'DISCARDED', 'DISCARDED']);
  });

  it('retains canonical hybrid/contract facts without sending invalid legacy enum values', async () => {
    const { service, envelope, jobs } = setup();
    const [item] = service.preview('intake', envelope);
    const value = {
      ...item.draft,
      employmentTypes: ['contract'],
      workModes: ['hybrid'],
    };
    await service.confirm(context, 'intake', {
      items: [{ itemId: item.itemId, draft: value }],
    });
    expect(jobs.get(item.jobId)?.jobAttributes).toEqual([]);
    expect(jobs.get(item.jobId)?.recruitingProfile).toMatchObject({
      employmentTypes: ['contract'],
      workModes: ['hybrid'],
    });
  });
});
