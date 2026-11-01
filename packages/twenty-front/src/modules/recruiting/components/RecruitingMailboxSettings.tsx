/** Gives native mailbox owners explicit capture choices and a read-only single-message check. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Checkbox, Field } from 'twenty-ui/primitives/input';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import { type RecruitingMailArchive } from '@/recruiting/types/RecruitingMailArchive';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingTitle,
} from '@/recruiting/components/recruitingStyles';

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
export const RecruitingMailboxSettings = ({
  active,
  onReceived,
}: {
  active: boolean;
  onReceived: (archiveId: string) => void;
}) => {
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
  const receive = async (connectedAccountId: string) => {
    setBusy(true);
    setError('');
    try {
      const mail = await recruitingRequest<RecruitingMailArchive>(
        'mailboxes/receive-latest',
        { method: 'POST', body: JSON.stringify({ connectedAccountId }) },
      );
      onReceived(mail.archiveId);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t`最新邮件尚未读取，请检查连接`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingRow>
        <StyledRecruitingTitle>{t`本人邮箱连接`}</StyledRecruitingTitle>
        <Button
          disabled={busy}
          onClick={() => {
            void query.reload();
          }}
        >{t`刷新连接`}</Button>
      </StyledRecruitingRow>
      <StyledRecruitingMuted>{t`沿用个人设置中的IMAP连接。可以先只读最新一封核对材料，不改变已读状态、文件夹、历史游标或后台同步。`}</StyledRecruitingMuted>
      {!query.loading && !query.error && !query.data?.connections.length && (
        <StyledRecruitingMuted>{t`当前用户没有可用的IMAP连接。请先在个人设置中连接本人邮箱，或导入完整EML验证材料流程。`}</StyledRecruitingMuted>
      )}
      {query.data && !query.data.nativeIntegrationEnabled && (
        <StyledRecruitingMuted>{t`邮箱连接功能尚未由管理员启用，完整EML导入仍可使用。`}</StyledRecruitingMuted>
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
              <Field.Label>{t`自动接收新邮件为招聘材料`}</Field.Label>
            </Field.Item>
            <Field.Description>{t`开启时记录邮箱当前位置，之后约每分钟只读检查INBOX的新邮件，不处理此前历史邮件。`}</Field.Description>
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
          <StyledRecruitingMuted>{t`新来信默认按候选人材料处理，正文和全部附件自动进入解析队列。`}</StyledRecruitingMuted>
          <Button
            loading={busy}
            disabled={!query.data?.nativeIntegrationEnabled}
            onClick={() => {
              void receive(connection.connectedAccountId);
            }}
          >{t`只读最新一封并查看归档`}</Button>
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
