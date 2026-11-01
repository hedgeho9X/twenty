/** Shows matching history and a focused subject detail with current ranked results. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { IconArrowLeft, IconRefresh } from 'twenty-ui/icon';
import { Select } from '@/ui/input/components/Select';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { type RecruitingMatchRun } from '@/recruiting/types/RecruitingMatchRun';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import {
  RecruitingCandidateFacts,
  RecruitingCompanyName,
  RecruitingJobFacts,
} from './RecruitingMatchFacts';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTable,
  StyledRecruitingTitle,
} from './recruitingStyles';

/** Filters direction in the toolbar and preserves explicit warnings only when results are incomplete. */
export const RecruitingMatchResults = ({
  initialRunId,
  active = true,
}: {
  initialRunId?: string;
  onDraft?: (candidateId: string, jobId: string) => void;
  onSharing?: (candidateId: string, jobId: string) => void;
  active?: boolean;
}) => {
  const [runId, setRunId] = useState(initialRunId);
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState('CANDIDATE_TO_JOBS');
  const list = useRecruitingQuery<RecruitingPage<RecruitingMatchRun>>(
    `match-runs?offset=${offset}&direction=${direction}&completed=true`,
    8000,
    active,
  );
  const detail = useRecruitingQuery<RecruitingMatchRun>(
    runId ? `match-runs/${runId}` : null,
    runId ? 8000 : 0,
    active,
  );
  const run = detail.error ? undefined : detail.data;
  if (runId)
    return (
      <StyledRecruitingStack>
        <StyledRecruitingRow>
          <Button
            variant="ghost"
            startIcon={<IconArrowLeft size={16} />}
            onClick={() => setRunId(undefined)}
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
              {!run.complete && (
                <StyledRecruitingError role="status">
                  {run.error || t`当前结果尚未完成，或资料已经更新。`}
                </StyledRecruitingError>
              )}
              <StyledRecruitingTable>
                <thead>
                  <tr>
                    {run.direction === 'JOB_TO_CANDIDATES' ? (
                      <th>{t`姓名`}</th>
                    ) : (
                      <th>{t`岗位`}</th>
                    )}
                    <th>{t`公司`}</th>
                    <th>{t`匹配值`}</th>
                  </tr>
                </thead>
                <tbody>
                  {run.top?.map((pair) => (
                    <tr key={`${pair.candidateId}:${pair.jobId}`}>
                      <td>
                        {run.direction === 'JOB_TO_CANDIDATES' ? (
                          <a href={pair.candidateUrl}>{pair.candidateLabel}</a>
                        ) : (
                          <RecruitingJobFacts
                            id={pair.jobId}
                            label={pair.jobLabel}
                          />
                        )}
                      </td>
                      <td>
                        <RecruitingCompanyName id={pair.companyId} />
                      </td>
                      <td
                        style={{
                          whiteSpace: 'nowrap',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {pair.score?.toFixed(2)} / 4
                      </td>
                    </tr>
                  ))}
                </tbody>
              </StyledRecruitingTable>
              {!run.complete &&
                (run.results ?? [])
                  .filter((pair) => pair.status !== 'SCORED')
                  .map((pair) => (
                    <div key={`${pair.candidateId}:${pair.jobId}`}>
                      <strong>
                        {{
                          EXCLUDED: t`明确条件冲突`,
                          NEEDS_REVIEW: t`待补资料或人工核对`,
                          FAILED: t`处理失败`,
                        }[pair.status] ?? pair.status}
                      </strong>
                      <div>
                        {run.direction === 'JOB_TO_CANDIDATES' && (
                          <>
                            <a href={pair.candidateUrl}>
                              {pair.candidateLabel}
                            </a>{' '}
                            ·{' '}
                          </>
                        )}
                        <a href={pair.jobUrl}>{pair.jobLabel}</a>
                      </div>
                      {pair.eligibility.reasons.map((reason) => (
                        <p key={reason.code}>{reason.message}</p>
                      ))}
                      {pair.error && <p>{pair.error}</p>}
                    </div>
                  ))}
              {!run.top?.length && (
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
        <StyledRecruitingTable style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th>{direction === 'JOB_TO_CANDIDATES' ? t`岗位` : t`姓名`}</th>
              {direction !== 'JOB_TO_CANDIDATES' && <th>{t`期望岗位`}</th>}
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
                <td>{new Date(row.createdAt).toLocaleDateString()}</td>
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
