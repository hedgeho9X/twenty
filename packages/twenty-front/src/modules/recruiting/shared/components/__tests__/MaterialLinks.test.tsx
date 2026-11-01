/** Keeps text-only JD task details safe when a native FILES field is empty or null. */
import { fireEvent, render, screen } from '@testing-library/react';
import { RecruitingMaterialLinks } from '@/recruiting/shared/components/MaterialLinks';

jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingError: 'div',
  StyledRecruitingRow: 'div',
  StyledRecruitingStack: 'div',
}));
jest.mock('@/recruiting/shared/components/FilePreview', () => ({
  RecruitingFilePreview: ({ label }: { label: string }) => (
    <div role="dialog">{label}</div>
  ),
}));
jest.mock('@/recruiting/shared/api/request');

it.each([null, undefined, []])(
  'renders a text-only task without attachment controls: %j',
  (files) => {
    render(<RecruitingMaterialLinks intakeId="text-jd" files={files} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);
it('still opens a real attachment when references are present', () => {
  render(
    <RecruitingMaterialLinks
      intakeId="resume"
      files={[{ fileId: 'source', label: 'resume.pdf' }]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '查看' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('resume.pdf');
});
