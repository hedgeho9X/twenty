/** Verifies durable nonterminal tasks can be recovered without claiming failure or duplicating operator requests. */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { RecruitingQueueDialog } from '@/recruiting/components/RecruitingQueueDialog';
import { RecruitingMailSources } from '@/recruiting/components/RecruitingMailSources';
import { RecruitingDrafts } from '@/recruiting/components/RecruitingDrafts';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import {
  downloadRecruitingArtifact,
  recruitingRequest,
} from '@/recruiting/utils/recruitingRequest';
import { type RecruitingDraft } from '@/recruiting/types/RecruitingDraft';

jest.mock('@/recruiting/hooks/useRecruitingQuery');
jest.mock('@/recruiting/utils/recruitingRequest');
jest.mock('@/recruiting/components/recruitingStyles', () => ({
  StyledRecruitingForm: 'div',
  StyledRecruitingSteps: 'nav',
  StyledRecruitingChoices: 'div',
  StyledRecruitingStatus: 'span',
  StyledRecruitingJobHover: 'div',
  StyledRecruitingSticky: 'div',
  StyledRecruitingDenseQueue: 'div',
  StyledRecruitingTitle: 'h2',
  StyledRecruitingProfileFacts: 'dl',
  StyledRecruitingProfileSection: 'section',
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
  StyledRecruitingPanel: 'section',
  StyledRecruitingRow: 'div',
  StyledRecruitingScroll: 'div',
  StyledRecruitingStack: 'div',
  StyledRecruitingTable: 'table',
}));
jest.mock('twenty-ui/icon', () => ({
  IconRefresh: () => null,
  IconX: () => null,
}));
jest.mock('twenty-ui/primitives/data-display', () => ({ Badge: 'span' }));
jest.mock('twenty-ui/primitives/surfaces', () => ({
  Dialog: {
    Root: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Portal: 'div',
    Backdrop: 'div',
    Viewport: 'div',
    Popup: 'div',
    Header: 'div',
    Title: 'h1',
    Description: 'p',
    Body: 'div',
    Footer: 'div',
    Close: () => null,
  },
}));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    'aria-label'?: string;
  }) => (
    <button
      aria-label={ariaLabel}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {children}
    </button>
  ),
  Field: { Root: 'div', Label: 'label' },
  Textarea: () => null,
}));
jest.mock('@/ui/input/components/Select', () => ({ Select: () => null }));
jest.mock('@/recruiting/components/RecruitingRecordPicker', () => ({
  RecruitingRecordPicker: () => null,
}));
jest.mock('@/recruiting/components/RecruitingDraftEditor', () => ({
  RecruitingDraftEditor: () => null,
}));
jest.mock('@/recruiting/components/RecruitingMailboxSettings', () => ({
  RecruitingMailboxSettings: () => null,
}));
jest.mock('@/recruiting/components/RecruitingMailSelection', () => ({
  RecruitingMailSelection: () => null,
}));

let queryData: Record<string, unknown>;
const reload = jest.fn();
type TaskKind = 'intake' | 'mail' | 'draft';

beforeEach(() => {
  jest.resetAllMocks();
  queryData = {};
  reload.mockResolvedValue(undefined);
  jest
    .mocked(useRecruitingQuery)
    .mockImplementation(<T,>(path: string | null) => ({
      data: queryData[path ?? ''] as T,
      error: '',
      loading: false,
      reload,
    }));
});

/** Opens each actual operator surface against a bounded synthetic API projection. */
const renderTask = (kind: TaskKind, status: string) => {
  if (kind === 'intake') {
    queryData['resume-intakes?offset=0'] = {
      records: [
        {
          intakeId: 'fixture',
          kind: 'CANDIDATE',
          name: 'Fixture',
          state: status === 'AWAITING_CONFIRMATION' ? 'READY' : status,
          stage: status === 'AWAITING_CONFIRMATION' ? status : 'PARSING',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
    };
    render(<RecruitingQueueDialog open onOpenChange={jest.fn()} />);
    return 'resume-intakes/fixture/retry';
  }
  if (kind === 'mail') {
    const mail = {
      archiveId: 'fixture',
      name: 'Fixture',
      status,
      artifactCount: 0,
      intakeIds: [],
    };
    queryData['mail-archives?offset=0'] = { records: [mail] };
    queryData['mail-archives/fixture'] = mail;
    render(<RecruitingMailSources onSubmitted={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    return 'mail-archives/fixture/retry';
  }
  const draft = { draftId: 'fixture', name: 'Fixture', status };
  queryData['drafts?offset=0'] = { records: [draft] };
  queryData['drafts/fixture'] = draft;
  render(<RecruitingDrafts />);
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  return 'drafts/fixture/retry';
};

it('downloads a queued original with authentication and keeps download failures retryable', async () => {
  queryData['resume-intakes?offset=0'] = {
    records: [
      {
        intakeId: 'fixture',
        kind: 'CANDIDATE',
        name: 'Fixture',
        state: 'COMPLETED',
        stage: 'STORED',
        createdAt: '2026-11-01T00:00:00Z',
        files: [{ fileId: 'source', label: 'resume.html' }],
      },
    ],
  };
  render(<RecruitingQueueDialog open onOpenChange={jest.fn()} />);
  jest
    .mocked(downloadRecruitingArtifact)
    .mockRejectedValueOnce(new Error('denied'));
  queryData['resume-intakes/fixture'] = {
    ...((queryData['resume-intakes?offset=0'] as { records: unknown[] })
      .records[0] as object),
    detail: { extraction: { profile: { name: '合成候选人' } } },
  };
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  fireEvent.click(screen.getByRole('button', { name: '下载' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('denied'),
  );
  expect(downloadRecruitingArtifact).toHaveBeenCalledWith(
    'resume-intakes/fixture/files/source',
    'resume.html',
  );
  expect(screen.queryByRole('link', { name: 'resume.html' })).toBeNull();
  expect(
    screen.getByRole('heading', { name: '合成候选人' }),
  ).toBeInTheDocument();
  jest.mocked(downloadRecruitingArtifact).mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole('button', { name: '下载' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it.each([
  ['intake', 'READY'],
  ['intake', 'PROCESSING'],
  ['mail', 'QUEUED'],
  ['mail', 'EXPANDING'],
  ['draft', 'QUEUED'],
  ['draft', 'PROCESSING'],
] as const)(
  'offers recovery for %s %s using its existing retry contract',
  async (kind, status) => {
    jest.mocked(recruitingRequest).mockResolvedValue({});
    const path = renderTask(kind, status);
    expect(
      screen.getByText('长时间没有进展时可尝试恢复；仍在运行的任务会继续等待'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '恢复处理' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(recruitingRequest).toHaveBeenCalledWith(path, {
      method: 'POST',
      body: '{}',
    });
  },
);

it.each([
  ['intake', 'COMPLETED'],
  ['intake', 'AWAITING_CONFIRMATION'],
  ['mail', 'READY'],
  ['mail', 'NEEDS_SELECTION'],
  ['draft', 'READY'],
  ['draft', 'APPROVED'],
  ['draft', 'NEEDS_REVIEW'],
] as const)(
  'does not offer recovery for completed or human-review state %s %s',
  (kind, status) => {
    renderTask(kind, status);
    expect(
      screen.queryByRole('button', { name: '恢复处理' }),
    ).not.toBeInTheDocument();
  },
);

it.each(['intake', 'mail', 'draft'] as const)(
  'prevents duplicate recovery clicks for %s and releases busy state',
  async (kind) => {
    let finish = () => {};
    jest.mocked(recruitingRequest).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderTask(
      kind,
      kind === 'intake'
        ? 'PROCESSING'
        : kind === 'mail'
          ? 'EXPANDING'
          : 'PROCESSING',
    );
    const button = screen.getByRole('button', { name: '恢复处理' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(recruitingRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    expect(button).not.toBeDisabled();
  },
);

it('creates a separate current-source draft for an approved stale original and can reopen the original', async () => {
  const original: RecruitingDraft = Object.freeze({
    draftId: 'original',
    name: 'Original reviewed draft',
    kind: 'GREETING',
    status: 'APPROVED',
    stale: true,
    candidateId: 'fixture-person',
    jobId: 'fixture-job',
    note: 'Original writing instruction',
    title: 'Reviewed title',
    body: 'Reviewed original body',
  });
  const replacement: RecruitingDraft = {
    draftId: 'replacement',
    name: 'New current draft',
    kind: 'GREETING',
    status: 'QUEUED',
  };
  queryData['drafts?offset=0'] = { records: [original] };
  queryData['drafts/original'] = original;
  queryData['drafts/replacement'] = replacement;
  jest.mocked(recruitingRequest).mockResolvedValueOnce(replacement);
  render(<RecruitingDrafts />);
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  expect(
    screen.queryByRole('button', { name: '重试生成' }),
  ).not.toBeInTheDocument();
  queryData['drafts?offset=0'] = { records: [original, replacement] };
  fireEvent.click(screen.getByRole('button', { name: '以当前资料另起新稿' }));
  await screen.findByRole('heading', { name: 'New current draft' });
  expect(recruitingRequest).toHaveBeenCalledTimes(1);
  const [path, options] = jest.mocked(recruitingRequest).mock.calls[0];
  expect(path).toBe('drafts');
  expect(options?.method).toBe('POST');
  expect(JSON.parse(options!.body as string)).toEqual({
    kind: original.kind,
    candidateId: original.candidateId,
    jobId: original.jobId,
    note: original.note,
    idempotencyKey: expect.any(String),
  });
  expect(reload).toHaveBeenCalled();
  const oldRow = screen.getByRole('row', { name: /Original reviewed draft/ });
  fireEvent.click(within(oldRow).getByRole('button', { name: '打开' }));
  expect(
    screen.getByRole('heading', { name: 'Original reviewed draft' }),
  ).toBeInTheDocument();
  expect(queryData['drafts/original']).toBe(original);
  expect(original.body).toBe('Reviewed original body');
});

it('retains the approved original and replacement identity after a failed new-draft request', async () => {
  const original: RecruitingDraft = {
    draftId: 'original',
    name: 'Original reviewed draft',
    kind: 'JOB_PUBLICATION',
    status: 'APPROVED',
    stale: true,
    jobId: 'fixture-job',
    note: 'Original publication instruction',
  };
  const replacement: RecruitingDraft = {
    draftId: 'replacement',
    name: 'New current draft',
    kind: 'JOB_PUBLICATION',
    status: 'QUEUED',
  };
  queryData['drafts?offset=0'] = { records: [original] };
  queryData['drafts/original'] = original;
  queryData['drafts/replacement'] = replacement;
  jest
    .mocked(recruitingRequest)
    .mockRejectedValueOnce(new Error('Fixture unavailable'))
    .mockResolvedValueOnce(replacement);
  render(<RecruitingDrafts />);
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  const button = screen.getByRole('button', { name: '以当前资料另起新稿' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(recruitingRequest).toHaveBeenCalledTimes(1);
  await screen.findByText('Fixture unavailable');
  expect(
    screen.getByRole('heading', { name: 'Original reviewed draft' }),
  ).toBeInTheDocument();
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
  await screen.findByRole('heading', { name: 'New current draft' });
  const calls = jest.mocked(recruitingRequest).mock.calls;
  expect(calls.map(([path]) => path)).toEqual(['drafts', 'drafts']);
  expect(JSON.parse(calls[0][1]!.body as string)).toEqual(
    JSON.parse(calls[1][1]!.body as string),
  );
});

it.each(['intake', 'mail', 'draft'] as const)(
  'shows a rejected recovery request for %s without relabeling the task failed',
  async (kind) => {
    jest
      .mocked(recruitingRequest)
      .mockRejectedValueOnce(new Error('Fixture permission denied'));
    renderTask(kind, kind === 'intake' ? 'READY' : 'QUEUED');
    fireEvent.click(screen.getByRole('button', { name: '恢复处理' }));
    await screen.findByText('Fixture permission denied');
    expect(screen.getByRole('button', { name: '恢复处理' })).not.toBeDisabled();
    expect(
      screen.queryByRole('button', { name: /重试生成|重试归档/ }),
    ).not.toBeInTheDocument();
  },
);

it('opens mail as a separate view with a reliable back action and no manual EML upload', () => {
  renderTask('mail', 'READY');
  expect(
    screen.getByRole('button', { name: '返回邮件列表' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '已接收邮件' })).toBeNull();
  expect(screen.queryByLabelText('选择完整EML邮件')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回邮件列表' }));
  expect(
    screen.getByRole('heading', { name: '已接收邮件' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '返回邮件列表' })).toBeNull();
});

it('separates match tasks from material tasks and displays pages, channel and time', () => {
  queryData['resume-intakes?offset=0'] = {
    records: [],
    count: 0,
    hasNextPage: false,
  };
  queryData['match-runs?offset=0'] = {
    records: [
      {
        runId: 'match',
        subjectLabel: '合成候选人',
        direction: 'CANDIDATE_TO_JOBS',
        source: 'email',
        status: 'PROCESSING',
        createdAt: '2026-11-01T00:00:00Z',
        counts: { processed: 2, total: 8 },
      },
    ],
    count: 101,
    hasNextPage: true,
  };
  render(<RecruitingQueueDialog open onOpenChange={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '岗位匹配' }));
  expect(screen.getByText('合成候选人')).toBeInTheDocument();
  expect(screen.getByText('邮件')).toBeInTheDocument();
  expect(screen.getByText('匹配中')).toBeInTheDocument();
  expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新队列' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '关闭队列' })).toBeInTheDocument();
});
