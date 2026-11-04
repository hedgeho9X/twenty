/** Lists share subjects with compact actions and an optional link to their source match. */
import { ResultPagination } from './ResultPagination';
import { Button } from 'twenty-ui/primitives/input';
import { IconCopy, IconEye, IconPlayerStop } from 'twenty-ui/icon';
import { useState } from 'react';
import { useRecruitingQuery } from '../hooks/useRecruitingQuery';
import { recruitingRequest } from '../api/request';
import {
  StyledRecruitingPanel,
  StyledRecruitingTable,
  StyledRecruitingTitle,
  StyledRecruitingRecordLink,
  StyledRecruitingMuted,
} from '../styles';

/** Supports older links without inventing a matching origin for them. */
type ShareRow = {
  key: string;
  url: string;
  createdAt: string;
  subjectLabel?: string;
  matchRunId?: string;
  jobs: { name: string; status: string }[];
  candidateIds: string[];
};

/** Serializes row actions and keeps clipboard failures visible. */
export const ShareLinks = ({ active }: { active: boolean }) => {
  const query = useRecruitingQuery<ShareRow[]>('share-links', 0, active);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const rows = (query.error ? [] : (query.data ?? [])).filter((row) =>
    [row.subjectLabel, ...row.jobs.map((job) => job.name)]
      .join(' ')
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(rows.length / pageSize)),
  );
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string>();
  const execute = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingTitle>分享链接</StyledRecruitingTitle>
      <input
        aria-label="搜索分享资料"
        placeholder="搜索分享对象或岗位"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      <div
        style={{
          maxHeight: 'calc(100vh - 330px)',
          overflow: 'auto',
          minHeight: 160,
        }}
      >
        <StyledRecruitingTable>
          <thead>
            <tr>
              <th>分享对象</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice((currentPage - 1) * pageSize, currentPage * pageSize)
              .map((row) => (
                <tr key={row.key}>
                  <td>
                    {row.matchRunId ? (
                      <StyledRecruitingRecordLink
                        href={`/recruiting-workspace?tab=matches&runId=${encodeURIComponent(row.matchRunId)}`}
                      >
                        {row.subjectLabel}
                      </StyledRecruitingRecordLink>
                    ) : (
                      <span>
                        {row.subjectLabel || row.jobs[0]?.name || '分享资料'}
                      </span>
                    )}
                    <StyledRecruitingMuted>
                      {[
                        row.jobs.length ? `${row.jobs.length} 个岗位` : '',
                        row.candidateIds.length
                          ? `${row.candidateIds.length} 位候选人`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </StyledRecruitingMuted>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td style={{ width: 132 }}>
                    <div
                      style={{ display: 'flex', flexWrap: 'nowrap', gap: 8 }}
                    >
                      <Button
                        variant="ghost"
                        aria-label="预览分享"
                        title="预览分享"
                        onClick={() =>
                          window.open(row.url, '_blank', 'noopener,noreferrer')
                        }
                      >
                        <IconEye size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label="复制链接"
                        title="复制链接"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void execute(row.key, async () => {
                            await navigator.clipboard.writeText(row.url);
                            setMessage('链接已复制');
                          })
                        }
                      >
                        <IconCopy size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label="撤销分享"
                        title="撤销分享"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void execute(row.key, async () => {
                            await recruitingRequest(
                              `share-links/${row.key}/revoke`,
                              { method: 'POST' },
                            );
                            query.reload();
                            setMessage('分享已撤销');
                          })
                        }
                      >
                        <IconPlayerStop
                          size={16}
                          color="#d64545"
                          fill="#d64545"
                        />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </StyledRecruitingTable>
      </div>
      <ResultPagination
        count={rows.length}
        page={currentPage}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
      {!query.loading && !rows.length && <p>暂无分享链接</p>}
      {(message || query.error) && (
        <p role="status">{message || query.error}</p>
      )}
    </StyledRecruitingPanel>
  );
};
