/** Verifies a reviewed selection and file scope are required before publishing a share. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MatchShareActions } from '../MatchShareActions';
import { recruitingRequest } from '../../api/request';
jest.mock('../../api/request');
jest.mock('../../styles', () => ({
  StyledRecruitingPanel: 'section',
  StyledRecruitingRow: 'div',
}));
jest.mock('twenty-ui/icon', () => ({
  IconLink: () => null,
  IconCopy: () => null,
  IconExternalLink: () => null,
  IconX: () => null,
  IconCheck: () => null,
  IconLoader: () => null,
}));
it('creates no link until the reviewed scope is confirmed, and preserves the explicit PDF exclusion', async () => {
  jest
    .mocked(recruitingRequest)
    .mockResolvedValue({ url: 'https://example.test/r/confirmed' });
  const props = {
    matchRunId: 'match',
    jobIds: ['job'],
    candidateIds: ['candidate'],
    selectionLabels: ['候选人甲 → 岗位乙'],
  };
  const { rerender } = render(<MatchShareActions {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '生成分享链接' }));
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '共 1 个岗位、1 位候选人',
  );
  fireEvent.click(screen.getByLabelText('附带所选候选人的全部 PDF / 原始附件'));
  expect(recruitingRequest).not.toHaveBeenCalled();
  rerender(
    <MatchShareActions
      {...props}
      candidateIds={['candidate-2']}
      selectionLabels={['候选人丙 → 岗位乙']}
    />,
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '生成分享链接' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('候选人丙 → 岗位乙');
  fireEvent.click(screen.getByRole('button', { name: '确认并生成链接' }));
  await waitFor(() =>
    expect(recruitingRequest).toHaveBeenCalledWith('share-links', {
      method: 'POST',
      body: JSON.stringify({
        jobIds: ['job'],
        candidateIds: ['candidate-2'],
        matchRunId: 'match',
        includeFiles: false,
      }),
    }),
  );
});
