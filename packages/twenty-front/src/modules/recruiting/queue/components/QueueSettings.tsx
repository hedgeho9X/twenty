/** Edits global admission limits without pausing or restarting active work. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { TextInput } from '@/recruiting/shadcn/compat';
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
        <ConcurrencyInput
          label="解析并发"
          value={limits.parsing}
          disabled={busy}
          onSave={(value) => void change('parsing', value)}
        />
        <span>{t`匹配并发`}</span>
        <ConcurrencyInput
          label="匹配并发"
          value={limits.matching}
          disabled={busy}
          onSave={(value) => void change('matching', value)}
        />
      </StyledRecruitingRow>
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
    </>
  );
};

/** Validates an integer on blur so typing never submits incomplete numeric values. */
const ConcurrencyInput = ({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onSave: (value: number) => void;
}) => {
  const [draft, setDraft] = useState(String(value));
  return (
    <TextInput
      aria-label={label}
      type="number"
      min={1}
      max={20}
      step={1}
      value={draft}
      disabled={disabled}
      style={{ width: 76 }}
      onChange={setDraft}
      onBlur={() => {
        const next = Number(draft);
        if (Number.isInteger(next) && next >= 1 && next <= 20) {
          if (next !== value) onSave(next);
        } else setDraft(String(value));
      }}
    />
  );
};
