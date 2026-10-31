/** Starts explicit candidate, job or specified-pair matching without bypassing the shared queue and policy. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Select } from '@/ui/input/components/Select';
import { RecruitingRecordPicker } from '@/recruiting/components/RecruitingRecordPicker';
import { type RecruitingCandidate } from '@/recruiting/types/RecruitingCandidate';
import { type RecruitingCompany } from '@/recruiting/types/RecruitingCompany';
import { type RecruitingJob } from '@/recruiting/types/RecruitingJob';
import { type RecruitingMatchRun } from '@/recruiting/types/RecruitingMatchRun';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingTitle,
} from '@/recruiting/components/recruitingStyles';

/** Keeps record choice explicit and preserves a request key across a failed network response. */
export const RecruitingManualMatch = ({
  onStarted,
}: {
  onStarted: (runId: string) => void;
}) => {
  const [mode, setMode] = useState('candidate');
  const [candidate, setCandidate] = useState<RecruitingCandidate>();
  const [company, setCompany] = useState<RecruitingCompany>();
  const [job, setJob] = useState<RecruitingJob>();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await recruitingRequest<RecruitingMatchRun>('match-runs', {
        method: 'POST',
        body: JSON.stringify({
          direction:
            mode === 'candidate'
              ? 'CANDIDATE_TO_JOBS'
              : mode === 'job'
                ? 'JOB_TO_CANDIDATES'
                : 'PAIR',
          subjectId: mode === 'job' ? job?.id : candidate?.id,
          ...(mode === 'pair' ? { jobId: job?.id } : {}),
          idempotencyKey: key,
        }),
      });
      setKey(crypto.randomUUID());
      onStarted(result.runId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`匹配请求未完成`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingTitle>{t`手动匹配`}</StyledRecruitingTitle>
      <StyledRecruitingMuted>{t`可以重新为候选人找岗位、为岗位找候选人，或核对指定的人岗组合。两种方向使用同一套评分与版本缓存。`}</StyledRecruitingMuted>
      <Select
        dropdownId="recruiting-match-direction"
        label={t`匹配方式`}
        value={mode}
        disabled={busy}
        options={[
          { value: 'candidate', label: t`候选人找岗位` },
          { value: 'job', label: t`岗位找候选人` },
          { value: 'pair', label: t`指定人岗组合` },
        ]}
        onChange={(value) => {
          setMode(value);
          setKey(crypto.randomUUID());
        }}
        fullWidth
      />
      {mode !== 'job' && (
        <RecruitingRecordPicker<RecruitingCandidate>
          label={t`选择候选人`}
          path="candidates"
          selected={candidate}
          disabled={busy}
          onSelect={(value) => {
            setCandidate(value);
            setKey(crypto.randomUUID());
          }}
          renderLabel={(record) =>
            `${record.name.firstName} ${record.name.lastName}${record.jobTitle ? ` · ${record.jobTitle}` : ''}`.trim()
          }
        />
      )}
      {mode !== 'candidate' && (
        <>
          <RecruitingRecordPicker<RecruitingCompany>
            label={t`选择公司`}
            path="companies"
            selected={company}
            disabled={busy}
            onSelect={(value) => {
              setCompany(value);
              setJob(undefined);
              setKey(crypto.randomUUID());
            }}
            renderLabel={(record) => record.name}
          />
          <RecruitingRecordPicker<RecruitingJob>
            label={t`选择在招岗位`}
            path={`jobs?companyId=${company?.id ?? ''}`}
            selected={job}
            disabled={busy || !company}
            onSelect={(value) => {
              setJob(value);
              setKey(crypto.randomUUID());
            }}
            renderLabel={(record) => record.name}
          />
        </>
      )}
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
      <Button
        variant="solid"
        color="accent"
        loading={busy}
        disabled={
          (mode !== 'job' && !candidate) || (mode !== 'candidate' && !job)
        }
        onClick={() => {
          void submit();
        }}
      >{t`开始匹配并查看进度`}</Button>
    </StyledRecruitingPanel>
  );
};
