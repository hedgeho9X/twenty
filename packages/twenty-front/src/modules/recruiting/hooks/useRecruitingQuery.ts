/** Keeps operator queries fresh and prevents cancelled or superseded responses from replacing current state. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import { t } from '@lingui/core/macro';

/** Polls only when requested and aborts pending reads when the path or mounted screen changes. */
export const useRecruitingQuery = <T>(
  path: string | null,
  interval = 0,
  enabled = true,
) => {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // oxlint-disable-next-line twenty/no-state-useref -- Owns an imperative cancellation resource; rendered state uses useState.
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    controller.current?.abort();
    if (!enabled) return;
    if (!path) {
      setData(undefined);
      setLoading(false);
      setError('');
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    try {
      const result = await recruitingRequest<T>(path, {
        signal: current.signal,
      });
      if (!current.signal.aborted) {
        setData(result);
        setError('');
      }
    } catch (failure) {
      if (!current.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : t`暂时无法刷新数据`,
        );
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [path, enabled]);
  useEffect(() => {
    setData(undefined);
    setError('');
  }, [path]);
  useEffect(() => {
    if (!enabled) {
      controller.current?.abort();
      setLoading(false);
      return;
    }
    void reload();
    const timer = interval
      ? window.setInterval(() => {
          void reload();
        }, interval)
      : undefined;
    return () => {
      if (timer) window.clearInterval(timer);
      controller.current?.abort();
    };
  }, [reload, interval, enabled]);
  return { data, error, loading, reload };
};
