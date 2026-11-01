/** Public read-only job introductions loaded with a scoped URL-fragment capability, without a CRM login. */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { t } from '@lingui/core/macro';
import { REACT_APP_SERVER_BASE_URL } from '~/config';
import {
  StyledRecruitingPanel,
  StyledRecruitingStack,
  StyledRecruitingTitle,
  StyledRecruitingError,
  StyledRecruitingMuted,
} from '@/recruiting/shared/styles';

type JobPage = {
  jobs: {
    id: string;
    title: string;
    company: string;
    description: string;
    locations: string[];
    employmentTypes: string[];
    workModes: string[];
  }[];
};
const labels: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  internship: '实习',
  contract: '项目制',
  onsite: '现场办公',
  hybrid: '混合办公',
  remote: '远程',
};
/** Renders the selected job descriptions without loading the authenticated workspace. */
export const RecruitingJobPage = () => {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get('access');
  const [data, setData] = useState<JobPage>();
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError('');
    if (!token) {
      setError(t`岗位介绍链接不完整`);
      return;
    }
    void fetch(
      `${REACT_APP_SERVER_BASE_URL.replace(/\/$/, '')}/recruiting-job-pages`,
      {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: abort.signal,
        redirect: 'error',
      },
    )
      .then(async (response) => {
        const body = await response.json().catch(() => {
          throw new Error(t`岗位介绍暂不可用，请稍后重试`);
        });
        if (!response.ok)
          throw Error(
            typeof body.message === 'string'
              ? body.message
              : t`岗位介绍暂不可用`,
          );
        if (!abort.signal.aborted) setData(body);
      })
      .catch((failure) => {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : t`岗位介绍暂不可用`,
          );
      });
    return () => abort.abort();
  }, [token]);
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 32 }}>
      <StyledRecruitingTitle>{t`为你推荐的岗位`}</StyledRecruitingTitle>
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
      {!error && !data && (
        <StyledRecruitingMuted>{t`正在读取岗位…`}</StyledRecruitingMuted>
      )}
      <StyledRecruitingStack>
        {data?.jobs.map((job) => (
          <StyledRecruitingPanel key={job.id}>
            <StyledRecruitingTitle>{job.title}</StyledRecruitingTitle>
            <strong>{job.company}</strong>
            <StyledRecruitingMuted>
              {[
                ...job.locations,
                ...job.employmentTypes.map((value) => labels[value] ?? value),
                ...job.workModes.map((value) => labels[value] ?? value),
              ].join(' · ')}
            </StyledRecruitingMuted>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, margin: 0 }}>
              {job.description}
            </p>
          </StyledRecruitingPanel>
        ))}
      </StyledRecruitingStack>
      {data && !data.jobs.length && (
        <StyledRecruitingMuted>{t`这些岗位目前已下线，请联系招聘顾问了解最新机会。`}</StyledRecruitingMuted>
      )}
    </main>
  );
};
