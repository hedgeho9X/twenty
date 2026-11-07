/** Verifies colored selections retain Radix's value anchor and selectable workflow choices. */
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkflowSelect } from '../WorkflowSelect';
jest.mock('twenty-ui/icon', () => ({
  IconCheck: () => null,
  IconChevronDown: () => null,
  IconChevronUp: () => null,
}));
it('renders the positioning anchor and lets the operator choose a colored status', async () => {
  Element.prototype.scrollIntoView = jest.fn();
  const change = jest.fn();
  render(<WorkflowSelect value="TODO" onChange={change} />);
  const trigger = screen.getByRole('combobox', { name: '跟进状态' });
  expect(trigger.querySelector('[data-slot="select-value"]')).toHaveTextContent(
    '待处理',
  );
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '待联系' }));
  expect(change).toHaveBeenCalledWith('TO_CONTACT');
});
