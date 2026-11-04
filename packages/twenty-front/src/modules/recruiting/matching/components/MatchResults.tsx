import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/recruiting/shadcn/ui/empty';
/** Presents a paginated work list and a lazy top-five/top-ten recommendation detail. */
import { useEffect, useRef, useState } from 'react';
import { IconArrowLeft, IconRefresh } from 'twenty-ui/icon';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/recruiting/shadcn/ui/card';
import { Button } from '@/recruiting/shadcn/ui/button';
import { Input } from '@/recruiting/shadcn/ui/input';
import { Badge } from '@/recruiting/shadcn/ui/badge';
import { Skeleton } from '@/recruiting/shadcn/ui/skeleton';
import { ScrollArea } from '@/recruiting/shadcn/ui/scroll-area';
import { Alert, AlertDescription } from '@/recruiting/shadcn/ui/alert';
import { Progress } from '@/recruiting/shadcn/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/recruiting/shadcn/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/recruiting/shadcn/ui/table';
import { WorkflowSelect } from '@/recruiting/shadcn/WorkflowSelect';
import { DateRangeFilter } from '@/recruiting/shadcn/DateRangeFilter';
import { ResultPagination } from '@/recruiting/shared/components/ResultPagination';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { type RecruitingMatchRun } from '../types/MatchRun';
import { type RecruitingPair } from '../types/Pair';
import { type RecruitingPage } from '@/recruiting/shared/types/Page';
import { MatchSelection } from './MatchSelection';

type ResultPage = RecruitingPage<RecruitingPair> & {
  runId: string;
  staleOnPage: number;
};
const stateLabels: Record<string, string> = {
  COMPLETED: '已完成',
  PARTIAL: '部分完成',
  NO_RESULTS: '暂无推荐',
  FAILED: '处理失败',
  SUPERSEDED: '资料已更新',
  PROCESSING: '匹配中',
  QUEUED: '排队中',
};

/** Makes loading explicit without mounting hundreds of result rows. */
const LoadingRows = () => (
  <div className="flex flex-col gap-3 p-5" aria-label="正在加载结果">
    {Array.from({ length: 5 }, (_, i) => (
      <Skeleton key={i} className="h-12 w-full" />
    ))}
  </div>
);

export const RecruitingMatchResults = ({
  initialRunId,
  onBack,
  active = true,
}: {
  initialRunId?: string;
  onBack?: () => void;
  active?: boolean;
}) => {
  const [runId, setRunId] = useState(initialRunId);
  const [offset, setOffset] = useState(0),
    [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [direction, setDirection] = useState('CANDIDATE_TO_JOBS');
  const [readFilter, setReadFilter] = useState(''),
    [followFilter, setFollowFilter] = useState('');
  const [dates, setDates] = useState({ from: '', to: '' });
  const [error, setError] = useState(''),
    [busyId, setBusyId] = useState<string>();
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const [topLimit, setTopLimit] = useState(5),
    [running, setRunning] = useState(true);
  const [lastPage, setLastPage] = useState<ResultPage>();
  const scrollRoot = useRef<HTMLDivElement>(null),
    scrollTop = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useRecruitingQuery<RecruitingPage<RecruitingMatchRun>>(
    `match-results?offset=${offset}&limit=${pageSize}&direction=${direction}&search=${encodeURIComponent(query)}&read=${readFilter}&followUp=${followFilter}&from=${dates.from}&to=${dates.to}`,
    0,
    active,
  );
  const summary = useRecruitingQuery<
    RecruitingMatchRun & { executionComplete: boolean }
  >(
    runId ? `match-runs/${runId}/summary` : null,
    running ? 3000 : 0,
    active && Boolean(runId),
  );
  const results = useRecruitingQuery<ResultPage>(
    runId
      ? `match-runs/${runId}/results?offset=0&limit=${topLimit}&status=${summary.data?.direction === 'PAIR' ? '' : 'SCORED'}`
      : null,
    running ? 3000 : 0,
    active && Boolean(runId),
  );
  useEffect(() => {
    if (summary.data && summary.data.runId === runId)
      setRunning(!summary.data.executionComplete);
  }, [summary.data, runId]);
  useEffect(() => {
    if (results.data?.runId === runId) setLastPage(results.data);
  }, [results.data, runId]);
  useEffect(() => {
    if (!runId) {
      const viewport = scrollRoot.current?.querySelector(
        '[data-radix-scroll-area-viewport]',
      );
      if (viewport) viewport.scrollTop = scrollTop.current;
    }
  }, [runId, list.data]);
  const rows = list.data?.records ?? [];
  const index = rows.findIndex((row) => row.runId === runId);
  const open = (id: string) => {
    setRunId(id);
    setTopLimit(5);
    setRunning(true);
    setLastPage(undefined);
    setError('');
    void recruitingRequest(`match-runs/${id}/reviewed`, { method: 'POST' })
      .then(() => setViewed((previous) => new Set([...previous, id])))
      .catch(() => setError('阅读状态未保存，请稍后重试'));
  };
  const back = () => {
    setRunId(undefined);
    setRunning(false);
    onBack?.();
  };
  const saveWorkflow = async (id: string, status: string) => {
    setBusyId(id);
    setError('');
    try {
      await recruitingRequest(`match-runs/${id}/workflow`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await list.reload();
    } catch {
      setError('跟进状态保存失败');
    } finally {
      setBusyId(undefined);
    }
  };
  if (runId) {
    const run = summary.data?.runId === runId ? summary.data : undefined;
    const page = lastPage?.runId === runId ? lastPage : undefined;
    const nextUnread = rows.find(
      (row, i) => i > index && !row.reviewedAt && !viewed.has(row.runId),
    );
    return (
      <Card className="flex h-full min-h-0 gap-0 py-0">
        <CardHeader className="gap-3 border-b py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={back}>
              <IconArrowLeft data-icon="inline-start" />
              返回列表
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={index <= 0}
                onClick={() => open(rows[index - 1].runId)}
              >
                上一条
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={index < 0 || index >= rows.length - 1}
                onClick={() => open(rows[index + 1].runId)}
              >
                下一条
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!nextUnread}
                onClick={() => nextUnread && open(nextUnread.runId)}
              >
                下一条未读
              </Button>
            </div>
          </div>
          {run ? (
            <>
              <div className="flex items-center gap-3">
                <CardTitle>{run.subjectLabel}</CardTitle>
                <Badge
                  variant={run.status === 'COMPLETED' ? 'success' : 'secondary'}
                >
                  {stateLabels[run.status] ?? run.status}
                </Badge>
              </div>
              <CardDescription>
                已处理 {run.counts.processed} / {run.counts.total} · 已评分{' '}
                {run.counts.scored} · 默认展示推荐前 5 名，可展开至前 10 名
              </CardDescription>
              {running && (
                <Progress
                  value={
                    (100 * run.counts.processed) / Math.max(1, run.counts.total)
                  }
                />
              )}
            </>
          ) : (
            <Skeleton className="h-12 w-80" />
          )}
        </CardHeader>
        <ScrollArea className="min-h-0 flex-1">
          <CardContent className="flex flex-col gap-4 p-5">
            {(error || summary.error || results.error) && (
              <Alert variant="destructive">
                <AlertDescription>
                  {error || summary.error || results.error}
                </AlertDescription>
              </Alert>
            )}
            {run?.status === 'PARTIAL' && (
              <Alert>
                <AlertDescription>
                  部分资料需要核对。以下仍有效的已评分结果可以直接选择、生成文案和分享
                  PDF。
                </AlertDescription>
              </Alert>
            )}
            {!!page?.staleOnPage && (
              <Alert>
                <AlertDescription>
                  部分资料已经更新，过期评分不可选择，请重新匹配。
                </AlertDescription>
              </Alert>
            )}
            {page?.records
              .filter((pair) => pair.status !== 'SCORED')
              .map((pair) => (
                <Alert key={`${pair.candidateId}:${pair.jobId}`}>
                  <AlertDescription>
                    <strong>
                      {pair.status === 'EXCLUDED'
                        ? '明确条件冲突'
                        : pair.status === 'NEEDS_REVIEW'
                          ? '待补资料或人工核对'
                          : pair.status === 'FAILED'
                            ? '处理失败'
                            : '资料已更新'}
                    </strong>
                    <div>
                      <a href={pair.candidateUrl}>{pair.candidateLabel}</a> ·{' '}
                      <a href={pair.jobUrl}>{pair.jobLabel}</a>
                    </div>
                    <p>
                      {pair.error ||
                        pair.eligibility?.reasons
                          .map((reason) => reason.message)
                          .join('；')}
                    </p>
                  </AlertDescription>
                </Alert>
              ))}
            {!page ? (
              <LoadingRows />
            ) : !page.records.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {running ? '正在生成推荐结果…' : '暂无可推荐的有效结果'}
                  </EmptyTitle>
                  <EmptyDescription>
                    可以稍后刷新，或检查原始资料。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              run && (
                <MatchSelection
                  run={{ ...run, results: page.records, top: page.records }}
                  active={active}
                  showAll
                />
              )
            )}
            {page && page.count > 5 && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  disabled={results.loading}
                  onClick={() => setTopLimit(topLimit === 5 ? 10 : 5)}
                >
                  {results.loading
                    ? '加载中…'
                    : topLimit === 5
                      ? '展开到前 10 名'
                      : '收起为前 5 名'}
                </Button>
              </div>
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    );
  }
  return (
    <Card className="flex h-full min-h-0 gap-0 py-0">
      <CardHeader className="gap-4 border-b py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>匹配结果</CardTitle>
            <CardDescription>逐条查看、筛选与跟进推荐结果</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={direction}
              onValueChange={(value) => {
                setDirection(value);
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-36" aria-label="匹配方向">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="CANDIDATE_TO_JOBS">人 → 岗位</SelectItem>
                  <SelectItem value="JOB_TO_CANDIDATES">岗位 → 人</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label="刷新结果"
              onClick={() => void list.reload()}
            >
              <IconRefresh />
            </Button>
          </div>
        </div>
        <div className="recruiting-results-filters">
          <Input
            className="min-w-48 flex-1"
            placeholder="搜索姓名、岗位或公司"
            aria-label="搜索匹配结果"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
          <Select
            value={readFilter || 'all'}
            onValueChange={(value) => {
              setReadFilter(value === 'all' ? '' : value);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-32" aria-label="阅读状态">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部阅读</SelectItem>
                <SelectItem value="unread">未读</SelectItem>
                <SelectItem value="read">已读</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <WorkflowSelect
            filter
            value={followFilter}
            onChange={(value) => {
              setFollowFilter(value);
              setOffset(0);
            }}
          />
          <DateRangeFilter
            from={dates.from}
            to={dates.to}
            onChange={(from, to) => {
              setDates({ from, to });
              setOffset(0);
            }}
          />
        </div>
      </CardHeader>
      {(error || list.error) && (
        <Alert variant="destructive">
          <AlertDescription>{error || list.error}</AlertDescription>
        </Alert>
      )}
      <ScrollArea
        ref={scrollRoot}
        className="min-h-0 flex-1"
        onScrollCapture={(event) => {
          if (event.target instanceof HTMLElement)
            scrollTop.current = event.target.scrollTop;
        }}
      >
        {list.loading ? (
          <LoadingRows />
        ) : (
          <Table
            className="recruiting-results-table"
            data-direction={direction}
          >
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>
                  {direction === 'JOB_TO_CANDIDATES' ? '岗位' : '候选人'}
                </TableHead>
                {direction !== 'JOB_TO_CANDIDATES' && (
                  <TableHead>期望岗位</TableHead>
                )}
                <TableHead>阅读</TableHead>
                <TableHead>跟进状态</TableHead>
                <TableHead>匹配状态</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.runId}>
                  <TableCell className="font-medium">
                    {row.subjectLabel || '—'}
                  </TableCell>
                  {direction !== 'JOB_TO_CANDIDATES' && (
                    <TableCell
                      className="max-w-56 truncate"
                      title={row.expectedRoles?.join('、')}
                    >
                      {row.expectedRoles?.join('、') || '—'}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge
                      variant={
                        row.reviewedAt || viewed.has(row.runId)
                          ? 'secondary'
                          : 'info'
                      }
                    >
                      {row.reviewedAt || viewed.has(row.runId)
                        ? '已读'
                        : '未读'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <WorkflowSelect
                      value={row.followUpStatus ?? 'TODO'}
                      disabled={busyId === row.runId}
                      onChange={(value) => void saveWorkflow(row.runId, value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {stateLabels[row.status] ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
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
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => open(row.runId)}
                    >
                      查看结果
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!list.loading && !rows.length && !list.error && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>没有符合条件的匹配结果</EmptyTitle>
              <EmptyDescription>试试调整筛选条件。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </ScrollArea>
      <ResultPagination
        count={list.data?.count ?? 0}
        page={Math.floor(offset / pageSize) + 1}
        pageSize={pageSize}
        onPage={(page) => {
          scrollTop.current = 0;
          setOffset((page - 1) * pageSize);
        }}
        onPageSize={(size) => {
          scrollTop.current = 0;
          setPageSize(size);
          setOffset(0);
        }}
      />
    </Card>
  );
};
