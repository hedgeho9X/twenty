/** Verifies hidden panels stop polling without erasing loaded data or accepting cancelled stale responses. */
import { act, renderHook } from '@testing-library/react';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';

jest.mock('@/recruiting/utils/recruitingRequest', () => ({
  recruitingRequest: jest.fn(),
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

it('preserves the current view while disabled and resumes on returning to the panel', async () => {
  jest.mocked(recruitingRequest).mockResolvedValue({ value: 'loaded' });
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      useRecruitingQuery<{ value: string }>('drafts', 1000, enabled),
    { initialProps: { enabled: true } },
  );
  await act(async () => {});
  expect(result.current.data).toEqual({ value: 'loaded' });
  rerender({ enabled: false });
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(recruitingRequest).toHaveBeenCalledTimes(1);
  expect(result.current.data).toEqual({ value: 'loaded' });
  rerender({ enabled: true });
  await act(async () => {});
  expect(recruitingRequest).toHaveBeenCalledTimes(2);
});

it('ignores an old response even when a transport resolves after cancellation', async () => {
  let finish: (value: unknown) => void = () => undefined;
  jest
    .mocked(recruitingRequest)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    )
    .mockResolvedValueOnce({ value: 'new' });
  const { result, rerender } = renderHook(
    ({ path }) => useRecruitingQuery<{ value: string }>(path),
    { initialProps: { path: 'first' } },
  );
  rerender({ path: 'second' });
  await act(async () => {});
  await act(async () => {
    finish({ value: 'old' });
  });
  expect(result.current.data).toEqual({ value: 'new' });
});
