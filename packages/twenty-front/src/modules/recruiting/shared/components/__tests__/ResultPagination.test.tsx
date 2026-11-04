/** Verifies bounded page navigation and explicit jumps. */
import { fireEvent, render, screen } from '@testing-library/react';
import { ResultPagination, resultPages } from '../ResultPagination';
jest.mock('twenty-ui/primitives/input', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
it('keeps a bounded window for large result sets', () => {
  expect(resultPages(50, 100)).toEqual([1, 49, 50, 51, 100]);
  expect(resultPages(1, 1)).toEqual([1]);
});
it('navigates to valid pages and rejects out of range jumps', () => {
  const onPage = jest.fn();
  render(
    <ResultPagination
      count={3080}
      page={7}
      pageSize={50}
      onPage={onPage}
      onPageSize={jest.fn()}
    />,
  );
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '62' } });
  fireEvent.submit(
    screen.getByRole('button', { name: '跳转' }).closest('form')!,
  );
  expect(onPage).toHaveBeenLastCalledWith(62);
  onPage.mockClear();
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '63' } });
  fireEvent.submit(
    screen.getByRole('button', { name: '跳转' }).closest('form')!,
  );
  expect(onPage).not.toHaveBeenCalled();
});
