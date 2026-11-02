import { ShareLinks } from '@/recruiting/shared/components/ShareLinks';
/** Hosts recruiting operations inside the native authenticated Twenty workspace. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Tabs } from 'twenty-ui/primitives/navigation';
import { IconBriefcase, IconClock } from 'twenty-ui/icon';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { RecruitingCandidateIntake } from '@/recruiting/intake/components/CandidateIntake';
import { RecruitingQueueDialog } from '@/recruiting/queue/components/QueueDialog';
import { RecruitingMatchResults } from '@/recruiting/matching/components/MatchResults';
import { RecruitingCompanyJobsList } from '@/recruiting/companies/components/CompanyJobsList';
import { RecruitingCompanyJobs } from '@/recruiting/companies/components/CompanyJobIntake';
import { RecruitingManualMatch } from '@/recruiting/matching/components/ManualMatch';
import { RecruitingMailSources } from '@/recruiting/mail/components/MailList';
import {
  StyledRecruitingBody,
  StyledRecruitingWorkspace,
} from '@/recruiting/shared/styles';

/** Uses normal pages for material editing and a short popup for queue progress. */
export const RecruitingWorkspacePage = () => {
  const [params, setParams] = useSearchParams();
  const [queueOpen, setQueueOpen] = useState(false);
  const [hasNewTasks, setHasNewTasks] = useState(false);
  const requestedTab = params.get('tab') ?? 'resumes';
  const tab = [
    'companies',
    'resumes',
    'matches',
    'mail',
    'manual',
    'shares',
  ].includes(requestedTab)
    ? requestedTab
    : 'resumes';
  const companyJobsId = params.get('companyJobs');
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
              <Tabs.Tab value="matches">{t`匹配结果`}</Tabs.Tab>
              <Tabs.Tab value="manual">{t`手动匹配`}</Tabs.Tab>
              <Tabs.Tab value="mail">{t`邮件列表`}</Tabs.Tab>
              <Tabs.Tab value="shares">分享链接</Tabs.Tab>
              <Tabs.Indicator />
            </Tabs.List>
          </div>
          <Tabs.Panel value="companies" keepMounted>
            <div hidden={Boolean(companyJobsId)}>
              <RecruitingCompanyJobs
                active={tab === 'companies' && !companyJobsId}
                onBrowseJobs={(companyId) =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set('companyJobs', companyId);
                    return next;
                  })
                }
                initialIntakeId={params.get('intakeId') ?? undefined}
                onOpenQueue={() => setQueueOpen(true)}
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
            </div>
            {companyJobsId && (
              <RecruitingCompanyJobsList
                key={companyJobsId}
                companyId={companyJobsId}
                onBack={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.delete('companyJobs');
                    return next;
                  })
                }
              />
            )}
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
            />
          </Tabs.Panel>
          <Tabs.Panel value="shares" keepMounted>
            <ShareLinks active={tab === 'shares'} />
          </Tabs.Panel>
          <Tabs.Panel value="manual" keepMounted>
            <RecruitingManualMatch active={tab === 'manual'} />
          </Tabs.Panel>
        </Tabs.Root>
      </StyledRecruitingBody>
      <RecruitingQueueDialog open={queueOpen} onOpenChange={setQueueOpen} />
    </StyledRecruitingWorkspace>
  );
};
