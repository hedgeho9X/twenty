/** Verifies the public page reads a scoped link without sending CRM credentials. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecruitingJobPage } from './RecruitingJobPage';

jest.mock('@/ai/components/LazyMarkdownRenderer', () => ({
  LazyMarkdownRenderer: ({ text }: { text: string }) => <div>{text}</div>,
}));
jest.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useLocation: () => ({ hash: '#access=scoped-token' }),
}));
jest.mock('~/config', () => ({
  REACT_APP_SERVER_BASE_URL: 'http://localhost:23001',
}));
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingPanel: 'section',
  StyledRecruitingStack: 'div',
  StyledRecruitingTitle: 'h2',
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
}));

it('shows company and full job text using an anonymous scoped request', async () => {
  const originalFetch = global.fetch;
  const request = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      jobs: [
        {
          id: 'job',
          title: '后端工程师',
          company: '示例公司',
          description: '负责开发与维护服务。',
          locations: ['北京'],
          employmentTypes: ['full_time'],
          workModes: ['hybrid'],
        },
      ],
    }),
  } as Response);
  global.fetch = request;
  render(<RecruitingJobPage />);
  expect(await screen.findByText('负责开发与维护服务。')).toBeInTheDocument();
  expect(screen.getAllByText('示例公司')).toHaveLength(2);
  expect(screen.getByText('北京 · 全职 · 混合办公')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(
    'http://localhost:23001/recruiting-job-pages',
    expect.objectContaining({
      credentials: 'omit',
      body: JSON.stringify({ token: 'scoped-token' }),
    }),
  );
  global.fetch = originalFetch;
});

/** Ensures both directions use single-profile navigation rather than stacked full documents. */
it('switches between candidates and jobs without showing every document at once', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [
        {
          name: { firstName: '测试候选人' },
          summary: '候选人的职业经历',
          skills: ['Go'],
          experience: [],
          education: ['测试大学'],
          expectedRoles: ['后端'],
        },
      ],
      jobs: [
        {
          id: 'second',
          title: '测试岗位',
          company: '测试公司',
          description: '岗位的完整正文',
          locations: [],
          employmentTypes: [],
          workModes: [],
          status: 'RECRUITING',
        },
      ],
    }),
  });
  render(<RecruitingJobPage />);
  expect(await screen.findByText('候选人的职业经历')).toBeInTheDocument();
  expect(screen.queryByText('岗位的完整正文')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /下一个/ }));
  expect(screen.getByText('岗位的完整正文')).toBeInTheDocument();
  expect(screen.queryByText('候选人的职业经历')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /上一个/ }));
  expect(screen.getByText('测试大学')).toBeInTheDocument();
  global.fetch = originalFetch;
});

it.each([true, false])(
  'opens a scoped PDF window before fetching and closes failed previews (success=%s)',
  async (success) => {
    const originalFetch = global.fetch;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const viewer = { opener: {}, location: { href: '' }, close: jest.fn() };
    const open = jest.spyOn(window, 'open').mockReturnValue(viewer as never);
    const create = jest.fn((_blob: Blob | MediaSource) => 'blob:scoped-pdf');
    URL.createObjectURL = create;
    URL.revokeObjectURL = jest.fn();
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobs: [],
          candidates: [
            {
              id: 'candidate',
              name: '测试候选人',
              summary: '职业资料',
              skills: [],
              experience: [],
              education: [],
              files: [{ fileId: 'resume', label: 'resume.pdf' }],
            },
          ],
        }),
      })
      .mockImplementationOnce(async () => {
        expect(open).toHaveBeenCalledWith('about:blank', '_blank');
        expect(viewer.opener).toBeNull();
        return {
          ok: success,
          blob: async () =>
            new Blob(['%PDF synthetic'], { type: 'application/octet-stream' }),
        };
      });
    global.fetch = request;
    try {
      render(<RecruitingJobPage />);
      fireEvent.click(await screen.findByRole('button', { name: '打开 PDF' }));
      if (success) {
        await waitFor(() =>
          expect(viewer.location.href).toBe('blob:scoped-pdf'),
        );
        expect((create.mock.calls[0][0] as Blob).type).toBe('application/pdf');
      } else {
        await waitFor(() => expect(viewer.close).toHaveBeenCalled());
        expect(create).not.toHaveBeenCalled();
      }
      expect(request).toHaveBeenLastCalledWith(
        'http://localhost:23001/recruiting-job-pages/files',
        expect.objectContaining({
          credentials: 'omit',
          redirect: 'error',
          body: JSON.stringify({
            token: 'scoped-token',
            candidateId: 'candidate',
            fileId: 'resume',
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      open.mockRestore();
    }
  },
);
