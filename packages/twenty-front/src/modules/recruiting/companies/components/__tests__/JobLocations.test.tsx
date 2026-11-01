/** Verifies JD location typing retains separators and keeps each item's pending edit isolated. */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { RecruitingJobDraftEditor } from '@/recruiting/companies/components/JobDraftEditor';
import { type RecruitingJobDraft } from '@/recruiting/companies/types/JobDraft';
import { type RecruitingJobItem } from '@/recruiting/companies/types/JobItem';

jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingError: 'div',
  StyledRecruitingMuted: 'p',
  StyledRecruitingPanel: 'section',
  StyledRecruitingRow: 'div',
}));
jest.mock('twenty-ui/primitives/data-display', () => ({ Badge: 'span' }));
jest.mock('@/ui/input/components/Select', () => ({ Select: () => null }));
jest.mock('twenty-ui/primitives/input', () => ({
  Button: () => null,
  Checkbox: () => null,
  Field: { Root: 'div', Item: 'div', Label: 'label', Description: 'p' },
  Input: ({
    value,
    onValueChange,
    onBlur,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    onBlur?: () => void;
  }) => (
    <input
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onBlur={onBlur}
    />
  ),
  Textarea: () => null,
}));

const original: RecruitingJobDraft = {
  title: 'Fixture job',
  description: 'Fixture JD',
  preferences: '',
  category: null,
  employmentTypes: [],
  workModes: [],
  locations: ['北京'],
};
const item: RecruitingJobItem = {
  itemId: 'first-item',
  jobId: 'first-job',
  status: 'DRAFT',
  draft: original,
};

it.each(['、', ',', '，', ';', '；'])(
  'retains a typed %s until the next location and commits both locations on blur',
  (separator) => {
    const changed = jest.fn();
    /** Models the parent preview retaining structured overrides until batch confirmation. */
    const Editor = () => {
      const [draft, setDraft] = useState(original);
      return (
        <RecruitingJobDraftEditor
          item={item}
          draft={draft}
          ignored={false}
          busy={false}
          onIgnore={jest.fn()}
          onChange={(next) => {
            changed(next);
            setDraft(next);
          }}
        />
      );
    };
    render(<Editor />);
    const input = screen.getByDisplayValue('北京');
    fireEvent.focus(input);
    for (const value of [
      `北京${separator}`,
      `北京${separator}上`,
      `北京${separator}上海`,
    ]) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveValue(value);
    }
    expect(changed).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(changed).toHaveBeenLastCalledWith({
      ...original,
      locations: ['北京', '上海'],
    });
    expect(input).toHaveValue('北京、上海');
  },
);

it('syncs fresh props, retains an active edit for its stable item and drops it when switching items', () => {
  const changed = jest.fn();
  const editor = (
    currentItem: RecruitingJobItem,
    draft: RecruitingJobDraft,
  ) => (
    <RecruitingJobDraftEditor
      item={currentItem}
      draft={draft}
      ignored={false}
      busy={false}
      onIgnore={jest.fn()}
      onChange={changed}
    />
  );
  const { rerender } = render(editor(item, original));
  rerender(editor(item, { ...original, locations: ['成都'] }));
  const input = screen.getByDisplayValue('成都');
  fireEvent.change(input, { target: { value: '成都、上海' } });
  const refreshed = {
    ...original,
    title: 'Refreshed title',
    locations: ['深圳'],
  };
  rerender(editor(item, refreshed));
  expect(input).toHaveValue('成都、上海');
  fireEvent.blur(input);
  expect(changed).toHaveBeenLastCalledWith({
    ...refreshed,
    locations: ['成都', '上海'],
  });

  fireEvent.change(input, { target: { value: 'Uncommitted first item' } });
  const second = { ...item, itemId: 'second-item' };
  rerender(editor(second, { ...original, locations: ['杭州'] }));
  expect(input).toHaveValue('杭州');
  rerender(editor(item, { ...original, locations: ['苏州'] }));
  expect(input).toHaveValue('苏州');
});
