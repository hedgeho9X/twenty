/** Gives native mailbox owners explicit capture choices and a read-only single-message check. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { IconRefresh } from 'twenty-ui/icon';
import { Button, Checkbox, Field } from 'twenty-ui/primitives/input';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingTitle,
} from '@/recruiting/shared/styles';

/** Connection summaries contain no passwords, tokens or mail-server parameters. */
type Mailboxes = {
  nativeIntegrationEnabled: boolean;
  connections: {
    connectedAccountId: string;
    handle: string;
    enabled: boolean;
    autoSubmit: boolean;
    lastPollAt?: string;
    lastPollError?: string;
  }[];
};

/** An explicit owner opt-in checks future INBOX receipts without historical synchronization or sending mail. */
export const RecruitingMailboxSettings = ({ active }: { active: boolean }) => {
  const query = useRecruitingQuery<Mailboxes>('mailboxes', 0, active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const configure = async (
    connection: Mailboxes['connections'][number],
    patch: { enabled?: boolean; autoSubmit?: boolean },
  ) => {
    setBusy(true);
    setError('');
    try {
      await recruitingRequest('mailboxes/configure', {
        method: 'POST',
        body: JSON.stringify({
          connectedAccountId: connection.connectedAccountId,
          enabled: patch.enabled ?? connection.enabled,
          autoSubmit: patch.autoSubmit ?? connection.autoSubmit,
        }),
      });
      await query.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`邮箱设置未保存`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingRow>
        <StyledRecruitingTitle>{t`招聘邮件接收`}</StyledRecruitingTitle>
        <Button
          disabled={busy}
          variant="ghost"
          aria-label={t`刷新连接`}
          onClick={() => {
            void query.reload();
          }}
        >
          <IconRefresh size={16} />
        </Button>
      </StyledRecruitingRow>
      {!query.loading && !query.error && !query.data?.connections.length && (
        <StyledRecruitingMuted>{t`请先添加邮箱账号。`}</StyledRecruitingMuted>
      )}
      {query.data && !query.data.nativeIntegrationEnabled && (
        <StyledRecruitingMuted>{t`邮箱接入未启用。`}</StyledRecruitingMuted>
      )}
      {query.data?.connections.map((connection) => (
        <StyledRecruitingPanel key={connection.connectedAccountId}>
          <strong>{connection.handle}</strong>
          <Field.Root>
            <Field.Item>
              <Checkbox
                checked={connection.enabled}
                disabled={
                  busy ||
                  (!query.data?.nativeIntegrationEnabled && !connection.enabled)
                }
                onCheckedChange={(checked) => {
                  void configure(connection, { enabled: checked === true });
                }}
              />
              <Field.Label>{t`自动接收并解析新邮件`}</Field.Label>
            </Field.Item>
          </Field.Root>
          {connection.lastPollAt && (
            <StyledRecruitingMuted>
              {t`最近检查：`}
              {new Date(connection.lastPollAt).toLocaleString()}
            </StyledRecruitingMuted>
          )}
          {connection.lastPollError && (
            <StyledRecruitingError role="alert">
              {connection.lastPollError}
            </StyledRecruitingError>
          )}
        </StyledRecruitingPanel>
      ))}
      {(error || query.error) && (
        <StyledRecruitingError role="alert">
          {error || query.error}
        </StyledRecruitingError>
      )}
    </StyledRecruitingPanel>
  );
};
