import { useState } from 'react';
import { JobProfileDialog } from './JobProfileDialog';
/** Shows permission-scoped existing jobs before an operator imports another company-bound batch. */
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { RecruitingJobStatus } from './JobStatus';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { type RecruitingJob } from '@/recruiting/companies/types/Job';
import { type RecruitingPage } from '@/recruiting/shared/types/Page';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingRecordLink,
} from '@/recruiting/shared/styles';

/** Reads the existing directory API; opening this list cannot create jobs or start matching. */
export const RecruitingCompanyExistingJobs = ({
  companyId,
  active = true,
  onViewAll,
}: {
  companyId: string;
  active?: boolean;
  onViewAll?: () => void;
}) => {
  const [selectedJob, setSelectedJob] = useState<string>();
  const query = useRecruitingQuery<RecruitingPage<RecruitingJob>>(
    `jobs?companyId=${encodeURIComponent(companyId)}&active=false`,
    0,
    active,
  );
  const page = query.error ? undefined : query.data;
  return (
    <details>
      {selectedJob && (
        <JobProfileDialog
          id={selectedJob}
          onClose={() => setSelectedJob(undefined)}
        />
      )}
      <summary>{page ? t`已有岗位（${page.count}）` : t`已有岗位`}</summary>
      <StyledRecruitingStack>
        {query.loading && (
          <StyledRecruitingMuted>{t`正在读取已有岗位…`}</StyledRecruitingMuted>
        )}
        {query.error && (
          <StyledRecruitingError role="alert">
            {query.error}
          </StyledRecruitingError>
        )}
        {page?.records.slice(0, 5).map((job) => (
          <StyledRecruitingRow key={job.id}>
            <StyledRecruitingRecordLink
              href={`/object/recruitmentJob/${job.id}`}
            >
              {job.name}
            </StyledRecruitingRecordLink>
            <RecruitingJobStatus status={job.jobStatus} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedJob(job.id)}
            >{t`查看解析`}</Button>
          </StyledRecruitingRow>
        ))}
        {page?.count === 0 && (
          <StyledRecruitingMuted>{t`这家公司还没有岗位记录。`}</StyledRecruitingMuted>
        )}
        {page && page.count > 5 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onViewAll}
          >{t`查看全部 ${page.count} 个岗位`}</Button>
        )}
      </StyledRecruitingStack>
    </details>
  );
};
