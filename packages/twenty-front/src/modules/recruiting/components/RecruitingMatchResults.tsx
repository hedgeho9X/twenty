/** Separates scoring coverage, current top five and human review without changing communication state. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Badge } from 'twenty-ui/primitives/data-display';
import { IconArrowLeft, IconRefresh } from 'twenty-ui/icon';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import { type RecruitingMatchRun } from '@/recruiting/types/RecruitingMatchRun';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTable,
  StyledRecruitingTitle,
} from '@/recruiting/components/recruitingStyles';

/** Uses explicit business labels for terminal and partial states. */
const runLabel = (status: string) => {
  const labels: Record<string, string> = {
    QUEUED: t`排队中`,
    PROCESSING: t`匹配中`,
    COMPLETED: t`已完成`,
    PARTIAL: t`部分结果`,
    FAILED: t`需要处理`,
    NO_RESULTS: t`暂无合适结果`,
    SUPERSEDED: t`资料已更新`,
  };
  return labels[status] ?? status;
};

/** Opens one result inline; bulk material confirmation remains a separate normal page. */
export const RecruitingMatchResults = ({
  initialRunId,
  onDraft,
  active = true,
}: {
  initialRunId?: string;
  onDraft?: (candidateId: string, jobId: string) => void;
  active?: boolean;
}) => {
  const [runId, setRunId] = useState(initialRunId);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [showReviewed, setShowReviewed] = useState(false);
  const list = useRecruitingQuery<RecruitingPage<RecruitingMatchRun>>(
    `match-runs?offset=${offset}`,
    8000,
    active,
  );
  const detail = useRecruitingQuery<RecruitingMatchRun>(
    runId ? `match-runs/${runId}` : null,
    runId ? 8000 : 0,
    active,
  );
  const run = detail.data;

  /** Retry never marks a recommendation as sent or a candidate as contacted. */
  const action = async (suffix: 'retry' | 'reviewed') => {
    if (!runId) return;
    try {
      setError('');
      await recruitingRequest(`match-runs/${runId}/${suffix}`, {
        method: 'POST',
        body: '{}',
      });
      await detail.reload();
      await list.reload();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t`操作未完成，请重试`,
      );
    }
  };

  if (runId)
    return (
      <StyledRecruitingStack>
        <StyledRecruitingRow>
          <Button
            startIcon={<IconArrowLeft size={16} />}
            onClick={() => setRunId(undefined)}
          >{t`返回匹配列表`}</Button>
          <Button
            startIcon={<IconRefresh size={16} />}
            onClick={() => {
              void detail.reload();
            }}
          >{t`刷新`}</Button>
        </StyledRecruitingRow>
        {(detail.error || error) && (
          <StyledRecruitingError role="alert">
            {error || detail.error}
          </StyledRecruitingError>
        )}
        {run && (
          <StyledRecruitingPanel>
            <StyledRecruitingRow>
              <StyledRecruitingTitle>
                {run.subjectLabel ?? t`匹配结果`}
              </StyledRecruitingTitle>
              <Badge>{runLabel(run.status)}</Badge>
            </StyledRecruitingRow>
            <StyledRecruitingMuted>{t`共 ${run.counts.total} 个组合，已处理 ${run.counts.processed} 个；成功评分 ${run.counts.scored} 个，明确排除 ${run.counts.excluded} 个，待补资料 ${run.counts.needsReview} 个，失败 ${run.counts.failed} 个。`}</StyledRecruitingMuted>
            {!run.complete && (
              <StyledRecruitingError role="status">{t`当前是部分或过期结果，前五不代表完整人才库。请核对覆盖情况后再决定。`}</StyledRecruitingError>
            )}
            {run.poolChanged && (
              <StyledRecruitingMuted>{t`匹配池已有变化，当前共有 ${run.currentPoolCount ?? 0} 条资料。`}</StyledRecruitingMuted>
            )}
            {run.error && (
              <StyledRecruitingMuted>{run.error}</StyledRecruitingMuted>
            )}
            <StyledRecruitingTable>
              <thead>
                <tr>
                  <th>{t`候选人`}</th>
                  <th>{t`岗位`}</th>
                  <th>{t`能力匹配`}</th>
                  <th>{t`意向与条件`}</th>
                  <th>{t`后续操作`}</th>
                </tr>
              </thead>
              <tbody>
                {run.top?.map((pair) => (
                  <tr key={`${pair.candidateId}:${pair.jobId}`}>
                    <td>
                      <a href={pair.candidateUrl}>{pair.candidateLabel}</a>
                    </td>
                    <td>
                      <a href={pair.jobUrl}>{pair.jobLabel}</a>
                    </td>
                    <td>{pair.score?.toFixed(2)} / 4</td>
                    <td>
                      <StyledRecruitingMuted>
                        {pair.intent?.expectedRoles.length
                          ? pair.intent.expectedRoles.join('、')
                          : t`未明确本次预期岗位`}
                      </StyledRecruitingMuted>
                      <Badge>{t`意向待确认`}</Badge>
                      {pair.eligibility.reasons.map((reason) => (
                        <StyledRecruitingMuted key={reason.code}>
                          {reason.message}
                        </StyledRecruitingMuted>
                      ))}
                    </td>
                    <td>
                      <Button
                        onClick={() => onDraft?.(pair.candidateId, pair.jobId)}
                      >{t`生成问候草稿`}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </StyledRecruitingTable>
            {!run.top?.length && (
              <StyledRecruitingMuted>{t`当前没有可展示的有效前五。可检查资料、等待处理完成或重试匹配。`}</StyledRecruitingMuted>
            )}
            <StyledRecruitingMuted>{t`分数表示材料中的能力匹配，不是录用概率。查看结果不会自动发送消息、推荐候选人或更新联系状态。`}</StyledRecruitingMuted>
            <StyledRecruitingRow>
              <Button
                onClick={() => {
                  void action('retry');
                }}
              >{t`重试或刷新匹配`}</Button>
              <Button
                variant="solid"
                color="accent"
                disabled={Boolean(run.reviewedAt)}
                onClick={() => {
                  void action('reviewed');
                }}
              >
                {run.reviewedAt ? t`已查看` : t`标记为已查看`}
              </Button>
            </StyledRecruitingRow>
          </StyledRecruitingPanel>
        )}
      </StyledRecruitingStack>
    );

  return (
    <StyledRecruitingPanel>
      <StyledRecruitingRow>
        <StyledRecruitingTitle>{t`匹配待查看`}</StyledRecruitingTitle>
        <Button onClick={() => setShowReviewed(!showReviewed)}>
          {showReviewed ? t`只看未查看` : t`包含已查看`}
        </Button>
        <Button
          startIcon={<IconRefresh size={16} />}
          onClick={() => {
            void list.reload();
          }}
        >{t`刷新`}</Button>
      </StyledRecruitingRow>
      {list.error && (
        <StyledRecruitingError role="alert">{list.error}</StyledRecruitingError>
      )}
      <StyledRecruitingMuted>{t`候选人入库或岗位更新后会自动安排匹配，完成后在这里查看。`}</StyledRecruitingMuted>
      <StyledRecruitingTable>
        <thead>
          <tr>
            <th>{t`候选人 / 岗位`}</th>
            <th>{t`方向`}</th>
            <th>{t`状态`}</th>
            <th>{t`覆盖`}</th>
            <th>{t`时间`}</th>
            <th>{t`操作`}</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.records
            .filter((row) => showReviewed || !row.reviewedAt)
            .map((row) => (
              <tr key={row.runId}>
                <td>{row.subjectLabel ?? t`待查看资料`}</td>
                <td>
                  {row.direction === 'CANDIDATE_TO_JOBS'
                    ? t`候选人找岗位`
                    : row.direction === 'JOB_TO_CANDIDATES'
                      ? t`岗位找候选人`
                      : t`指定人岗`}
                </td>
                <td>
                  <Badge>{runLabel(row.status)}</Badge>
                </td>
                <td>
                  {row.counts.processed} / {row.counts.total}
                </td>
                <td>{new Date(row.createdAt).toLocaleString()}</td>
                <td>
                  <Button
                    size="sm"
                    onClick={() => setRunId(row.runId)}
                  >{t`查看结果`}</Button>
                </td>
              </tr>
            ))}
        </tbody>
      </StyledRecruitingTable>
      {!list.loading && !list.data?.records.length && (
        <StyledRecruitingMuted>{t`还没有匹配任务。先上传候选人或导入岗位。`}</StyledRecruitingMuted>
      )}
      <StyledRecruitingRow>
        <Button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >{t`上一页`}</Button>
        <Button
          disabled={!list.data?.hasNextPage}
          onClick={() => setOffset(offset + 50)}
        >{t`下一页`}</Button>
      </StyledRecruitingRow>
    </StyledRecruitingPanel>
  );
};
