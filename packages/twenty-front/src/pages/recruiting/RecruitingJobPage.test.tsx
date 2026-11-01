/** Verifies the public page reads a scoped link without sending CRM credentials. */
import { render, screen } from '@testing-library/react';
import { RecruitingJobPage } from './RecruitingJobPage';

jest.mock('react-router-dom', () => ({
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
  expect(screen.getByText('示例公司')).toBeInTheDocument();
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
