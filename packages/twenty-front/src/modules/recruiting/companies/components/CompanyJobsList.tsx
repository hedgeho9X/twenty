import { JobProfileDialog } from './JobProfileDialog';
/** Opens all jobs for one company using the existing permission-aware, paginated directory. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Input } from 'twenty-ui/primitives/input';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { type RecruitingPage } from '@/recruiting/shared/types/Page';
import { type RecruitingJob } from '@/recruiting/companies/types/Job';
import { type RecruitingCompany } from '@/recruiting/companies/types/Company';
import { RecruitingJobStatus } from './JobStatus';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTable,
  StyledRecruitingTitle,
  StyledRecruitingRecordLink,
} from '@/recruiting/shared/styles';

type RecruitingCompanyJobsListProps = { companyId: string; onBack: () => void };
/** Keeps the company filter mandatory, resets pagination on search and never changes the selected intake. */
export const RecruitingCompanyJobsList = ({
  companyId,
  onBack,
}: RecruitingCompanyJobsListProps) => {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const company = useRecruitingQuery<RecruitingCompany>(
    `companies/${encodeURIComponent(companyId)}`,
  );
  const [selectedJob, setSelectedJob] = useState<string>();
  const query = useRecruitingQuery<RecruitingPage<RecruitingJob>>(
    `jobs?companyId=${encodeURIComponent(companyId)}&active=false&offset=${offset}&search=${encodeURIComponent(search)}`,
  );
  const page = query.error ? undefined : query.data;
  return (
    <StyledRecruitingStack>
      {selectedJob && (
        <JobProfileDialog
          id={selectedJob}
          onClose={() => setSelectedJob(undefined)}
        />
      )}
      <StyledRecruitingRow>
        <Button variant="ghost" onClick={onBack}>{t`返回导入`}</Button>
      </StyledRecruitingRow>
      <StyledRecruitingPanel>
        <StyledRecruitingTitle>
          {company.error ? t`公司岗位` : (company.data?.name ?? t`公司岗位`)}
        </StyledRecruitingTitle>
        <StyledRecruitingMuted>
          {search ? t`搜索结果` : t`当前公司全部岗位`} · {page?.count ?? '—'}
        </StyledRecruitingMuted>
        <Input
          aria-label={t`搜索公司岗位`}
          placeholder={t`搜索岗位名称`}
          value={search}
          onValueChange={(value) => {
            setSearch(value);
            setOffset(0);
          }}
        />
        {(query.error || company.error) && (
          <StyledRecruitingError role="alert">
            {query.error || company.error}
          </StyledRecruitingError>
        )}
        <div style={{ overflowX: 'auto' }}>
          <StyledRecruitingTable>
            <thead>
              <tr>
                <th>{t`岗位名称`}</th>
                <th>{t`状态`}</th>
                <th>{t`解析资料`}</th>
              </tr>
            </thead>
            <tbody>
              {page?.records.map((job) => (
                <tr key={job.id}>
                  <td>
                    <StyledRecruitingRecordLink
                      href={`/object/recruitmentJob/${job.id}`}
                    >
                      {job.name}
                    </StyledRecruitingRecordLink>
                  </td>
                  <td>
                    <RecruitingJobStatus status={job.jobStatus} />
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() => setSelectedJob(job.id)}
                    >{t`查看解析`}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </StyledRecruitingTable>
        </div>
        {!query.loading && page?.count === 0 && (
          <StyledRecruitingMuted>{t`没有符合条件的岗位`}</StyledRecruitingMuted>
        )}
        <StyledRecruitingRow>
          <Button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >{t`上一页`}</Button>
          <Button
            disabled={!page?.hasNextPage}
            onClick={() => setOffset(offset + 100)}
          >{t`下一页`}</Button>
        </StyledRecruitingRow>
      </StyledRecruitingPanel>
    </StyledRecruitingStack>
  );
};
