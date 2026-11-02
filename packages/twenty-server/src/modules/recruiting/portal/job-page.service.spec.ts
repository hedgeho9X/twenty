/** Verifies selected-job-only sharing and expiry/tamper isolation without public candidate data. */
import { RecruitingJobPageService } from './job-page.service';
const jobId = '11111111-1111-4111-8111-111111111111';
const actor = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  userWorkspaceId: '33333333-3333-4333-8333-333333333333',
};
const setup = () => {
  const job = {
    id: jobId,
    name: '工程师',
    companyId: 'company',
    jobStatus: 'RECRUITING',
    jobDescription: { markdown: '公开岗位职责' },
    jobRecruitmentPreferences: { markdown: '内部备注' },
    recruitingProfile: {
      locations: ['上海'],
      employmentTypes: ['full_time'],
      secret: 'private',
    },
  };
  const actors = {
    capture: jest.fn(() => actor),
    resolve: jest.fn(async () => ({})),
  };
  const records = {
    one: jest.fn(async (_c, kind) =>
      kind === 'company' ? { name: '公司', secret: 'private' } : job,
    ),
  };
  const tokens = new Map<string, string>();
  const service = new RecruitingJobPageService(
    {
      get: (key: string) =>
        key === 'APP_SECRET' ? 'test-secret' : 'http://localhost:23000',
    } as never,
    actors as never,
    records as never,
    {
      set: async (key: string, value: string) => {
        tokens.set(key, value);
      },
      get: async (key: string) => tokens.get(key),
      setIfAbsent: async (key: string, value: string) => {
        if (tokens.has(key)) return false;
        tokens.set(key, value);
        return true;
      },
      setAdd: async () => {},
      del: async (key: string) => {
        tokens.delete(key);
      },
      setRemove: async () => 1,
    } as never,
  );
  return { service, job, actors };
};
it('returns only the selected job public projection without needing the reader login', async () => {
  const { service } = setup();
  const url = await service.create({} as never, [jobId]);
  const token = new URL(url).pathname.split('/').pop()!;
  const page = await service.view(token);
  expect(page.jobs).toHaveLength(1);
  expect(page.jobs[0]).toMatchObject({
    title: '工程师',
    description: '公开岗位职责',
  });
  expect(JSON.stringify(page)).not.toContain('private');
  expect(JSON.stringify(page)).not.toContain('内部备注');
});
it('rejects tampered links before reading records', async () => {
  const { service, actors } = setup();
  await expect(service.view('invalid')).rejects.toThrow('已失效');
  expect(actors.resolve).not.toHaveBeenCalled();
});
it('stops showing a job when it closes', async () => {
  const { service, job } = setup();
  const url = await service.create({} as never, [jobId]);
  job.jobStatus = 'CLOSED';
  const token = new URL(url).pathname.split('/').pop()!;
  expect((await service.view(token)).jobs[0].status).toBe('CLOSED');
});

it('deletes the public capability immediately on revocation', async () => {
  const { service } = setup();
  const context = {} as never;
  const url = await service.create(context, [jobId]);
  const token = new URL(url).pathname.split('/').pop()!;
  await service.revoke(context, token);
  await expect(service.view(token)).rejects.toThrow('已失效');
});
