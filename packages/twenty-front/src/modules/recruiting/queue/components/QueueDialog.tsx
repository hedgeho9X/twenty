/** Separates material processing from matching jobs in a compact, paginated queue with on-demand details. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { IconRefresh, IconX } from 'twenty-ui/icon';
import { type RecruitingIntake } from '@/recruiting/intake/types/Intake';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';
import { type RecruitingPage } from '@/recruiting/shared/types/Page';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import {
  recruitingChannelLabel,
  recruitingTaskLabel,
  recruitingTaskTone,
} from '@/recruiting/shared/utils/taskLabels';
import { RecruitingTaskDetail } from './TaskDetail';
import {
  recruitingDialogClass,
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
  StyledRecruitingStatus,
  StyledRecruitingTable,
  StyledRecruitingDenseQueue,
} from '@/recruiting/shared/styles';

/** Resumes interrupted processing and legacy JD tasks through the automatic creation pipeline. */
const canResumeIntake = (intake: RecruitingIntake) =>
  (['READY', 'PROCESSING'].includes(intake.state) &&
    intake.stage !== 'AWAITING_CONFIRMATION') ||
  (intake.kind === 'JOB' && intake.stage === 'AWAITING_CONFIRMATION');

/** Displays the saved source and actual job state without equating stored material with completed matching. */
export const RecruitingQueueDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [kind, setKind] = useState<'intake' | 'match'>('intake');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [retryingId, setRetryingId] = useState<string>();
  const [selected, setSelected] = useState<{
    kind: 'intake' | 'match';
    id: string;
  }>();
  const query = useRecruitingQuery<
    RecruitingPage<RecruitingIntake & RecruitingMatchRun>
  >(
    open
      ? `${kind === 'intake' ? 'resume-intakes' : 'match-runs'}?offset=${offset}`
      : null,
    open ? 5000 : 0,
  );
  const page = query.error ? undefined : query.data;
  const pageCount = Math.max(1, Math.ceil((page?.count ?? 0) / 50));
  /** Recovery stays an explicit queue action and reuses the existing durable task. */
  const retry = async (id: string) => {
    if (retryingId) return;
    setRetryingId(id);
    setError('');
    try {
      await recruitingRequest(
        `${kind === 'intake' ? 'resume-intakes' : 'match-runs'}/${id}/retry`,
        { method: 'POST', body: '{}' },
      );
      await query.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`暂时无法重试`);
    } finally {
      setRetryingId(undefined);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) setSelected(undefined);
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <div className={recruitingDialogClass}>
            <Dialog.Popup size="xl">
              <Dialog.Header>
                <StyledRecruitingRow
                  style={{ justifyContent: 'space-between' }}
                >
                  <Dialog.Title>{t`处理队列`}</Dialog.Title>
                  <StyledRecruitingRow>
                    <Button
                      variant="ghost"
                      aria-label={t`刷新队列`}
                      disabled={query.loading}
                      onClick={() => {
                        void query.reload();
                      }}
                    >
                      <IconRefresh size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={t`关闭队列`}
                      onClick={() => {
                        setSelected(undefined);
                        onOpenChange(false);
                      }}
                    >
                      <IconX size={16} />
                    </Button>
                  </StyledRecruitingRow>
                </StyledRecruitingRow>
                <StyledRecruitingRow>
                  <Button
                    variant={kind === 'intake' ? 'soft' : 'ghost'}
                    aria-pressed={kind === 'intake'}
                    onClick={() => {
                      setKind('intake');
                      setOffset(0);
                    }}
                  >{t`材料处理`}</Button>
                  <Button
                    variant={kind === 'match' ? 'soft' : 'ghost'}
                    aria-pressed={kind === 'match'}
                    onClick={() => {
                      setKind('match');
                      setOffset(0);
                    }}
                  >{t`岗位匹配`}</Button>
                </StyledRecruitingRow>
              </Dialog.Header>
              <Dialog.Body>
                {page?.records.some(
                  (row) => kind === 'intake' && canResumeIntake(row),
                ) && (
                  <StyledRecruitingMuted>{t`长时间没有进展时可尝试恢复；仍在运行的任务会继续等待`}</StyledRecruitingMuted>
                )}
                {(query.error || error) && (
                  <StyledRecruitingError role="alert">
                    {error || query.error}
                  </StyledRecruitingError>
                )}
                <StyledRecruitingDenseQueue>
                  <StyledRecruitingTable>
                    <thead>
                      <tr>
                        <th>{t`名称`}</th>
                        <th>{t`类型`}</th>
                        <th>{t`渠道`}</th>
                        <th>{t`时间`}</th>
                        <th>{kind === 'intake' ? t`材料状态` : t`匹配状态`}</th>
                        {kind === 'match' && <th>{t`进度`}</th>}
                        <th>{t`详情`}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page?.records.map((row) => {
                        const id = kind === 'intake' ? row.intakeId : row.runId;
                        const state =
                          kind === 'intake' ? row.stage : row.status;
                        const direction =
                          kind === 'intake'
                            ? row.kind === 'JOB'
                              ? 'JOB_TO_CANDIDATES'
                              : 'CANDIDATE_TO_JOBS'
                            : row.direction;
                        const recover =
                          kind === 'intake'
                            ? canResumeIntake(row) ||
                              (row.state === 'NEEDS_REVIEW' &&
                                row.stage !== 'AWAITING_CONFIRMATION')
                            : ['FAILED', 'PARTIAL'].includes(row.status);
                        return (
                          <tr key={id}>
                            <td title={row.name ?? row.subjectLabel}>
                              {kind === 'intake'
                                ? row.name?.replace('[recruiting-v2] ', '')
                                : row.subjectLabel}
                            </td>
                            <td>
                              {direction === 'JOB_TO_CANDIDATES'
                                ? t`岗找人`
                                : direction === 'PAIR'
                                  ? t`指定匹配`
                                  : t`人找岗`}
                            </td>
                            <td>{recruitingChannelLabel(row.source)}</td>
                            <td>{new Date(row.createdAt).toLocaleString()}</td>
                            <td>
                              <StyledRecruitingStatus
                                data-tone={recruitingTaskTone(state)}
                              >
                                {recruitingTaskLabel(state)}
                              </StyledRecruitingStatus>
                            </td>
                            {kind === 'match' && (
                              <td>
                                {row.counts.processed}/{row.counts.total}
                              </td>
                            )}
                            <td>
                              <StyledRecruitingRow>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setSelected({ kind, id })}
                                >{t`详情`}</Button>
                                {recover && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={Boolean(retryingId)}
                                    loading={retryingId === id}
                                    onClick={() => {
                                      void retry(id);
                                    }}
                                  >
                                    {kind === 'intake' && canResumeIntake(row)
                                      ? t`恢复处理`
                                      : t`重试`}
                                  </Button>
                                )}
                              </StyledRecruitingRow>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </StyledRecruitingTable>
                </StyledRecruitingDenseQueue>
                {!query.loading && !page?.records.length && (
                  <StyledRecruitingMuted>{t`暂无处理任务`}</StyledRecruitingMuted>
                )}
              </Dialog.Body>
              <Dialog.Footer>
                <StyledRecruitingRow
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  <Button
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 50))}
                  >{t`上一页`}</Button>
                  <span>
                    {Math.floor(offset / 50) + 1} / {pageCount} {t`页`} ·{' '}
                    {t`共`} {page?.count ?? 0} {t`条`}
                  </span>
                  <Button
                    disabled={!page?.hasNextPage}
                    onClick={() => setOffset(offset + 50)}
                  >{t`下一页`}</Button>
                </StyledRecruitingRow>
              </Dialog.Footer>
            </Dialog.Popup>
          </div>
        </Dialog.Viewport>
      </Dialog.Portal>
      {selected && open && (
        <RecruitingTaskDetail
          kind={selected.kind}
          id={selected.id}
          onClose={() => setSelected(undefined)}
        />
      )}
    </Dialog.Root>
  );
};
