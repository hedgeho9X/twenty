import { experimental_evaluate as evaluate } from 'ai';
import { SdkProviderFactoryService } from './sdk-provider-factory.service';
import { z } from 'zod';
import { ProviderConfigService } from './provider-config.service';
/** Registers application model purposes and persists validated bindings in native instance configuration. */
import { BadRequestException, Injectable } from '@nestjs/common';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { AiModelRegistryService } from './ai-model-registry.service';

export const AI_FEATURES = [
  { id: 'candidate_extraction', label: '候选人资料整理', kind: 'language' },
  { id: 'jd_extraction', label: '岗位 JD 整理', kind: 'language' },
  { id: 'match_brief', label: '匹配结果文案', kind: 'language' },
  { id: 'jev_matching', label: '人岗匹配评分', kind: 'evaluation' },
] as const;
export type AiFeatureId = (typeof AI_FEATURES)[number]['id'];

@Injectable()
export class AiFeatureModelsService {
  constructor(
    private readonly config: TwentyConfigService,
    private readonly registry: AiModelRegistryService,
    private readonly providers: ProviderConfigService,
    private readonly factory: SdkProviderFactoryService,
  ) {}

  /** Resolves settings for every new operation; existing job checkpoints retain their generated output. */
  resolve(id: AiFeatureId): string {
    return (
      this.config.get('AI_FEATURE_MODELS')[id] ||
      (id === 'jev_matching'
        ? process.env.RECRUITING_JEV_MODEL_ID ||
          'recruiting-gateway/typesafe-ai/jev'
        : process.env.RECRUITING_MODEL_ID ||
          this.registry.getDefaultModelForTier('smart').modelId)
    );
  }

  list() {
    return {
      features: AI_FEATURES.map((feature) => ({
        ...feature,
        modelId: this.resolve(feature.id),
      })),
      models: this.registry
        .getAllModelsWithStatus()
        .filter((row) => row.isAvailable && row.isAdminEnabled)
        .map((row) => ({
          id: row.modelConfig.modelId,
          label: row.modelConfig.label,
          kind: 'language',
        })),
      evaluationModels: this.registry
        .getAllEvaluationModelsWithStatus()
        .filter((row) => row.isAvailable && row.isAdminEnabled)
        .map((row) => ({
          id: row.modelConfig.modelId,
          label: row.modelConfig.label,
          kind: 'evaluation',
        })),
    };
  }

  jevConfig() {
    const modelId = this.resolve('jev_matching');
    const providerName = modelId.split('/')[0];
    const provider = this.providers.getResolvedProviders()[providerName];
    return {
      modelId,
      providerName,
      baseUrl: provider?.baseUrl ?? '',
      hasApiKey: Boolean(provider?.apiKey),
      inputPricePerMillion:
        this.config.get('RECRUITING_JEV_INPUT_PRICE') ?? null,
    };
  }

  async saveJev(input: unknown) {
    const parsed = z
      .object({
        baseUrl: z.union([z.literal(''), z.url()]),
        apiKey: z.string().min(1).max(4096).optional(),
        inputPricePerMillion: z.number().finite().nonnegative().optional(),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('请填写有效的服务地址和凭据');
    const { providerName } = this.jevConfig();
    const provider = this.providers.getResolvedProviders()[providerName];
    if (!provider) throw new BadRequestException('评分提供方不存在');
    const configured = this.config.get('AI_PROVIDERS');
    await this.config.set('AI_PROVIDERS', {
      ...configured,
      [providerName]: {
        ...provider,
        baseUrl: parsed.data.baseUrl || undefined,
        ...(parsed.data.apiKey ? { apiKey: parsed.data.apiKey } : {}),
      },
    });
    if (parsed.data.inputPricePerMillion !== undefined)
      await this.config.set(
        'RECRUITING_JEV_INPUT_PRICE',
        parsed.data.inputPricePerMillion,
      );
    return this.jevConfig();
  }

  /** Runs a small synthetic score using form values without saving them or touching recruiting records. */
  async testJev(input: unknown) {
    const parsed = z
      .object({
        baseUrl: z.union([z.literal(''), z.url()]),
        apiKey: z.string().min(1).max(4096).optional(),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('请填写有效的服务地址和凭据');
    const { modelId, providerName } = this.jevConfig();
    const provider = this.providers.getResolvedProviders()[providerName];
    if (!provider) throw new BadRequestException('评分提供方不存在');
    const started = performance.now();
    try {
      const connection = this.factory.createTransientProvider({
        ...provider,
        baseUrl: parsed.data.baseUrl || undefined,
        ...(parsed.data.apiKey ? { apiKey: parsed.data.apiKey } : {}),
      });
      const model = connection.createEvaluationModel?.(
        modelId.slice(providerName.length + 1),
      );
      if (!model) throw new Error('unsupported');
      const result = await evaluate({
        model,
        state:
          '合成测试：岗位要求两年 JavaScript 经验。候选人明确拥有两年 JavaScript 开发经验。',
        questions: {
          match: {
            type: 'score',
            instructions: '候选人经验与岗位要求匹配吗？',
            criteria: [
              '完全不匹配',
              '少量匹配',
              '部分匹配',
              '大体匹配',
              '完全匹配',
            ],
          },
        },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(20_000),
      });
      const answer = result.answers.match;
      if (
        answer.type !== 'score' ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > 4
      )
        throw new Error('invalid-score');
      return {
        success: true,
        modelId,
        elapsedMs: Math.round(performance.now() - started),
        score: answer.score,
      };
    } catch {
      throw new BadRequestException(
        'Jev 测试失败，请检查服务地址、API Key 或网络连接',
      );
    }
  }

  /** Rejects arbitrary feature names and incompatible models before changing persistent configuration. */
  async set(id: string, modelId: string) {
    const feature = AI_FEATURES.find((value) => value.id === id);
    if (!feature) throw new BadRequestException('未知的 AI 功能');
    const model =
      feature.kind === 'evaluation'
        ? this.registry.getEvaluationModel(modelId)
        : this.registry.getModel(modelId);
    if (!model || !this.registry.isModelAdminAllowed(modelId))
      throw new BadRequestException('请选择可用且类型匹配的模型');
    await this.config.set('AI_FEATURE_MODELS', {
      ...this.config.get('AI_FEATURE_MODELS'),
      [id]: modelId,
    });
    return this.list();
  }
}
