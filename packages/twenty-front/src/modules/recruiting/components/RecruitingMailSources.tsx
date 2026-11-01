/** Separates complete email reception/archiving from explicit candidate-material selection. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { type RecruitingMailArchive } from '@/recruiting/types/RecruitingMailArchive';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import { RecruitingMailSelection } from '@/recruiting/components/RecruitingMailSelection';
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
} from '@/recruiting/components/recruitingStyles';

/** Uses business status instead of exposing transport or worker implementation to operators. */
const mailLabel = (status: string) =>
  ({
    UPLOADING: t`保存原文`,
    QUEUED: t`排队中`,
    EXPANDING: t`整理附件`,
    READY: t`已归档`,
    NEEDS_SELECTION: t`待选择材料`,
    FAILED: t`需要处理`,
  })[status] ?? status;

/** Accepts exported EML without implying that mailbox sync is enabled or any email was sent. */
export const RecruitingMailSources = ({
  active = true,
  onSubmitted,
}: {
  active?: boolean;
  onSubmitted: () => void;
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [file, setFile] = useState<File>();
  const [archiveId, setArchiveId] = useState<string>();
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRecruitingQuery<RecruitingPage<RecruitingMailArchive>>(
    `mail-archives?offset=${offset}`,
    8000,
    active,
  );
  const detail = useRecruitingQuery<RecruitingMailArchive>(
    archiveId ? `mail-archives/${archiveId}` : null,
    archiveId ? 4000 : 0,
    active,
  );
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const receipt = await recruitingRequest<RecruitingMailArchive>(
        'mail-archives/upload',
        { method: 'POST', body: form },
      );
      setArchiveId(receipt.archiveId);
      await list.reload();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t`邮件原文尚未受理，请重试`,
      );
    } finally {
      setBusy(false);
    }
  };
  const mail = detail.data;
  const canResume = Boolean(
    mail && ['QUEUED', 'EXPANDING'].includes(mail.status),
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
      <StyledRecruitingPanel>
        <StyledRecruitingTitle>{t`邮件材料`}</StyledRecruitingTitle>
        <StyledRecruitingMuted>{t`导入完整EML后，原文、正文、附件和内嵌资源一起保存。先核对属于候选人的材料，再交给统一处理队列。`}</StyledRecruitingMuted>
        <input
          aria-label={t`选择完整EML邮件`}
          type="file"
          accept=".eml,message/rfc822"
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected && selected.size > 50 * 1024 * 1024) {
              setError(t`邮件原文最大50MB`);
              return;
            }
            setFile(selected);
            setError('');
          }}
        />
        <Button
          loading={busy}
          disabled={!file}
          onClick={() => {
            void upload();
          }}
          variant="solid"
          color="accent"
        >{t`导入完整邮件`}</Button>
      </StyledRecruitingPanel>
      {(error || list.error || detail.error) && (
        <StyledRecruitingError role="alert">
          {error || detail.error || list.error}
        </StyledRecruitingError>
      )}
      {mail && (
        <StyledRecruitingPanel>
          <StyledRecruitingRow>
            <StyledRecruitingTitle>{mail.name}</StyledRecruitingTitle>
            <span>{mailLabel(mail.status)}</span>
            <Button
              disabled={busy}
              onClick={() => setArchiveId(undefined)}
            >{t`收起`}</Button>
          </StyledRecruitingRow>
          <StyledRecruitingMuted>
            {[mail.detail?.metadata?.from?.address, mail.detail?.metadata?.date]
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
          {['READY', 'NEEDS_SELECTION'].includes(mail.status) && (
            <RecruitingMailSelection
              key={mail.archiveId}
              archive={mail}
              onSubmitted={onSubmitted}
            />
          )}
        </StyledRecruitingPanel>
      )}
      <StyledRecruitingPanel>
        <StyledRecruitingTitle>{t`已接收邮件`}</StyledRecruitingTitle>
        <StyledRecruitingTable>
          <thead>
            <tr>
              <th>{t`邮件`}</th>
              <th>{t`进度`}</th>
              <th>{t`材料数量`}</th>
              <th>{t`操作`}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.records.map((item) => (
              <tr key={item.archiveId}>
                <td>{item.name}</td>
                <td>{mailLabel(item.status)}</td>
                <td>{item.artifactCount}</td>
                <td>
                  <Button
                    disabled={busy}
                    onClick={() => setArchiveId(item.archiveId)}
                  >{t`查看与选择材料`}</Button>
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
    </StyledRecruitingStack>
  );
};
