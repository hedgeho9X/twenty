/** Verifies owner connection pagination and explicit loading without changing capture settings. */
import { fireEvent, render, screen } from '@testing-library/react';
import { RecruitingMailboxSettings } from '../MailboxSettings';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
jest.mock('@/recruiting/shared/hooks/useRecruitingQuery');
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingPanel: 'section',
  StyledRecruitingRow: 'div',
  StyledRecruitingTitle: 'h2',
  StyledRecruitingMuted: 'p',
  StyledRecruitingError: 'p',
}));
it('shows a loading state instead of claiming no mailbox exists', () => {
  jest
    .mocked(useRecruitingQuery)
    .mockReturnValue({
      data: undefined,
      loading: true,
      error: '',
      reload: jest.fn(),
    });
  render(<RecruitingMailboxSettings active />);
  expect(
    screen.getByRole('status', { name: '正在加载邮箱连接' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('请先添加邮箱账号。')).not.toBeInTheDocument();
});
it('requests a new bounded server page without reconfiguring capture', () => {
  jest
    .mocked(useRecruitingQuery)
    .mockReturnValue({
      data: {
        connections: [],
        count: 45,
        hasNextPage: true,
        nativeIntegrationEnabled: true,
      },
      loading: false,
      error: '',
      reload: jest.fn(),
    } as never);
  render(<RecruitingMailboxSettings active />);
  expect(useRecruitingQuery).toHaveBeenLastCalledWith(
    'mailboxes?offset=0&limit=20',
    0,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(useRecruitingQuery).toHaveBeenLastCalledWith(
    'mailboxes?offset=20&limit=20',
    0,
    true,
  );
});
