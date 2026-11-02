/** Verifies shortlist expansion, explicit selection and persisted copyable draft output. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MatchSelection } from '@/recruiting/matching/components/MatchSelection';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';
jest.mock('@/recruiting/shared/hooks/useRecruitingQuery');
jest.mock('@/recruiting/shared/api/request');
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingPanel: 'section',
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
  StyledRecruitingRow: 'div',
  StyledRecruitingStack: 'div',
  StyledRecruitingTable: 'table',
}));
jest.mock('../MatchFacts', () => ({
  RecruitingJobFacts: ({ label }: { label: string }) => <span>{label}</span>,
  RecruitingCompanyName: () => <span>公司</span>,
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
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (x: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
  Textarea: ({
    value,
    onValueChange,
    'aria-label': ariaLabel,
  }: {
    value: string;
    onValueChange: (x: string) => void;
    'aria-label'?: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    />
  ),
}));
const run = {
  runId: 'run',
  direction: 'CANDIDATE_TO_JOBS',
  complete: true,
  top: Array.from({ length: 10 }, (_, i) => ({
    jobId: `job-${i}`,
    jobLabel: `岗位${i}`,
    candidateId: 'person',
    score: 3,
  })),
} as RecruitingMatchRun;
it('defaults to five selections, expands to ten and saves/copies the selected draft', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  jest
    .mocked(useRecruitingQuery)
    .mockImplementation(<T,>(path: string | null) => ({
      data: (path === 'drafts/draft'
        ? {
            draftId: 'draft',
            status: 'READY',
            title: '问候',
            body: '生成的文案',
          }
        : undefined) as T,
      error: '',
      loading: false,
      reload: jest.fn(),
    }));
  jest.mocked(recruitingRequest).mockResolvedValue({ draftId: 'draft' });
  render(<MatchSelection run={run} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  expect(
    screen
      .getAllByRole('checkbox')
      .filter((box) => (box as HTMLInputElement).checked),
  ).toHaveLength(5);
  const toggle = screen.getByRole('button', { name: '取消全选' });
  expect(toggle.closest('th')).not.toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText('已选 0 项')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '全选当前结果' }));
  expect(screen.getByText('已选 5 项')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
  expect(screen.getAllByRole('checkbox')).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: '全选当前结果' }));
  fireEvent.click(screen.getByRole('button', { name: '生成沟通文案' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('生成的文案'));
  const body = JSON.parse(
    jest.mocked(recruitingRequest).mock.calls[0][1]!.body as string,
  );
  expect(body.selectedIds).toHaveLength(10);
  fireEvent.change(screen.getByLabelText('沟通文案'), {
    target: { value: '编辑后的文案' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
  await waitFor(() =>
    expect(recruitingRequest).toHaveBeenCalledWith(
      'drafts/draft/review',
      expect.objectContaining({
        body: JSON.stringify({
          title: '问候',
          body: '编辑后的文案',
          approve: false,
        }),
      }),
    ),
  );
});

it('keeps a generated draft visible when clipboard access is unavailable', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
  jest
    .mocked(useRecruitingQuery)
    .mockImplementation(<T,>(path: string | null) => ({
      data: (path === 'drafts/draft'
        ? { draftId: 'draft', status: 'READY', body: '保留的文案' }
        : undefined) as T,
      error: '',
      loading: false,
      reload: jest.fn(),
    }));
  jest.mocked(recruitingRequest).mockResolvedValue({ draftId: 'draft' });
  render(<MatchSelection run={run} />);
  fireEvent.click(screen.getByRole('button', { name: '生成沟通文案' }));
  expect(
    await screen.findByText('文案已保存，请点击复制文案'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('沟通文案')).toHaveValue('保留的文案');
});

it('restores saved selection without copying an existing draft on page load', async () => {
  const writeText = jest.fn();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const savedDraft = {
    draftId: 'saved',
    status: 'READY',
    body: '已有文案',
    selectedIds: ['job-0', 'job-7'],
  };
  jest
    .mocked(useRecruitingQuery)
    .mockImplementation(<T,>(path: string | null) => ({
      data: (path === 'match-runs/run/draft' ? savedDraft : undefined) as T,
      error: '',
      loading: false,
      reload: jest.fn(),
    }));
  render(<MatchSelection run={run} />);
  await screen.findByText('已选 2 项');
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
  expect(
    screen
      .getAllByRole('checkbox')
      .filter((box) => (box as HTMLInputElement).checked),
  ).toHaveLength(2);
  expect(writeText).not.toHaveBeenCalled();
});
