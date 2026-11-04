/** Gives native mailbox owners explicit capture choices and a read-only single-message check. */
import { ResultPagination } from '@/recruiting/shared/components/ResultPagination';
import { Skeleton } from '@/recruiting/shadcn/ui/skeleton';
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { IconRefresh } from 'twenty-ui/icon';
import { Button, Checkbox, Field } from '@/recruiting/shadcn/compat';
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
  count: number;
  hasNextPage: boolean;
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const query = useRecruitingQuery<Mailboxes>(
    `mailboxes?offset=${(page - 1) * pageSize}&limit=${pageSize}`,
    0,
    active,
  );
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
      {query.loading && (
        <div role="status" aria-label="正在加载邮箱连接">
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {!query.loading && !query.error && !query.data?.connections.length && (
        <StyledRecruitingMuted>{t`请先添加邮箱账号。`}</StyledRecruitingMuted>
      )}
      {query.data && !query.data.nativeIntegrationEnabled && (
        <StyledRecruitingMuted>{t`邮箱接入未启用。`}</StyledRecruitingMuted>
      )}
      {!query.loading &&
        query.data?.connections.map((connection) => (
          <StyledRecruitingPanel key={connection.connectedAccountId}>
            <strong>{connection.handle}</strong>
            <Field.Root>
              <Field.Item>
                <Checkbox
                  checked={connection.enabled}
                  disabled={
                    busy ||
                    (!query.data?.nativeIntegrationEnabled &&
                      !connection.enabled)
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
      {query.data && query.data.count > pageSize && (
        <ResultPagination
          isLoading={query.loading}
          hasCount={query.data !== undefined}
          count={query.data.count}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
      {(error || query.error) && (
        <StyledRecruitingError role="alert">
          {error || query.error}
        </StyledRecruitingError>
      )}
    </StyledRecruitingPanel>
  );
};
