/** Verifies billing boundaries, version invalidation and safe failure persistence without network calls. */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { experimental_evaluate as evaluate } from 'ai';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import {
  RecruitingEvaluationAuthError,
  RecruitingPairEvaluatorService,
  type RecruitingPairResult,
} from './recruiting-pair-evaluator.service';

jest.mock('ai', () => ({ experimental_evaluate: jest.fn() }));

const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
const candidate = {
  id: 'candidate',
  recruitingProfile: { summary: '维护 TypeScript 服务' },
};
const job = {
  id: 'job',
  name: '后端',
  jobStatus: 'RECRUITING',
  jobAttributes: ['FULL_TIME'],
  jobDescription: { markdown: '维护 TypeScript 服务' },
};
const company = {
  id: 'company',
  name: '公司',
  recruitingDescription: '基础设施',
};

/** A native-style in-memory boundary rejects duplicate identities rather than hiding an invalid cache write. */
const setup = () => {
  const rows = new Map<string, Record<string, unknown>>();
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
        if (rows.has(data.id)) throw new Error('duplicate');
        rows.set(data.id, structuredClone(data));
        return data;
      },
    ),
    update: jest.fn(
      async (_context, _object, id: string, data: Record<string, unknown>) => {
        const next = { ...rows.get(id), ...structuredClone(data) };
        rows.set(id, next);
        return next;
      },
    ),
  };
  const registry = {
    getEvaluationModel: () => ({ model: {} }),
    isModelAdminAllowed: () => true,
  };
  const locks = {
    tryWithLock: async (_name: string, callback: () => Promise<unknown>) => ({
      acquired: true,
      value: await callback(),
    }),
  };
  const evaluator = new RecruitingPairEvaluatorService(
    records as unknown as RecruitingRecordsService,
    registry as unknown as AiModelRegistryService,
    locks as unknown as PostgresAdvisoryLockService,
  );
  jest.mocked(evaluate).mockResolvedValue({
    answers: {
      match: {
        type: 'score',
        score: 3.2,
        probabilities: { '3': 0.8, '4': 0.2 },
      },
    },
    usage: { inputTokens: 100 },
    response: { modelId: 'jev-resolved' },
  } as never);
  return { evaluator, rows, records };
};

describe('recruiting pair evaluator', () => {
  it('reuses the same successful pair and invalidates only changed company context', async () => {
    const { evaluator } = setup();
    const first = await evaluator.run(context, candidate, job, company);
    const cached = await evaluator.run(context, candidate, job, company);
    expect(first.score).toBe(3.2);
    expect(cached.cached).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    const changed = await evaluator.run(context, candidate, job, {
      ...company,
      recruitingDescription: '金融系统',
    });
    expect(changed.cacheId).not.toBe(first.cacheId);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('updates expired cache identities instead of failing after a second paid call', async () => {
    const { evaluator, rows, records } = setup();
    const first = await evaluator.run(context, candidate, job, company);
    (rows.get(first.cacheId)!.payload as RecruitingPairResult).evaluatedAt =
      new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    expect((await evaluator.run(context, candidate, job, company)).cached).toBe(
      false,
    );
    expect(records.create).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('filters explicit conflict before any model or cache writes', async () => {
    const { evaluator, records } = setup();
    const result = await evaluator.run(
      context,
      {
        ...candidate,
        candidatePreferences: {
          markdown: '这是测试候选人，只考虑全职后端开发，不考虑实习岗位。',
        },
      },
      { ...job, jobAttributes: ['INTERNSHIP'] },
      company,
    );
    expect(result.status).toBe('EXCLUDED');
    expect(result.score).toBeUndefined();
    expect(evaluate).not.toHaveBeenCalled();
    expect(records.create).not.toHaveBeenCalled();
  });

  it('checks native write permissions before billing', async () => {
    const { evaluator, records } = setup();
    records.create.mockRejectedValue(new ForbiddenException());
    await expect(
      evaluator.run(context, candidate, job, company),
    ).rejects.toThrow(ForbiddenException);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('does not truncate oversized materials or score empty identities', async () => {
    const { evaluator } = setup();
    expect(
      (await evaluator.run(context, { id: 'empty' }, job, company)).status,
    ).toBe('NEEDS_REVIEW');
    expect(
      (
        await evaluator.run(
          context,
          {
            id: 'large',
            recruitingProfile: { sourceText: '职业经历'.repeat(100_000) },
          },
          job,
          company,
        )
      ).status,
    ).toBe('NEEDS_REVIEW');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('sends complete non-ASCII material above the old byte ceiling and lets Jev enforce its token window', async () => {
    const { evaluator } = setup();
    const text = '职业经历和具体项目。'.repeat(2000);
    expect(Buffer.byteLength(text)).toBeGreaterThan(32000);
    const result = await evaluator.run(
      context,
      { id: 'long', recruitingProfile: { sourceText: text } },
      job,
      company,
    );
    expect(result.status).toBe('SCORED');
    const request = jest.mocked(evaluate).mock.calls[0][0];
    expect(JSON.parse(request.state as string).resume.sourceText).toBe(text);
  });

  it('reports an actual provider context rejection as review-needed without a zero score or leaked response', async () => {
    const { evaluator, rows } = setup();
    jest
      .mocked(evaluate)
      .mockRejectedValue({
        statusCode: 400,
        responseBody: 'context_length_exceeded: private material and secret',
      });
    const result = await evaluator.run(context, candidate, job, company);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.score).toBeUndefined();
    expect(JSON.stringify([...rows.values()])).not.toContain(
      'private material',
    );
    expect(JSON.stringify([...rows.values()])).not.toContain('secret');
  });

  it('persists an authorization failure without any upstream secret or zero score', async () => {
    const { evaluator, rows } = setup();
    jest.mocked(evaluate).mockRejectedValue({
      statusCode: 401,
      message: 'secret upstream request',
      headers: { Authorization: 'secret' },
    });
    await expect(
      evaluator.run(context, candidate, job, company),
    ).rejects.toThrow(RecruitingEvaluationAuthError);
    const record = [...rows.values()][0];
    expect(record.status).toBe('FAILED');
    expect(record.score).toBeNull();
    expect(JSON.stringify(record)).not.toContain('secret');
  });
});
