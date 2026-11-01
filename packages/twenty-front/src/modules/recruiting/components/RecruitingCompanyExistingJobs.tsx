/** Shows permission-scoped existing jobs before an operator imports another company-bound batch. */
import { t } from '@lingui/core/macro';
import { Badge } from 'twenty-ui/primitives/data-display';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { type RecruitingJob } from '@/recruiting/types/RecruitingJob';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
  StyledRecruitingStack,
} from '@/recruiting/components/recruitingStyles';

/** Labels stored recruiting status without treating a missing value as active. */
const jobStatusLabel = (status?: string) =>
  ({
    RECRUITING: t`在招`,
    CLOSED: t`已停招`,
    PAUSED: t`已暂停`,
  })[status ?? ''] ?? t`状态待确认`;

/** Reads the existing directory API; opening this list cannot create jobs or start matching. */
export const RecruitingCompanyExistingJobs = ({
  companyId,
  active = true,
}: {
  companyId: string;
  active?: boolean;
}) => {
  const query = useRecruitingQuery<RecruitingPage<RecruitingJob>>(
    `jobs?companyId=${encodeURIComponent(companyId)}&active=false`,
    0,
    active,
  );
  const page = query.error ? undefined : query.data;
  return (
    <details>
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
            <a href={`/object/recruitmentJob/${job.id}`}>{job.name}</a>
            <Badge>{jobStatusLabel(job.jobStatus)}</Badge>
          </StyledRecruitingRow>
        ))}
        {page?.count === 0 && (
          <StyledRecruitingMuted>{t`这家公司还没有岗位记录。`}</StyledRecruitingMuted>
        )}
        {page && page.count > 5 && (
          <StyledRecruitingMuted>{t`这里显示前5条，可打开公司记录查看完整岗位。`}</StyledRecruitingMuted>
        )}
      </StyledRecruitingStack>
    </details>
  );
};
