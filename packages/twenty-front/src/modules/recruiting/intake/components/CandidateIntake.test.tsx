/** A successful upload releases the form for the next candidate without retaining submitted files. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecruitingCandidateIntake } from './CandidateIntake';
import { recruitingRequest } from '@/recruiting/shared/api/request';
jest.mock('@/recruiting/shared/api/request');
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingDrop: 'label',
  StyledRecruitingError: 'p',
  StyledRecruitingMuted: 'p',
  StyledRecruitingPanel: 'section',
  StyledRecruitingRow: 'div',
  StyledRecruitingStack: 'div',
  StyledRecruitingTitle: 'h2',
}));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Checkbox: () => null,
  Field: { Root: 'div', Item: 'div', Label: 'label', Description: 'p' },
  Textarea: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <textarea value={value} onChange={(e) => onValueChange(e.target.value)} />
  ),
}));
it('clears accepted files and notes instead of requiring continue-upload', async () => {
  jest.mocked(recruitingRequest).mockResolvedValue({ intakeId: 'new' });
  const submitted = jest.fn();
  render(<RecruitingCandidateIntake onSubmitted={submitted} />);
  fireEvent.change(screen.getByLabelText('选择简历文件'), {
    target: {
      files: [new File(['synthetic'], 'test.txt', { type: 'text/plain' })],
    },
  });
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'test note' },
  });
  fireEvent.click(screen.getByRole('button', { name: '上传并开始整理' }));
  await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('test.txt')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.queryByText('继续上传简历')).not.toBeInTheDocument();
});
