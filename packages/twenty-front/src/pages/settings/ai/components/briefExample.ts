/** Synthetic complete-enough data for testing writing templates, never production candidate information. */
export const BRIEF_EXAMPLE = {
  direction: 'CANDIDATE_TO_JOBS',
  candidates: [
    {
      key: 'candidate-1',
      profile: {
        name: '示例候选人',
        summary: '4年后端开发经验，负责过AI材料处理平台',
        skills: ['TypeScript', 'Go', 'PostgreSQL'],
        experience: ['2022—2026：负责异步任务、接口设计和文档解析服务'],
        education: ['计算机本科'],
        expectedRoles: ['后端工程师', 'AI应用工程师'],
        employmentTypes: ['full_time'],
        workModes: ['hybrid', 'remote'],
        locations: ['上海'],
        employmentEvidence: '仅考虑全职',
        workModeEvidence: '接受混合与远程',
        locationEvidence: '优先上海',
      },
    },
  ],
  companies: [
    {
      key: 'company-1',
      profile: {
        name: '示例科技',
        description: '为企业提供文档自动化产品，研发团队20人。',
      },
    },
  ],
  jobs: [
    {
      key: 'job-1',
      companyKey: 'company-1',
      profile: {
        name: 'AI后端工程师',
        description:
          '负责文档处理服务、异步队列及模型API集成。要求3年以上后端经验，熟悉TypeScript或Go和PostgreSQL。',
        employmentTypes: ['full_time'],
        workModes: ['hybrid'],
        locations: ['上海'],
      },
    },
  ],
  recommendations: [{ rank: 1, candidateKey: 'candidate-1', jobKey: 'job-1' }],
  jobPageUrl: 'https://example.com/s/demo',
};
