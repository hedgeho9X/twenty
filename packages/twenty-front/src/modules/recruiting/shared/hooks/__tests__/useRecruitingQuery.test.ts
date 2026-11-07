/** Verifies hidden panels stop polling without erasing loaded data or accepting cancelled stale responses. */
import { act, renderHook } from '@testing-library/react';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';

jest.mock('@/recruiting/shared/api/request', () => ({
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

it('waits for a slow read instead of aborting it at every polling interval', async () => {
  let finish: (value: unknown) => void = () => undefined;
  jest
    .mocked(recruitingRequest)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ value: 'refreshed' });
  const { result } = renderHook(() =>
    useRecruitingQuery<{ value: string }>('processing-tasks', 1000),
  );
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(recruitingRequest).toHaveBeenCalledTimes(1);
  expect(jest.mocked(recruitingRequest).mock.calls[0][1]?.signal?.aborted).toBe(
    false,
  );
  await act(async () => {
    finish({ value: 'loaded' });
  });
  expect(result.current.data).toEqual({ value: 'loaded' });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(recruitingRequest).toHaveBeenCalledTimes(2);
  expect(result.current.data).toEqual({ value: 'refreshed' });
});

it('patches a confirmed row without requesting or loading the full page again', async () => {
  jest
    .mocked(recruitingRequest)
    .mockResolvedValue({ records: [{ status: 'TODO' }] });
  const { result } = renderHook(() =>
    useRecruitingQuery<{ records: { status: string }[] }>('match-results'),
  );
  await act(async () => {});
  act(() =>
    result.current.updateData((page) => ({
      ...page,
      records: [{ status: 'TO_CONTACT' }],
    })),
  );
  expect(result.current.data?.records[0].status).toBe('TO_CONTACT');
  expect(result.current.loading).toBe(false);
  expect(recruitingRequest).toHaveBeenCalledTimes(1);
});
