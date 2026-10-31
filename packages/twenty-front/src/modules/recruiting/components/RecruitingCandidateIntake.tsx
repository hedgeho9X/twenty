/** Provides explicit per-candidate notes and stable retry identities for manual resume intake. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Checkbox, Field, Textarea } from 'twenty-ui/primitives/input';
import { IconFiles, IconUpload } from 'twenty-ui/icon';
import { type RecruitingIntake } from '@/recruiting/types/RecruitingIntake';
import { type RecruitingUpload } from '@/recruiting/types/RecruitingUpload';
import {
  recruitingRequest,
  uploadRecruitingFile,
} from '@/recruiting/utils/recruitingRequest';
import {
  StyledRecruitingDrop,
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTitle,
} from '@/recruiting/components/recruitingStyles';

/** Local entries retain their idempotency key until explicitly cleared or replaced. */
type ResumeEntry = {
  key: string;
  file: File;
  note: string;
  intake?: RecruitingIntake;
  error?: string;
  uploaded?: RecruitingUpload;
  attempted?: boolean;
};

/** Uploads multiple candidates separately by default; supplementary images can be grouped for one person. */
export const RecruitingCandidateIntake = ({
  onSubmitted,
  existingCandidateId,
}: {
  onSubmitted: () => void;
  existingCandidateId?: string;
}) => {
  const [entries, setEntries] = useState<ResumeEntry[]>([]);
  const [groupChoice, setGrouped] = useState(false);
  const grouped = Boolean(existingCandidateId) || groupChoice;
  const [note, setNote] = useState('');
  const [groupKey, setGroupKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [groupIntake, setGroupIntake] = useState<RecruitingIntake>();
  const locked =
    busy ||
    entries.some((entry) => Boolean(entry.attempted)) ||
    Boolean(groupIntake);
  const update = (key: string, patch: Partial<ResumeEntry>) =>
    setEntries((current) =>
      current.map((entry) =>
        entry.key === key ? { ...entry, ...patch } : entry,
      ),
    );

  /** Uses the single-request endpoint so retries do not allocate another file or candidate. */
  const submit = async () => {
    if (!entries.length || busy) return;
    setBusy(true);
    setError('');
    try {
      if (grouped && entries.length > 1) {
        const files = [];
        for (const entry of entries) {
          update(entry.key, { attempted: true });
          const file =
            entry.uploaded ?? (await uploadRecruitingFile(entry.file));
          update(entry.key, { uploaded: file });
          files.push(file);
        }
        const intake = await recruitingRequest<RecruitingIntake>(
          'resume-intakes',
          {
            method: 'POST',
            body: JSON.stringify({
              files,
              note,
              source: 'manual',
              idempotencyKey: groupKey,
              ...(existingCandidateId
                ? { candidateId: existingCandidateId }
                : {}),
            }),
          },
        );
        setGroupIntake(intake);
        onSubmitted();
      } else {
        for (const entry of entries) {
          if (entry.intake) continue;
          update(entry.key, { attempted: true });
          try {
            const form = new FormData();
            form.append('file', entry.file);
            form.append(
              'note',
              entries.length === 1
                ? note
                : [note, entry.note].filter(Boolean).join('\n\n'),
            );
            form.append('source', 'manual');
            form.append('batchId', groupKey);
            if (existingCandidateId)
              form.append('candidateId', existingCandidateId);
            const intake = await recruitingRequest<RecruitingIntake>(
              'resume-intakes/upload',
              {
                method: 'POST',
                headers: { 'idempotency-key': entry.key },
                body: form,
              },
            );
            update(entry.key, { intake, error: undefined });
            onSubmitted();
          } catch (failure) {
            update(entry.key, {
              error:
                failure instanceof Error
                  ? failure.message
                  : t`上传未完成，请重试`,
            });
          }
        }
      }
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
        <StyledRecruitingMuted>{t`上传简历并补充自我介绍，系统会整理资料、写入候选人列表，再独立安排岗位匹配。`}</StyledRecruitingMuted>
        {!locked && (
          <StyledRecruitingDrop>
            <IconUpload size={28} />
            <strong>{t`选择简历文件`}</strong>
            <StyledRecruitingMuted>{t`支持图片、PDF、Word、TXT、HTML、Markdown；单个文件最大 50MB。`}</StyledRecruitingMuted>
            <input
              aria-label={t`选择简历文件`}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.html,.htm,.md,.markdown"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (
                  files.some((file) => file.size > 50 * 1024 * 1024) ||
                  files.length > 30
                ) {
                  setError(t`每次最多30个文件，单个文件不能超过50MB`);
                  return;
                }
                setEntries(
                  files.map((file) => ({
                    key: crypto.randomUUID(),
                    file,
                    note: '',
                  })),
                );
                setError('');
                setGroupKey(crypto.randomUUID());
              }}
            />
          </StyledRecruitingDrop>
        )}
        {entries.length > 1 && !existingCandidateId && (
          <Field.Root>
            <Field.Item>
              <Checkbox
                checked={grouped}
                disabled={locked}
                onCheckedChange={(value) => setGrouped(value === true)}
              />
              <Field.Label>{t`这些文件属于同一位候选人`}</Field.Label>
            </Field.Item>
            <Field.Description>{t`多张简历图片或补充附件可合并；否则每个文件分别建立一位候选人。`}</Field.Description>
          </Field.Root>
        )}
        {entries.map((entry) => (
          <StyledRecruitingPanel key={entry.key}>
            <StyledRecruitingRow>
              <IconFiles size={16} />
              <strong>{entry.file.name}</strong>
              <StyledRecruitingMuted>{`${(entry.file.size / 1024 / 1024).toFixed(1)} MB`}</StyledRecruitingMuted>
            </StyledRecruitingRow>
            {!grouped && entries.length > 1 && (
              <Field.Root>
                <Field.Label>{t`这位候选人的补充说明（可选）`}</Field.Label>
                <Textarea
                  value={entry.note}
                  disabled={locked}
                  onValueChange={(value) => update(entry.key, { note: value })}
                  rows={2}
                  maxLength={100000}
                />
              </Field.Root>
            )}
            {entry.error && (
              <StyledRecruitingError role="alert">
                {entry.error}
              </StyledRecruitingError>
            )}
            {entry.intake && (
              <StyledRecruitingMuted>{t`已接收，请在处理队列查看进度。`}</StyledRecruitingMuted>
            )}
          </StyledRecruitingPanel>
        ))}
        <Field.Root>
          <Field.Label>
            {entries.length > 1 && !grouped
              ? t`所有候选人的共同说明（可选）`
              : t`补充说明（可选）`}
          </Field.Label>
          <Textarea
            value={note}
            disabled={locked}
            onValueChange={setNote}
            rows={4}
            maxLength={100000}
            placeholder={t`候选人的自我介绍、本次想投的岗位，或需要保留的其他说明。`}
          />
        </Field.Root>
        {error && (
          <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
        )}
        {groupIntake && (
          <StyledRecruitingMuted>{t`这一组材料已接收，可在处理队列查看。`}</StyledRecruitingMuted>
        )}
        <StyledRecruitingRow>
          <Button
            variant="solid"
            color="accent"
            startIcon={<IconUpload size={16} />}
            loading={busy}
            disabled={
              !entries.length ||
              Boolean(groupIntake) ||
              entries.every((entry) => Boolean(entry.intake))
            }
            onClick={() => {
              void submit();
            }}
          >{t`上传并开始整理`}</Button>
          {entries.length > 0 && (
            <Button
              disabled={busy}
              onClick={() => {
                setEntries([]);
                setNote('');
                setGroupIntake(undefined);
                setGrouped(false);
                setError('');
                setGroupKey(crypto.randomUUID());
              }}
            >{t`新建一批材料`}</Button>
          )}
        </StyledRecruitingRow>
      </StyledRecruitingPanel>
    </StyledRecruitingStack>
  );
};
