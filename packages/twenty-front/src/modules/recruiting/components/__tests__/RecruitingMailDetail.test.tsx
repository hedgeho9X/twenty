/** Verifies mail content, complete attachment visibility and safe HTML-only rendering. */
import { fireEvent, render, screen } from '@testing-library/react';
import { RecruitingMailDetail } from '../RecruitingMailDetail';
import { recruitingBlob } from '@/recruiting/utils/recruitingRequest';
import { type RecruitingMailArchive } from '@/recruiting/types/RecruitingMailArchive';

jest.mock('@/recruiting/utils/recruitingRequest');
jest.mock('twenty-ui/icon', () => ({
  IconFile: () => null,
  IconPhoto: () => null,
}));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));
jest.mock('../recruitingStyles', () => ({
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
  StyledRecruitingRow: 'div',
  StyledRecruitingStack: 'div',
}));
jest.mock('../RecruitingFilePreview', () => ({
  RecruitingFilePreview: ({ label }: { label: string }) => (
    <div role="dialog">{label}</div>
  ),
}));
const mail: RecruitingMailArchive = {
  archiveId: 'mail',
  name: 'Candidate intro',
  status: 'READY',
  artifactCount: 4,
  attachmentCount: 1,
  intakeIds: [],
  detail: {
    artifacts: [
      {
        key: 'raw',
        label: 'original.eml',
        kind: 'raw',
        inline: false,
        suggestedResume: false,
        mimeType: 'message/rfc822',
      },
      {
        key: 'body',
        label: 'mail-body.txt',
        kind: 'text',
        inline: false,
        suggestedResume: false,
        mimeType: 'text/plain',
      },
      {
        key: 'image',
        label: 'resume.png',
        kind: 'attachment',
        inline: true,
        suggestedResume: false,
        mimeType: 'image/png',
      },
    ],
  },
};
it('loads the body immediately and opens inline attachments without selection controls', async () => {
  jest
    .mocked(recruitingBlob)
    .mockResolvedValue({
      text: async () => 'My candidate introduction',
    } as Blob);
  render(<RecruitingMailDetail archive={mail} />);
  expect(
    await screen.findByText('My candidate introduction'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText('original.eml')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'resume.png' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('resume.png');
});
it('isolates HTML-only email and blocks remote content', async () => {
  jest
    .mocked(recruitingBlob)
    .mockResolvedValue({ text: async () => '<b>Hello</b>' } as Blob);
  render(
    <RecruitingMailDetail
      archive={{
        ...mail,
        detail: { artifacts: [{ ...mail.detail!.artifacts[1], kind: 'html' }] },
      }}
    />,
  );
  const frame = await screen.findByTitle('邮件正文');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
});
