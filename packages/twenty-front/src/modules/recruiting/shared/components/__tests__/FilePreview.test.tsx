/** Verifies that viewing untrusted HTML never creates an executable frame and that private PDF URLs are released. */
import { render, screen, waitFor } from '@testing-library/react';
import { RecruitingFilePreview } from '@/recruiting/shared/components/FilePreview';
import { recruitingBlob } from '@/recruiting/shared/api/request';
jest.mock('@/recruiting/shared/api/request');
jest.mock('@/activities/files/components/DocumentViewer', () => ({
  DocumentViewer: ({ documentUrl }: { documentUrl: string }) => (
    <div data-testid="native-pdf-viewer" data-url={documentUrl} />
  ),
}));
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
}));
jest.mock('twenty-ui/primitives/input', () => ({ Button: 'button' }));
jest.mock('twenty-ui/primitives/surfaces', () => ({
  Dialog: {
    Root: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Portal: 'div',
    Backdrop: 'div',
    Viewport: 'div',
    Popup: 'div',
    Header: 'div',
    Title: 'h1',
    Body: 'div',
    Footer: 'div',
  },
}));
beforeEach(() => {
  URL.createObjectURL = jest.fn(() => 'blob:local-test');
  URL.revokeObjectURL = jest.fn();
});
it('shows source HTML as escaped text without running scripts or loading its remote image', async () => {
  jest.mocked(recruitingBlob).mockResolvedValue({
    text: async () =>
      '<script>bad()</script><img src="https://example.invalid/a">',
  } as Blob);
  const { container } = render(
    <RecruitingFilePreview
      path="resume-intakes/task/files/file"
      label="resume.html"
      onClose={jest.fn()}
    />,
  );
  await screen.findByText(/<script>bad/);
  expect(container.querySelector('script,img,iframe')).toBeNull();
});
it('opens PDF bytes using a local PDF blob and revokes its URL on close', async () => {
  jest.mocked(recruitingBlob).mockResolvedValue(new Blob(['%PDF-test']));
  const { unmount } = render(
    <RecruitingFilePreview
      path="resume-intakes/task/files/file"
      label="resume.pdf"
      onClose={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(screen.getByTestId('native-pdf-viewer')).toHaveAttribute(
      'data-url',
      'blob:local-test',
    ),
  );
  expect(jest.mocked(URL.createObjectURL).mock.calls[0][0]).toMatchObject({
    type: 'application/pdf',
  });
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-test');
});
