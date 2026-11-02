/** Verifies compact accessible share actions and honest source-match navigation. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShareLinks } from '../ShareLinks';
import { useRecruitingQuery } from '../../hooks/useRecruitingQuery';
import { recruitingRequest } from '../../api/request';
jest.mock('../../hooks/useRecruitingQuery');
jest.mock('../../api/request');
jest.mock('../../styles', () => ({
  StyledRecruitingPanel: 'section',
  StyledRecruitingTable: 'table',
  StyledRecruitingTitle: 'h2',
  StyledRecruitingRecordLink: 'a',
  StyledRecruitingMuted: 'p',
}));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('twenty-ui/icon', () => ({
  IconCopy: () => null,
  IconEye: () => null,
  IconPlayerStop: () => null,
}));
it('shows the matching subject and serializable icon actions instead of a wall of job names', async () => {
  const reload = jest.fn();
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  jest.mocked(useRecruitingQuery).mockReturnValue({
    data: [
      {
        key: 'short',
        url: 'https://example.test/r/short',
        subjectLabel: '测试候选人',
        matchRunId: 'match',
        jobIds: ['job'],
        candidateIds: [],
        jobs: [{ name: '长岗位描述', status: 'RECRUITING' }],
        createdAt: new Date().toISOString(),
      },
    ],
    loading: false,
    error: '',
    reload,
  } as never);
  jest.mocked(recruitingRequest).mockResolvedValue({ deleted: true });
  render(<ShareLinks active />);
  expect(screen.getByRole('link', { name: '测试候选人' })).toHaveAttribute(
    'href',
    '/recruiting-workspace?tab=matches&runId=match',
  );
  expect(screen.queryByText('长岗位描述')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '预览分享' })).toHaveAttribute(
    'title',
    '预览分享',
  );
  fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
  await screen.findByText('链接已复制');
  expect(writeText).toHaveBeenCalledWith('https://example.test/r/short');
  fireEvent.click(screen.getByRole('button', { name: '撤销分享' }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(recruitingRequest).toHaveBeenCalledWith('share-links/short/revoke', {
    method: 'POST',
  });
});
