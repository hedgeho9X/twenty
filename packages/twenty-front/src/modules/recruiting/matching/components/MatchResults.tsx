import {
  ResultInput,
  ResultSelect,
} from '@/recruiting/shared/components/ResultControls';
import { ResultPagination } from '@/recruiting/shared/components/ResultPagination';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { MatchSelection } from './MatchSelection';
/** Shows matching history and a focused subject detail with current ranked results. */
import { useEffect, useRef, useState } from 'react';
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
  StyledRecruitingStatus,
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
  const tableScroll = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  const [runId, setRunId] = useState(initialRunId);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [readFilter, setReadFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [followFilter, setFollowFilter] = useState('');
  const [workflowError, setWorkflowError] = useState('');
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => new Set());
  const [direction, setDirection] = useState('CANDIDATE_TO_JOBS');
  const list = useRecruitingQuery<RecruitingPage<RecruitingMatchRun>>(
    `match-results?offset=${offset}&limit=${pageSize}&direction=${direction}&search=${encodeURIComponent(search)}&read=${readFilter}&followUp=${followFilter}&from=${from}&to=${to}`,
    0,
    active,
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
  useEffect(() => {
    if (!runId && tableScroll.current)
      tableScroll.current.scrollTop = scrollPosition.current;
  }, [list.data, runId]);
  const openResult = async (id: string) => {
    try {
      await recruitingRequest(`match-runs/${id}/reviewed`, { method: 'POST' });
      setViewedIds((previous) => new Set([...previous, id]));
    } catch {
      setWorkflowError(t`阅读状态未保存`);
    }
    setRunId(id);
  };
  const navigationRows = list.data?.records ?? [];
  const currentIndex = navigationRows.findIndex((row) => row.runId === runId);
  const nextUnread = navigationRows.find(
    (row, index) =>
      index > currentIndex && !row.reviewedAt && !viewedIds.has(row.runId),
  );
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
          <Button
            disabled={currentIndex <= 0}
            onClick={() =>
              void openResult(navigationRows[currentIndex - 1].runId)
            }
          >{t`上一条`}</Button>
          <Button
            disabled={
              currentIndex < 0 || currentIndex >= navigationRows.length - 1
            }
            onClick={() =>
              void openResult(navigationRows[currentIndex + 1].runId)
            }
          >{t`下一条`}</Button>
          <Button
            disabled={!nextUnread}
            onClick={() => nextUnread && void openResult(nextUnread.runId)}
          >{t`下一条未读`}</Button>
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
    <StyledRecruitingPanel
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: 'calc(100dvh - 160px)',
        minHeight: 300,
        boxSizing: 'border-box',
      }}
    >
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
      <ResultInput
        aria-label="搜索匹配结果"
        placeholder="搜索姓名、岗位或公司"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOffset(0);
        }}
      />
      <StyledRecruitingRow>
        <ResultSelect
          aria-label={t`阅读状态`}
          value={readFilter}
          onChange={(event) => {
            setReadFilter(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t`全部阅读状态`}</option>
          <option value="unread">{t`未读`}</option>
          <option value="read">{t`已读`}</option>
        </ResultSelect>
        <ResultSelect
          aria-label={t`筛选跟进状态`}
          value={followFilter}
          onChange={(event) => {
            setFollowFilter(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t`全部跟进状态`}</option>
          <option value="TODO">{t`待处理`}</option>
          <option value="TO_CONTACT">{t`待联系`}</option>
          <option value="CONTACTED">{t`已联系`}</option>
          <option value="DISMISSED">{t`暂不推进`}</option>
        </ResultSelect>
        <ResultInput
          aria-label={t`开始日期`}
          title={t`开始日期`}
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setOffset(0);
          }}
        />
        <ResultInput
          aria-label={t`结束日期`}
          title={t`结束日期`}
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setOffset(0);
          }}
        />
      </StyledRecruitingRow>
      {workflowError && (
        <StyledRecruitingError role="alert">
          {workflowError}
        </StyledRecruitingError>
      )}
      <div
        ref={tableScroll}
        onScroll={(event) => {
          scrollPosition.current = event.currentTarget.scrollTop;
        }}
        style={{
          overflow: 'auto',
          flex: 1,
          minHeight: 0,
        }}
      >
        <StyledRecruitingTable style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>{direction === 'JOB_TO_CANDIDATES' ? t`岗位` : t`姓名`}</th>
              {direction !== 'JOB_TO_CANDIDATES' && <th>{t`期望岗位`}</th>}
              <th>{t`阅读`}</th>
              <th>{t`跟进状态`}</th>
              <th>{t`匹配状态`}</th>
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
                <td>
                  <StyledRecruitingStatus
                    data-tone={
                      row.reviewedAt || viewedIds.has(row.runId)
                        ? 'neutral'
                        : 'blue'
                    }
                  >
                    {row.reviewedAt || viewedIds.has(row.runId)
                      ? t`已读`
                      : t`未读`}
                  </StyledRecruitingStatus>
                </td>
                <td>
                  <ResultSelect
                    aria-label={`${row.subjectLabel} 跟进状态`}
                    value={row.followUpStatus ?? 'TODO'}
                    style={{
                      color: (
                        {
                          TODO: '#666',
                          TO_CONTACT: '#a35e00',
                          CONTACTED: '#16814a',
                          DISMISSED: '#666',
                        } as Record<string, string>
                      )[row.followUpStatus ?? 'TODO'],
                      borderRadius: 6,
                      border: 'none',
                      background: (
                        {
                          TODO: '#f1f1f1',
                          TO_CONTACT: '#fff1d6',
                          CONTACTED: '#e0f3e7',
                          DISMISSED: '#ededed',
                        } as Record<string, string>
                      )[row.followUpStatus ?? 'TODO'],
                      padding: '4px 8px',
                    }}
                    onChange={async (event) => {
                      try {
                        await recruitingRequest(
                          `match-runs/${row.runId}/workflow`,
                          {
                            method: 'POST',
                            body: JSON.stringify({
                              status: event.target.value,
                            }),
                          },
                        );
                        await list.reload();
                      } catch {
                        setWorkflowError(t`跟进状态未保存，请重试`);
                      }
                    }}
                  >
                    <option value="TODO">{t`待处理`}</option>
                    <option value="TO_CONTACT">{t`待联系`}</option>
                    <option value="CONTACTED">{t`已联系`}</option>
                    <option value="DISMISSED">{t`暂不推进`}</option>
                  </ResultSelect>
                </td>
                <td>
                  {{
                    COMPLETED: t`已完成`,
                    PARTIAL: t`部分完成`,
                    NO_RESULTS: t`暂无结果`,
                    FAILED: t`处理失败`,
                    SUPERSEDED: t`资料已更新`,
                  }[row.status] ?? row.status}
                </td>
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
                    onClick={() => void openResult(row.runId)}
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
      <ResultPagination
        count={list.data?.count ?? 0}
        page={Math.floor(offset / pageSize) + 1}
        pageSize={pageSize}
        onPage={(page) => setOffset((page - 1) * pageSize)}
        onPageSize={(size) => {
          setPageSize(size);
          setOffset(0);
        }}
      />
    </StyledRecruitingPanel>
  );
};
