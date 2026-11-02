import { SettingsBriefTemplates } from './SettingsBriefTemplates';
import { SettingsSubscriptionConnection } from './SettingsSubscriptionConnection';
import { useClientConfig } from '@/client-config/hooks/useClientConfig';
import { TextInput } from '@/ui/input/components/TextInput';
/** Configures registered business features and shows account-reported quota without exposing credentials. */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Section } from 'twenty-ui/components/layout';
import { Button } from 'twenty-ui/primitives/input';
import { Select } from '@/ui/input/components/Select';
import { subscriptionRequest } from '@/settings/admin-panel/ai/utils/subscriptionRequest';
import {
  StyledSubscriptionError,
  StyledSubscriptionMuted,
  StyledSubscriptionPanel,
  StyledSubscriptionRow,
  StyledSubscriptionStack,
} from '@/settings/admin-panel/ai/components/subscriptionSettingsStyles';

type FeatureConfig = {
  features: { id: string; label: string; kind: string; modelId: string }[];
  models: { id: string; label: string }[];
  evaluationModels: { id: string; label: string }[];
};
type Quota = {
  plan?: string;
  fetchedAt: string;
  windows: {
    remainingPercent: number;
    windowSeconds: number;
    resetsAt: string | null;
  }[];
};
type JevConfig = {
  modelId: string;
  providerName: string;
  baseUrl: string;
  hasApiKey: boolean;
  inputPricePerMillion: number | null;
};

/** A provider refresh discovers models; only explicit feature selection changes running application configuration. */
export const SettingsRecruitingAiTab = ({
  kind,
}: {
  kind: 'subscription' | 'jev';
}) => {
  const { refetch: refreshClientConfig } = useClientConfig();
  const [config, setConfig] = useState<FeatureConfig>();
  const [quota, setQuota] = useState<Quota>();
  const [quotaError, setQuotaError] = useState('');
  const [jev, setJev] = useState<JevConfig>();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const loadQuota = useCallback(async (signal?: AbortSignal) => {
    setQuotaError('');
    try {
      const result = await subscriptionRequest<Quota>('/usage', {
        signal,
      });
      if (!signal?.aborted) setQuota(result);
    } catch (failure) {
      if (!signal?.aborted) {
        setQuota(undefined);
        setQuotaError(
          failure instanceof Error ? failure.message : t`额度暂不可用`,
        );
      }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void subscriptionRequest<FeatureConfig>('/features', {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setConfig(result);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    if (kind === 'subscription') void loadQuota(controller.signal);
    else
      void subscriptionRequest<JevConfig>('/jev', { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) {
            setJev(result);
            setBaseUrl(result.baseUrl);
            setPrice(
              result.inputPricePerMillion == null
                ? ''
                : String(result.inputPricePerMillion),
            );
          }
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message);
        });
    return () => controller.abort();
  }, [kind, loadQuota]);
  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`保存失败`);
    } finally {
      setBusy(false);
    }
  };
  const features =
    config?.features.filter(
      (feature) => kind === 'subscription' && feature.kind === 'language',
    ) ?? [];
  const models = kind === 'jev' ? config?.evaluationModels : config?.models;
  return (
    <Section.Root>
      <Section.Header
        title={kind === 'jev' ? t`Jev 评分配置` : t`ChatGPT 订阅与功能模型`}
      />
      <StyledSubscriptionStack>
        {error && (
          <StyledSubscriptionError role="alert">
            {error}
          </StyledSubscriptionError>
        )}
        {notice && <div role="status">{notice}</div>}
        {kind === 'subscription' && (
          <SettingsSubscriptionConnection
            onActivated={async () => {
              setConfig(await subscriptionRequest<FeatureConfig>('/features'));
              await loadQuota();
              await refreshClientConfig();
            }}
          />
        )}
        {kind === 'subscription' && (
          <StyledSubscriptionPanel>
            <StyledSubscriptionRow>
              <strong>
                {quota?.plan ? `ChatGPT ${quota.plan}` : t`当前 ChatGPT 账号`}
              </strong>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void loadQuota()}
              >{t`刷新额度`}</Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void execute(async () => {
                    const result = await subscriptionRequest<{ count: number }>(
                      '/models/sync',
                      { method: 'POST' },
                    );
                    setConfig(
                      await subscriptionRequest<FeatureConfig>('/features'),
                    );
                    await refreshClientConfig();
                    setNotice(t`已同步 ${result.count} 个可用模型`);
                  })
                }
              >{t`同步可用模型`}</Button>
            </StyledSubscriptionRow>
            {quotaError && (
              <StyledSubscriptionMuted>{quotaError}</StyledSubscriptionMuted>
            )}
            {quota?.windows.map((window) => (
              <div key={window.windowSeconds}>
                <StyledSubscriptionRow>
                  <span>
                    {t`额度窗口`} · {window.windowSeconds / 3600}
                    {t`小时`}
                  </span>
                  <strong>
                    {t`剩余`} {window.remainingPercent}%
                  </strong>
                </StyledSubscriptionRow>
                <progress
                  aria-label={`${window.windowSeconds / 3600} 小时剩余额度`}
                  value={window.remainingPercent}
                  max={100}
                  style={{ width: '100%' }}
                />
                {window.resetsAt && (
                  <StyledSubscriptionMuted>
                    {t`重置时间`} · {new Date(window.resetsAt).toLocaleString()}
                  </StyledSubscriptionMuted>
                )}
              </div>
            ))}
            {quota && !quota.windows.length && (
              <StyledSubscriptionMuted>{t`上游未返回额度窗口`}</StyledSubscriptionMuted>
            )}
          </StyledSubscriptionPanel>
        )}
        {kind === 'subscription' && <SettingsBriefTemplates />}
        {features.map((feature) => (
          <StyledSubscriptionPanel key={feature.id}>
            <strong>{feature.label}</strong>
            <Select
              dropdownId={`feature-${feature.id}`}
              value={feature.modelId}
              options={(models ?? []).map((model) => ({
                value: model.id,
                label: model.label || model.id,
              }))}
              disabled={busy}
              onChange={(modelId) =>
                void execute(async () => {
                  setConfig(
                    await subscriptionRequest<FeatureConfig>(
                      `/features/${feature.id}`,
                      {
                        method: 'POST',
                        body: JSON.stringify({ modelId }),
                      },
                    ),
                  );
                  if (kind === 'jev') {
                    const next = await subscriptionRequest<JevConfig>('/jev');
                    setJev(next);
                    setBaseUrl(next.baseUrl);
                  }
                  setNotice(t`已保存，新任务将使用所选模型`);
                })
              }
            />
          </StyledSubscriptionPanel>
        ))}
        {kind === 'jev' && jev && (
          <StyledSubscriptionPanel>
            <label>
              {t`服务地址`}
              <TextInput
                aria-label={t`服务地址`}
                value={baseUrl}
                onChange={setBaseUrl}
                style={{
                  display: 'block',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </label>
            <label>
              API Key
              <TextInput
                aria-label="Jev API Key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                placeholder={jev.hasApiKey ? t`已配置，留空保留` : t`未配置`}
                onChange={setApiKey}
                style={{
                  display: 'block',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </label>
            <label>
              输入价格（美元 / 百万 Token）
              <TextInput
                type="number"
                min={0}
                step="any"
                value={price}
                onChange={setPrice}
              />
            </label>
            <StyledSubscriptionRow>
              <Button
                disabled={busy}
                onClick={() =>
                  void execute(async () => {
                    const result = await subscriptionRequest<{
                      elapsedMs: number;
                    }>('/jev/test', {
                      method: 'POST',
                      body: JSON.stringify({
                        baseUrl,
                        ...(apiKey ? { apiKey } : {}),
                      }),
                    });
                    setNotice(t`Jev 测试成功，耗时 ${result.elapsedMs} ms`);
                  })
                }
              >{t`测试连接`}</Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void execute(async () => {
                    setJev(
                      await subscriptionRequest<JevConfig>('/jev', {
                        method: 'POST',
                        body: JSON.stringify({
                          baseUrl,
                          ...(price.trim()
                            ? { inputPricePerMillion: Number(price) }
                            : {}),
                          ...(apiKey ? { apiKey } : {}),
                        }),
                      }),
                    );
                    setApiKey('');
                    setNotice(t`Jev 配置已保存`);
                  })
                }
              >{t`保存连接`}</Button>
            </StyledSubscriptionRow>
          </StyledSubscriptionPanel>
        )}
      </StyledSubscriptionStack>
    </Section.Root>
  );
};
