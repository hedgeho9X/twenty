/** Verifies linked-record replacement, failed JD editing and non-scored match outcomes without external requests. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecruitingCompanyJobs } from '@/recruiting/components/RecruitingCompanyJobs';
import { RecruitingDrafts } from '@/recruiting/components/RecruitingDrafts';
import { RecruitingSharing } from '@/recruiting/components/RecruitingSharing';
import { RecruitingMatchResults } from '@/recruiting/components/RecruitingMatchResults';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import {
  recruitingRequest,
  uploadRecruitingFile,
} from '@/recruiting/utils/recruitingRequest';
import { type RecruitingPair } from '@/recruiting/types/RecruitingPair';

jest.mock('@/recruiting/hooks/useRecruitingQuery');
jest.mock('@/recruiting/utils/recruitingRequest');
jest.mock('@/recruiting/components/recruitingStyles', () => ({
  StyledRecruitingDrop: 'div',
  StyledRecruitingForm: 'div',
  StyledRecruitingSteps: 'nav',
  StyledRecruitingChoices: 'div',
  StyledRecruitingStatus: 'span',
  StyledRecruitingJobHover: 'div',
  StyledRecruitingRecordLink: 'a',
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
  StyledRecruitingPanel: 'section',
  StyledRecruitingRow: 'div',
  StyledRecruitingStack: 'div',
  StyledRecruitingTable: 'table',
  StyledRecruitingTitle: 'h2',
}));
jest.mock('twenty-ui/icon', () => ({
  IconBuildingSkyscraper: () => null,
  IconPlus: () => null,
  IconUpload: () => null,
  IconArrowLeft: () => null,
  IconRefresh: () => null,
}));
jest.mock('twenty-ui/primitives/data-display', () => ({ Badge: 'span' }));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
  Field: { Root: 'div', Label: 'label' },
  Input: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <input
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
  Textarea: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <textarea
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
}));
jest.mock('@/ui/input/components/Select', () => ({ Select: () => null }));
jest.mock('@/recruiting/components/RecruitingContracts', () => ({
  RecruitingContracts: () => null,
}));
jest.mock('@/recruiting/components/RecruitingActivities', () => ({
  RecruitingActivities: () => null,
}));
jest.mock('@/recruiting/components/RecruitingJobDraftEditor', () => ({
  RecruitingJobDraftEditor: () => null,
}));
jest.mock('@/recruiting/components/RecruitingRecordPicker', () => ({
  RecruitingRecordPicker: ({
    label,
    selected,
    onSelect,
  }: {
    label: string;
    selected?: { id: string };
    onSelect: (record: unknown) => void;
  }) =>
    selected ? (
      <button
        onClick={() => onSelect(undefined)}
      >{`${label}:clear:${selected.id}`}</button>
    ) : (
      <button
        onClick={() =>
          onSelect({
            id: 'replacement',
            name:
              label === '公司'
                ? 'Fixture company'
                : { firstName: 'Fixture', lastName: 'B' },
          })
        }
      >{`${label}:choose`}</button>
    ),
}));

let queryData: Record<string, unknown>;

beforeEach(() => {
  jest.resetAllMocks();
  queryData = {};
  jest
    .mocked(useRecruitingQuery)
    .mockImplementation(<T,>(path: string | null) => ({
      data: queryData[path ?? ''] as T,
      error: '',
      loading: false,
      reload: jest.fn().mockResolvedValue(undefined),
    }));
});

it.each([RecruitingDrafts, RecruitingSharing])(
  'allows replacing a candidate and job initially linked from a matching result',
  (Component) => {
    queryData['candidates/linked-person'] = {
      id: 'linked-person',
      name: { firstName: 'Fixture', lastName: 'A' },
    };
    queryData['jobs/linked-job'] = { id: 'linked-job', name: 'Fixture job' };
    render(
      <Component
        initialCandidateId="linked-person"
        initialJobId="linked-job"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /:clear:linked-person$/ }),
    );
    expect(
      screen.queryByRole('button', { name: /:clear:linked-person$/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^候选人:choose$/ }));
    expect(
      screen.getByRole('button', { name: /:clear:replacement$/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /:clear:linked-job$/ }));
    expect(
      screen.queryByRole('button', { name: /:clear:linked-job$/ }),
    ).not.toBeInTheDocument();
  },
);

it('retains text, notes and completed uploads when reopening a failed JD submission', async () => {
  jest.mocked(uploadRecruitingFile).mockResolvedValue({
    fileId: 'fixture-file',
    label: 'fixture.pdf',
    role: 'primary',
    uploadReceipt: 'fixture-receipt',
  });
  jest
    .mocked(recruitingRequest)
    .mockRejectedValueOnce(new Error('Temporary failure'))
    .mockResolvedValueOnce({ intakeId: 'accepted' });
  render(
    <RecruitingCompanyJobs
      onSubmitted={jest.fn()}
      onIntakeChange={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '公司:choose' }));
  expect(screen.queryByRole('button', { name: '新建公司' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一步：添加材料' }));
  const [text, note] = screen.getAllByRole('textbox');
  fireEvent.change(text, { target: { value: 'Original full JD' } });
  fireEvent.change(note, { target: { value: 'Original operator note' } });
  fireEvent.change(screen.getByLabelText('添加岗位文件'), {
    target: { files: [new File(['fixture'], 'fixture.pdf')] },
  });
  fireEvent.click(screen.getByRole('button', { name: '整理并预览岗位' }));
  await screen.findByText('Temporary failure');

  const firstInput = JSON.parse(
    jest.mocked(recruitingRequest).mock.calls[0][1]!.body as string,
  );
  fireEvent.click(screen.getByRole('button', { name: '重新编辑材料' }));
  expect(text).toHaveValue('Original full JD');
  expect(note).toHaveValue('Original operator note');
  expect(text).not.toBeDisabled();
  expect(screen.getByText('fixture.pdf')).toBeInTheDocument();
  fireEvent.change(text, { target: { value: 'Corrected full JD' } });
  fireEvent.click(screen.getByRole('button', { name: '整理并预览岗位' }));
  await waitFor(() => expect(recruitingRequest).toHaveBeenCalledTimes(2));
  const secondInput = JSON.parse(
    jest.mocked(recruitingRequest).mock.calls[1][1]!.body as string,
  );
  expect(secondInput).toMatchObject({
    text: 'Corrected full JD',
    note: firstInput.note,
    files: firstInput.files,
  });
  expect(secondInput.idempotencyKey).not.toBe(firstInput.idempotencyKey);
  expect(uploadRecruitingFile).toHaveBeenCalledTimes(1);
});

it.each([
  ['EXCLUDED', '明确条件冲突', '只接受全职，岗位仅接受实习'],
  ['NEEDS_REVIEW', '待补资料或人工核对', '需要补充完整职业资料'],
  ['FAILED', '处理失败', '匹配服务暂不可用，请稍后重试'],
])(
  'shows the specific outcome of an unscored PAIR: %s',
  (status, label, reason) => {
    const pair: RecruitingPair = {
      candidateId: 'fixture-person',
      candidateLabel: 'Fixture person',
      candidateUrl: '/object/person/fixture-person',
      jobId: 'fixture-job',
      jobLabel: 'Fixture job',
      jobUrl: '/object/recruitmentJob/fixture-job',
      status,
      cached: false,
      eligibility: {
        status: status === 'EXCLUDED' ? 'excluded' : 'needs_confirmation',
        reasons:
          status === 'EXCLUDED'
            ? [{ code: 'employment', message: reason, blocking: true }]
            : [],
      },
      error: status === 'EXCLUDED' ? undefined : reason,
    };
    queryData['match-runs/pair-run'] = {
      runId: 'pair-run',
      subjectId: 'fixture-person',
      subjectLabel: 'Fixture person',
      direction: 'PAIR',
      status: 'NO_RESULTS',
      top: [],
      results: [pair],
      counts: {
        total: 1,
        processed: 1,
        scored: 0,
        excluded: 1,
        needsReview: 0,
        failed: 0,
      },
    };
    render(<RecruitingMatchResults initialRunId="pair-run" />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Fixture person' }),
    ).toHaveAttribute('href', pair.candidateUrl);
    expect(screen.getByRole('link', { name: 'Fixture job' })).toHaveAttribute(
      'href',
      pair.jobUrl,
    );
    expect(screen.queryByText(/\/ 4/)).not.toBeInTheDocument();
  },
);

it('shows a single candidate header and compact job results without follow-up controls', () => {
  queryData['candidates/person'] = {
    name: { firstName: '合成候选人', lastName: '' },
    recruitingProfile: {
      summary: '后端开发',
      skills: ['TypeScript'],
      expectedRoles: ['后端工程师'],
    },
  };
  queryData['match-runs/completed'] = {
    runId: 'completed',
    subjectId: 'person',
    subjectLabel: '合成候选人',
    direction: 'CANDIDATE_TO_JOBS',
    status: 'COMPLETED',
    complete: true,
    counts: { total: 46, processed: 46 },
    top: [
      {
        candidateId: 'person',
        candidateLabel: '合成候选人',
        candidateUrl: '/object/person/person',
        jobId: 'job',
        jobLabel: '后端工程师',
        jobUrl: '/object/recruitmentJob/job',
        score: 3.2,
        status: 'SCORED',
        eligibility: { reasons: [] },
      },
    ],
  };
  render(<RecruitingMatchResults initialRunId="completed" />);
  expect(screen.getAllByText('合成候选人')).toHaveLength(1);
  expect(screen.getByText(/TypeScript/)).toBeInTheDocument();
  expect(screen.getByText('3.20 / 4')).toBeInTheDocument();
  expect(screen.queryByText('已完成')).toBeNull();
  expect(screen.queryByText(/共 46 个组合/)).toBeNull();
  expect(screen.queryByRole('button', { name: '生成问候草稿' })).toBeNull();
  expect(screen.queryByRole('button', { name: '标记为已查看' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重试或刷新匹配' })).toBeNull();
});
