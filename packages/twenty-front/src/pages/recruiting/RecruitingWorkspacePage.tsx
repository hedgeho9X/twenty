/** Hosts recruiting operations inside the native authenticated Twenty workspace. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Select } from '@/ui/input/components/Select';
import { Tabs } from 'twenty-ui/primitives/navigation';
import { IconBriefcase, IconClock } from 'twenty-ui/icon';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { RecruitingCandidateIntake } from '@/recruiting/components/RecruitingCandidateIntake';
import { RecruitingQueueDialog } from '@/recruiting/components/RecruitingQueueDialog';
import { RecruitingMatchResults } from '@/recruiting/components/RecruitingMatchResults';
import { RecruitingCompanyJobs } from '@/recruiting/components/RecruitingCompanyJobs';
import { RecruitingManualMatch } from '@/recruiting/components/RecruitingManualMatch';
import { RecruitingDrafts } from '@/recruiting/components/RecruitingDrafts';
import { RecruitingMailSources } from '@/recruiting/components/RecruitingMailSources';
import { RecruitingSharing } from '@/recruiting/components/RecruitingSharing';
import {
  StyledRecruitingBody,
  StyledRecruitingWorkspace,
} from '@/recruiting/components/recruitingStyles';

/** Uses normal pages for material editing and a short popup for queue progress. */
export const RecruitingWorkspacePage = () => {
  const [params, setParams] = useSearchParams();
  const [queueOpen, setQueueOpen] = useState(false);
  const [hasNewTasks, setHasNewTasks] = useState(false);
  const tab = params.get('tab') ?? 'resumes';
  const candidateId = params.get('candidateId') ?? undefined;
  return (
    <StyledRecruitingWorkspace>
      <PageHeader title={t`招聘工作台`} Icon={IconBriefcase}>
        <Button
          startIcon={<IconClock size={16} />}
          onClick={() => {
            setQueueOpen(true);
            setHasNewTasks(false);
          }}
        >
          {hasNewTasks ? t`处理队列 · 有新任务` : t`处理队列`}
        </Button>
      </PageHeader>
      <StyledRecruitingBody>
        <Tabs.Root
          value={tab}
          onValueChange={(value) => {
            if (typeof value === 'string')
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set('tab', value);
                return next;
              });
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <Tabs.List aria-label={t`招聘工作区`}>
              <Tabs.Tab value="companies">{t`公司与岗位`}</Tabs.Tab>
              <Tabs.Tab value="resumes">{t`简历入库`}</Tabs.Tab>
              <Tabs.Tab value="mail">{t`邮件`}</Tabs.Tab>
              <Tabs.Tab value="matches">{t`匹配结果`}</Tabs.Tab>
              <Tabs.Indicator />
            </Tabs.List>
            <Select
              dropdownId="recruiting-more-pages"
              value={['manual', 'drafts', 'sharing'].includes(tab) ? tab : ''}
              options={[
                { value: '', label: t`更多` },
                { value: 'manual', label: t`手动匹配` },
                { value: 'drafts', label: t`问候与发布草稿` },
                { value: 'sharing', label: t`资料确认与跟进` },
              ]}
              onChange={(value) => {
                if (value)
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set('tab', value);
                    return next;
                  });
              }}
            />
          </div>
          <Tabs.Panel value="companies" keepMounted>
            <RecruitingCompanyJobs
              active={tab === 'companies'}
              initialIntakeId={params.get('intakeId') ?? undefined}
              onSubmitted={() => setHasNewTasks(true)}
              onIntakeChange={(id) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  if (id) next.set('intakeId', id);
                  else next.delete('intakeId');
                  return next;
                })
              }
            />
          </Tabs.Panel>
          <Tabs.Panel value="resumes" keepMounted>
            <RecruitingCandidateIntake
              key={candidateId ?? 'new'}
              existingCandidateId={candidateId}
              onSubmitted={() => setHasNewTasks(true)}
            />
          </Tabs.Panel>
          <Tabs.Panel value="mail" keepMounted>
            <RecruitingMailSources
              active={tab === 'mail'}
              onSubmitted={() => setHasNewTasks(true)}
            />
          </Tabs.Panel>
          <Tabs.Panel value="matches" keepMounted>
            <RecruitingMatchResults
              active={tab === 'matches'}
              key={params.get('runId') ?? 'list'}
              initialRunId={params.get('runId') ?? undefined}
              onSharing={(candidateId, jobId) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('tab', 'sharing');
                  next.set('sharingCandidateId', candidateId);
                  next.set('sharingJobId', jobId);
                  return next;
                })
              }
              onDraft={(candidateId, jobId) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('tab', 'drafts');
                  next.set('draftCandidateId', candidateId);
                  next.set('draftJobId', jobId);
                  return next;
                })
              }
            />
          </Tabs.Panel>
          <Tabs.Panel value="drafts" keepMounted>
            <RecruitingDrafts
              active={tab === 'drafts'}
              key={`${params.get('draftCandidateId')}:${params.get('draftJobId')}`}
              initialCandidateId={params.get('draftCandidateId') ?? undefined}
              initialJobId={params.get('draftJobId') ?? undefined}
            />
          </Tabs.Panel>
          <Tabs.Panel value="sharing" keepMounted>
            <RecruitingSharing
              active={tab === 'sharing'}
              initialCandidateId={params.get('sharingCandidateId') ?? undefined}
              initialJobId={params.get('sharingJobId') ?? undefined}
              key={`${params.get('sharingCandidateId')}:${params.get('sharingJobId')}`}
            />
          </Tabs.Panel>
          <Tabs.Panel value="manual" keepMounted>
            <RecruitingManualMatch
              onStarted={(id) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('tab', 'matches');
                  next.set('runId', id);
                  return next;
                })
              }
            />
          </Tabs.Panel>
        </Tabs.Root>
      </StyledRecruitingBody>
      <RecruitingQueueDialog open={queueOpen} onOpenChange={setQueueOpen} />
    </StyledRecruitingWorkspace>
  );
};
