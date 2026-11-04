import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/recruiting/shadcn/ui/table';
import { RecruitingFilePreview } from '@/recruiting/shared/components/FilePreview';
import { useState } from 'react';
import { SourceMaterialView } from '@/recruiting/shared/components/SourceMaterialView';
/** Reads a task's persisted extraction and originals in a dedicated detail dialog, without rerunning the task. */
import { t } from '@lingui/core/macro';
import { Button } from '@/recruiting/shadcn/compat';
import { Dialog } from '@/recruiting/shadcn/compat';
import { IconArrowLeft, IconX } from 'twenty-ui/icon';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { type RecruitingIntake } from '@/recruiting/intake/types/Intake';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';
import { RecruitingParsedProfile } from '@/recruiting/shared/components/ParsedProfile';
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
  embedded?: boolean;
  onBack?: () => void;
};
/** Opens only the selected task; linked matching state is read independently from the intake stage. */
export const RecruitingTaskDetail = ({
  kind,
  id,
  onClose,
  embedded = false,
  onBack,
}: RecruitingTaskDetailProps) => {
  const [preview, setPreview] =
    useState<NonNullable<RecruitingIntake['files']>[number]>();
  const [showSource, setShowSource] = useState(false);
  const query = useRecruitingQuery<MaterialDetail & RecruitingMatchRun>(
    `${kind === 'intake' ? 'resume-intakes' : 'match-runs'}/${id}`,
    5000,
  );
  const task = query.error ? undefined : query.data;
  const stage = kind === 'intake' ? task?.stage : task?.status;
  const content = preview ? (
    <RecruitingFilePreview
      embedded
      path={`resume-intakes/${id}/files/${preview.fileId}`}
      label={preview.label}
      intakeId={id}
      fileId={preview.fileId}
      onBack={() => setPreview(undefined)}
      onClose={onClose}
    />
  ) : (
    <>
      <Dialog.Header>
        <StyledRecruitingRow style={{ justifyContent: 'space-between' }}>
          <StyledRecruitingRow>
            {(showSource || embedded) && (
              <Button
                variant="ghost"
                aria-label={t`返回解析详情`}
                startIcon={<IconArrowLeft size={16} />}
                onClick={() =>
                  showSource ? setShowSource(false) : (onBack ?? onClose)()
                }
              >{t`返回`}</Button>
            )}
            <Dialog.Title>
              {showSource
                ? t`原始材料`
                : kind === 'intake'
                  ? t`材料详情`
                  : t`匹配详情`}
            </Dialog.Title>
          </StyledRecruitingRow>
          <Button variant="ghost" aria-label={t`关闭详情`} onClick={onClose}>
            <IconX size={16} />
          </Button>
        </StyledRecruitingRow>
      </Dialog.Header>
      <Dialog.Body key={showSource ? 'source' : 'details'}>
        {showSource ? (
          <SourceMaterialView intakeId={id} onPreview={setPreview} />
        ) : (
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
                  <StyledRecruitingError>{task.error}</StyledRecruitingError>
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
                    <Button
                      variant="ghost"
                      onClick={() => setShowSource(true)}
                    >{t`原始材料`}</Button>
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
                      {task.counts?.total} · {t`评分成功`} {task.counts?.scored}{' '}
                      · {t`失败`} {task.counts?.failed}
                    </StyledRecruitingMuted>
                    <StyledRecruitingTable>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t`候选人`}</TableHead>
                          <TableHead>{t`岗位`}</TableHead>
                          <TableHead>{t`状态`}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {task.results?.map((pair) => (
                          <TableRow key={`${pair.candidateId}:${pair.jobId}`}>
                            <TableCell>{pair.candidateLabel}</TableCell>
                            <TableCell>{pair.jobLabel}</TableCell>
                            <TableCell>
                              {recruitingTaskLabel(pair.status)}
                              {pair.error && <p>{pair.error}</p>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
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
        )}
      </Dialog.Body>
    </>
  );
  if (embedded) return content;
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
            <Dialog.Popup size="xl">{content}</Dialog.Popup>
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
