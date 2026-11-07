import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/recruiting/shadcn/ui/table';
import { QueueSettings } from './QueueSettings';
/** Displays one task per submission from material processing through matching completion. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from '@/recruiting/shadcn/compat';
import { Dialog } from '@/recruiting/shadcn/compat';
import { IconRefresh, IconX } from 'twenty-ui/icon';
import { Select } from '@/recruiting/shadcn/compat';
import { type RecruitingIntake } from '@/recruiting/intake/types/Intake';
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

type ProcessingTask = RecruitingIntake & {
  retryPath: string;
  progress: { processed: number; total: number };
};
/** Keeps the internal worker queue boundaries out of the operator's task list. */
export const RecruitingQueueDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [direction, setDirection] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [retryingId, setRetryingId] = useState<string>();
  const [selected, setSelected] = useState<ProcessingTask>();
  const query = useRecruitingQuery<RecruitingPage<ProcessingTask>>(
    open ? `processing-tasks?offset=${offset}&direction=${direction}` : null,
    open ? 5000 : 0,
  );
  const page = query.error ? undefined : query.data;
  const pageCount = Math.max(1, Math.ceil((page?.count ?? 0) / 50));
  /** Retries the failed stage without replaying previously stored material. */
  const retry = async (row: ProcessingTask) => {
    if (retryingId) return;
    setRetryingId(row.intakeId);
    setError('');
    try {
      await recruitingRequest(row.retryPath, { method: 'POST', body: '{}' });
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
              {selected ? (
                <RecruitingTaskDetail
                  embedded
                  kind="intake"
                  id={selected.intakeId}
                  matchingRunIds={selected.matchingRunIds}
                  workflowStage={selected.stage}
                  onBack={() => setSelected(undefined)}
                  onClose={() => {
                    setSelected(undefined);
                    onOpenChange(false);
                  }}
                />
              ) : (
                <>
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
                    <QueueSettings active={open} />
                    <Select
                      dropdownId="processing-task-type"
                      value={direction}
                      options={[
                        { value: '', label: t`全部类型` },
                        { value: 'CANDIDATE_TO_JOBS', label: t`人找岗` },
                        { value: 'JOB_TO_CANDIDATES', label: t`岗找人` },
                      ]}
                      onChange={(value) => {
                        setDirection(value);
                        setOffset(0);
                      }}
                    />
                  </Dialog.Header>
                  <Dialog.Body>
                    {(query.error || error) && (
                      <StyledRecruitingError role="alert">
                        {error || query.error}
                      </StyledRecruitingError>
                    )}
                    <StyledRecruitingDenseQueue>
                      <StyledRecruitingTable>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t`名称`}</TableHead>
                            <TableHead>{t`类型`}</TableHead>
                            <TableHead>{t`渠道`}</TableHead>
                            <TableHead>{t`时间`}</TableHead>
                            <TableHead>{t`状态`}</TableHead>
                            <TableHead>{t`详情`}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {page?.records.map((row) => (
                            <TableRow key={row.intakeId}>
                              <TableCell title={row.name}>
                                {row.name?.replace('[recruiting-v2] ', '')}
                              </TableCell>
                              <TableCell>
                                {row.kind === 'JOB' ? t`岗找人` : t`人找岗`}
                              </TableCell>
                              <TableCell>
                                {recruitingChannelLabel(row.source)}
                              </TableCell>
                              <TableCell>
                                {new Date(row.createdAt).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <StyledRecruitingStatus
                                  data-tone={recruitingTaskTone(row.stage)}
                                >
                                  {recruitingTaskLabel(row.stage)}
                                </StyledRecruitingStatus>
                                {row.stage === 'MATCHING' &&
                                  row.progress.total > 0 && (
                                    <span>
                                      {' '}
                                      {row.progress.processed}/
                                      {row.progress.total}
                                    </span>
                                  )}
                              </TableCell>
                              <TableCell>
                                <StyledRecruitingRow>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setSelected(row)}
                                  >{t`详情`}</Button>
                                  {row.stage === 'MATCH_DISABLED' && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={Boolean(retryingId)}
                                      onClick={() =>
                                        void (async () => {
                                          setRetryingId(row.intakeId);
                                          setError('');
                                          try {
                                            await recruitingRequest(
                                              `resume-intakes/${row.intakeId}/match`,
                                              { method: 'POST', body: '{}' },
                                            );
                                            await query.reload();
                                          } catch (failure) {
                                            setError(
                                              failure instanceof Error
                                                ? failure.message
                                                : t`匹配启动失败`,
                                            );
                                          } finally {
                                            setRetryingId(undefined);
                                          }
                                        })()
                                      }
                                    >{t`开始匹配`}</Button>
                                  )}
                                  {(['FAILED', 'NEEDS_REVIEW'].includes(
                                    row.state,
                                  ) ||
                                    ['MATCH_FAILED', 'MATCH_STALE'].includes(
                                      row.stage,
                                    )) && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={Boolean(retryingId)}
                                      loading={retryingId === row.intakeId}
                                      onClick={() => {
                                        void retry(row);
                                      }}
                                    >
                                      {t`重试`}
                                    </Button>
                                  )}
                                </StyledRecruitingRow>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
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
                </>
              )}
            </Dialog.Popup>
          </div>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
