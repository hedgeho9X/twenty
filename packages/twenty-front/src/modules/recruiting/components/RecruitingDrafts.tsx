/** Provides normal-page drafting, generation progress and explicit operator review using native UI. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Field, Textarea } from 'twenty-ui/primitives/input';
import { Select } from '@/ui/input/components/Select';
import { type RecruitingDraft } from '@/recruiting/types/RecruitingDraft';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import { type RecruitingCandidate } from '@/recruiting/types/RecruitingCandidate';
import { type RecruitingJob } from '@/recruiting/types/RecruitingJob';
import { RecruitingRecordPicker } from '@/recruiting/components/RecruitingRecordPicker';
import { RecruitingDraftEditor } from '@/recruiting/components/RecruitingDraftEditor';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTable,
  StyledRecruitingTitle,
} from '@/recruiting/components/recruitingStyles';

/** Keeps statuses readable without claiming that text generation completed a real-world action. */
const draftLabel = (status: string) =>
  ({
    QUEUED: t`排队中`,
    PROCESSING: t`生成中`,
    READY: t`待核对`,
    APPROVED: t`已核对`,
    NEEDS_REVIEW: t`需要核对`,
    FAILED: t`生成失败`,
  })[status] ?? status;

/** Defaults linked matching results into the composer while allowing independent greeting and posting drafts. */
export const RecruitingDrafts = ({
  initialCandidateId,
  initialJobId,
  active = true,
}: {
  initialCandidateId?: string;
  initialJobId?: string;
  active?: boolean;
}) => {
  const [kind, setKind] = useState('GREETING');
  const [candidate, setCandidate] = useState<RecruitingCandidate | null>();
  const [job, setJob] = useState<RecruitingJob | null>();
  const linkedCandidate = useRecruitingQuery<RecruitingCandidate>(
    initialCandidateId ? `candidates/${initialCandidateId}` : null,
  );
  const linkedJob = useRecruitingQuery<RecruitingJob>(
    initialJobId ? `jobs/${initialJobId}` : null,
  );
  const selectedCandidate =
    candidate === undefined ? linkedCandidate.data : (candidate ?? undefined);
  const selectedJob = job === undefined ? linkedJob.data : (job ?? undefined);
  const [note, setNote] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [draftId, setDraftId] = useState<string>();
  const [replacementKeys, setReplacementKeys] = useState<
    Record<string, string>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useRecruitingQuery<RecruitingPage<RecruitingDraft>>(
    `drafts?offset=${offset}`,
    8000,
    active,
  );
  const detail = useRecruitingQuery<RecruitingDraft>(
    draftId ? `drafts/${draftId}` : null,
    draftId ? 4000 : 0,
    active,
  );
  const canResume = ['QUEUED', 'PROCESSING'].includes(
    detail.data?.status ?? '',
  );
  /** Rebinds recovery to the current caller while the server preserves any task already in flight. */
  const retry = async () => {
    if (!draftId || busy || detail.data?.status === 'APPROVED') return;
    setBusy(true);
    setError('');
    try {
      await recruitingRequest(`drafts/${draftId}/retry`, {
        method: 'POST',
        body: '{}',
      });
      await detail.reload();
      await list.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`暂时无法重试`);
    } finally {
      setBusy(false);
    }
  };
  /** Creates a separate current-source draft while preserving the reviewed original and a recoverable submission identity. */
  const replaceApproved = async () => {
    const original = detail.data;
    if (!original || busy || original.status !== 'APPROVED' || !original.stale)
      return;
    const idempotencyKey =
      replacementKeys[original.draftId] ?? crypto.randomUUID();
    setReplacementKeys((current) => ({
      ...current,
      [original.draftId]: idempotencyKey,
    }));
    setBusy(true);
    setError('');
    try {
      const draft = await recruitingRequest<RecruitingDraft>('drafts', {
        method: 'POST',
        body: JSON.stringify({
          kind: original.kind,
          candidateId: original.candidateId,
          jobId: original.jobId,
          note: original.note ?? '',
          idempotencyKey,
        }),
      });
      setDraftId(draft.draftId);
      setReplacementKeys((current) => {
        const next = { ...current };
        delete next[original.draftId];
        return next;
      });
      await list.reload();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t`新稿请求未完成，原稿已保留`,
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const draft = await recruitingRequest<RecruitingDraft>('drafts', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          candidateId: kind === 'GREETING' ? selectedCandidate?.id : undefined,
          jobId: selectedJob?.id,
          note,
          idempotencyKey: key,
        }),
      });
      setDraftId(draft.draftId);
      setKey(crypto.randomUUID());
      await list.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`生成请求未完成`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingStack>
      <StyledRecruitingPanel>
        <StyledRecruitingTitle>{t`问候与发布草稿`}</StyledRecruitingTitle>
        <StyledRecruitingMuted>{t`根据当前资料生成可编辑文案，核对后由运营人员自行发送或发布。`}</StyledRecruitingMuted>
        <Select
          dropdownId="recruiting-draft-kind"
          label={t`草稿类型`}
          value={kind}
          options={[
            { value: 'GREETING', label: t`候选人问候` },
            { value: 'JOB_PUBLICATION', label: t`岗位发布` },
          ]}
          onChange={(value) => {
            setKind(value);
            setKey(crypto.randomUUID());
          }}
          disabled={busy}
          fullWidth
        />
        {kind === 'GREETING' && (
          <RecruitingRecordPicker<RecruitingCandidate>
            label={t`候选人`}
            path="candidates"
            selected={selectedCandidate}
            disabled={busy}
            onSelect={(value) => {
              setCandidate(value ?? null);
              setKey(crypto.randomUUID());
            }}
            renderLabel={(record) =>
              `${record.name.firstName} ${record.name.lastName}`.trim()
            }
          />
        )}
        <RecruitingRecordPicker<RecruitingJob>
          label={kind === 'GREETING' ? t`相关岗位（可选）` : t`岗位`}
          path="jobs"
          selected={selectedJob}
          disabled={busy}
          onSelect={(value) => {
            setJob(value ?? null);
            setKey(crypto.randomUUID());
          }}
          renderLabel={(record) => record.name}
        />
        <Field.Root>
          <Field.Label>{t`文案说明（可选）`}</Field.Label>
          <Textarea
            value={note}
            onValueChange={(value) => {
              setNote(value);
              setKey(crypto.randomUUID());
            }}
            rows={3}
            disabled={busy}
            maxLength={50000}
          />
        </Field.Root>
        {kind === 'GREETING' && selectedJob && (
          <Button
            disabled={busy}
            onClick={() => {
              setJob(null);
              setKey(crypto.randomUUID());
            }}
          >{t`不关联具体岗位`}</Button>
        )}
        <Button
          loading={busy}
          disabled={kind === 'GREETING' ? !selectedCandidate : !selectedJob}
          onClick={() => {
            void submit();
          }}
          variant="solid"
          color="accent"
        >{t`生成草稿`}</Button>
      </StyledRecruitingPanel>
      {(error ||
        list.error ||
        detail.error ||
        linkedCandidate.error ||
        linkedJob.error) && (
        <StyledRecruitingError role="alert">
          {error ||
            detail.error ||
            list.error ||
            linkedCandidate.error ||
            linkedJob.error}
        </StyledRecruitingError>
      )}
      {detail.data && (
        <StyledRecruitingPanel>
          <StyledRecruitingRow>
            <StyledRecruitingTitle>{detail.data.name}</StyledRecruitingTitle>
            <span>{draftLabel(detail.data.status)}</span>
            <Button
              disabled={busy}
              onClick={() => setDraftId(undefined)}
            >{t`收起`}</Button>
          </StyledRecruitingRow>
          {detail.data.error && (
            <StyledRecruitingError>{detail.data.error}</StyledRecruitingError>
          )}
          {['READY', 'APPROVED', 'NEEDS_REVIEW'].includes(
            detail.data.status,
          ) && (
            <RecruitingDraftEditor
              key={`${detail.data.draftId}:${detail.data.generation ? 'generated' : 'empty'}`}
              draft={detail.data}
              onSaved={detail.reload}
            />
          )}
          {canResume && (
            <StyledRecruitingMuted>{t`长时间没有进展时可尝试恢复；仍在运行的任务会继续等待`}</StyledRecruitingMuted>
          )}
          {(canResume ||
            detail.data.status === 'FAILED' ||
            (detail.data.stale && detail.data.status !== 'APPROVED')) && (
            <Button
              disabled={busy}
              loading={busy}
              onClick={() => {
                void retry();
              }}
            >
              {canResume ? t`恢复处理` : t`重试生成`}
            </Button>
          )}
          {detail.data.status === 'APPROVED' && detail.data.stale && (
            <>
              <StyledRecruitingMuted>{t`原稿已核对并保留。可根据当前资料另起新稿，完成后重新核对。`}</StyledRecruitingMuted>
              <Button
                disabled={busy}
                loading={busy}
                onClick={() => {
                  void replaceApproved();
                }}
              >{t`以当前资料另起新稿`}</Button>
            </>
          )}
        </StyledRecruitingPanel>
      )}
      <StyledRecruitingPanel>
        <StyledRecruitingTitle>{t`草稿记录`}</StyledRecruitingTitle>
        <StyledRecruitingTable>
          <thead>
            <tr>
              <th>{t`草稿`}</th>
              <th>{t`状态`}</th>
              <th>{t`操作`}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.records.map((draft) => (
              <tr key={draft.draftId}>
                <td>{draft.name}</td>
                <td>{draftLabel(draft.status)}</td>
                <td>
                  <Button
                    disabled={busy}
                    onClick={() => setDraftId(draft.draftId)}
                  >{t`打开`}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </StyledRecruitingTable>
        <StyledRecruitingRow>
          <Button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 30))}
          >{t`上一页`}</Button>
          <Button
            disabled={!list.data?.hasNextPage}
            onClick={() => setOffset(offset + 30)}
          >{t`下一页`}</Button>
        </StyledRecruitingRow>
      </StyledRecruitingPanel>
    </StyledRecruitingStack>
  );
};
