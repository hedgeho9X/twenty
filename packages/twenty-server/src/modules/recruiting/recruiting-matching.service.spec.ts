/** Exercises bounded orchestration, partial coverage, authorization circuit breaking and stale results. */
import { NotFoundException } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type RecruitingActorService } from './recruiting-actor.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import {
  RecruitingEvaluationAuthError,
  type RecruitingPairEvaluatorService,
  type RecruitingPairResult,
} from './recruiting-pair-evaluator.service';
import { RecruitingMatchingService } from './recruiting-matching.service';

const actor = { workspaceId: 'workspace', userWorkspaceId: 'user' };
const context = {
  type: 'user',
  workspace: { id: 'workspace' },
  userWorkspaceId: 'user',
} as WorkspaceAuthContext;

/** Uses isolated native-like records; no production data or model endpoint participates. */
const setup = () => {
  const person = { id: 'person', contactRoles: ['CANDIDATE'] };
  const jobs = Array.from({ length: 7 }, (_, index) => ({
    id: `job-${index}`,
    companyId: 'company',
  }));
  const run = {
    id: 'run',
    direction: 'CANDIDATE_TO_JOBS',
    subjectId: 'person',
    status: 'QUEUED',
    payload: {
      version: 1,
      input: { direction: 'CANDIDATE_TO_JOBS', subjectId: 'person' },
      actor,
      inputHash: 'hash',
      results: [] as RecruitingPairResult[],
    },
  };
  const rows = new Map<string, Record<string, unknown>>([
    ['person', person],
    ['company', { id: 'company' }],
    ['run', run],
    ...jobs.map((job) => [job.id, job] as [string, Record<string, unknown>]),
  ]);
  const records = {
    list: jest.fn(async () => ({ count: jobs.length })),
    one: jest.fn(async (_context, _object, id: string) => {
      if (!rows.has(id)) throw new NotFoundException();
      return rows.get(id)!;
    }),
    all: jest.fn(async (_context, object: string) =>
      object === 'company' ? [rows.get('company')] : jobs,
    ),
    update: jest.fn(
      async (_context, _object, id: string, patch: Record<string, unknown>) => {
        const value = { ...rows.get(id), ...structuredClone(patch) };
        rows.set(id, value);
        return value;
      },
    ),
  };
  let active = 0;
  let maximum = 0;
  const evaluator = {
    prepare: jest.fn((_context, candidate, job) => ({
      cacheKey: job.id,
      cacheId: job.id,
      modelId: 'model',
      candidate: { label: candidate.id, context: { expectedRoles: [] } },
      job: { label: job.id, duplicateKey: job.id },
    })),
    run: jest.fn(
      async (_context, candidate, job): Promise<RecruitingPairResult> => {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active--;
        return {
          candidateId: candidate.id,
          jobId: job.id,
          candidateLabel: '候选人',
          jobLabel: job.id,
          status: 'SCORED',
          score: 3,
          eligibility: { status: 'eligible', reasons: [] },
          cacheKey: job.id,
          cacheId: job.id,
          modelId: 'model',
          cached: false,
          evaluatedAt: new Date().toISOString(),
          duplicateKey: job.id,
        };
      },
    ),
  };
  const queue = { add: jest.fn(), getInFlightJobs: jest.fn(async () => []) };
  const actors = {
    resolve: jest.fn(async () => context),
    capture: () => actor,
  };
  const service = new RecruitingMatchingService(
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
    evaluator as unknown as RecruitingPairEvaluatorService,
    queue as unknown as MessageQueueService,
  );
  return {
    service,
    rows,
    jobs,
    evaluator,
    records,
    queue,
    maximum: () => maximum,
  };
};

describe('recruiting matching runs', () => {
  it('bounds pair concurrency and checkpoints without losing simultaneous results', async () => {
    const { service, rows, maximum } = setup();
    await service.process({ runId: 'run', actor });
    const result = await service.one(context, 'run');
    expect(maximum()).toBe(3);
    expect(rows.get('run')!.status).toBe('COMPLETED');
    expect(result.counts).toMatchObject({
      total: 7,
      processed: 7,
      scored: 7,
      failed: 0,
    });
    expect(result.top).toHaveLength(5);
  });

  it('reports partial failures without making up zero scores', async () => {
    const { service, evaluator } = setup();
    evaluator.run.mockRejectedValueOnce(
      new Error('upstream failure containing secret'),
    );
    await service.process({ runId: 'run', actor });
    const result = await service.one(context, 'run');
    expect(result.status).toBe('PARTIAL');
    expect(result.complete).toBe(false);
    expect(result.counts).toMatchObject({ processed: 7, scored: 6, failed: 1 });
    expect(
      result.results.find((entry) => entry.status === 'FAILED')?.score,
    ).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('stops new provider calls after authorization failure while accounting for every target', async () => {
    const { service, evaluator } = setup();
    evaluator.run.mockRejectedValue(new RecruitingEvaluationAuthError());
    await service.process({ runId: 'run', actor });
    const result = await service.one(context, 'run');
    expect(evaluator.run.mock.calls.length).toBeLessThanOrEqual(3);
    expect(result.counts).toMatchObject({ total: 7, failed: 7, scored: 0 });
    expect(result.top).toEqual([]);
  });

  it('removes stale and inaccessible records before producing the current top five', async () => {
    const { service, evaluator, rows } = setup();
    await service.process({ runId: 'run', actor });
    evaluator.prepare.mockImplementation((_context, candidate, job) => ({
      cacheKey: 'changed',
      cacheId: job.id,
      modelId: 'model',
      candidate: { label: candidate.id, context: { expectedRoles: [] } },
      job: { label: job.id, duplicateKey: job.id },
    }));
    rows.delete('job-0');
    const result = await service.one(context, 'run');
    expect(result.stale).toBe(6);
    expect(result.inaccessible).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.top).toEqual([]);
  });

  it('recovers an orphaned PROCESSING run through a current caller without duplicating active work', async () => {
    const { service, rows, queue } = setup();
    rows.get('run')!.status = 'PROCESSING';
    await service.retry(context, 'run');
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(rows.get('run')!.status).toBe('QUEUED');
  });

  it('does not claim current full coverage when new targets entered the pool after the snapshot', async () => {
    const { service, records } = setup();
    await service.process({ runId: 'run', actor });
    records.list.mockResolvedValue({ count: 8 });
    const result = await service.one(context, 'run');
    expect(result.poolChanged).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.currentPoolCount).toBe(8);
  });

  it('refreshes the current whole pool and makes a previously reviewed run visible again', async () => {
    const { service, rows, jobs } = setup();
    await service.process({ runId: 'run', actor });
    await service.reviewed(context, 'run');
    const added = { id: 'job-added', companyId: 'company' };
    jobs.push(added);
    rows.set(added.id, added);

    await service.retry(context, 'run');
    const queued = rows.get('run')!.payload as Record<string, unknown>;
    expect(queued.targetIds).toBeUndefined();
    expect(queued.reviewedAt).toBeUndefined();

    await service.process({ runId: 'run', actor });
    const result = await service.one(context, 'run');
    expect(result.counts).toMatchObject({ total: 8, scored: 8 });
    expect(result.results.some((entry) => entry.jobId === added.id)).toBe(true);
    expect(result.poolChanged).toBe(false);
    expect(result.complete).toBe(true);
  });

  it('retains explicitly selected targets when retrying a limited run', async () => {
    const { service, rows, jobs } = setup();
    const payload = rows.get('run')!.payload as {
      input: Record<string, unknown>;
    };
    payload.input.targetIds = ['job-0', 'job-2'];
    await service.process({ runId: 'run', actor });
    const added = { id: 'job-added', companyId: 'company' };
    jobs.push(added);
    rows.set(added.id, added);

    await service.retry(context, 'run');
    await service.process({ runId: 'run', actor });
    const result = await service.one(context, 'run');
    expect(result.counts).toMatchObject({ total: 2, scored: 2 });
    expect(result.results.map((entry) => entry.jobId)).toEqual([
      'job-0',
      'job-2',
    ]);
    expect(result.complete).toBe(true);
  });
});

it.each(['CANDIDATE_TO_JOBS', 'JOB_TO_CANDIDATES'])(
  'filters %s before native pagination',
  async (direction) => {
    const records = {
      list: jest.fn(async () => ({
        records: [],
        count: 0,
        hasNextPage: false,
      })),
    };
    const service = new RecruitingMatchingService(
      records as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.list({} as never, 50, direction);
    expect(records.list).toHaveBeenCalledWith(
      {},
      'recruitingMatchRun',
      expect.objectContaining({
        offset: 50,
        filter:
          direction === 'CANDIDATE_TO_JOBS'
            ? {
                or: [
                  { direction: { eq: 'CANDIDATE_TO_JOBS' } },
                  { direction: { eq: 'PAIR' } },
                ],
              }
            : { direction: { eq: 'JOB_TO_CANDIDATES' } },
      }),
    );
  },
);
