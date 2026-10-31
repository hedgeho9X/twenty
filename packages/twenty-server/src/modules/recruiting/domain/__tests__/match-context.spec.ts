/** Covers migration input fidelity, explicit rejection and content version boundaries. */
import {
  buildCandidateMatchContext,
  buildJobMatchContext,
  contentVersion,
  minimizeRecruitingText,
} from '../match-context';
import { evaluateRecruitingEligibility } from '../match-policy';

describe('recruiting match context', () => {
  it('excludes a paused company but retains unknown company states and invalidates only affected inputs', () => {
    const job = {
      id: 'job',
      name: '后端',
      jobStatus: 'RECRUITING',
      jobDescription: { markdown: 'TypeScript服务' },
    };
    const open = buildJobMatchContext(job, {
      id: 'company',
      name: '公司',
      recruitmentStatus: 'ACTIVE',
    });
    const unknown = buildJobMatchContext(job, {
      id: 'company',
      name: '公司',
      recruitmentStatus: 'UNKNOWN',
    });
    const paused = buildJobMatchContext(job, {
      id: 'company',
      name: '公司',
      recruitmentStatus: 'PAUSED',
    });
    expect(evaluateRecruitingEligibility({}, open.eligibility).status).toBe(
      'eligible',
    );
    expect(unknown.companyVersion).toBe(open.companyVersion);
    expect(evaluateRecruitingEligibility({}, paused.eligibility)).toMatchObject(
      {
        status: 'excluded',
        reasons: [expect.objectContaining({ code: 'company_not_recruiting' })],
      },
    );
    expect(paused.companyVersion).not.toBe(open.companyVersion);
  });
  it('preserves Linux, Angular, Helm, OpenAI and Go even when a name overlaps their characters', () => {
    const result = minimizeRecruitingText(
      'Name: Go\nSkills: Go, Linux, Angular, Helm, OpenAI\n姓名：Li | TypeScript 后端',
      ['Go', 'Li', 'An', 'He', 'AI'],
    );
    expect(result).toContain('Name: [候选人]');
    expect(result).toContain('姓名：[候选人] | TypeScript 后端');
    expect(result).toContain('Skills: Go, Linux, Angular, Helm, OpenAI');
    expect(
      buildCandidateMatchContext({
        id: 'p',
        name: { firstName: 'Li' },
        recruitingProfile: {
          summary: 'Linux 开发',
          skills: ['Linux', 'OpenAI'],
          experience: ['Go 与 Linux 服务'],
        },
      }).context.skills,
    ).toEqual(['Linux', 'OpenAI']);
  });
  it('preserves a complete technical line containing contact information', () => {
    const result = minimizeRecruitingText(
      '位情情：TypeScript 后端，mail@example.com，13812345678',
      ['位情情'],
    );
    expect(result).toContain('TypeScript 后端');
    expect(result).not.toContain('mail@example.com');
    expect(result).not.toContain('13812345678');
  });

  it('removes signed download URLs without discarding adjacent career evidence', () => {
    const result = minimizeRecruitingText(
      'TypeScript 后端 https://files.example.com/cv?private_token=secret ，维护队列',
    );
    expect(result).toContain('TypeScript 后端');
    expect(result).toContain('维护队列');
    expect(result).not.toContain('private_token');
    expect(result).not.toContain('secret');
  });

  it('distinguishes occupational self-introductions from download-only mail boilerplate', () => {
    const note =
      '历史投递自述：\n我有四年客户成功经验，负责 SaaS 平台客户的培训、文档、续约和问题闭环。'.repeat(
        3,
      );
    expect(
      buildCandidateMatchContext({
        id: 'p',
        candidatePreferences: { markdown: note },
      }),
    ).toMatchObject({ supplementOnly: true, issue: undefined });
    expect(
      buildCandidateMatchContext({
        id: 'p',
        candidatePreferences: {
          markdown: `历史投递自述：从QQ邮箱发来的超大附件，进入下载页面 https://files.example.com/cv?key=${'secret'.repeat(50)}`,
        },
      }).issue,
    ).toContain('缺少');
  });

  it('flattens legacy occupational facts and quotes without reintroducing identity fields', () => {
    const result = buildCandidateMatchContext({
      id: 'person',
      name: { firstName: '测试同学' },
      emails: { primaryEmail: 'private@example.com' },
      candidateSearchJson: {
        skills: [
          {
            value: 'TypeScript',
            evidence: [{ quote: '维护 NestJS 服务', source: 'resume' }],
          },
        ],
        experience: [{ value: '构建队列' }],
        preferences: { roles: { value: 'Backend' } },
      },
    });
    expect(result.context.skills).toEqual(['TypeScript', '维护 NestJS 服务']);
    expect(result.context.expectedRoles).toEqual(['Backend']);
    expect(JSON.stringify(result.context)).not.toContain('private@example.com');
    expect(result.issue).toBeUndefined();
  });

  it('rejects internship-only jobs for explicit refusal without rejecting part-time work', () => {
    const candidate = buildCandidateMatchContext({
      id: 'p',
      candidatePreferences: { markdown: '目前不接受实习' },
      recruitingProfile: { summary: 'Node.js 工程师' },
    });
    expect(
      evaluateRecruitingEligibility(candidate.eligibility, {
        status: 'RECRUITING',
        employmentTypes: ['internship'],
      }).status,
    ).toBe('excluded');
    expect(
      evaluateRecruitingEligibility(candidate.eligibility, {
        status: 'RECRUITING',
        employmentTypes: ['part_time'],
      }).status,
    ).toBe('eligible');
    expect(
      evaluateRecruitingEligibility(candidate.eligibility, {
        status: 'RECRUITING',
        employmentTypes: ['internship', 'full_time'],
      }).status,
    ).toBe('eligible');
  });

  it('keeps old derived employment preferences unconfirmed without a current explicit statement', () => {
    const candidate = buildCandidateMatchContext({
      id: 'p',
      candidateEmploymentType: ['FULL_TIME'],
      candidateSearchJson: { experience: [{ value: '资深后端' }] },
    });
    expect(
      evaluateRecruitingEligibility(candidate.eligibility, {
        status: 'RECRUITING',
        employmentTypes: ['internship'],
      }).status,
    ).toBe('needs_confirmation');
  });

  it('does not turn negated or historical statements into current hard filters', () => {
    for (const note of [
      '不只考虑全职',
      '以前不接受实习，现在可以',
      '并非不接受实习',
    ]) {
      const candidate = buildCandidateMatchContext({
        id: 'p',
        candidatePreferences: { markdown: note },
        recruitingProfile: { summary: '工程师' },
      });
      expect(
        evaluateRecruitingEligibility(candidate.eligibility, {
          status: 'RECRUITING',
          employmentTypes: ['internship'],
        }).status,
      ).toBe('eligible');
    }
  });

  it('rejects conflicting identity sources even with nonempty career evidence', () => {
    expect(
      buildCandidateMatchContext({
        id: 'p',
        recruitingProfile: { summary: '工程师', identityConflict: true },
      }).issue,
    ).toContain('身份冲突');
    expect(
      buildCandidateMatchContext({ id: 'p', jobTitle: '工程师' }).issue,
    ).toContain('缺少');
  });

  it('uses the current native preference instead of enforcing an archived submission note forever', () => {
    for (const note of ['', '现在可以接受实习']) {
      const candidate = buildCandidateMatchContext({
        id: 'p',
        candidatePreferences: { markdown: note },
        recruitingProfile: { summary: '工程师', note: '不接受实习' },
      });
      expect(
        evaluateRecruitingEligibility(candidate.eligibility, {
          status: 'RECRUITING',
          employmentTypes: ['internship'],
        }).status,
      ).toBe('eligible');
    }
  });

  it('invalidates company context independently from human follow-up and contact fields', () => {
    const record = {
      id: 'j',
      name: '后端',
      jobDescription: { markdown: '维护 Node.js' },
      jobStatus: 'RECRUITING',
    };
    const first = buildJobMatchContext(record, {
      id: 'c',
      name: '公司',
      recruitingDescription: '机器人',
    });
    const second = buildJobMatchContext(
      { ...record, updatedAt: 'new', recruitingFollowUp: '已联系' },
      { id: 'c', name: '公司', recruitingDescription: '机器人' },
    );
    const changed = buildJobMatchContext(record, {
      id: 'c',
      name: '公司',
      recruitingDescription: '金融',
    });
    expect(first.version).toBe(second.version);
    expect(first.companyVersion).toBe(second.companyVersion);
    expect(first.companyVersion).not.toBe(changed.companyVersion);
    expect(contentVersion({ a: 1, b: 2 })).toBe(contentVersion({ b: 2, a: 1 }));
  });
});
