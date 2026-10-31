/** Evaluates one versioned candidate/job pair and persists reusable native records. */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { experimental_evaluate as evaluate } from 'ai';
import { v5 } from 'uuid';

import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { RecruitingRecordsService } from './recruiting-records.service';
import {
  buildCandidateMatchContext,
  buildJobMatchContext,
  stableSerialize,
  type MatchSource,
} from './domain/match-context';
import {
  evaluateRecruitingEligibility,
  getPairEvaluationCacheKey,
  type EligibilityResult,
} from './domain/match-policy';
import { RECRUITING_MATCH_PROTOCOL } from './domain/match-protocol';

/** Stops a run after upstream authorization fails without exposing provider response contents. */
export class RecruitingEvaluationAuthError extends Error {
  constructor() {
    super('Jev 授权不可用，请管理员检查评分模型配置');
  }
}

/** A failure has no score; eligibility and input problems remain explicit alongside model output. */
export type RecruitingPairResult = {
  candidateId: string;
  jobId: string;
  candidateLabel: string;
  jobLabel: string;
  companyId?: string;
  status: 'SCORED' | 'EXCLUDED' | 'NEEDS_REVIEW' | 'FAILED';
  eligibility: EligibilityResult;
  intent?: {
    expectedRoles: string[];
    status: 'declared' | 'unspecified';
    requiresConfirmation: boolean;
  };
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  error?: string;
  cacheId: string;
  cacheKey: string;
  cached: boolean;
  evaluatedAt: string;
  modelId: string;
  resolvedModelId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  cost?: string | number;
  elapsedMs?: number;
  duplicateKey: string;
};

@Injectable()
/** Shares the same pair cache in both matching directions and serializes simultaneous paid evaluations. */
export class RecruitingPairEvaluatorService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly registry: AiModelRegistryService,
    private readonly locks: PostgresAdvisoryLockService,
  ) {}

  /** Computes eligibility and a content-only cache identity without invoking a model. */
  prepare(
    context: WorkspaceAuthContext,
    candidateRecord: MatchSource,
    jobRecord: MatchSource,
    companyRecord?: MatchSource,
  ) {
    const candidate = buildCandidateMatchContext(candidateRecord);
    const job = buildJobMatchContext(jobRecord, companyRecord);
    const modelId =
      process.env.RECRUITING_JEV_MODEL_ID ??
      'recruiting-gateway/typesafe-ai/jev';
    const cacheKey = getPairEvaluationCacheKey({
      workspaceId: context.workspace.id,
      candidateId: candidate.id,
      candidateVersion: candidate.version,
      jobId: job.id,
      jobVersion: job.version,
      companyVersion: job.companyVersion,
      protocolVersion: RECRUITING_MATCH_PROTOCOL.version,
      modelVersion: modelId,
    });
    return {
      candidate,
      job,
      modelId,
      cacheKey,
      cacheId: v5(`${context.workspace.id}:${cacheKey}`, v5.URL),
    };
  }

  /** Filters explicit conflicts before billing, preserves unknowns and uses the native model registry. */
  async run(
    context: WorkspaceAuthContext,
    candidateRecord: MatchSource,
    jobRecord: MatchSource,
    companyRecord?: MatchSource,
  ): Promise<RecruitingPairResult> {
    const prepared = this.prepare(
      context,
      candidateRecord,
      jobRecord,
      companyRecord,
    );
    const { candidate, job, modelId, cacheKey, cacheId } = prepared;
    const eligibility = evaluateRecruitingEligibility(
      candidate.eligibility,
      job.eligibility,
    );
    if (candidate.supplementOnly) {
      eligibility.reasons.push({
        code: 'supplement_only',
        message: '目前只有投递自述或补充说明，原始简历需补充或核实',
        blocking: false,
      });
      if (eligibility.status === 'eligible')
        eligibility.status = 'needs_confirmation';
    }
    const base: RecruitingPairResult = {
      candidateId: candidate.id,
      jobId: job.id,
      candidateLabel: candidate.label,
      jobLabel: job.label,
      companyId: job.companyId,
      status: 'NEEDS_REVIEW',
      eligibility,
      intent: {
        expectedRoles: candidate.context.expectedRoles,
        status: candidate.context.expectedRoles.length
          ? 'declared'
          : 'unspecified',
        requiresConfirmation: true,
      },
      cacheId,
      cacheKey,
      cached: false,
      evaluatedAt: new Date().toISOString(),
      modelId,
      duplicateKey: job.duplicateKey,
    };
    if (eligibility.status === 'excluded')
      return { ...base, status: 'EXCLUDED' };
    if (candidate.issue || job.issue)
      return { ...base, error: candidate.issue ?? job.issue };
    const state = {
      resume: candidate.context,
      job: job.context,
      company: job.company,
    };
    const questions = { match: RECRUITING_MATCH_PROTOCOL.question };
    // UTF-8 bytes are a deliberately conservative ceiling, not a claim of exact Jev tokenization.
    if (
      Buffer.byteLength(stableSerialize({ state, questions })) + 2048 >
      32_000
    )
      return {
        ...base,
        error:
          '完整材料超过当前 Jev 上下文安全预算，未截断；请先整理或拆分材料',
      };
    const cached = await this.cached(context, cacheId, cacheKey);
    if (cached) return { ...cached, cached: true };
    const result = await this.locks.tryWithLock(
      `recruiting-pair:${context.workspace.id}:${cacheId}`,
      async () => {
        const current = await this.cached(context, cacheId, cacheKey);
        if (current) return { ...current, cached: true };
        const model = this.registry.getEvaluationModel(modelId);
        if (!model || !this.registry.isModelAdminAllowed(modelId))
          throw new BadRequestException('请先配置可用的 Jev 评分模型');
        let previous;
        try {
          previous = await this.records.one(
            context,
            'recruitingPairEvaluation',
            cacheId,
          );
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
        const pending = {
          name: `${candidate.id} / ${job.id}`,
          candidateId: candidate.id,
          jobId: job.id,
          status: 'PROCESSING',
          score: null,
          payload: base,
        };
        // Check native write permission before billing; an interrupted claim is recoverable under the same lock.
        if (previous)
          await this.records.update(
            context,
            'recruitingPairEvaluation',
            cacheId,
            pending,
          );
        else
          await this.records.create(context, 'recruitingPairEvaluation', {
            id: cacheId,
            ...pending,
          });
        const started = performance.now();
        const response = await this.evaluateAndRecordFailure(
          context,
          cacheId,
          model.model,
          state,
          questions,
          base,
        );
        const answer = response.answers.match;
        if (
          answer.type !== 'score' ||
          !Number.isFinite(answer.score) ||
          answer.score < 0 ||
          answer.score > 4
        )
          throw new BadRequestException('评分模型返回的能力分无效');
        const confidence = response.providerMetadata?.typesafe?.confidence;
        const output: RecruitingPairResult = {
          ...base,
          status: 'SCORED',
          score: answer.score,
          probabilities: answer.probabilities,
          ...(confidence &&
          typeof confidence === 'object' &&
          'match' in confidence &&
          typeof confidence.match === 'number'
            ? { confidence: confidence.match }
            : {}),
          usage: response.usage,
          resolvedModelId: response.response.modelId,
          cost: response.providerMetadata?.gateway?.cost as
            | string
            | number
            | undefined,
          elapsedMs: Math.round(performance.now() - started),
        };
        const fields = {
          id: cacheId,
          name: `${candidate.id} / ${job.id}`,
          candidateId: candidate.id,
          jobId: job.id,
          status: 'SCORED',
          score: output.score,
          payload: output,
        };
        await this.records.update(
          context,
          'recruitingPairEvaluation',
          cacheId,
          fields,
        );
        return output;
      },
    );
    return result.acquired
      ? result.value
      : {
          ...base,
          status: 'FAILED',
          error: '该人岗组合正在评分，请稍后重试以复用结果',
        };
  }

  /** Stores safe failure categories because provider exceptions may contain credentials and full materials. */
  private async evaluateAndRecordFailure(
    context: WorkspaceAuthContext,
    cacheId: string,
    model: NonNullable<
      ReturnType<AiModelRegistryService['getEvaluationModel']>
    >['model'],
    state: unknown,
    questions: { match: typeof RECRUITING_MATCH_PROTOCOL.question },
    base: RecruitingPairResult,
  ) {
    try {
      const result = await evaluate({
        model,
        state: stableSerialize(state),
        questions,
        maxRetries: 2,
        abortSignal: AbortSignal.timeout(30_000),
      });
      const answer = result.answers.match;
      if (
        answer.type !== 'score' ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > 4
      )
        throw new BadRequestException('评分模型返回的能力分无效');
      return result;
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'statusCode' in error
          ? error.statusCode
          : undefined;
      const unauthorized = status === 401 || status === 403;
      await this.records.update(context, 'recruitingPairEvaluation', cacheId, {
        status: 'FAILED',
        score: null,
        payload: {
          ...base,
          status: 'FAILED',
          error: unauthorized ? '评分模型授权不可用' : '评分请求失败，可重试',
        },
      });
      if (unauthorized) throw new RecruitingEvaluationAuthError();
      throw new BadRequestException('评分请求失败，可重试；未计为零分');
    }
  }

  /** Keeps moving model aliases bounded; only successful, unexpired scores may be reused. */
  private async cached(
    context: WorkspaceAuthContext,
    id: string,
    key: string,
  ): Promise<RecruitingPairResult | undefined> {
    try {
      const record = await this.records.one(
        context,
        'recruitingPairEvaluation',
        id,
      );
      const payload = record.payload as RecruitingPairResult | undefined;
      if (
        payload?.status === 'SCORED' &&
        payload.cacheKey === key &&
        Date.now() - Date.parse(payload.evaluatedAt) < 24 * 60 * 60_000
      )
        return payload;
      return undefined;
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
}
