import { MatchSelection } from './MatchSelection';
/** Shows matching history and a focused subject detail with current ranked results. */
import { useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { IconArrowLeft, IconRefresh } from 'twenty-ui/icon';
import { Select } from '@/ui/input/components/Select';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';
import { matchResultNotice } from '@/recruiting/matching/utils/resultNotice';
import { type RecruitingPage } from '@/recruiting/shared/types/Page';
import { RecruitingCandidateFacts } from './MatchFacts';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTable,
  StyledRecruitingTitle,
} from '@/recruiting/shared/styles';

/** Filters direction in the toolbar and preserves explicit warnings only when results are incomplete. */
export const RecruitingMatchResults = ({
  initialRunId,
  onBack,
  active = true,
}: {
  initialRunId?: string;
  onBack?: () => void;
  active?: boolean;
}) => {
  const [finished, setFinished] = useState(false);
  const [runId, setRunId] = useState(initialRunId);
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState('CANDIDATE_TO_JOBS');
  const list = useRecruitingQuery<RecruitingPage<RecruitingMatchRun>>(
    `match-runs?offset=${offset}&direction=${direction}&terminalHistory=true`,
    0,
    active && !runId,
  );
  const detail = useRecruitingQuery<RecruitingMatchRun>(
    runId ? `match-runs/${runId}` : null,
    runId && !finished ? 1500 : 0,
    active,
  );
  useEffect(() => {
    setFinished(false);
  }, [runId]);
  useEffect(() => {
    if (detail.data && !['QUEUED', 'PROCESSING'].includes(detail.data.status))
      setFinished(true);
  }, [detail.data]);
  const run = detail.error ? undefined : detail.data;
  const notice = run ? matchResultNotice(run) : undefined;
  if (runId)
    return (
      <StyledRecruitingStack>
        <StyledRecruitingRow>
          <Button
            variant="ghost"
            startIcon={<IconArrowLeft size={16} />}
            onClick={() => (onBack ? onBack() : setRunId(undefined))}
          >{t`返回匹配列表`}</Button>
        </StyledRecruitingRow>
        {detail.error && (
          <StyledRecruitingError role="alert">
            {detail.error}
          </StyledRecruitingError>
        )}
        {run && (
          <>
            {run.direction !== 'JOB_TO_CANDIDATES' ? (
              <RecruitingCandidateFacts
                key={run.subjectId}
                id={run.subjectId}
                label={run.subjectLabel}
              />
            ) : (
              <StyledRecruitingPanel>
                <StyledRecruitingTitle>
                  {run.subjectLabel}
                </StyledRecruitingTitle>
              </StyledRecruitingPanel>
            )}
            <StyledRecruitingPanel>
              <StyledRecruitingRow>
                <strong>
                  {run.counts.processed} / {run.counts.total} 已处理
                </strong>
                <span>复用 {run.counts.cached} 项</span>
                <span>状态：{run.status}</span>
                <span>
                  {run.billing
                    ? `预计费用 $${run.billing.estimatedUsd.toFixed(6)}`
                    : '费用未配置'}
                </span>
                {!!run.billing?.unknownUsage && <span>部分调用未返回用量</span>}
              </StyledRecruitingRow>
              {!finished && (
                <progress
                  aria-label="匹配进度"
                  max={Math.max(1, run.counts.total)}
                  value={run.counts.processed}
                  style={{ width: '100%' }}
                />
              )}
              {notice &&
                (notice.error ? (
                  <StyledRecruitingError role="alert">
                    {notice.message}
                  </StyledRecruitingError>
                ) : (
                  <StyledRecruitingMuted role="status">
                    {notice.message}
                  </StyledRecruitingMuted>
                ))}
              {run.complete && (run.top?.length ?? 0) > 0 && (
                <MatchSelection key={run.runId} run={run} active={active} />
              )}
              {!run.complete && (
                <StyledRecruitingMuted role="status">
                  已评分 {run.counts.scored} / {run.counts.total}{' '}
                  项。结果覆盖不完整，仅供查看；完整匹配后才可选择、生成文案或推荐。
                </StyledRecruitingMuted>
              )}
              {!run.complete &&
                (run.results ?? []).map((pair) => (
                  <div key={`${pair.candidateId}:${pair.jobId}`}>
                    <strong>
                      {{
                        SCORED: t`已评分`,
                        EXCLUDED: t`明确条件冲突`,
                        NEEDS_REVIEW: t`待补资料或人工核对`,
                        FAILED: t`处理失败`,
                      }[pair.status] ?? pair.status}
                    </strong>
                    <div>
                      {run.direction === 'JOB_TO_CANDIDATES' && (
                        <>
                          <a href={pair.candidateUrl}>{pair.candidateLabel}</a>{' '}
                          ·{' '}
                        </>
                      )}
                      <a href={pair.jobUrl}>{pair.jobLabel}</a>
                    </div>
                    {pair.status === 'SCORED' && (
                      <div>匹配值：{pair.score?.toFixed(2)} / 4</div>
                    )}
                    {pair.eligibility.reasons.map((reason) => (
                      <p key={reason.code}>{reason.message}</p>
                    ))}
                    {pair.error && <p>{pair.error}</p>}
                  </div>
                ))}
              {run.complete && !run.top?.length && (
                <StyledRecruitingMuted>{t`暂无匹配结果`}</StyledRecruitingMuted>
              )}
            </StyledRecruitingPanel>
          </>
        )}
      </StyledRecruitingStack>
    );
  const rows = (list.error ? [] : (list.data?.records ?? [])).filter(
    (row) =>
      row.direction === direction ||
      (direction === 'CANDIDATE_TO_JOBS' && row.direction === 'PAIR'),
  );
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingRow style={{ justifyContent: 'space-between' }}>
        <StyledRecruitingTitle>{t`匹配结果`}</StyledRecruitingTitle>
        <StyledRecruitingRow>
          <Select
            dropdownId="match-list-direction"
            value={direction}
            options={[
              { value: 'CANDIDATE_TO_JOBS', label: t`人 → 岗位` },
              { value: 'JOB_TO_CANDIDATES', label: t`岗位 → 人` },
            ]}
            onChange={(value) => {
              setOffset(0);
              setDirection(value);
            }}
          />
          <Button
            variant="ghost"
            startIcon={<IconRefresh size={16} />}
            onClick={() => {
              void list.reload();
            }}
          >{t`刷新`}</Button>
        </StyledRecruitingRow>
      </StyledRecruitingRow>
      {list.error && (
        <StyledRecruitingError role="alert">{list.error}</StyledRecruitingError>
      )}
      <div style={{ overflowX: 'auto' }}>
        <StyledRecruitingTable style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>{direction === 'JOB_TO_CANDIDATES' ? t`岗位` : t`姓名`}</th>
              {direction !== 'JOB_TO_CANDIDATES' && <th>{t`期望岗位`}</th>}
              <th>{t`状态`}</th>
              <th>{t`时间`}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.runId}>
                <td>{row.subjectLabel || '—'}</td>
                {direction !== 'JOB_TO_CANDIDATES' && (
                  <td>
                    <span
                      title={row.expectedRoles?.join('、')}
                      style={{
                        display: 'block',
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.expectedRoles?.join('、') || '—'}
                    </span>
                  </td>
                )}
                <td>{row.status}</td>
                <td
                  style={{
                    whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <time dateTime={row.createdAt}>
                    {new Date(row.createdAt).toLocaleString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}
                  </time>
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRunId(row.runId)}
                  >{t`查看结果`}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </StyledRecruitingTable>
      </div>
      {!list.loading && !rows.length && (
        <StyledRecruitingMuted>{t`暂无匹配记录`}</StyledRecruitingMuted>
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
