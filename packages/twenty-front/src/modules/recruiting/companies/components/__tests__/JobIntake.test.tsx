/** Supplies the DOM scrolling primitive used by Radix option focus in jsdom. */
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});
/** Checks original batch materials, live operator name edits and advisory duplicate links without model requests. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecruitingCompanyJobs } from '@/recruiting/companies/components/CompanyJobIntake';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';

jest.mock('@/recruiting/shared/hooks/useRecruitingQuery');
jest.mock('@/recruiting/shared/api/request');
jest.mock('@/recruiting/shared/styles', () => ({
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
  StyledRecruitingScroll: 'div',
  StyledRecruitingStack: 'div',
  StyledRecruitingTitle: 'h2',
  StyledRecruitingDrop: 'label',
}));
jest.mock('twenty-ui/primitives/data-display', () => ({ Badge: 'span' }));
jest.mock('twenty-ui/icon', () => ({
  ...jest.requireActual('twenty-ui/icon'),
  IconBuildingSkyscraper: () => null,
  IconPlus: () => null,
  IconUpload: () => null,
}));
jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    label,
    value,
    onChange,
    options,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
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
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Checkbox: () => null,
  Field: { Root: 'div', Item: 'div', Label: 'label', Description: 'p' },
  Input: ({
    value,
    onValueChange,
    disabled,
    onBlur,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    onBlur?: () => void;
  }) => (
    <input
      value={value}
      disabled={disabled}
      onBlur={onBlur}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
  Textarea: ({
    value,
    onValueChange,
    readOnly,
    disabled,
    'aria-label': ariaLabel,
  }: {
    value: string;
    onValueChange?: (value: string) => void;
    readOnly?: boolean;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
}));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRecruitingQuery).mockImplementation((path) => ({
    data:
      path === 'resume-intakes/existing'
        ? { intakeId: 'existing', detail: { input: { companyId: 'company' } } }
        : path === 'companies/company'
          ? { id: 'company', name: '合成公司' }
          : undefined,
    loading: false,
    error: '',
    reload: jest.fn(),
    updateData: jest.fn(),
  }));
});

it('uses two text-only steps, queues every JD independently, and retries only the failed entry', async () => {
  const onSubmitted = jest.fn();
  jest
    .mocked(recruitingRequest)
    .mockResolvedValueOnce({ intakeId: 'first' })
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockResolvedValueOnce({ intakeId: 'second' });
  const { container } = render(
    <RecruitingCompanyJobs
      initialIntakeId="existing"
      onSubmitted={onSubmitted}
      onIntakeChange={jest.fn()}
    />,
  );
  expect(screen.queryByText('3. 核对并确认岗位')).toBeNull();
  expect(container.querySelector('input[type=file]')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '岗位描述 1' }), {
    target: { value: '第一份完整 JD' },
  });
  fireEvent.click(screen.getByRole('button', { name: '再添加一个 JD' }));
  fireEvent.change(screen.getByRole('textbox', { name: '岗位描述 2' }), {
    target: { value: '第二份完整 JD' },
  });
  screen
    .getAllByRole('combobox', { name: '招聘类型（必选）' })
    .forEach((select) => {
      if (!(select as HTMLButtonElement).disabled) {
        fireEvent.click(select);
        fireEvent.click(screen.getByRole('option', { name: '正式' }));
      }
    });
  fireEvent.click(screen.getByRole('button', { name: '提交到队列' }));
  await screen.findByText('temporary failure');
  expect(screen.getByText('已加入队列')).toBeInTheDocument();
  expect(onSubmitted).toHaveBeenCalledTimes(1);
  const first = JSON.parse(
    jest.mocked(recruitingRequest).mock.calls[0][1]!.body as string,
  );
  const second = JSON.parse(
    jest.mocked(recruitingRequest).mock.calls[1][1]!.body as string,
  );
  expect(first).toMatchObject({
    companyId: 'company',
    text: '第一份完整 JD',
    source: 'manual',
  });
  expect(second.text).toBe('第二份完整 JD');
  expect(first.batchId).toBe(second.batchId);
  expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  screen
    .getAllByRole('combobox', { name: '招聘类型（必选）' })
    .forEach((select) => {
      if (!(select as HTMLButtonElement).disabled) {
        fireEvent.click(select);
        fireEvent.click(screen.getByRole('option', { name: '正式' }));
      }
    });
  fireEvent.click(screen.getByRole('button', { name: '提交到队列' }));
  await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(2));
  const retried = JSON.parse(
    jest.mocked(recruitingRequest).mock.calls[2][1]!.body as string,
  );
  expect(retried).toEqual(second);
  expect(screen.getAllByText('已加入队列')).toHaveLength(2);
});

it('preserves all draft JD text when navigating back to the selected company', () => {
  render(
    <RecruitingCompanyJobs
      initialIntakeId="existing"
      onSubmitted={jest.fn()}
      onIntakeChange={jest.fn()}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: '岗位描述 1' }), {
    target: { value: '保留的岗位正文' },
  });
  fireEvent.click(screen.getByRole('button', { name: '返回选择公司' }));
  fireEvent.click(screen.getByRole('button', { name: '下一步：填写 JD' }));
  expect(screen.getByRole('textbox', { name: '岗位描述 1' })).toHaveValue(
    '保留的岗位正文',
  );
});
