/** Manages explicit ChatGPT authorization and adds selected account models through the official provider settings. */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Checkbox } from 'twenty-ui/primitives/input';
import { Section } from 'twenty-ui/components/layout';
import { Select } from '@/ui/input/components/Select';
import { useApolloAdminClient } from '@/settings/admin-panel/apollo/hooks/useApolloAdminClient';
import { ADD_AI_PROVIDER } from '@/settings/admin-panel/ai/graphql/mutations/addAiProvider';
import { ADD_MODEL_TO_PROVIDER } from '@/settings/admin-panel/ai/graphql/mutations/addModelToProvider';
import { GET_AI_PROVIDERS } from '@/settings/admin-panel/ai/graphql/queries/getAiProviders';
import { GET_ADMIN_AI_MODELS } from '@/settings/admin-panel/ai/graphql/queries/getAdminAiModels';
import { type RawAiProviderConfig } from '@/settings/admin-panel/ai/types/RawAiProviderConfig';
import { subscriptionRequest } from '@/settings/admin-panel/ai/utils/subscriptionRequest';
import { type AdminAiModelConfig } from '~/generated-admin/graphql';
import { openUrlInNewTab } from '~/utils/openUrlInNewTab';
import {
  StyledSubscriptionError,
  StyledSubscriptionMuted,
  StyledSubscriptionPanel,
  StyledSubscriptionRow,
  StyledSubscriptionStack,
  StyledSubscriptionTable,
} from './subscriptionSettingsStyles';

/** Management state has labels and opaque connection IDs, never access, refresh or ID tokens. */
type Connection = {
  id: string;
  label: string;
  status: string;
  expiresAt: number;
  canRefresh: boolean;
};
type Accounts = {
  connections: Connection[];
  pendingAttempt?: Attempt & { authorizeUrl?: string };
};
type Attempt = {
  attemptId: string;
  status: string;
  expiresAt: number;
  connectionId?: string;
};
const statusLabel = (status: string) =>
  ({
    READY: t`已授权`,
    SIGNED_OUT: t`已断开`,
    NEEDS_AUTH: t`需要重新授权`,
    MISSING_PLAN_PERMISSION: t`缺少订阅使用授权`,
  })[status] ?? status;

/** Merely viewing settings never starts OAuth, switches account defaults, refreshes Codex or opens another tab. */
export const SettingsChatgptSubscriptions = ({
  providers,
  models,
  canAddProvider,
}: {
  providers: Record<string, RawAiProviderConfig>;
  models: AdminAiModelConfig[];
  canAddProvider: boolean;
}) => {
  const admin = useApolloAdminClient();
  const [accounts, setAccounts] = useState<Accounts>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [link, setLink] = useState('');
  const [selected, setSelected] = useState('');
  const [catalog, setCatalog] = useState<{ id: string; label: string }[]>([]);
  const [catalogAccountId, setCatalogAccountId] = useState('');
  const [model, setModel] = useState('');
  const [image, setImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => {
    const value = await subscriptionRequest<Accounts>();
    setAccounts(value);
    if (value.pendingAttempt) {
      setAttempt(value.pendingAttempt);
      setLink(value.pendingAttempt.authorizeUrl ?? '');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void subscriptionRequest<Accounts>('', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setAccounts(value);
          if (value.pendingAttempt) {
            setAttempt(value.pendingAttempt);
            setLink(value.pendingAttempt.authorizeUrl ?? '');
          }
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!attempt || !['PENDING', 'PROCESSING'].includes(attempt.status)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void subscriptionRequest<Attempt>(`/attempts/${attempt.attemptId}`, {
        signal: controller.signal,
      })
        .then(async (value) => {
          if (controller.signal.aborted) return;
          setAttempt(value);
          if (value.status === 'COMPLETED') {
            setLink('');
            setNotice(t`授权流程已完成，请选择账号并加载模型。`);
            if (value.connectionId) {
              setSelected(value.connectionId);
              setCatalog([]);
              setCatalogAccountId('');
              setModel('');
            }
            await reload();
          } else if (
            ['FAILED', 'EXPIRED', 'CANCELLED'].includes(value.status)
          ) {
            setLink('');
            setNotice(t`授权未完成，可重新发起。已有模型连接保留。`);
          }
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message);
        });
    }, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [attempt, reload]);
  /** Keeps recoverable form selections and a clear error when a native management call fails. */
  const execute = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`操作未完成`);
    } finally {
      setBusy(false);
    }
  };
  /** Opens only after an explicit click; a blocked popup leaves a second explicit authorization link. */
  const authorize = (connectionId?: string) => {
    void execute(async () => {
      const value = await subscriptionRequest<
        Attempt & { authorizeUrl: string }
      >('/authorize', {
        method: 'POST',
        body: JSON.stringify({ connectionId }),
      });
      if (new URL(value.authorizeUrl).origin !== 'https://auth.openai.com')
        throw new Error(t`授权地址不可用`);
      setAttempt({ ...value, status: 'PENDING' });
      setLink(value.authorizeUrl);
      openUrlInNewTab(value.authorizeUrl);
    });
  };
  /** Appends a model without overwriting other models or changing any default automatically. */
  const addModel = () =>
    execute(async () => {
      const account = accounts?.connections.find((row) => row.id === selected);
      const picked = catalog.find((row) => row.id === model);
      if (
        !account ||
        account.status !== 'READY' ||
        !picked ||
        catalogAccountId !== selected
      )
        throw new Error(t`请选择已授权账号及模型`);
      const providerName = `chatgpt-${account.id}`;
      if (
        models.some((row) => row.modelId === `${providerName}/${picked.id}`)
      ) {
        setNotice(t`模型已存在，可在下方默认模型区域选择。`);
        return;
      }
      const modelConfig = {
        name: picked.id,
        label: picked.label,
        modalities: image ? ['text', 'image'] : ['text'],
        inputCostPerMillionTokens: 0,
        outputCostPerMillionTokens: 0,
      };
      if (Object.hasOwn(providers, providerName)) {
        if (providers[providerName].subscriptionConnectionId !== account.id)
          throw new Error(t`提供方连接不一致，请刷新设置后核对`);
        await admin.mutate({
          mutation: ADD_MODEL_TO_PROVIDER,
          variables: { providerName, modelConfig },
          refetchQueries: [
            { query: GET_AI_PROVIDERS },
            { query: GET_ADMIN_AI_MODELS },
          ],
        });
      } else
        await admin.mutate({
          mutation: ADD_AI_PROVIDER,
          variables: {
            providerName,
            providerConfig: {
              npm: '@ai-sdk/openai',
              authType: 'chatgpt',
              subscriptionConnectionId: account.id,
              label: account.label,
              models: [modelConfig],
            },
          },
          refetchQueries: [
            { query: GET_AI_PROVIDERS },
            { query: GET_ADMIN_AI_MODELS },
          ],
        });
      setNotice(t`模型已添加。请在下方选择默认模型，或在Agent设置中指定。`);
    });
  const pending = attempt && ['PENDING', 'PROCESSING'].includes(attempt.status);
  return (
    <Section.Root>
      <Section.Header
        title={t`ChatGPT订阅`}
        description={t`在Twenty内连接账号，模型调用使用该账号订阅额度；Jev及Embedding仍使用各自配置。`}
      />
      <StyledSubscriptionStack>
        <StyledSubscriptionPanel>
          <StyledSubscriptionMuted>
            {t`账号连接请在设置 → AI → 订阅与功能中管理。`}
          </StyledSubscriptionMuted>
          {error && (
            <StyledSubscriptionError role="alert">
              {error}
            </StyledSubscriptionError>
          )}
          {notice && <div role="status">{notice}</div>}
          <StyledSubscriptionRow>
            <Button
              disabled={busy || Boolean(pending)}
              onClick={() => authorize()}
              data-oai-siwc-button
            >
              Continue with ChatGPT
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void execute(reload);
              }}
            >{t`刷新账号`}</Button>
          </StyledSubscriptionRow>
          {pending && (
            <StyledSubscriptionRow>
              <span>
                {attempt.status === 'PROCESSING'
                  ? t`正在校验授权`
                  : t`等待本人授权`}{' '}
                · {t`有效至`} {new Date(attempt.expiresAt).toLocaleTimeString()}
              </span>
              <Button
                disabled={busy || attempt.status === 'PROCESSING'}
                onClick={() => {
                  void execute(async () => {
                    setAttempt(
                      await subscriptionRequest<Attempt>(
                        `/attempts/${attempt.attemptId}/cancel`,
                        { method: 'POST' },
                      ),
                    );
                    setLink('');
                  });
                }}
              >{t`取消本次授权`}</Button>
            </StyledSubscriptionRow>
          )}
          {link && pending && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              data-oai-siwc-button
            >{t`打开授权页面`}</a>
          )}
          <StyledSubscriptionTable>
            <thead>
              <tr>
                <th>{t`账号`}</th>
                <th>{t`状态`}</th>
                <th>{t`续期`}</th>
                <th>{t`操作`}</th>
              </tr>
            </thead>
            <tbody>
              {accounts?.connections.map((account) => (
                <tr key={account.id}>
                  <td>{account.label}</td>
                  <td>{statusLabel(account.status)}</td>
                  <td>
                    {account.canRefresh ? t`支持自动续期` : t`需本人重新授权`}
                  </td>
                  <td>
                    <StyledSubscriptionRow>
                      <Button
                        disabled={busy || Boolean(pending)}
                        onClick={() => authorize(account.id)}
                      >{t`重新授权`}</Button>
                      <Button
                        disabled={busy || account.status === 'SIGNED_OUT'}
                        onClick={() => {
                          void execute(async () => {
                            const value = await subscriptionRequest<{
                              remoteRevocationConfirmed: boolean | null;
                            }>(`/${account.id}/disconnect`, { method: 'POST' });
                            await reload();
                            setCatalog([]);
                            setModel('');
                            setNotice(
                              value.remoteRevocationConfirmed === false
                                ? t`本地已断开，上游撤销未确认；可在ChatGPT设置中断开此应用。`
                                : t`账号已断开。`,
                            );
                          });
                        }}
                      >{t`断开`}</Button>
                    </StyledSubscriptionRow>
                  </td>
                </tr>
              ))}
            </tbody>
          </StyledSubscriptionTable>
          {!accounts?.connections.length && (
            <StyledSubscriptionMuted>{t`还没有在Twenty中完成的新授权。`}</StyledSubscriptionMuted>
          )}
        </StyledSubscriptionPanel>
        {accounts &&
          accounts.connections.some(
            (account) => account.status === 'READY',
          ) && (
            <StyledSubscriptionPanel>
              <Select
                dropdownId="chatgpt-subscription-account"
                label={t`选择订阅账号`}
                fullWidth
                value={selected}
                options={[
                  { value: '', label: t`请选择账号` },
                  ...accounts.connections
                    .filter((account) => account.status === 'READY')
                    .map((account) => ({
                      value: account.id,
                      label: account.label,
                    })),
                ]}
                onChange={(value) => {
                  setSelected(value);
                  setCatalog([]);
                  setModel('');
                  setImage(false);
                }}
                disabled={busy}
              />
              <Button
                disabled={busy || !selected}
                onClick={() => {
                  void execute(async () => {
                    const values = await subscriptionRequest<
                      { id: string; label: string }[]
                    >(`/${selected}/models`);
                    setCatalog(values);
                    setCatalogAccountId(selected);
                    setModel('');
                  });
                }}
              >{t`加载账号可用模型`}</Button>
              {catalog.length > 0 && catalogAccountId === selected && (
                <>
                  <Select
                    dropdownId="chatgpt-subscription-model"
                    label={t`模型`}
                    fullWidth
                    value={model}
                    options={[
                      { value: '', label: t`请选择模型` },
                      ...catalog.map((row) => ({
                        value: row.id,
                        label: row.label,
                      })),
                    ]}
                    onChange={setModel}
                    disabled={busy}
                  />
                  <label>
                    <Checkbox
                      checked={image}
                      onCheckedChange={(value) => setImage(value === true)}
                    />
                    <span>{t`该模型支持图片输入（确认能力后启用）`}</span>
                  </label>
                  <Button
                    disabled={busy || !model || !canAddProvider}
                    onClick={() => {
                      void addModel();
                    }}
                  >{t`添加到官方模型配置`}</Button>
                </>
              )}
            </StyledSubscriptionPanel>
          )}
      </StyledSubscriptionStack>
    </Section.Root>
  );
};
