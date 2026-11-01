/** Edits global admission limits without pausing or restarting active work. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Select } from '@/ui/input/components/Select';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import {
  StyledRecruitingRow,
  StyledRecruitingError,
} from '@/recruiting/shared/styles';

type Limits = { parsing: number; matching: number };
export const QueueSettings = ({ active }: { active: boolean }) => {
  const query = useRecruitingQuery<Limits>(active ? 'queue-settings' : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!query.data || query.error) return null;
  const limits = query.data;
  const change = async (key: keyof Limits, value: number) => {
    setBusy(true);
    setError('');
    try {
      await recruitingRequest('queue-settings', {
        method: 'POST',
        body: JSON.stringify({ ...limits, [key]: value }),
      });
      await query.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`设置失败`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <StyledRecruitingRow>
        <span>{t`解析并发`}</span>
        <Select
          dropdownId="parsing-concurrency"
          value={limits.parsing}
          disabled={busy}
          options={Array.from({ length: 20 }, (_, i) => ({
            value: i + 1,
            label: String(i + 1),
          }))}
          onChange={(value) => void change('parsing', value)}
        />
        <span>{t`匹配并发`}</span>
        <Select
          dropdownId="matching-concurrency"
          value={limits.matching}
          disabled={busy}
          options={Array.from({ length: 10 }, (_, i) => ({
            value: i + 1,
            label: String(i + 1),
          }))}
          onChange={(value) => void change('matching', value)}
        />
      </StyledRecruitingRow>
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
    </>
  );
};
