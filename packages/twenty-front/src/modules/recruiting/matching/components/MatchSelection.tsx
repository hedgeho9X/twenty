import { MatchShareActions } from '@/recruiting/shared/components/MatchShareActions';
/** Selects up to ten ranked results and generates a persistent editable communication draft. */
import { useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Checkbox, Textarea } from 'twenty-ui/primitives/input';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';
import { type RecruitingDraft } from '@/recruiting/drafts/types/Draft';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { RecruitingCompanyName, RecruitingJobFacts } from './MatchFacts';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTable,
} from '@/recruiting/shared/styles';

/** Converts unavailable or denied clipboard access into a recoverable promise rejection. */
const copyText = async (text: string) => {
  await navigator.clipboard.writeText(text);
};

/** Separates local editing from polling so a completed response cannot replace unsaved text. */
const DraftText = ({ draft }: { draft: RecruitingDraft }) => {
  const [body, setBody] = useState(draft.body ?? '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await recruitingRequest(`drafts/${draft.draftId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          title: draft.title ?? '',
          body,
          approve: false,
        }),
      });
      setMessage(t`已保存`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t`保存失败`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <StyledRecruitingStack>
      <Textarea
        aria-label={t`沟通文案`}
        value={body}
        onValueChange={setBody}
        rows={8}
      />
      <StyledRecruitingRow>
        <Button
          disabled={saving || !body.trim()}
          onClick={() => {
            void save();
          }}
        >{t`保存修改`}</Button>
        <Button
          onClick={() => {
            void copyText(body)
              .then(() => setMessage(t`已复制`))
              .catch(() => setMessage(t`复制失败，请手动复制文本`));
          }}
        >{t`复制文案`}</Button>
        <span role="status">{message}</span>
      </StyledRecruitingRow>
    </StyledRecruitingStack>
  );
};

/** Defaults to the first five results and expands to the remaining five on request. */
export const MatchSelection = ({
  run,
  active = true,
}: {
  run: RecruitingMatchRun;
  active?: boolean;
}) => {
  const pairs = (run.top ?? []).slice(0, 10);
  const identifier = (pair: (typeof pairs)[number]) =>
    run.direction === 'JOB_TO_CANDIDATES' ? pair.candidateId : pair.jobId;
  const [visibleCount, setVisibleCount] = useState(5);
  const [selected, setSelected] = useState(
    () => new Set(pairs.slice(0, 5).map(identifier)),
  );
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [draftId, setDraftId] = useState<string>();
  const [autoCopy, setAutoCopy] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const saved = useRecruitingQuery<RecruitingDraft | null>(
    `match-runs/${run.runId}/draft`,
    0,
    active,
  );
  useEffect(() => {
    if (!selectionTouched && saved.data?.selectedIds?.length)
      setSelected(new Set(saved.data.selectedIds));
  }, [saved.data?.selectedIds, selectionTouched]);
  const id = draftId ?? saved.data?.draftId;
  const query = useRecruitingQuery<RecruitingDraft>(
    id ? `drafts/${id}` : null,
    2000,
    active,
  );
  const draft = query.data ?? saved.data;
  useEffect(() => {
    if (
      !active ||
      !autoCopy ||
      draft?.draftId !== autoCopy ||
      !['READY', 'NEEDS_REVIEW'].includes(draft.status) ||
      draft.stale ||
      !draft.body
    )
      return;
    setAutoCopy(undefined);
    void copyText(draft.body)
      .then(() => setMessage(t`文案已生成并复制`))
      .catch(() => setMessage(t`文案已保存，请点击复制文案`));
  }, [
    active,
    autoCopy,
    draft?.draftId,
    draft?.status,
    draft?.body,
    draft?.stale,
  ]);
  const generate = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await recruitingRequest<RecruitingDraft>('drafts', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'GREETING',
          matchRunId: run.runId,
          selectedIds: pairs
            .filter((pair) => selected.has(identifier(pair)))
            .map(identifier),
          idempotencyKey: key,
        }),
      });
      setDraftId(result.draftId);
      setAutoCopy(result.draftId);
      setKey(crypto.randomUUID());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t`生成失败`);
    } finally {
      setBusy(false);
    }
  };
  const select = (next: Set<string>) => {
    setSelectionTouched(true);
    setSelected(next);
    setKey(crypto.randomUUID());
  };
  return (
    <StyledRecruitingStack>
      <StyledRecruitingTable>
        <thead>
          <tr>
            <th>
              <Button
                variant="ghost"
                onClick={() => {
                  const visible = pairs.slice(0, visibleCount).map(identifier);
                  const all =
                    visible.length > 0 &&
                    visible.every((id) => selected.has(id));
                  select(all ? new Set() : new Set(visible));
                }}
              >
                {pairs
                  .slice(0, visibleCount)
                  .every((pair) => selected.has(identifier(pair)))
                  ? t`取消全选`
                  : t`全选当前结果`}
              </Button>
              <span>{t`已选 ${selected.size} 项`}</span>
            </th>
            <th>{run.direction === 'JOB_TO_CANDIDATES' ? t`姓名` : t`岗位`}</th>
            <th>{t`公司`}</th>
            <th>{t`匹配值`}</th>
          </tr>
        </thead>
        <tbody>
          {pairs.slice(0, visibleCount).map((pair) => (
            <tr key={identifier(pair)}>
              <td>
                <Checkbox
                  aria-label={`${t`选择`} ${run.direction === 'JOB_TO_CANDIDATES' ? pair.candidateLabel : pair.jobLabel}`}
                  checked={selected.has(identifier(pair))}
                  onCheckedChange={(checked) => {
                    const next = new Set(selected);
                    if (checked) next.add(identifier(pair));
                    else next.delete(identifier(pair));
                    select(next);
                  }}
                />
              </td>
              <td>
                {run.direction === 'JOB_TO_CANDIDATES' ? (
                  <a href={pair.candidateUrl}>{pair.candidateLabel}</a>
                ) : (
                  <RecruitingJobFacts id={pair.jobId} label={pair.jobLabel} />
                )}
              </td>
              <td>
                <RecruitingCompanyName id={pair.companyId} />
              </td>
              <td>{pair.score?.toFixed(2)} / 4</td>
            </tr>
          ))}
        </tbody>
      </StyledRecruitingTable>
      {pairs.length > visibleCount && (
        <Button
          variant="ghost"
          onClick={() => setVisibleCount(10)}
        >{t`加载更多`}</Button>
      )}
      <Button
        disabled={
          !run.complete ||
          !selected.size ||
          busy ||
          ['QUEUED', 'PROCESSING'].includes(draft?.status ?? '')
        }
        loading={busy}
        onClick={() => {
          void generate();
        }}
      >{t`生成沟通文案`}</Button>
      <MatchShareActions
        currentUrl={draft?.jobPageUrl}
        jobIds={[
          ...new Set(
            pairs
              .filter((pair) => selected.has(identifier(pair)))
              .map((pair) => pair.jobId),
          ),
        ]}
        candidateIds={
          run.direction === 'JOB_TO_CANDIDATES'
            ? [
                ...new Set(
                  pairs
                    .filter((pair) => selected.has(identifier(pair)))
                    .map((pair) => pair.candidateId),
                ),
              ]
            : []
        }
      />
      {message && (
        <StyledRecruitingMuted role="status">{message}</StyledRecruitingMuted>
      )}
      {(query.error || saved.error) && (
        <StyledRecruitingError>
          {query.error || saved.error}
        </StyledRecruitingError>
      )}
      {draft && ['QUEUED', 'PROCESSING'].includes(draft.status) && (
        <StyledRecruitingMuted>{t`正在生成文案…`}</StyledRecruitingMuted>
      )}
      {draft?.error && (
        <StyledRecruitingError>{draft.error}</StyledRecruitingError>
      )}
      {draft?.stale && (
        <StyledRecruitingMuted>{t`资料或文案规则已更新，请重新生成文案。`}</StyledRecruitingMuted>
      )}
      {draft &&
        !draft.stale &&
        ['READY', 'APPROVED', 'NEEDS_REVIEW'].includes(draft.status) && (
          <DraftText key={draft.draftId} draft={draft} />
        )}
    </StyledRecruitingStack>
  );
};
