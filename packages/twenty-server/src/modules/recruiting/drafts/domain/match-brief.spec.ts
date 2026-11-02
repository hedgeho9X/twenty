/** Verifies deduplicated writing context preserves facts and selected order in both matching directions. */
import { buildMatchBrief, MATCH_BRIEF_INSTRUCTIONS } from './match-brief';

import { type MatchSource } from '../../matching/domain/match-context';
const fixtures: Record<string, MatchSource> = {
  person1: {
    id: 'person1',
    name: { firstName: '候选人甲' },
    recruitingProfile: { summary: '后端经验', skills: ['TypeScript'] },
  },
  person2: {
    id: 'person2',
    name: { firstName: '候选人乙' },
    recruitingProfile: { summary: '前端经验', skills: ['React'] },
  },
  job1: {
    id: 'job1',
    name: '后端工程师',
    companyId: 'company',
    jobStatus: 'RECRUITING',
    jobDescription: { markdown: '完整职责和要求' },
    recruitingProfile: { employmentTypes: ['full_time'] },
  },
  job2: {
    id: 'job2',
    name: '前端工程师',
    companyId: 'company',
    jobStatus: 'RECRUITING',
    jobDescription: { markdown: '前端完整要求' },
  },
  company: {
    id: 'company',
    name: '示例公司',
    recruitingDescription: '公司业务介绍',
  },
};
it('sends one candidate and company for multiple selected jobs', async () => {
  const read = jest.fn(async (_kind, id) => fixtures[id]);
  const result = await buildMatchBrief(
    'CANDIDATE_TO_JOBS',
    [
      { candidateId: 'person1', jobId: 'job2' },
      { candidateId: 'person1', jobId: 'job1' },
    ],
    read,
  );
  expect(result.context.candidates).toHaveLength(1);
  expect(result.context.companies).toHaveLength(1);
  expect(result.jobIds).toEqual(['job2', 'job1']);
  expect(read).toHaveBeenCalledTimes(4);
  expect(result.context.recommendations.map((x) => x.rank)).toEqual([1, 2]);
  expect(JSON.stringify(result.context)).toContain('完整职责和要求');
  expect(JSON.stringify(result.context)).not.toContain('score');
});
it('sends one job for multiple candidates and changes version with source facts', async () => {
  const result = await buildMatchBrief(
    'JOB_TO_CANDIDATES',
    [
      { candidateId: 'person1', jobId: 'job1' },
      { candidateId: 'person2', jobId: 'job1' },
    ],
    async (_kind, id) => fixtures[id],
  );
  expect(result.context.candidates).toHaveLength(2);
  expect(result.context.jobs).toHaveLength(1);
  const revised = await buildMatchBrief(
    'JOB_TO_CANDIDATES',
    [
      { candidateId: 'person1', jobId: 'job1' },
      { candidateId: 'person2', jobId: 'job1' },
    ],
    async (_kind, id) =>
      id === 'job1'
        ? { ...fixtures[id], jobDescription: '修改后的职责' }
        : fixtures[id],
  );
  expect(revised.version).not.toBe(result.version);
});
it('specifies sender, evidence constraints and canonical link output', () => {
  expect(MATCH_BRIEF_INSTRUCTIONS).toContain('你是招聘顾问');
  expect(MATCH_BRIEF_INSTRUCTIONS).toContain('原样附上 jobPageUrl');
  expect(MATCH_BRIEF_INSTRUCTIONS).toContain('不输出评分');
  expect(MATCH_BRIEF_INSTRUCTIONS).toContain('不新增或替换岗位');
});
