/** Verifies bounded recommendation loading, usable partial results and explicit date defaults. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecruitingMatchResults } from '../MatchResults';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/shared/api/request';
jest.mock('@/recruiting/shared/hooks/useRecruitingQuery');
jest.mock('@/recruiting/shared/api/request');
jest.mock('twenty-ui/icon', () => ({
  IconArrowLeft: () => null,
  IconRefresh: () => null,
  IconChevronDown: () => null,
  IconChevronUp: () => null,
  IconChevronLeft: () => null,
  IconChevronRight: () => null,
  IconCheck: () => null,
  IconX: () => null,
  IconDotsVertical: () => null,
  IconLoader: () => null,
  IconLink: () => null,
  IconCopy: () => null,
  IconExternalLink: () => null,
}));
jest.mock('../MatchFacts', () => ({
  RecruitingCompanyName: ({ label }: { label: string }) => <span>{label}</span>,
  RecruitingJobFacts: ({ label }: { label: string }) => <span>{label}</span>,
}));
const pairs = Array.from({ length: 10 }, (_, i) => ({
  candidateId: `candidate-${i}`,
  jobId: `job-${i}`,
  candidateLabel: `候选人${i}`,
  jobLabel: `岗位${i}`,
  companyLabel: '公司',
  status: 'SCORED',
  score: 3 - i / 10,
  cached: false,
  eligibility: { status: 'eligible', reasons: [] },
}));
let direction = 'CANDIDATE_TO_JOBS';
let loading = false;
let state = 'COMPLETED';
let summary: Record<string, unknown>;
let page5: Record<string, unknown>,
  page10: Record<string, unknown>,
  list: Record<string, unknown>;
beforeEach(() => {
  jest.clearAllMocks();
  direction = 'CANDIDATE_TO_JOBS';
  loading = false;
  state = 'COMPLETED';
  jest.mocked(recruitingRequest).mockResolvedValue({});
  summary = {
    runId: 'run',
    direction,
    subjectId: 'subject',
    subjectLabel: '测试对象',
    status: state,
    createdAt: '2026-11-05T00:00:00Z',
    executionComplete: true,
    counts: {
      total: 500,
      processed: 500,
      scored: 480,
      excluded: 20,
      cached: 0,
      failed: 0,
      needsReview: 0,
    },
  };
  page5 = {
    runId: 'run',
    records: pairs.slice(0, 5),
    count: 480,
    hasNextPage: true,
    staleOnPage: 0,
  };
  page10 = { ...page5, records: pairs };
  list = { records: [summary], count: 1, hasNextPage: false };
  jest.mocked(useRecruitingQuery).mockImplementation(
    (path) =>
      ({
        data: path?.endsWith('/summary')
          ? summary
          : path?.includes('/results?')
            ? path.includes('limit=10')
              ? page10
              : page5
            : path?.startsWith('match-results?')
              ? loading
                ? undefined
                : list
              : undefined,
        error: '',
        loading,
        reload: jest.fn(),
      }) as never,
  );
});
it('loads five recommendations first and requests ten only after expanding', async () => {
  render(<RecruitingMatchResults initialRunId="run" />);
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(5));
  expect(useRecruitingQuery).toHaveBeenCalledWith(
    'match-runs/run/summary',
    expect.any(Number),
    true,
  );
  expect(useRecruitingQuery).toHaveBeenCalledWith(
    'match-runs/run/results?offset=0&limit=5&status=SCORED',
    expect.any(Number),
    true,
  );
  expect(
    jest
      .mocked(useRecruitingQuery)
      .mock.calls.some(([path]) => path === 'match-runs/run'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '展开到前 10 名' }));
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(10));
});
it('keeps PDF sharing available for scored candidates in a partial job run', async () => {
  summary.direction = 'JOB_TO_CANDIDATES';
  summary.status = 'PARTIAL';
  render(<RecruitingMatchResults initialRunId="run" />);
  await screen.findByText(/部分资料需要核对/);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '生成分享链接' }),
    ).not.toBeDisabled(),
  );
  expect(
    screen.getByLabelText('附带所选候选人的全部 PDF / 原始附件'),
  ).toBeChecked();
});
it('defaults to all time and displays loading placeholders rather than an empty result', () => {
  loading = true;
  render(<RecruitingMatchResults />);
  expect(screen.getByRole('combobox', { name: '时间范围' })).toHaveTextContent(
    '全部时间',
  );
  expect(screen.getByLabelText('正在加载结果')).toBeInTheDocument();
  expect(screen.queryByText('没有符合条件的匹配结果')).not.toBeInTheDocument();
  expect(document.querySelector('input[type="date"]')).toBeNull();
});

it('restores the same view after detail navigation but starts a new page at the top', async () => {
  list = { ...list, count: 100 };
  const { container } = render(<RecruitingMatchResults />);
  let viewport = container.querySelector('[data-radix-scroll-area-viewport]')!;
  viewport.scrollTop = 180;
  viewport.scrollLeft = 90;
  fireEvent.scroll(viewport);
  fireEvent.click(screen.getByRole('button', { name: '查看结果' }));
  fireEvent.click(await screen.findByRole('button', { name: '返回列表' }));
  viewport = container.querySelector('[data-radix-scroll-area-viewport]')!;
  expect(viewport.scrollTop).toBe(180);
  expect(viewport.scrollLeft).toBe(90);
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await waitFor(() => expect(viewport.scrollTop).toBe(0));
  expect(viewport.scrollLeft).toBe(0);
});
