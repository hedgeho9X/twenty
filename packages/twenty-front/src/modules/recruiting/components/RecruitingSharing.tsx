/** Lets operators prepare scoped candidate and company links without declaring an actual recommendation or contact. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { RecruitingRecordPicker } from '@/recruiting/components/RecruitingRecordPicker';
import { RecruitingActivities } from '@/recruiting/components/RecruitingActivities';
import { type RecruitingCandidate } from '@/recruiting/types/RecruitingCandidate';
import { type RecruitingJob } from '@/recruiting/types/RecruitingJob';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
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
} from './recruitingStyles';

/** Lists omit capabilities; copying explicitly requests one under the creator's current native permissions. */
type Invite = {
  inviteId: string;
  kind: string;
  candidateId: string;
  candidateLabel?: string;
  candidateUrl?: string;
  jobIds: string[];
  status: string;
  expiresAt: string;
  expired: boolean;
  url?: string;
};

/** Keeps link creation independent from sending and candidate consent independent from operator intent. */
export const RecruitingSharing = ({
  active = true,
  initialCandidateId,
  initialJobId,
}: {
  active?: boolean;
  initialCandidateId?: string;
  initialJobId?: string;
}) => {
  const [candidate, setCandidate] = useState<RecruitingCandidate>();
  const [job, setJob] = useState<RecruitingJob | null>();
  const linkedCandidate = useRecruitingQuery<RecruitingCandidate>(
    initialCandidateId ? `candidates/${initialCandidateId}` : null,
  );
  const linkedJob = useRecruitingQuery<RecruitingJob>(
    initialJobId ? `jobs/${initialJobId}` : null,
  );
  const selectedCandidate = candidate ?? linkedCandidate.data;
  const selectedJob = job === undefined ? linkedJob.data : (job ?? undefined);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useRecruitingQuery<RecruitingPage<Invite>>(
    `portal-invites?offset=${offset}`,
    0,
    active,
  );
  const status = useRecruitingQuery<{ status: string; valid: boolean }>(
    selectedCandidate && selectedJob
      ? `sharing-status?candidateId=${selectedCandidate.id}&jobId=${selectedJob.id}`
      : null,
    0,
    active,
  );
  /** Clipboard failures preserve the created link's idempotency key for a safe retry. */
  const execute = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await list.reload();
      await status.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`操作未完成`);
    } finally {
      setBusy(false);
    }
  };
  /** Company access is checked again server-side, even if a stale UI shows a valid confirmation. */
  const create = (kind: 'CANDIDATE' | 'COMPANY') =>
    execute(async () => {
      const invite = await recruitingRequest<Invite>('portal-invites', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          candidateId: selectedCandidate?.id,
          jobIds: selectedJob ? [selectedJob.id] : [],
          expiresInDays: 7,
          idempotencyKey: `${key}:${kind}`,
        }),
      });
      if (!invite.url) throw new Error(t`链接未生成，请重试`);
      await navigator.clipboard.writeText(invite.url);
      setKey(crypto.randomUUID());
      setNotice(t`链接已复制。请由运营人员自行发送。`);
    });
  return (
    <StyledRecruitingStack>
      <StyledRecruitingPanel>
        <StyledRecruitingTitle>{t`资料确认与分享`}</StyledRecruitingTitle>
        <StyledRecruitingMuted>{t`先把候选人入口发给本人核对资料、表达意向并确认分享；确认后才能创建对应岗位的公司预览。生成或复制链接不代表已经联系或推荐。`}</StyledRecruitingMuted>
        <RecruitingRecordPicker<RecruitingCandidate>
          label={t`候选人`}
          path="candidates"
          selected={selectedCandidate}
          disabled={busy}
          onSelect={(value) => {
            setCandidate(value);
            setKey(crypto.randomUUID());
          }}
          renderLabel={(record) =>
            `${record.name.firstName} ${record.name.lastName}`.trim()
          }
        />
        <RecruitingRecordPicker<RecruitingJob>
          label={t`相关在招岗位（可选）`}
          path="jobs"
          selected={selectedJob}
          disabled={busy}
          onSelect={(value) => {
            setJob(value);
            setKey(crypto.randomUUID());
          }}
          renderLabel={(record) => record.name}
        />
        {selectedJob && (
          <Button
            disabled={busy}
            onClick={() => {
              setJob(null);
              setKey(crypto.randomUUID());
            }}
          >{t`仅核对资料，暂不指定岗位`}</Button>
        )}
        {selectedJob && (
          <StyledRecruitingMuted>
            {status.data?.valid
              ? t`候选人已确认当前资料可向该岗位分享`
              : t`当前资料尚未获得有效的分享确认`}
          </StyledRecruitingMuted>
        )}
        {error && (
          <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
        )}
        {notice && <div role="status">{notice}</div>}
        <StyledRecruitingRow>
          <Button
            variant="solid"
            color="accent"
            disabled={busy || !selectedCandidate}
            onClick={() => {
              void create('CANDIDATE');
            }}
          >{t`创建并复制候选人入口`}</Button>
          <Button
            disabled={
              busy || !selectedCandidate || !selectedJob || !status.data?.valid
            }
            onClick={() => {
              void create('COMPANY');
            }}
          >{t`创建并复制公司预览`}</Button>
          <Button
            disabled={busy}
            onClick={() => {
              void execute(async () => {});
            }}
          >{t`刷新确认状态`}</Button>
        </StyledRecruitingRow>
      </StyledRecruitingPanel>
      <RecruitingActivities
        candidateId={selectedCandidate?.id}
        jobId={selectedJob?.id}
        active={active}
        key={`${selectedCandidate?.id}:${selectedJob?.id}`}
      />
      <StyledRecruitingPanel>
        <StyledRecruitingTitle>{t`已创建的入口`}</StyledRecruitingTitle>
        {list.error && (
          <StyledRecruitingError role="alert">
            {list.error}
          </StyledRecruitingError>
        )}
        <StyledRecruitingTable>
          <thead>
            <tr>
              <th>{t`候选人`}</th>
              <th>{t`访问对象`}</th>
              <th>{t`有效期`}</th>
              <th>{t`状态`}</th>
              <th>{t`操作`}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.records.map((invite) => (
              <tr key={invite.inviteId}>
                <td>
                  <a href={invite.candidateUrl}>
                    {invite.candidateLabel ?? t`候选人`}
                  </a>
                </td>
                <td>
                  {invite.kind === 'CANDIDATE' ? t`候选人本人` : t`公司预览`}
                </td>
                <td>{new Date(invite.expiresAt).toLocaleString()}</td>
                <td>
                  {invite.expired
                    ? t`已过期`
                    : invite.status === 'ACTIVE'
                      ? t`有效`
                      : t`已撤销`}
                </td>
                <td>
                  <StyledRecruitingRow>
                    <Button
                      disabled={
                        busy || invite.expired || invite.status !== 'ACTIVE'
                      }
                      onClick={() => {
                        void execute(async () => {
                          const linked = await recruitingRequest<Invite>(
                            `portal-invites/${invite.inviteId}/link`,
                            { method: 'POST' },
                          );
                          if (linked.url)
                            await navigator.clipboard.writeText(linked.url);
                          setNotice(t`链接已复制。请由运营人员自行发送。`);
                        });
                      }}
                    >{t`复制链接`}</Button>
                    <Button
                      disabled={busy || invite.status !== 'ACTIVE'}
                      onClick={() => {
                        void execute(async () => {
                          await recruitingRequest(
                            `portal-invites/${invite.inviteId}/revoke`,
                            { method: 'POST' },
                          );
                          setNotice(t`入口已撤销，之后的查看与下载将被阻止。`);
                        });
                      }}
                    >{t`撤销入口`}</Button>
                  </StyledRecruitingRow>
                </td>
              </tr>
            ))}
          </tbody>
        </StyledRecruitingTable>
        {!list.data?.records.length && !list.loading && (
          <StyledRecruitingMuted>{t`还没有创建入口。`}</StyledRecruitingMuted>
        )}
        <StyledRecruitingRow>
          <Button
            disabled={offset === 0 || busy}
            onClick={() => setOffset(Math.max(0, offset - 30))}
          >{t`上一页`}</Button>
          <Button
            disabled={!list.data?.hasNextPage || busy}
            onClick={() => setOffset(offset + 30)}
          >{t`下一页`}</Button>
        </StyledRecruitingRow>
      </StyledRecruitingPanel>
    </StyledRecruitingStack>
  );
};
