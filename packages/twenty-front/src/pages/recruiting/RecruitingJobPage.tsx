import '@/recruiting/shadcn.css';
import { Button } from '@/recruiting/shadcn/compat';
/** Public read-only job introductions loaded with a scoped URL-fragment capability, without a CRM login. */
import { useEffect, useState } from 'react';
import { LazyMarkdownRenderer } from '@/ai/components/LazyMarkdownRenderer';
import { useLocation, useParams } from 'react-router-dom';
import { t } from '@lingui/core/macro';
import { REACT_APP_SERVER_BASE_URL } from '~/config';
import { PublicProfileNavigator } from '@/recruiting/portal/components/PublicProfileNavigator';
import {
  StyledRecruitingPanel,
  StyledRecruitingTitle,
  StyledRecruitingError,
  StyledRecruitingMuted,
} from '@/recruiting/shared/styles';

type JobPage = {
  candidates?: {
    id?: string;
    urls?: string[];
    files?: { fileId: string; label: string }[];
    name: { firstName?: string; lastName?: string };
    summary: string;
    skills: string[];
    experience: string[];
    education: string[];
    expectedRoles: string[];
  }[];
  jobs: {
    status?: string;
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
  const params = useParams();
  const token =
    params.token ?? new URLSearchParams(location.hash.slice(1)).get('access');
  const [data, setData] = useState<JobPage>();
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string>();
  const download = async (
    candidateId: string,
    file: { fileId: string; label: string },
    preview = false,
  ) => {
    const viewer = preview ? window.open('about:blank', '_blank') : null;
    if (viewer) viewer.opener = null;
    setDownloading(file.fileId);
    try {
      const response = await fetch(
        `${REACT_APP_SERVER_BASE_URL.replace(/\/$/, '')}/recruiting-job-pages/files`,
        {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, candidateId, fileId: file.fileId }),
        },
      );
      if (!response.ok) throw new Error(t`材料无法下载，请确认分享仍然有效`);
      const blob = await response.blob();
      const url = URL.createObjectURL(
        preview ? new Blob([blob], { type: 'application/pdf' }) : blob,
      );
      if (viewer) {
        viewer.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
      const link = document.createElement('a');
      link.href = url;
      link.download = file.label;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failure) {
      viewer?.close();
      setError(failure instanceof Error ? failure.message : t`下载失败`);
    } finally {
      setDownloading(undefined);
    }
  };
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
    <main
      className="recruiting-shadcn"
      style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}
    >
      <StyledRecruitingTitle>{t`推荐资料`}</StyledRecruitingTitle>
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
      {!error && !data && (
        <StyledRecruitingMuted>{t`正在读取岗位…`}</StyledRecruitingMuted>
      )}
      <PublicProfileNavigator
        key={token}
        items={[
          ...(data?.candidates ?? []).map((person, i) => ({
            key: `candidate-${i}`,
            title: [person.name?.firstName, person.name?.lastName]
              .filter(Boolean)
              .join(' '),
            subtitle: person.expectedRoles?.join(' · '),
            content: (
              <StyledRecruitingPanel>
                <StyledRecruitingTitle>
                  {[person.name?.firstName, person.name?.lastName]
                    .filter(Boolean)
                    .join(' ')}
                </StyledRecruitingTitle>
                <p>{person.summary}</p>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {person.urls
                    ?.filter((url) => /^https?:\/\//i.test(url))
                    .map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {url}
                      </a>
                    ))}
                  {person.files?.map((file) => (
                    <div key={file.fileId} className="flex items-center gap-2">
                      {/\.pdf$/i.test(file.label) && (
                        <Button
                          variant="outline"
                          disabled={Boolean(downloading) || !person.id}
                          onClick={() =>
                            person.id && void download(person.id, file, true)
                          }
                        >
                          打开 PDF
                        </Button>
                      )}
                      <Button
                        key={file.fileId}
                        disabled={Boolean(downloading) || !person.id}
                        onClick={() =>
                          person.id && void download(person.id, file)
                        }
                      >
                        {t`下载`} {file.label}
                      </Button>
                    </div>
                  ))}
                </div>
                <p>{person.skills?.join(' · ')}</p>
                {person.experience?.map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
                {person.education?.map((line, j) => (
                  <p key={`education-${j}`}>{line}</p>
                ))}
              </StyledRecruitingPanel>
            ),
          })),
          ...(data?.jobs ?? []).map((job) => ({
            key: `job-${job.id}`,
            title: job.title,
            subtitle: job.company,
            content: (
              <StyledRecruitingPanel>
                <StyledRecruitingTitle>{job.title}</StyledRecruitingTitle>
                <strong>{job.company}</strong>
                <span>{job.status === 'RECRUITING' ? '在招' : '已停招'}</span>
                <StyledRecruitingMuted>
                  {[
                    ...job.locations,
                    ...job.employmentTypes.map(
                      (value) => labels[value] ?? value,
                    ),
                    ...job.workModes.map((value) => labels[value] ?? value),
                  ].join(' · ')}
                </StyledRecruitingMuted>
                <LazyMarkdownRenderer text={job.description} />
              </StyledRecruitingPanel>
            ),
          })),
        ]}
      />
      {data && !data.jobs.length && !data.candidates?.length && (
        <StyledRecruitingMuted>{t`这些岗位目前已下线，请联系招聘顾问了解最新机会。`}</StyledRecruitingMuted>
      )}
    </main>
  );
};
