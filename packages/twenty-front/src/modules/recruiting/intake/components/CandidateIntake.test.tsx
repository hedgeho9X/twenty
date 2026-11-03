/** A successful upload releases the form for the next candidate without retaining submitted files. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecruitingCandidateIntake } from './CandidateIntake';
import {
  recruitingRequest,
  uploadRecruitingFile,
} from '@/recruiting/shared/api/request';
jest.mock('@/recruiting/shared/api/request');
jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    label,
    value,
    onChange,
    options,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
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
    'aria-label': label,
  }: {
    'aria-label'?: string;
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled} aria-label={label}>
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
  jest
    .mocked(uploadRecruitingFile)
    .mockResolvedValue({ fileId: 'file', label: 'test.txt' } as never);
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
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'full_time' },
  });
  fireEvent.click(screen.getByRole('button', { name: '上传并开始整理' }));
  await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('test.txt')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.queryByText('继续上传简历')).not.toBeInTheDocument();
});

it('requires employment and submits five files as one candidate task', async () => {
  jest.mocked(recruitingRequest).mockClear();
  jest.mocked(uploadRecruitingFile).mockClear();
  jest.mocked(recruitingRequest).mockResolvedValue({ intakeId: 'group' });
  jest
    .mocked(uploadRecruitingFile)
    .mockResolvedValue({ fileId: 'synthetic', label: 'resume' } as never);
  render(<RecruitingCandidateIntake onSubmitted={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('选择简历文件'), {
    target: {
      files: Array.from(
        { length: 5 },
        (_, i) => new File(['synthetic'], `${i}.txt`),
      ),
    },
  });
  expect(screen.getByRole('button', { name: '上传并开始整理' })).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'internship' },
  });
  fireEvent.click(screen.getByRole('button', { name: '上传并开始整理' }));
  await waitFor(() => expect(recruitingRequest).toHaveBeenCalledTimes(1));
  expect(uploadRecruitingFile).toHaveBeenCalledTimes(5);
  const body = JSON.parse(
    jest.mocked(recruitingRequest).mock.calls[0][1]!.body as string,
  );
  expect(body.files).toHaveLength(5);
  expect(body.employmentType).toBe('internship');
});

it('removes one selected file without clearing the other', () => {
  render(<RecruitingCandidateIntake onSubmitted={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('选择简历文件'), {
    target: {
      files: [new File(['a'], 'keep.txt'), new File(['b'], 'remove.txt')],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: '移除 remove.txt' }));
  expect(screen.getByText('keep.txt')).toBeInTheDocument();
  expect(screen.queryByText('remove.txt')).not.toBeInTheDocument();
});
