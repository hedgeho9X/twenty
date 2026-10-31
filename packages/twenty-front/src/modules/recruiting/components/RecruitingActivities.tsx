/** Records explicit operator follow-up and preserves legacy history without executing an external action. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Field, Input, Textarea } from 'twenty-ui/primitives/input';
import { Select } from '@/ui/input/components/Select';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingTable,
  StyledRecruitingTitle,
} from './recruitingStyles';

/** Verified assertions are distinct from notes and migrated CRM fields. */
type Activity = {
  activityId: string;
  action: string;
  note: string;
  at: string;
  channel: string;
  verified: boolean;
  humanConfirmed: boolean;
};
const labels = {
  NOTE: t`跟进备注`,
  CANDIDATE_CONTACTED: t`已联系候选人`,
  COMPANY_RECOMMENDED: t`已向公司推荐`,
  JOB_PUBLISHED: t`岗位已发布`,
};

/** Binds every new receipt to the currently selected records and retains its key after a network failure. */
export const RecruitingActivities = ({
  candidateId,
  jobId,
  active,
}: {
  candidateId?: string;
  jobId?: string;
  active: boolean;
}) => {
  const [action, setAction] = useState('NOTE');
  const [note, setNote] = useState('');
  const [channel, setChannel] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useRecruitingQuery<RecruitingPage<Activity>>(
    candidateId
      ? `activities?candidateId=${candidateId}&offset=${offset}`
      : `activities?offset=${offset}`,
    0,
    active,
  );
  /** This button records the user's declaration; no message delivery or publication API is called. */
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await recruitingRequest('activities', {
        method: 'POST',
        body: JSON.stringify({
          action,
          candidateId,
          jobId,
          note,
          channel,
          idempotencyKey: key,
        }),
      });
      setKey(crypto.randomUUID());
      setNote('');
      await list.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`记录未保存`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingTitle>{t`人工跟进记录`}</StyledRecruitingTitle>
      <StyledRecruitingMuted>{t`请先在上方选择对象。实际联系、推荐或发布完成后再记录回执。公司推荐要求候选人对当前资料已确认分享。`}</StyledRecruitingMuted>
      <Select
        dropdownId="recruiting-activity-action"
        label={t`记录类型`}
        value={action}
        disabled={busy}
        fullWidth
        options={Object.entries(labels).map(([value, label]) => ({
          value,
          label,
        }))}
        onChange={(value) => {
          setAction(value);
          setKey(crypto.randomUUID());
        }}
      />
      <Field.Root>
        <Field.Label>{t`渠道或外部记录（可选）`}</Field.Label>
        <Input
          value={channel}
          onValueChange={(value) => {
            setChannel(value);
            setKey(crypto.randomUUID());
          }}
          maxLength={300}
          disabled={busy}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>{t`跟进说明`}</Field.Label>
        <Textarea
          value={note}
          onValueChange={(value) => {
            setNote(value);
            setKey(crypto.randomUUID());
          }}
          maxLength={10000}
          rows={3}
          disabled={busy}
        />
      </Field.Root>
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
      <StyledRecruitingRow>
        <Button
          variant="solid"
          color="accent"
          disabled={
            busy ||
            !note.trim() ||
            (action === 'JOB_PUBLISHED' ? !jobId : !candidateId) ||
            (action === 'COMPANY_RECOMMENDED' && !jobId)
          }
          loading={busy}
          onClick={() => {
            void save();
          }}
        >
          {action === 'NOTE' ? t`保存备注` : t`确认实际已完成并记录`}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            void list.reload();
          }}
        >{t`刷新记录`}</Button>
      </StyledRecruitingRow>
      {list.error && (
        <StyledRecruitingError role="alert">{list.error}</StyledRecruitingError>
      )}
      <StyledRecruitingTable>
        <thead>
          <tr>
            <th>{t`时间`}</th>
            <th>{t`记录`}</th>
            <th>{t`说明`}</th>
            <th>{t`确认来源`}</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.records.map((row) => (
            <tr key={row.activityId}>
              <td>{new Date(row.at).toLocaleString()}</td>
              <td>
                {labels[row.action as keyof typeof labels] ??
                  row.action ??
                  t`历史记录`}
              </td>
              <td>
                <div>{row.note}</div>
                <StyledRecruitingMuted>{row.channel}</StyledRecruitingMuted>
              </td>
              <td>
                {row.humanConfirmed
                  ? t`本人确认`
                  : row.verified
                    ? t`备注`
                    : t`历史数据／需核对`}
              </td>
            </tr>
          ))}
        </tbody>
      </StyledRecruitingTable>
      {!list.loading && !list.data?.records.length && (
        <StyledRecruitingMuted>{t`暂无跟进记录。`}</StyledRecruitingMuted>
      )}
      <StyledRecruitingRow>
        <Button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >{t`上一页`}</Button>
        <Button
          disabled={!list.data?.hasNextPage}
          onClick={() => setOffset(offset + 30)}
        >{t`下一页`}</Button>
      </StyledRecruitingRow>
    </StyledRecruitingPanel>
  );
};
