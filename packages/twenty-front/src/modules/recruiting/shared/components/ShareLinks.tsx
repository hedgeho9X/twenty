/** Lists authorized share subjects in the same fixed-header viewport as matching results. */
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  CardDescription,
} from '@/recruiting/shadcn/ui/card';
import { ScrollArea } from '@/recruiting/shadcn/ui/scroll-area';
import { Empty, EmptyHeader, EmptyTitle } from '@/recruiting/shadcn/ui/empty';
import { Skeleton } from '@/recruiting/shadcn/ui/skeleton';
import { Alert, AlertDescription } from '@/recruiting/shadcn/ui/alert';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/recruiting/shadcn/ui/table';
import { ResultInput } from '@/recruiting/shared/components/ResultControls';
import { ResultPagination } from './ResultPagination';
import { Button } from '@/recruiting/shadcn/compat';
import { IconCopy, IconEye, IconPlayerStop } from 'twenty-ui/icon';
import { useState } from 'react';
import { useRecruitingQuery } from '../hooks/useRecruitingQuery';
import { recruitingRequest } from '../api/request';
import {
  StyledRecruitingTable,
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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const query = useRecruitingQuery<{ records: ShareRow[]; count: number }>(
    `share-results?search=${encodeURIComponent(search)}&offset=${(page - 1) * pageSize}&limit=${pageSize}`,
    0,
    active,
  );
  const rows = query.error || query.loading ? [] : (query.data?.records ?? []);
  const currentPage = page;
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
    <Card className="flex h-full min-h-0 gap-0 py-0">
      <CardHeader className="gap-3 border-b py-4">
        <CardTitle role="heading" aria-level={2}>
          分享链接
        </CardTitle>
        <ResultInput
          aria-label="搜索分享资料"
          placeholder="搜索分享对象或岗位"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </CardHeader>
      {query.error && (
        <Alert variant="destructive" className="mx-6 mt-4">
          <AlertDescription>{query.error}</AlertDescription>
        </Alert>
      )}
      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea className="h-full">
          <StyledRecruitingTable
            className="recruiting-share-table"
            containerClassName="overflow-visible"
          >
            <TableHeader>
              <TableRow>
                <TableHead>分享对象</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.loading && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <div role="status" aria-label="正在加载分享链接">
                      <Skeleton className="h-16 w-full" />
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    {row.matchRunId ? (
                      <StyledRecruitingRecordLink
                        className="block truncate"
                        title={row.subjectLabel}
                        href={`/recruiting-workspace?tab=matches&runId=${encodeURIComponent(row.matchRunId)}`}
                      >
                        {row.subjectLabel}
                      </StyledRecruitingRecordLink>
                    ) : (
                      <span
                        className="block truncate"
                        title={row.subjectLabel || row.jobs[0]?.name}
                      >
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
                  </TableCell>
                  <TableCell style={{ whiteSpace: 'nowrap' }}>
                    <time
                      dateTime={row.createdAt}
                      title={new Date(row.createdAt).toLocaleString('zh-CN')}
                    >
                      {new Date(row.createdAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </time>
                  </TableCell>
                  <TableCell style={{ width: 132 }}>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </StyledRecruitingTable>
          {query.data && !query.loading && !query.error && !rows.length && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>暂无分享链接</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </ScrollArea>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-0 p-0">
        <ResultPagination
          isLoading={query.loading}
          hasCount={query.data !== undefined}
          count={query.data?.count ?? 0}
          page={currentPage}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
        {message && (
          <CardDescription role="status" className="px-6 py-2">
            {message}
          </CardDescription>
        )}
      </CardFooter>
    </Card>
  );
};
