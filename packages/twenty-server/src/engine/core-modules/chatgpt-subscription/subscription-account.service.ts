import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { SiwcStoreService } from './siwc-store.service';
import {
  createSubscriptionFetch,
  createSubscriptionTransport,
  type SubscriptionCredential,
} from './subscription-fetch';
/** Reads the account's own quota and model catalog without exposing credentials or modifying upstream usage. */
import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const windowSchema = z.object({
  used_percent: z.number().min(0).max(100),
  limit_window_seconds: z.number().positive(),
  reset_at: z.number().optional(),
});
const usageSchema = z.object({
  plan_type: z.string().optional(),
  rate_limit: z
    .object({
      primary_window: windowSchema.nullish(),
      secondary_window: windowSchema.nullish(),
    })
    .nullish(),
});
const catalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string().min(1),
      display_name: z.string().optional(),
      input_modalities: z.array(z.string()).optional(),
      visibility: z.string().optional(),
      supported_in_api: z.boolean().optional(),
      context_window: z.number().int().positive().optional(),
    }),
  ),
});

@Injectable()
export class SubscriptionAccountService {
  constructor(
    private readonly config: TwentyConfigService,
    private readonly store: SiwcStoreService,
  ) {}

  activeConnectionId() {
    return (
      Object.values(this.config.get('AI_PROVIDERS')).find(
        (provider) =>
          provider.authType === 'chatgpt' && provider.subscriptionConnectionId,
      )?.subscriptionConnectionId ?? null
    );
  }

  /** Pins requests to the Codex account bound to the active provider, preventing silent account switches. */
  private async request(path: string, selected?: SubscriptionCredential) {
    const providers = this.config.get('AI_PROVIDERS');
    const bindings = Object.values(providers).filter(
      (provider) => provider.authType === 'chatgpt',
    );
    const binding =
      bindings.find((provider) => provider.subscriptionConnectionId) ??
      bindings[0];
    if (!selected && !binding?.subscriptionConnectionId)
      throw new BadRequestException('请先连接并启用 ChatGPT 账号');
    const credential =
      selected ??
      (await this.store.credential(binding!.subscriptionConnectionId!));
    if (credential.protocol !== 'codex')
      throw new BadRequestException('此连接不支持 Codex 额度查询');
    const transport = createSubscriptionTransport(
      process.env.RECRUITING_MODEL_PROXY_URL,
    );
    const url = new URL(`https://chatgpt.com/backend-api/${path}`);
    if (path === 'codex/models')
      url.searchParams.set(
        'client_version',
        credential.clientVersion ?? '0.144.1',
      );
    const response = await transport(url.toString(), {
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        'ChatGPT-Account-Id': credential.accountId ?? '',
        'User-Agent': `codex_cli_rs/${credential.clientVersion ?? '0.144.1'}`,
        originator: 'codex_cli_rs',
      },
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new BadRequestException('订阅信息暂不可用，请检查账号连接后刷新');
    return { body: await response.json(), credential };
  }

  async usage() {
    const { body } = await this.request('wham/usage');
    const parsed = usageSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('订阅额度返回格式已变化');
    const windows = [
      parsed.data.rate_limit?.primary_window,
      parsed.data.rate_limit?.secondary_window,
    ].flatMap((window) =>
      window
        ? [
            {
              remainingPercent:
                Math.round((100 - window.used_percent) * 10) / 10,
              windowSeconds: window.limit_window_seconds,
              resetsAt: window.reset_at
                ? new Date(window.reset_at * 1000).toISOString()
                : null,
            },
          ]
        : [],
    );
    return {
      plan: parsed.data.plan_type,
      windows,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Explicit catalog refresh adds usable models without changing selected feature models. */
  async syncModels(selected?: SubscriptionCredential, connectionId?: string) {
    const { body, credential } = await this.request('codex/models', selected);
    const parsed = catalogSchema.safeParse(body);
    if (!parsed.success || !parsed.data.models.length)
      throw new BadRequestException('未获取到可用模型');
    const models = parsed.data.models.filter(
      (model) =>
        model.visibility !== 'hide' && model.supported_in_api !== false,
    );
    if (!models.length) throw new BadRequestException('当前账号没有可选模型');
    const providers = this.config.get('AI_PROVIDERS');
    const name =
      Object.entries(providers).find(
        ([, provider]) => provider.authType === 'chatgpt',
      )?.[0] ?? 'chatgpt-subscription';
    const previous = providers[name];
    await this.config.set('AI_PROVIDERS', {
      ...providers,
      [name]: {
        ...previous,
        npm: '@ai-sdk/openai',
        authType: 'chatgpt',
        subscriptionAccountId:
          connectionId || previous?.subscriptionConnectionId
            ? undefined
            : credential.accountId,
        ...(connectionId ? { subscriptionConnectionId: connectionId } : {}),
        label: 'ChatGPT 订阅',
        models: models.map((model) => ({
          ...previous?.models?.find((existing) => existing.name === model.slug),
          name: model.slug,
          label: model.display_name ?? model.slug,
          ...(model.context_window
            ? { contextWindowTokens: model.context_window }
            : {}),
          modalities: model.input_modalities?.includes('image')
            ? ['text', 'image']
            : ['text'],
        })),
      },
    });
    return { count: models.length };
  }
  /** Activates a connection only after its own credential can discover models and produce structured output. */
  async activate(id: string) {
    const credential = await this.store.credential(id, true);
    const { body } = await this.request('codex/models', credential);
    const catalog = catalogSchema
      .parse(body)
      .models.filter(
        (model) =>
          model.visibility !== 'hide' && model.supported_in_api !== false,
      );
    const modelId =
      catalog.find((model) => model.slug === 'gpt-6.1-sol')?.slug ??
      catalog[0]?.slug;
    if (!modelId) throw new BadRequestException('此账号没有可用模型');
    const provider = createOpenAI({
      apiKey: 'managed-subscription',
      fetch: createSubscriptionFetch({
        loadCredential: () => this.store.credential(id),
        upstreamFetch: createSubscriptionTransport(
          process.env.RECRUITING_MODEL_PROXY_URL,
        ),
      }),
    });
    try {
      const result = await generateText({
        model: provider.responses(modelId),
        output: Output.object({ schema: z.object({ ok: z.boolean() }) }),
        prompt:
          'This is a connection test. Return an object with ok set to true.',
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(45_000),
      });
      if (result.output?.ok !== true) throw new Error('invalid');
    } catch {
      throw new BadRequestException('独立账号推理验证未通过，原连接保留');
    }
    const result = await this.syncModels(credential, id);
    return {
      ...result,
      activeConnectionId: id,
      verifiedModel: modelId,
      refreshVerified: true,
    };
  }
}
