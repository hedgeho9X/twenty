/** Covers migration input fidelity, explicit rejection and content version boundaries. */
import {
  buildCandidateMatchContext,
  buildCompanyMatchContext,
  buildJobMatchContext,
  contentVersion,
  minimizeRecruitingText,
  recruitingText,
} from '../match-context';
import { evaluateRecruitingEligibility } from '../match-policy';

/** Mirrors the native editor's persisted document without depending on its React state. */
const nativeDocument = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: text
      ? text.split('\n').map((line) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: line }],
        }))
      : [],
  });

describe('native rich-text recruiting inputs', () => {
  it('keeps current editor company preferences and JD text in model context and content versions', () => {
    const company = { id: 'company', name: '合成公司' };
    const before = buildCompanyMatchContext(company);
    const after = buildCompanyMatchContext({
      ...company,
      recruitmentPreferences: {
        markdown: null,
        blocknote: null,
        tiptap: nativeDocument('TypeScript服务\n优先项目经验'),
      },
    });
    expect(after.preferences).toContain('TypeScript服务');
    expect(after.preferences).toContain('优先项目经验');
    expect(contentVersion(after)).not.toBe(contentVersion(before));
    const job = buildJobMatchContext({
      id: 'job',
      name: '后端工程师',
      jobStatus: 'RECRUITING',
      jobDescription: { tiptap: nativeDocument('维护PostgreSQL和队列') },
    });
    expect(job.context.description).toContain('维护PostgreSQL和队列');
    expect(job.issue).toBeUndefined();
  });

  it('does not resurrect stale markdown after the native editor clears the document', () => {
    expect(
      recruitingText({
        tiptap: nativeDocument(''),
        markdown: '已删除的旧要求',
      }),
    ).toBe('');
    const job = buildJobMatchContext({
      id: 'job',
      jobDescription: { tiptap: nativeDocument('') },
      jobRecruitmentPreferences: { markdown: '' },
      recruitingProfile: {
        description: '已清除的旧JD',
        preferences: '已清除的旧偏好',
      },
    });
    expect(job.context.description).toBe('');
    expect(job.context.preferences).toBe('');
    expect(job.issue).toContain('缺少 JD');
  });

  it('keeps profile fallback for legacy records without a populated native text field', () => {
    const job = buildJobMatchContext({
      id: 'job',
      jobDescription: { markdown: null, blocknote: null, tiptap: null },
      recruitingProfile: { description: '旧资料仍保留完整JD' },
    });
    expect(job.context.description).toBe('旧资料仍保留完整JD');
    expect(job.issue).toBeUndefined();
  });

  it('keeps legacy BlockNote facts instead of serializing editor identifiers', () => {
    const value = recruitingText({
      blocknote: JSON.stringify([
        {
          id: 'private-editor-id',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: '接受远程协作', styles: {} }],
          children: [],
        },
      ]),
    });
    expect(value).toBe('接受远程协作');
    expect(value).not.toContain('private-editor-id');
  });

  it('reads a legacy TipTap block array through the native converter', () => {
    expect(
      recruitingText({
        blocknote: JSON.stringify([
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Node.js服务' }],
          },
        ]),
      }),
    ).toBe('Node.js服务');
  });

  it('preserves existing plain and Markdown inputs and rejects malformed editor metadata', () => {
    expect(recruitingText('Linux\nPostgreSQL')).toBe('Linux\nPostgreSQL');
    expect(recruitingText({ markdown: 'Linux\nPostgreSQL' })).toBe(
      'Linux\nPostgreSQL',
    );
    expect(
      recruitingText({ tiptap: '{broken', markdown: '可读取的正文' }),
    ).toBe('可读取的正文');
    expect(recruitingText({ tiptap: '{"private":"metadata"}' })).toBe('');
  });

  it('redacts contacts and credential-bearing links after converting current rich text', () => {
    const context = buildCompanyMatchContext({
      id: 'company',
      recruitmentPreferences: {
        tiptap: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'TypeScript项目经验',
                  marks: [
                    {
                      type: 'link',
                      attrs: {
                        href: 'https://example.invalid/prefs?token=synthetic-secret',
                      },
                    },
                  ],
                },
                { type: 'text', text: ' 联系private@example.invalid' },
              ],
            },
          ],
        }),
      },
    });
    expect(context.preferences).toContain('TypeScript项目经验');
    expect(context.preferences).not.toContain('synthetic-secret');
    expect(context.preferences).not.toContain('private@example.invalid');
  });
});

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

  it('uses the current profile without mixing archived projects, unknowns or identity warnings', () => {
    const current = {
      id: 'person',
      recruitingProfile: {
        summary: '当前 TypeScript 后端工程师',
        sourceText: '当前项目：维护 Node.js 服务',
      },
    };
    const result = buildCandidateMatchContext({
      ...current,
      candidateSearchJson: {
        projects: [{ value: '已更正的旧项目' }],
        unknowns: ['旧学历待核对'],
        数据一致性提示: '旧原件身份冲突',
      },
    });
    expect(result.context.sourceText).toContain('当前项目');
    expect(result.context.projects).toEqual([]);
    expect(result.context.unknowns).toEqual([]);
    expect(result.issue).toBeUndefined();
    expect(result.version).toBe(buildCandidateMatchContext(current).version);

    const legacy = buildCandidateMatchContext({
      id: 'legacy',
      candidateSearchJson: {
        projects: [{ value: '旧版项目资料' }],
        unknowns: ['旧学历待核对'],
        数据一致性提示: '旧原件身份冲突',
      },
    });
    expect(legacy.context.projects).toEqual(['旧版项目资料']);
    expect(legacy.context.unknowns).toEqual(['旧学历待核对']);
    expect(legacy.issue).toContain('身份冲突');
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

it('retains new professional fields and complete original JD in matching context and version', () => {
  const job = {
    id: 'job',
    name: 'Engineer',
    jobStatus: 'RECRUITING',
    recruitingProfile: {
      description: 'Summary',
      originalText: 'Complete duties and requirements',
      salary: { min: 10, max: 20 },
      certifications: ['required'],
      sourceIntakeId: 'internal',
    },
  };
  const first = buildJobMatchContext(job);
  expect(first.context).toMatchObject({
    originalText: 'Complete duties and requirements',
    salary: { min: 10, max: 20 },
    certifications: ['required'],
  });
  expect(first.context).not.toHaveProperty('sourceIntakeId');
  const changed = buildJobMatchContext({
    ...job,
    recruitingProfile: {
      ...job.recruitingProfile,
      salary: { min: 20, max: 30 },
    },
  });
  expect(changed.version).not.toBe(first.version);
  const candidate = buildCandidateMatchContext({
    id: 'candidate',
    recruitingProfile: {
      summary: 'Engineer',
      portfolio: { achievements: ['delivered service'] },
    },
  });
  expect(candidate.context).toMatchObject({
    portfolio: { achievements: ['delivered service'] },
  });
});
it('uses source-backed employment requirements as a hard filter and keeps unknowns', () => {
  const person = buildCandidateMatchContext({
    id: 'candidate',
    recruitingProfile: {
      summary: 'Engineer',
      employmentTypes: ['full_time'],
      employmentEvidence: '接受全职',
      sourceText: '求职意向：接受全职',
    },
  });
  expect(person.eligibility.employmentTypes?.certainty).toBe('confirmed');
  expect(
    evaluateRecruitingEligibility(person.eligibility, {
      status: 'RECRUITING',
      employmentTypes: ['internship'],
    }).status,
  ).toBe('excluded');
  expect(
    evaluateRecruitingEligibility(person.eligibility, {
      status: 'RECRUITING',
      employmentTypes: [],
    }).status,
  ).not.toBe('excluded');
});
