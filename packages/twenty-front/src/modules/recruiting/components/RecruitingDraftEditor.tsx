/** Keeps unsaved operator edits separate from periodic queue refreshes. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Field, Input, Textarea } from 'twenty-ui/primitives/input';
import { type RecruitingDraft } from '@/recruiting/types/RecruitingDraft';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
} from '@/recruiting/components/recruitingStyles';

/** Saving or approval never marks a message sent or a posting published. */
export const RecruitingDraftEditor = ({
  draft,
  onSaved,
}: {
  draft: RecruitingDraft;
  onSaved: () => Promise<void>;
}) => {
  const [title, setTitle] = useState(draft.title ?? '');
  const [body, setBody] = useState(draft.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (approve: boolean) => {
    setBusy(true);
    setError('');
    try {
      await recruitingRequest(`drafts/${draft.draftId}/review`, {
        method: 'POST',
        body: JSON.stringify({ title, body, approve }),
      });
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`保存未完成`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingMuted>
        {draft.approvedAt
          ? t`已由运营人员核对；实际发送或发布仍需另行操作。`
          : t`请核对事实、语气和待补信息，编辑后保存。`}
      </StyledRecruitingMuted>
      {draft.stale && (
        <StyledRecruitingError>{t`来源资料已变化，请重新生成并核对。`}</StyledRecruitingError>
      )}
      {draft.generation?.profile.reviewNotes.map((note) => (
        <StyledRecruitingMuted key={note}>{note}</StyledRecruitingMuted>
      ))}
      <Field.Root>
        <Field.Label>{t`标题`}</Field.Label>
        <Input
          value={title}
          onValueChange={setTitle}
          disabled={busy || draft.stale}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>{t`正文`}</Field.Label>
        <Textarea
          value={body}
          onValueChange={setBody}
          rows={12}
          disabled={busy || draft.stale}
        />
      </Field.Root>
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
      <StyledRecruitingRow>
        <Button
          loading={busy}
          disabled={!body.trim() || draft.stale}
          onClick={() => {
            void save(false);
          }}
        >{t`保存修改`}</Button>
        <Button
          variant="solid"
          color="accent"
          loading={busy}
          disabled={!body.trim() || draft.stale}
          onClick={() => {
            void save(true);
          }}
        >{t`确认已核对草稿`}</Button>
        {draft.source?.candidateUrl && (
          <a href={draft.source.candidateUrl}>{t`查看候选人`}</a>
        )}
        {draft.source?.jobUrl && (
          <a href={draft.source.jobUrl}>{t`查看岗位`}</a>
        )}
      </StyledRecruitingRow>
    </StyledRecruitingPanel>
  );
};
