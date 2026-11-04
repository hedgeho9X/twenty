/** Starts explicit candidate, job or specified-pair matching without bypassing the shared queue and policy. */
import { useState } from 'react';
import { RecruitingMatchResults } from './MatchResults';
import { t } from '@lingui/core/macro';
import { Button } from '@/recruiting/shadcn/compat';
import { Select } from '@/recruiting/shadcn/compat';
import { RecruitingRecordPicker } from '@/recruiting/shared/components/RecordPicker';
import { type RecruitingCandidate } from '@/recruiting/intake/types/Candidate';
import { type RecruitingCompany } from '@/recruiting/companies/types/Company';
import { type RecruitingJob } from '@/recruiting/companies/types/Job';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingTitle,
} from '@/recruiting/shared/styles';

/** Keeps record choice explicit and preserves a request key across a failed network response. */
export const RecruitingManualMatch = ({
  active = true,
}: {
  active?: boolean;
}) => {
  const [runId, setRunId] = useState<string>();
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
      setRunId(result.runId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`匹配请求未完成`);
    } finally {
      setBusy(false);
    }
  };
  if (runId)
    return (
      <RecruitingMatchResults
        key={runId}
        active={active}
        initialRunId={runId}
        onBack={() => setRunId(undefined)}
      />
    );
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingTitle>{t`手动匹配`}</StyledRecruitingTitle>
      <StyledRecruitingMuted>{t`选择候选人或岗位，直接开始匹配并在此查看结果。`}</StyledRecruitingMuted>
      <Select
        dropdownId="recruiting-match-direction"
        label={t`匹配方式`}
        value={mode}
        disabled={busy}
        options={[
          { value: 'candidate', label: t`候选人找岗位` },
          { value: 'job', label: t`岗位找候选人` },
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
      >{t`开始匹配`}</Button>
    </StyledRecruitingPanel>
  );
};
