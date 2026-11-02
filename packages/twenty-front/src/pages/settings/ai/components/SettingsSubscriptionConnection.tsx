/** Completes administrator-owned OAuth and activates only a verified independent subscription connection. */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { subscriptionRequest } from '@/settings/admin-panel/ai/utils/subscriptionRequest';
import { openUrlInNewTab } from '~/utils/openUrlInNewTab';
import {
  StyledSubscriptionPanel,
  StyledSubscriptionRow,
  StyledSubscriptionError,
} from '@/settings/admin-panel/ai/components/subscriptionSettingsStyles';

type Attempt = {
  attemptId: string;
  status: string;
  expiresAt: number;
  connectionId?: string;
  authorizeUrl?: string;
};
type Connection = {
  id: string;
  label: string;
  status: string;
  protocol?: string;
};
type Accounts = {
  connections: Connection[];
  activeConnectionId: string | null;
  pendingAttempt?: Attempt;
};
export const SettingsSubscriptionConnection = ({
  onActivated,
}: {
  onActivated: () => Promise<void>;
}) => {
  const [accounts, setAccounts] = useState<Accounts>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => {
    const data = await subscriptionRequest<Accounts>();
    setAccounts(data);
    return data;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void subscriptionRequest<Accounts>('', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setAccounts(data);
          setAttempt(data.pendingAttempt);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  const activate = useCallback(
    async (id: string) => {
      setBusy(true);
      setError('');
      setNotice(t`正在验证独立账号连接`);
      try {
        await subscriptionRequest(`/${id}/activate`, { method: 'POST' });
        await reload();
        await onActivated();
        setNotice(t`已启用独立账号连接`);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t`连接验证失败`);
        setNotice('');
      } finally {
        setBusy(false);
      }
    },
    [onActivated, reload],
  );
  useEffect(() => {
    if (!attempt || !['PENDING', 'PROCESSING'].includes(attempt.status)) return;
    const controller = new AbortController();
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void subscriptionRequest<Attempt>(`/attempts/${attempt.attemptId}`, {
        signal: controller.signal,
      })
        .then(async (result) => {
          if (controller.signal.aborted) return;
          setAttempt({ ...result, authorizeUrl: attempt.authorizeUrl });
          if (result.status === 'COMPLETED' && result.connectionId)
            await activate(result.connectionId);
          else if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(result.status))
            setError(t`授权未完成，请重新连接`);
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message);
        })
        .finally(() => {
          polling = false;
        });
    }, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [attempt, activate]);
  const start = async (connectionId?: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await subscriptionRequest<Attempt>('/authorize', {
        method: 'POST',
        body: JSON.stringify({ protocol: 'codex', connectionId }),
      });
      setAttempt({ ...next, status: 'PENDING' });
      if (next.authorizeUrl) openUrlInNewTab(next.authorizeUrl);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`连接失败`);
    } finally {
      setBusy(false);
    }
  };
  const pending = Boolean(
    attempt && ['PENDING', 'PROCESSING'].includes(attempt.status),
  );
  return (
    <StyledSubscriptionPanel>
      <StyledSubscriptionRow>
        <strong>{t`ChatGPT 账号`}</strong>
        {!pending && (
          <Button disabled={busy} onClick={() => void start()}>
            {accounts?.activeConnectionId ? t`切换账号` : t`连接 ChatGPT`}
          </Button>
        )}
      </StyledSubscriptionRow>
      {error && (
        <StyledSubscriptionError role="alert">{error}</StyledSubscriptionError>
      )}
      {notice && <div role="status">{notice}</div>}
      {pending && (
        <StyledSubscriptionRow>
          <span>
            {attempt?.status === 'PROCESSING'
              ? t`正在验证新账号`
              : t`等待新账号授权`}
          </span>
          {attempt?.authorizeUrl && (
            <Button
              onClick={() => openUrlInNewTab(attempt.authorizeUrl!)}
            >{t`打开授权页面`}</Button>
          )}
          <Button
            disabled={attempt?.status === 'PROCESSING'}
            onClick={() => {
              void subscriptionRequest<Attempt>(
                `/attempts/${attempt!.attemptId}/cancel`,
                { method: 'POST' },
              )
                .then(setAttempt)
                .catch((failure) => setError(failure.message));
            }}
          >{t`取消`}</Button>
        </StyledSubscriptionRow>
      )}
      {pending && accounts?.activeConnectionId && (
        <span>{t`新授权完成前，继续使用当前账号。`}</span>
      )}
      {!pending &&
        accounts?.connections
          .filter((account) => account.protocol === 'codex')
          .map((account) => (
            <StyledSubscriptionRow key={account.id}>
              <span>{account.label}</span>
              <span>
                {accounts.activeConnectionId === account.id
                  ? t`当前使用`
                  : account.status === 'READY'
                    ? t`已授权`
                    : t`需要重新连接`}
              </span>
              {account.status === 'READY' &&
                accounts.activeConnectionId !== account.id && (
                  <Button
                    disabled={busy}
                    onClick={() => void activate(account.id)}
                  >{t`验证并启用`}</Button>
                )}
              <Button
                disabled={busy || pending}
                onClick={() => void start(account.id)}
              >{t`重新连接`}</Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void subscriptionRequest(`/${account.id}/disconnect`, {
                    method: 'POST',
                  })
                    .then(() => reload())
                    .catch((failure) => setError(failure.message))
                    .finally(() => setBusy(false));
                }}
              >{t`断开`}</Button>
            </StyledSubscriptionRow>
          ))}
    </StyledSubscriptionPanel>
  );
};
