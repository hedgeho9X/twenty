/** Checks original batch materials, live operator name edits and advisory duplicate links without model requests. */
import { fireEvent, render, screen } from '@testing-library/react';
import { RecruitingCompanyJobs } from '@/recruiting/components/RecruitingCompanyJobs';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';

jest.mock('@/recruiting/hooks/useRecruitingQuery');
jest.mock('@/recruiting/utils/recruitingRequest');
jest.mock('@/recruiting/components/RecruitingContracts', () => ({
  RecruitingContracts: () => null,
}));
jest.mock('@/recruiting/components/recruitingStyles', () => ({
  StyledRecruitingForm: 'div',
  StyledRecruitingSteps: 'nav',
  StyledRecruitingChoices: 'div',
  StyledRecruitingStatus: 'span',
  StyledRecruitingJobHover: 'div',
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
  IconBuildingSkyscraper: () => null,
  IconPlus: () => null,
  IconUpload: () => null,
}));
jest.mock('@/ui/input/components/Select', () => ({ Select: () => null }));
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
  }: {
    value: string;
    onValueChange?: (value: string) => void;
    readOnly?: boolean;
    disabled?: boolean;
  }) => (
    <textarea
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
}));

const source = '原始输入<script>not executed</script>';
const draft = {
  title: '后端工程师',
  description: '维护服务',
  preferences: '',
  category: null,
  employmentTypes: [],
  workModes: [],
  locations: [],
  needsReview: false,
  reviewNotes: [],
};
let jobItems: {
  itemId: string;
  jobId: string;
  status: string;
  draft: typeof draft;
}[];

beforeEach(() => {
  jobItems = [{ itemId: 'item', jobId: 'new-job', status: 'DRAFT', draft }];
  jest.mocked(useRecruitingQuery).mockImplementation((path) => ({
    data:
      path === 'resume-intakes/intake'
        ? {
            intakeId: 'intake',
            files: [{ fileId: 'file', label: 'source.pdf' }],
            detail: {
              input: {
                companyId: 'company',
                files: [{ fileId: 'file', label: 'source.pdf' }],
                text: source,
                note: '原始补充说明',
              },
              jobItems,
              previewExistingJobs: [
                {
                  id: 'existing',
                  name: '后端工程师',
                  companyId: 'company',
                  jobStatus: 'CLOSED',
                },
              ],
              duplicateCheck: { status: 'COMPLETE', checked: 1, total: 1 },
            },
          }
        : path === 'companies/company'
          ? { id: 'company', name: '合成公司' }
          : undefined,
    error: '',
    loading: false,
    reload: jest.fn(),
  }));
});

it('shows batch originals separately and recalculates name hints as the operator edits', () => {
  const { container } = render(
    <RecruitingCompanyJobs
      initialIntakeId="intake"
      onSubmitted={jest.fn()}
      onIntakeChange={jest.fn()}
    />,
  );
  expect(screen.getByText('本批材料来源')).toBeTruthy();
  expect(screen.getByText('source.pdf')).toBeTruthy();
  expect(screen.getByDisplayValue(source)).toHaveAttribute('readonly');
  expect(screen.getByDisplayValue('原始补充说明')).toHaveAttribute('readonly');
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('公司已有同名岗位')).toBeTruthy();
  expect(screen.getByRole('link', { name: '后端工程师' })).toHaveAttribute(
    'href',
    '/object/recruitmentJob/existing',
  );
  expect(screen.getByText('已停招')).toBeTruthy();
  expect(screen.getByText(/未写明：岗位方向/)).toBeTruthy();
  fireEvent.change(screen.getByDisplayValue('后端工程师'), {
    target: { value: '产品经理' },
  });
  expect(screen.queryByText('公司已有同名岗位')).toBeNull();
  fireEvent.change(screen.getByDisplayValue('产品经理'), {
    target: { value: '后端工程师' },
  });
  expect(screen.getByText('公司已有同名岗位')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '确认本批岗位' }),
  ).not.toBeDisabled();
});

it('keeps batch originals visible before extraction has produced any preview item', () => {
  jobItems = [];
  render(
    <RecruitingCompanyJobs
      initialIntakeId="intake"
      onSubmitted={jest.fn()}
      onIntakeChange={jest.fn()}
    />,
  );
  expect(screen.getByText('本批材料来源')).toBeTruthy();
  expect(screen.getByDisplayValue(source)).toHaveAttribute('readonly');
  expect(screen.queryByRole('button', { name: '确认本批岗位' })).toBeNull();
});
