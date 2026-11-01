/** Reads a task's persisted extraction and originals in a dedicated detail dialog, without rerunning the task. */
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { IconX } from 'twenty-ui/icon';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { type RecruitingIntake } from '@/recruiting/intake/types/Intake';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';
import { RecruitingParsedProfile } from '@/recruiting/shared/components/ParsedProfile';
import { RecruitingMaterialLinks } from '@/recruiting/shared/components/MaterialLinks';
import {
  recruitingTaskLabel,
  recruitingTaskTone,
  recruitingChannelLabel,
} from '@/recruiting/shared/utils/taskLabels';
import {
  recruitingDialogClass,
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingStatus,
  StyledRecruitingTable,
} from '@/recruiting/shared/styles';

type MaterialDetail = RecruitingIntake & {
  detail?: {
    input?: { note?: string };
    extraction?: { profile?: unknown };
    materials?: { label: string; text: string }[];
  };
};
type RecruitingTaskDetailProps = {
  kind: 'intake' | 'match';
  id: string;
  onClose: () => void;
};
/** Opens only the selected task; linked matching state is read independently from the intake stage. */
export const RecruitingTaskDetail = ({
  kind,
  id,
  onClose,
}: RecruitingTaskDetailProps) => {
  const query = useRecruitingQuery<MaterialDetail & RecruitingMatchRun>(
    `${kind === 'intake' ? 'resume-intakes' : 'match-runs'}/${id}`,
    5000,
  );
  const task = query.error ? undefined : query.data;
  const stage = kind === 'intake' ? task?.stage : task?.status;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
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
                  <Dialog.Title>
                    {kind === 'intake' ? t`材料详情` : t`匹配详情`}
                  </Dialog.Title>
                  <Button
                    variant="ghost"
                    aria-label={t`关闭详情`}
                    onClick={onClose}
                  >
                    <IconX size={16} />
                  </Button>
                </StyledRecruitingRow>
              </Dialog.Header>
              <Dialog.Body>
                <StyledRecruitingStack>
                  {query.error && (
                    <StyledRecruitingError role="alert">
                      {query.error}
                    </StyledRecruitingError>
                  )}
                  {query.loading && !task && (
                    <StyledRecruitingMuted>{t`正在读取…`}</StyledRecruitingMuted>
                  )}
                  {task && (
                    <>
                      <strong>
                        {task.name?.replace('[recruiting-v2] ', '') ??
                          task.subjectLabel}
                      </strong>
                      <StyledRecruitingRow>
                        {stage && (
                          <StyledRecruitingStatus
                            data-tone={recruitingTaskTone(stage)}
                          >
                            {recruitingTaskLabel(stage)}
                          </StyledRecruitingStatus>
                        )}
                        <span>{recruitingChannelLabel(task.source)}</span>
                        <span>{new Date(task.createdAt).toLocaleString()}</span>
                      </StyledRecruitingRow>
                      {task.error && (
                        <StyledRecruitingError>
                          {task.error}
                        </StyledRecruitingError>
                      )}
                      {kind === 'intake' ? (
                        <>
                          {task.detail?.extraction?.profile ? (
                            <RecruitingParsedProfile
                              profile={task.detail.extraction.profile}
                              kind={task.kind}
                            />
                          ) : (
                            <StyledRecruitingMuted>{t`尚未生成解析数据`}</StyledRecruitingMuted>
                          )}
                          {task.detail?.input?.note && (
                            <details>
                              <summary>{t`补充说明`}</summary>
                              <p style={{ whiteSpace: 'pre-wrap' }}>
                                {task.detail.input.note}
                              </p>
                            </details>
                          )}
                          <strong>{t`原始材料`}</strong>
                          <RecruitingMaterialLinks
                            intakeId={id}
                            files={task.files}
                          />
                          {task.matchingRunIds?.length ? (
                            <IntakeMatchingState ids={task.matchingRunIds} />
                          ) : (
                            <StyledRecruitingMuted>{t`尚未创建匹配任务`}</StyledRecruitingMuted>
                          )}
                        </>
                      ) : (
                        <>
                          <StyledRecruitingMuted>
                            {t`已处理`} {task.counts?.processed} /{' '}
                            {task.counts?.total} · {t`评分成功`}{' '}
                            {task.counts?.scored} · {t`失败`}{' '}
                            {task.counts?.failed}
                          </StyledRecruitingMuted>
                          <StyledRecruitingTable>
                            <thead>
                              <tr>
                                <th>{t`候选人`}</th>
                                <th>{t`岗位`}</th>
                                <th>{t`状态`}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {task.results?.map((pair) => (
                                <tr key={`${pair.candidateId}:${pair.jobId}`}>
                                  <td>{pair.candidateLabel}</td>
                                  <td>{pair.jobLabel}</td>
                                  <td>
                                    {recruitingTaskLabel(pair.status)}
                                    {pair.error && <p>{pair.error}</p>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </StyledRecruitingTable>
                          {task.complete && (
                            <a
                              href={`/recruiting-workspace?tab=matches&runId=${id}`}
                            >{t`查看匹配结果`}</a>
                          )}
                        </>
                      )}
                    </>
                  )}
                </StyledRecruitingStack>
              </Dialog.Body>
            </Dialog.Popup>
          </div>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/** Current run receipts, rather than the intake's old enqueue marker, determine downstream completion. */
const IntakeMatchingState = ({ ids }: { ids: string[] }) => (
  <StyledRecruitingStack>
    <strong>{t`匹配任务`}</strong>
    {ids.map((id) => (
      <MatchingState key={id} id={id} />
    ))}
  </StyledRecruitingStack>
);
/** Refreshes a linked matching run independently while the material remains stored. */
const MatchingState = ({ id }: { id: string }) => {
  const query = useRecruitingQuery<RecruitingMatchRun>(
    `match-runs/${id}`,
    5000,
  );
  return (
    <div>
      {query.error ? (
        <StyledRecruitingError>{query.error}</StyledRecruitingError>
      ) : query.data ? (
        <>
          <StyledRecruitingStatus
            data-tone={recruitingTaskTone(query.data.status)}
          >
            {recruitingTaskLabel(query.data.status)}
          </StyledRecruitingStatus>{' '}
          {query.data.counts.processed} / {query.data.counts.total}
        </>
      ) : (
        t`正在读取…`
      )}
    </div>
  );
};
