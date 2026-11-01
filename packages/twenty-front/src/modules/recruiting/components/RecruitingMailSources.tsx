/** Shows received candidate mail with downstream processing progress. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { type RecruitingMailArchive } from '@/recruiting/types/RecruitingMailArchive';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import { RecruitingMailDetail } from '@/recruiting/components/RecruitingMailDetail';
import {
  recruitingTaskLabel,
  recruitingTaskTone,
} from '@/recruiting/utils/taskLabels';
import { RecruitingMailboxSettings } from '@/recruiting/components/RecruitingMailboxSettings';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import {
  recruitingDialogClass,
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTable,
  StyledRecruitingTitle,
  StyledRecruitingSticky,
  StyledRecruitingStatus,
} from '@/recruiting/components/recruitingStyles';

/** Uses business status instead of exposing transport or worker implementation to operators. */
const mailLabel = (status: string) =>
  ({
    UPLOADING: t`保存原文`,
    QUEUED: t`排队中`,
    EXPANDING: t`整理附件`,
    READY: t`等待解析`,
    NEEDS_SELECTION: t`待处理`,
    FAILED: t`需要处理`,
  })[status] ?? recruitingTaskLabel(status);

/** Browses received mail separately from its material-selection detail; reception is configured in mailbox settings. */
export const RecruitingMailSources = ({
  active = true,
}: {
  active?: boolean;
  onSubmitted: () => void;
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveId, setArchiveId] = useState<string>();
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRecruitingQuery<RecruitingPage<RecruitingMailArchive>>(
    `mail-archives?offset=${offset}`,
    8000,
    active && !archiveId,
  );
  const detail = useRecruitingQuery<RecruitingMailArchive>(
    archiveId ? `mail-archives/${archiveId}` : null,
    archiveId ? 4000 : 0,
    active,
  );
  const mail = archiveId && !detail.error ? detail.data : undefined;
  const canResume = Boolean(
    mail &&
    (['QUEUED', 'EXPANDING'].includes(mail.status) || Boolean(mail.error)),
  );
  /** Reuses archive checkpoints; the server keeps an in-flight task waiting instead of starting it twice. */
  const retry = async () => {
    if (!mail || busy) return;
    setBusy(true);
    setError('');
    try {
      await recruitingRequest(`mail-archives/${mail.archiveId}/retry`, {
        method: 'POST',
        body: '{}',
      });
      await detail.reload();
      await list.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`暂时无法重试`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingStack>
      <StyledRecruitingRow style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={() => setSettingsOpen(!settingsOpen)}>
          {settingsOpen ? t`关闭邮箱设置` : t`邮箱设置`}
        </Button>
      </StyledRecruitingRow>
      {settingsOpen && (
        <Dialog.Root open onOpenChange={setSettingsOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Viewport>
              <div className={recruitingDialogClass}>
                <Dialog.Popup size="lg">
                  <Dialog.Header>
                    <Dialog.Title>{t`邮箱设置`}</Dialog.Title>
                  </Dialog.Header>
                  <Dialog.Body>
                    <RecruitingMailboxSettings
                      active={active}
                      onReceived={(id) => {
                        setArchiveId(id);
                        void list.reload();
                      }}
                    />
                  </Dialog.Body>
                  <Dialog.Footer>
                    <Button
                      onClick={() => setSettingsOpen(false)}
                    >{t`完成`}</Button>
                  </Dialog.Footer>
                </Dialog.Popup>
              </div>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {(error || list.error || detail.error) && (
        <StyledRecruitingError role="alert">
          {error || detail.error || list.error}
        </StyledRecruitingError>
      )}
      {archiveId && (
        <StyledRecruitingSticky>
          <Button
            variant="ghost"
            onClick={() => setArchiveId(undefined)}
          >{t`返回邮件列表`}</Button>
        </StyledRecruitingSticky>
      )}
      {mail && (
        <StyledRecruitingPanel>
          <StyledRecruitingRow>
            <StyledRecruitingTitle>{mail.name}</StyledRecruitingTitle>
            <StyledRecruitingStatus
              data-tone={recruitingTaskTone(
                mail.processingStatus ?? mail.status,
              )}
            >
              {mailLabel(mail.processingStatus ?? mail.status)}
            </StyledRecruitingStatus>
          </StyledRecruitingRow>
          <StyledRecruitingMuted>
            {[
              [
                mail.detail?.metadata?.from?.name,
                mail.detail?.metadata?.from?.address,
              ]
                .filter(Boolean)
                .join(' · '),
              mail.detail?.metadata?.date,
            ]
              .filter(Boolean)
              .join(' · ')}
          </StyledRecruitingMuted>
          {mail.error && (
            <StyledRecruitingError>{mail.error}</StyledRecruitingError>
          )}
          {canResume && (
            <StyledRecruitingMuted>{t`长时间没有进展时可尝试恢复；仍在运行的任务会继续等待`}</StyledRecruitingMuted>
          )}
          {(mail.status === 'FAILED' || canResume) && (
            <Button
              disabled={busy}
              loading={busy}
              onClick={() => {
                void retry();
              }}
            >
              {canResume ? t`恢复处理` : t`重试归档`}
            </Button>
          )}
          <RecruitingMailDetail key={mail.archiveId} archive={mail} />
        </StyledRecruitingPanel>
      )}
      {!archiveId && (
        <StyledRecruitingPanel>
          <StyledRecruitingTitle>{t`已接收邮件`}</StyledRecruitingTitle>
          <StyledRecruitingTable>
            <thead>
              <tr>
                <th>{t`邮件主题`}</th>
                <th>{t`附件数量`}</th>
                <th>{t`处理进度`}</th>
                <th>{t`操作`}</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.records.map((item) => (
                <tr key={item.archiveId}>
                  <td>{item.name}</td>
                  <td>{item.attachmentCount ?? '—'}</td>
                  <td>
                    <StyledRecruitingStatus
                      data-tone={recruitingTaskTone(
                        item.processingStatus ?? item.status,
                      )}
                    >
                      {mailLabel(item.processingStatus ?? item.status)}
                    </StyledRecruitingStatus>
                  </td>
                  <td>
                    <Button
                      disabled={busy}
                      onClick={() => setArchiveId(item.archiveId)}
                    >{t`查看`}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </StyledRecruitingTable>
          <StyledRecruitingRow>
            <Button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 30))}
            >{t`上一页`}</Button>
            <Button
              disabled={!list.data?.hasNextPage}
              onClick={() => setOffset(offset + 30)}
            >{t`下一页`}</Button>
          </StyledRecruitingRow>
        </StyledRecruitingPanel>
      )}
    </StyledRecruitingStack>
  );
};
