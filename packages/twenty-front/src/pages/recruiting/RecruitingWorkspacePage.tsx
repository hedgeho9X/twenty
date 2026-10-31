/** Hosts recruiting operations inside the native authenticated Twenty workspace. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Tabs } from 'twenty-ui/primitives/navigation';
import { IconBriefcase, IconClock } from 'twenty-ui/icon';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { RecruitingCandidateIntake } from '@/recruiting/components/RecruitingCandidateIntake';
import { RecruitingQueueDialog } from '@/recruiting/components/RecruitingQueueDialog';
import { RecruitingMatchResults } from '@/recruiting/components/RecruitingMatchResults';
import { RecruitingCompanyJobs } from '@/recruiting/components/RecruitingCompanyJobs';
import { RecruitingManualMatch } from '@/recruiting/components/RecruitingManualMatch';
import { RecruitingDrafts } from '@/recruiting/components/RecruitingDrafts';
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
          <Tabs.List aria-label={t`招聘工作区`}>
            <Tabs.Tab value="companies">{t`公司与岗位`}</Tabs.Tab>
            <Tabs.Tab value="resumes">{t`候选人入库`}</Tabs.Tab>
            <Tabs.Tab value="matches">{t`匹配待查看`}</Tabs.Tab>
            <Tabs.Tab value="manual">{t`手动匹配`}</Tabs.Tab>
            <Tabs.Tab value="drafts">{t`问候与发布草稿`}</Tabs.Tab>
            <Tabs.Indicator />
          </Tabs.List>
          <Tabs.Panel value="companies" keepMounted>
            <RecruitingCompanyJobs
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
          <Tabs.Panel value="matches" keepMounted>
            <RecruitingMatchResults
              key={params.get('runId') ?? 'list'}
              initialRunId={params.get('runId') ?? undefined}
              onDraft={(candidateId, jobId) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('tab', 'drafts');
                  next.set('candidateId', candidateId);
                  next.set('jobId', jobId);
                  return next;
                })
              }
            />
          </Tabs.Panel>
          <Tabs.Panel value="drafts" keepMounted>
            <RecruitingDrafts
              key={`${params.get('candidateId')}:${params.get('jobId')}`}
              initialCandidateId={params.get('candidateId') ?? undefined}
              initialJobId={params.get('jobId') ?? undefined}
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
