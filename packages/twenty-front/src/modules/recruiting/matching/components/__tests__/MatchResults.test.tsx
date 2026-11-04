/** Verifies persisted partial history can be reopened without enabling recommendation actions. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { RecruitingMatchResults } from '../MatchResults';
import { MatchSelection } from '../MatchSelection';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';

jest.mock('@/recruiting/shared/hooks/useRecruitingQuery');
jest.mock('@/recruiting/shared/api/request', () => ({
  recruitingRequest: jest.fn().mockResolvedValue({}),
}));
jest.mock('../MatchSelection', () => ({
  MatchSelection: jest.fn(() => <button>生成沟通文案</button>),
}));
jest.mock('../MatchFacts', () => ({
  RecruitingCandidateFacts: ({ label }: { label: string }) => <h2>{label}</h2>,
}));
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingPanel: 'section',
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
  StyledRecruitingRow: 'div',
  StyledRecruitingStack: 'div',
  StyledRecruitingTable: 'table',
  StyledRecruitingTitle: 'h2',
  StyledRecruitingStatus: 'span',
}));
jest.mock('twenty-ui/icon', () => ({
  IconRefresh: () => null,
  IconArrowLeft: () => null,
}));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label="匹配方向"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const makeRun = (direction: string, unscoredStatus: string) =>
  ({
    runId: 'saved-run',
    direction,
    subjectId: 'subject',
    subjectLabel: '匹配来源',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'PARTIAL',
    complete: false,
    counts: {
      total: 2,
      processed: 2,
      scored: 1,
      needsReview: 1,
      failed: 0,
      cached: 0,
      excluded: 0,
    },
    results: ['SCORED', unscoredStatus].map((status, index) => ({
      candidateId: `candidate-${index}`,
      candidateLabel: `候选人${index}`,
      candidateUrl: `/object/person/candidate-${index}`,
      jobId: `job-${index}`,
      jobLabel: `岗位${index}`,
      jobUrl: `/object/recruitmentJob/job-${index}`,
      status,
      score: status === 'SCORED' ? 3.25 : undefined,
      cached: false,
      eligibility: { status: 'eligible', reasons: [] },
    })),
  }) as RecruitingMatchRun;

beforeEach(() => jest.clearAllMocks());

it.each([
  ['CANDIDATE_TO_JOBS', 'NEEDS_REVIEW'],
  ['CANDIDATE_TO_JOBS', 'FAILED'],
  ['JOB_TO_CANDIDATES', 'NEEDS_REVIEW'],
  ['JOB_TO_CANDIDATES', 'FAILED'],
])(
  'recovers %s partial history containing %s after remount',
  async (direction, unscoredStatus) => {
    const run = makeRun(direction, unscoredStatus);
    jest
      .mocked(useRecruitingQuery)
      .mockImplementation(<T,>(path: string | null) => ({
        data: (path === 'match-runs/saved-run'
          ? run
          : { records: [run], hasNextPage: false }) as T,
        error: '',
        loading: false,
        reload: jest.fn(),
      }));

    // Simulate leaving the result page and returning without an in-memory run ID.
    const previous = render(
      <RecruitingMatchResults initialRunId="saved-run" />,
    );
    previous.unmount();
    render(<RecruitingMatchResults />);
    fireEvent.change(screen.getByRole('combobox', { name: '匹配方向' }), {
      target: { value: direction },
    });
    expect(useRecruitingQuery).toHaveBeenCalledWith(
      `match-results?offset=0&limit=50&direction=${direction}&search=&read=&followUp=&from=&to=`,
      0,
      true,
    );
    expect(
      within(screen.getByRole('table')).getByText('部分完成'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看结果' }));
    await screen.findByText('匹配值：3.25 / 4');
    expect(screen.getByText('匹配值：3.25 / 4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '岗位0' })).toHaveAttribute(
      'href',
      '/object/recruitmentJob/job-0',
    );
    if (direction === 'JOB_TO_CANDIDATES')
      expect(screen.getByRole('link', { name: '候选人0' })).toHaveAttribute(
        'href',
        '/object/person/candidate-0',
      );
    expect(
      screen.getByText(
        unscoredStatus === 'FAILED' ? '处理失败' : '待补资料或人工核对',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/已评分 1 \/ 2 项/)).toHaveTextContent(
      '结果覆盖不完整',
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '生成沟通文案' }),
    ).not.toBeInTheDocument();
    expect(MatchSelection).not.toHaveBeenCalled();
    expect(useRecruitingQuery).toHaveBeenLastCalledWith(
      'match-runs/saved-run',
      0,
      true,
    );
  },
);

it('retains selection and draft actions for complete results', () => {
  const run = makeRun('CANDIDATE_TO_JOBS', 'NEEDS_REVIEW');
  run.status = 'COMPLETED';
  run.complete = true;
  run.top = run.results?.filter((pair) => pair.status === 'SCORED');
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: run,
    loading: false,
    error: '',
    reload: jest.fn(),
  });
  render(<RecruitingMatchResults initialRunId="saved-run" />);
  expect(
    screen.getByRole('button', { name: '生成沟通文案' }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/结果覆盖不完整/)).not.toBeInTheDocument();
});
