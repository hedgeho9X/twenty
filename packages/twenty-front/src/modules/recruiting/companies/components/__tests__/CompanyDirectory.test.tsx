/** Checks company disambiguation and bounded existing-job visibility without creating records. */
import { fireEvent, render, screen } from '@testing-library/react';
import { RecruitingCompanyExistingJobs } from '@/recruiting/companies/components/ExistingJobs';
import { RecruitingRecordPicker } from '@/recruiting/shared/components/RecordPicker';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';

jest.mock('@/recruiting/shared/hooks/useRecruitingQuery');
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingForm: 'div',
  StyledRecruitingSteps: 'nav',
  StyledRecruitingChoices: 'div',
  StyledRecruitingStatus: 'span',
  StyledRecruitingJobHover: 'div',
  StyledRecruitingRecordLink: 'a',
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
  StyledRecruitingRow: 'div',
  StyledRecruitingScroll: 'div',
  StyledRecruitingStack: 'div',
}));
jest.mock('twenty-ui/primitives/data-display', () => ({ Badge: 'span' }));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  Field: { Root: 'div', Label: 'label' },
  Input: () => <input />,
}));

beforeEach(() => {
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: undefined,
    loading: false,
    error: '',
    reload: jest.fn(),
  });
});

it('distinguishes same-name company choices using their actual domains', () => {
  const records = [
    { id: 'a', name: '同名公司', domain: 'https://a.example.invalid' },
    { id: 'b', name: '同名公司', domain: 'https://b.example.invalid' },
  ];
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: { records },
    loading: false,
    error: '',
    reload: jest.fn(),
  });
  render(
    <RecruitingRecordPicker
      label="公司"
      path="companies"
      renderLabel={(record: (typeof records)[number]) => record.name}
      renderHint={(record) => record.domain}
      onSelect={jest.fn()}
    />,
  );
  expect(
    screen.getByRole('button', { name: /a\.example\.invalid/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: /b\.example\.invalid/ }),
  ).toBeTruthy();
});

it('shows active and closed jobs with native record links and a bounded preview', () => {
  const records = Array.from({ length: 7 }, (_, index) => ({
    id: `job-${index}`,
    name: `岗位 ${index}`,
    jobStatus: index ? 'CLOSED' : 'RECRUITING',
  }));
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: { records, count: 7, hasNextPage: false },
    loading: false,
    error: '',
    reload: jest.fn(),
  });
  const onViewAll = jest.fn();
  render(
    <RecruitingCompanyExistingJobs
      companyId="company-a"
      active={false}
      onViewAll={onViewAll}
    />,
  );
  expect(useRecruitingQuery).toHaveBeenCalledWith(
    'jobs?companyId=company-a&active=false',
    0,
    false,
  );
  expect(screen.getByText('已有岗位（7）')).toBeTruthy();
  expect(screen.getByText('在招')).toBeTruthy();
  expect(screen.getAllByRole('link')).toHaveLength(5);
  expect(
    screen.getByRole('link', { name: '岗位 0' }).getAttribute('href'),
  ).toBe('/object/recruitmentJob/job-0');
  expect(screen.queryByText('岗位 5')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看全部 7 个岗位' }));
  expect(onViewAll).toHaveBeenCalledTimes(1);
  expect(screen.getByText('在招')).toHaveAttribute('data-tone', 'green');
  expect(screen.getAllByText('已停招')[0]).toHaveAttribute(
    'data-tone',
    'neutral',
  );
});

it('keeps a directory permission failure distinct from an empty company', () => {
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: {
      records: [{ id: 'old', name: '先前读取的岗位' }],
      count: 1,
      hasNextPage: false,
    },
    loading: false,
    error: '当前无权读取岗位',
    reload: jest.fn(),
  });
  render(<RecruitingCompanyExistingJobs companyId="company-a" />);
  expect(screen.getByRole('alert').textContent).toBe('当前无权读取岗位');
  expect(screen.queryByText('这家公司还没有岗位记录。')).toBeNull();
  expect(screen.queryByText('先前读取的岗位')).toBeNull();
});

it('reports zero only after the permitted directory returns an empty page', () => {
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: { records: [], count: 0, hasNextPage: false },
    loading: false,
    error: '',
    reload: jest.fn(),
  });
  render(<RecruitingCompanyExistingJobs companyId="company-b" />);
  expect(screen.getByText('已有岗位（0）')).toBeTruthy();
  expect(screen.getByText('这家公司还没有岗位记录。')).toBeTruthy();
});
