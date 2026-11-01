/** Reads the account's own quota and model catalog without exposing credentials or modifying upstream usage. */
import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { loadLocalCodexCredential } from './local-codex-credential';
import { createSubscriptionTransport } from './subscription-fetch';

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
  constructor(private readonly config: TwentyConfigService) {}

  /** Pins requests to the Codex account bound to the active provider, preventing silent account switches. */
  private async request(path: string) {
    const providers = this.config.get('AI_PROVIDERS');
    const binding = Object.values(providers).find(
      (provider) =>
        provider.authType === 'chatgpt' && !provider.subscriptionConnectionId,
    );
    const credential = await loadLocalCodexCredential(
      binding?.subscriptionAccountId,
    );
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
    return { body: await response.json(), accountId: credential.accountId };
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
  async syncModels() {
    const { body, accountId } = await this.request('codex/models');
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
        ([, provider]) =>
          provider.authType === 'chatgpt' && !provider.subscriptionConnectionId,
      )?.[0] ?? 'chatgpt-subscription';
    const previous = providers[name];
    await this.config.set('AI_PROVIDERS', {
      ...providers,
      [name]: {
        ...previous,
        npm: '@ai-sdk/openai',
        authType: 'chatgpt',
        subscriptionAccountId: accountId,
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
}
