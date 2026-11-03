/** Checks compact entry points and preserves protected variables across prose edits. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsBriefTemplates } from './SettingsBriefTemplates';
import { subscriptionRequest } from '@/settings/admin-panel/ai/utils/subscriptionRequest';
jest.mock('@/settings/admin-panel/ai/utils/subscriptionRequest');
jest.mock('@/recruiting/shared/api/request');
jest.mock(
  '@/settings/admin-panel/ai/components/subscriptionSettingsStyles',
  () => ({ StyledSubscriptionPanel: 'section', StyledSubscriptionRow: 'div' }),
);
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button {...props} onClick={onClick}>
      {children}
    </button>
  ),
  Textarea: ({ onValueChange, ...props }: any) => (
    <textarea {...props} onChange={(e) => onValueChange(e.target.value)} />
  ),
}));
jest.mock('twenty-ui/primitives/surfaces', () => ({
  Dialog: {
    Root: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    Portal: 'div',
    Backdrop: 'div',
    Viewport: 'div',
    Popup: 'div',
    Header: 'div',
    Title: 'h2',
    Body: 'div',
    Footer: 'div',
  },
}));
it('opens only the selected template and keeps its field token on save', async () => {
  const templates = {
    candidate: '写文案${candidateInfo}简洁',
    company: '企业${jobInfo}',
  };
  jest.mocked(subscriptionRequest).mockResolvedValue(templates);
  render(<SettingsBriefTemplates />);
  await waitFor(() =>
    expect(screen.getByText('候选人模板设置')).not.toBeDisabled(),
  );
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByText('候选人模板设置'));
  expect(screen.getByText('候选人信息', { selector: 'code' })).toHaveAttribute(
    'title',
    expect.stringContaining('profile'),
  );
  expect(screen.getByRole('textbox', { name: '模板文档' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('保存模板'));
  await waitFor(() =>
    expect(subscriptionRequest).toHaveBeenCalledWith(
      '/brief-templates',
      expect.objectContaining({
        body: JSON.stringify({
          ...templates,
          candidate: '写文案${candidateInfo}简洁',
        }),
      }),
    ),
  );
});
