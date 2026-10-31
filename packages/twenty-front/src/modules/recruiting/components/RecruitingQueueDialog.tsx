/** Shows short-lived progress views backed by persistent intake records, with explicit error recovery. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { Badge } from 'twenty-ui/primitives/data-display';
import { IconRefresh } from 'twenty-ui/icon';
import { type RecruitingIntake } from '@/recruiting/types/RecruitingIntake';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
  StyledRecruitingScroll,
  StyledRecruitingTable,
} from '@/recruiting/components/recruitingStyles';

/** Presents business stages rather than implementation queue or model identifiers. */
const stageLabel = (intake: RecruitingIntake) => {
  const labels: Record<string, string> = {
    QUEUED: t`排队中`,
    PARSING: t`解析文件`,
    EXTRACTING: t`整理资料`,
    EXTRACTED: t`资料已整理`,
    COPYING_FILES: t`保存附件`,
    STORED: t`已入库`,
    AWAITING_CONFIRMATION: t`待确认岗位`,
    FAILED: t`需要处理`,
    CONFIRMATION_PARTIAL: t`部分岗位待修正`,
    DISCARDED: t`已结束，未导入`,
  };
  return labels[intake.stage] ?? intake.stage;
};

/** Keeps detailed bulk editing outside this popup; accepted tasks remain available after refresh. */
export const RecruitingQueueDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const query = useRecruitingQuery<RecruitingPage<RecruitingIntake>>(
    open ? `resume-intakes?offset=${offset}` : null,
    open ? 5000 : 0,
  );
  const retry = async (id: string) => {
    try {
      setError('');
      await recruitingRequest(`resume-intakes/${id}/retry`, {
        method: 'POST',
        body: '{}',
      });
      await query.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`暂时无法重试`);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="xl">
            <Dialog.Header>
              <Dialog.Title>{t`处理队列`}</Dialog.Title>
              <Dialog.Description>{t`接收成功后会继续后台处理。材料入库与匹配分开进行，匹配失败不会删除候选人。`}</Dialog.Description>
            </Dialog.Header>
            <Dialog.Body>
              {(query.error || error) && (
                <StyledRecruitingError role="alert">
                  {error || query.error}
                </StyledRecruitingError>
              )}
              <StyledRecruitingScroll>
                <StyledRecruitingTable>
                  <thead>
                    <tr>
                      <th>{t`材料`}</th>
                      <th>{t`进度`}</th>
                      <th>{t`处理结果`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data?.records.map((intake) => (
                      <tr key={intake.intakeId}>
                        <td>
                          <strong>
                            {intake.name?.replace('[recruiting-v2] ', '')}
                          </strong>
                          <StyledRecruitingMuted>
                            {new Date(intake.createdAt).toLocaleString()}
                          </StyledRecruitingMuted>
                        </td>
                        <td>
                          <Badge>{stageLabel(intake)}</Badge>
                          {intake.error && (
                            <StyledRecruitingMuted>
                              {intake.error}
                            </StyledRecruitingMuted>
                          )}
                        </td>
                        <td>
                          <StyledRecruitingRow>
                            {intake.recordUrl && (
                              <a href={intake.recordUrl}>{t`打开记录`}</a>
                            )}
                            {intake.kind === 'JOB' &&
                              [
                                'AWAITING_CONFIRMATION',
                                'CONFIRMATION_PARTIAL',
                              ].includes(intake.stage) && (
                                <a
                                  href={`/recruiting-workspace?tab=companies&intakeId=${intake.intakeId}`}
                                >{t`打开岗位预览`}</a>
                              )}
                            {intake.state === 'NEEDS_REVIEW' &&
                              intake.stage !== 'AWAITING_CONFIRMATION' && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    void retry(intake.intakeId);
                                  }}
                                >{t`重试`}</Button>
                              )}
                          </StyledRecruitingRow>
                          {intake.matchingError && (
                            <StyledRecruitingMuted>
                              {intake.matchingError}
                            </StyledRecruitingMuted>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </StyledRecruitingTable>
              </StyledRecruitingScroll>
              {!query.loading && !query.data?.records.length && (
                <StyledRecruitingMuted>{t`还没有材料处理任务。`}</StyledRecruitingMuted>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <StyledRecruitingRow>
                <Button
                  startIcon={<IconRefresh size={14} />}
                  onClick={() => {
                    void query.reload();
                  }}
                >{t`刷新`}</Button>
                <Button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >{t`上一页`}</Button>
                <Button
                  disabled={!query.data?.hasNextPage}
                  onClick={() => setOffset(offset + 50)}
                >{t`下一页`}</Button>
              </StyledRecruitingRow>
              <Dialog.Close render={<Button>{t`关闭`}</Button>} />
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
