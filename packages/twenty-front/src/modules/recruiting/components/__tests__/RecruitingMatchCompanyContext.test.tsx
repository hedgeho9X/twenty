/** Checks lazy current-company context, escaped facts and readable permission failures beside matching results. */
import { fireEvent, render, screen } from '@testing-library/react';
import { RecruitingMatchCompanyContext } from '@/recruiting/components/RecruitingMatchCompanyContext';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { type RecruitingCompany } from '@/recruiting/types/RecruitingCompany';

jest.mock('@/recruiting/hooks/useRecruitingQuery');
jest.mock('@/recruiting/components/recruitingStyles', () => ({
  StyledRecruitingContextText: 'p',
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
  StyledRecruitingStack: 'div',
}));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    onClick,
    'aria-expanded': expanded,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    'aria-expanded'?: boolean;
  }) => (
    <button aria-expanded={expanded} onClick={onClick}>
      {children}
    </button>
  ),
}));

const company: RecruitingCompany = {
  id: 'company-a',
  name: '合成公司',
  domainName: { primaryLinkUrl: 'https://a.example.invalid' },
  recruitingDescription: '<img src="https://example.invalid/track">研发工具',
  recruitmentPreferences: { markdown: '远程协作\n明确项目经验' },
};
const reload = jest.fn();

beforeEach(() => {
  jest.mocked(useRecruitingQuery).mockImplementation((path) => ({
    data: path ? company : undefined,
    loading: false,
    error: '',
    reload,
  }));
});

it('loads only after expansion and shows escaped current company facts without remote media', () => {
  const { container } = render(
    <RecruitingMatchCompanyContext companyId="company-a" />,
  );
  expect(useRecruitingQuery).toHaveBeenLastCalledWith(null, 0, false);
  expect(screen.queryByText('合成公司')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看公司资料' }));
  expect(useRecruitingQuery).toHaveBeenLastCalledWith(
    'companies/company-a',
    0,
    true,
  );
  expect(
    screen.getByRole('link', { name: '合成公司' }).getAttribute('href'),
  ).toBe('/object/company/company-a');
  expect(screen.getByText(company.recruitingDescription!)).toBeTruthy();
  expect(screen.getByText(/远程协作/)).toBeTruthy();
  expect(screen.getByText(/明确项目经验/)).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '收起公司资料' }));
  expect(screen.queryByText('合成公司')).toBeNull();
  expect(useRecruitingQuery).toHaveBeenLastCalledWith(null, 0, false);
});

it('reads migrated blocknote-only preferences through the native rich-text reader', () => {
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: {
      ...company,
      recruitmentPreferences: {
        blocknote: JSON.stringify([
          {
            id: 'block',
            type: 'paragraph',
            props: {},
            content: [{ type: 'text', text: '优先公开项目', styles: {} }],
            children: [],
          },
        ]),
      },
    },
    loading: false,
    error: '',
    reload,
  });
  render(<RecruitingMatchCompanyContext companyId="company-a" />);
  fireEvent.click(screen.getByRole('button', { name: '查看公司资料' }));
  expect(screen.getByText('优先公开项目')).toBeTruthy();
});

it('does not present previously cached company details after a permission failure', () => {
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: company,
    loading: false,
    error: '当前无权读取公司',
    reload,
  });
  render(<RecruitingMatchCompanyContext companyId="company-a" />);
  fireEvent.click(screen.getByRole('button', { name: '查看公司资料' }));
  expect(screen.getByRole('alert').textContent).toBe('当前无权读取公司');
  expect(screen.queryByText('合成公司')).toBeNull();
  expect(screen.queryByText('尚未填写招聘偏好')).toBeNull();
});

it('does not query or invent a company for unbound legacy jobs', () => {
  render(<RecruitingMatchCompanyContext />);
  expect(screen.getByText('未关联公司')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(useRecruitingQuery).toHaveBeenLastCalledWith(null, 0, false);
});
