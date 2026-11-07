import { Input } from '@/recruiting/shadcn/compat';
/** Submits up to five documents as one candidate, retaining completed uploads across retries. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Field, Textarea } from '@/recruiting/shadcn/compat';
import { IconFiles, IconUpload, IconX } from 'twenty-ui/icon';
import { Select } from '@/recruiting/shadcn/compat';
import { type RecruitingUpload } from '@/recruiting/intake/types/Upload';
import {
  recruitingRequest,
  uploadRecruitingFile,
} from '@/recruiting/shared/api/request';
import {
  StyledRecruitingDrop,
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTitle,
} from '@/recruiting/shared/styles';

/** A completed file reference and request key survive uncertain network failures. */
type Entry = { key: string; file: File; uploaded?: RecruitingUpload };

/** Explicit employment choice takes precedence over model-inferred preferences. */
export const RecruitingCandidateIntake = ({
  onSubmitted,
  existingCandidateId,
}: {
  onSubmitted: () => void;
  existingCandidateId?: string;
}) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [employmentType, setEmploymentType] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const locked = busy || attempted;
  const clear = () => {
    setEntries([]);
    setNote('');
    setEmploymentType('');
    setAttempted(false);
    setError('');
    setKey(crypto.randomUUID());
  };
  const submit = async () => {
    if (busy || !entries.length || !employmentType) return;
    setBusy(true);
    setAttempted(true);
    setError('');
    try {
      const files: RecruitingUpload[] = [];
      for (const entry of entries) {
        const uploaded =
          entry.uploaded ?? (await uploadRecruitingFile(entry.file));
        setEntries((current) =>
          current.map((item) =>
            item.key === entry.key ? { ...item, uploaded } : item,
          ),
        );
        files.push(uploaded);
      }
      await recruitingRequest('resume-intakes', {
        method: 'POST',
        body: JSON.stringify({
          files,
          note,
          employmentType,
          source: 'manual',
          idempotencyKey: key,
          ...(existingCandidateId ? { candidateId: existingCandidateId } : {}),
        }),
      });
      clear();
      onSubmitted();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t`上传未完成，请重试`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingStack>
      <StyledRecruitingPanel>
        <StyledRecruitingTitle>{t`候选人材料`}</StyledRecruitingTitle>
        <Select
          dropdownId="candidate-employment-type"
          label={t`求职类型（必选）`}
          value={employmentType}
          options={[
            { value: '', label: t`请选择` },
            { value: 'full_time', label: t`正式` },
            { value: 'internship', label: t`实习` },
          ]}
          disabled={locked}
          onChange={setEmploymentType}
          fullWidth
        />
        {!locked && (
          <StyledRecruitingDrop>
            <IconUpload size={28} />
            <strong>{t`选择简历文件`}</strong>
            <StyledRecruitingMuted>{t`同一候选人最多6份文件，单个文件最大50MB`}</StyledRecruitingMuted>
            <Input
              aria-label={t`选择简历文件`}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.html,.htm,.md,.markdown"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (
                  files.length > 6 ||
                  files.some((file) => file.size > 50 * 1024 * 1024)
                ) {
                  setError(t`同一候选人最多6份文件，单个文件不能超过50MB`);
                  return;
                }
                setEntries(
                  files.map((file) => ({ key: crypto.randomUUID(), file })),
                );
                setError('');
                setKey(crypto.randomUUID());
              }}
            />
          </StyledRecruitingDrop>
        )}
        {entries.map((entry) => (
          <StyledRecruitingRow key={entry.key}>
            <IconFiles size={16} />
            <strong>{entry.file.name}</strong>
            <Button
              variant="ghost"
              size="sm"
              startIcon={<IconX size={14} />}
              aria-label={t`移除 ${entry.file.name}`}
              disabled={locked}
              onClick={() => {
                setEntries((current) =>
                  current.filter((item) => item.key !== entry.key),
                );
                setError('');
              }}
            />
          </StyledRecruitingRow>
        ))}
        <Field.Root>
          <Field.Label>{t`补充说明（可选）`}</Field.Label>
          <Textarea
            value={note}
            disabled={locked}
            onValueChange={setNote}
            rows={4}
            maxLength={100000}
          />
        </Field.Root>
        {error && (
          <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
        )}
        <StyledRecruitingRow>
          <Button
            variant="solid"
            color="accent"
            startIcon={<IconUpload size={16} />}
            loading={busy}
            disabled={!entries.length || !employmentType || busy}
            onClick={() => void submit()}
          >{t`上传并开始整理`}</Button>
          {entries.length > 0 && (
            <Button disabled={busy} onClick={clear}>{t`清空选择`}</Button>
          )}
        </StyledRecruitingRow>
      </StyledRecruitingPanel>
    </StyledRecruitingStack>
  );
};
