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
  const readOne = jest.fn(async (_c, kind, _id?: string) =>
    kind === 'company' ? { name: '公司', secret: 'private' } : job,
  );
  const records = {
    one: readOne,
    list: jest.fn(
      async (
        context,
        kind,
        options: { filter: { id: { in: string[] } }; select: string[] },
      ) => ({
        records: await Promise.all(
          options.filter.id.in.map(async (id) => {
            const source = {
              ...(await readOne(context, kind, id)),
              id,
            } as Record<string, unknown>;
            return Object.fromEntries(
              options.select.map((key) => [key, source[key]]),
            );
          }),
        ),
      }),
    ),
  };
  const tokens = new Map<string, string>();
  const links = {
    set: async (key: string, value: string) => {
      tokens.set(key, value);
    },
    get: async (key: string) => tokens.get(key),
    setIfAbsent: async (key: string, value: string) => {
      if (tokens.has(key)) return false;
      tokens.set(key, value);
      return true;
    },
    setAdd: jest.fn(async () => {}),
    setMembers: jest.fn(async () =>
      [...tokens.keys()]
        .filter((key) => key.startsWith('recruiting-share-meta:'))
        .map((key) => key.split(':').pop()),
    ),
    del: async (key: string) => {
      tokens.delete(key);
    },
    setRemove: jest.fn(async () => 1),
  };
  const files = {
    list: jest.fn(async () => ({
      files: [{ fileId: 'resume', label: 'resume.pdf' }],
    })),
    download: jest.fn(async () => ({ label: 'resume.pdf', stream: {} })),
  };
  const matching = { selection: jest.fn(async () => ({})) };
  const service = new RecruitingJobPageService(
    {
      get: (key: string) =>
        key === 'APP_SECRET' ? 'test-secret' : 'http://localhost:23000',
    } as never,
    actors as never,
    records as never,
    links as never,
    files as never,
    matching as never,
  );
  return { service, job, actors, records, links, tokens, files, matching };
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

it('expires share indexes and prunes expired members while keeping live shares', async () => {
  const { service, links, tokens } = setup();
  const context = {} as never;
  const expiredUrl = await service.create(context, [jobId]);
  const liveUrl = await service.create(context, [jobId]);
  const expiredKey = new URL(expiredUrl).pathname.split('/').pop()!;
  const liveKey = new URL(liveUrl).pathname.split('/').pop()!;
  const indexKey = `recruiting-share-index:${actor.workspaceId}`;

  // Redis expires the metadata, but SADD does not expire individual set members.
  tokens.delete(`recruiting-share-meta:${expiredKey}`);
  tokens.delete(`recruiting-job-page:${expiredKey}`);
  links.setMembers.mockResolvedValue([expiredKey, liveKey]);

  expect(await service.list(context)).toEqual([
    expect.objectContaining({ key: liveKey, url: liveUrl }),
  ]);
  expect(links.setRemove).toHaveBeenCalledWith(indexKey, [expiredKey]);
  expect(links.setAdd).toHaveBeenNthCalledWith(
    1,
    indexKey,
    [expiredKey],
    7 * 24 * 60 * 60 * 1000,
  );
  expect(links.setAdd).toHaveBeenNthCalledWith(
    2,
    indexKey,
    [liveKey],
    7 * 24 * 60 * 60 * 1000,
  );
  expect((await service.view(liveKey)).jobs).toHaveLength(1);
});

it('rebases active draft links without reviving revoked or foreign shares', async () => {
  const { service, actors } = setup();
  const context = {} as never;
  const url = await service.create(context, [jobId]);
  const savedUrl = url.replace('http://localhost:23000', 'https://old.example');

  expect(await service.activeDraftUrl(context, savedUrl)).toBe(url);
  actors.capture.mockReturnValueOnce({
    ...actor,
    workspaceId: '66666666-6666-4666-8666-666666666666',
  });
  expect(await service.activeDraftUrl(context, savedUrl)).toBeUndefined();

  await service.revoke(context, new URL(url).pathname.split('/').pop()!);
  expect(await service.activeDraftUrl(context, savedUrl)).toBeUndefined();
});

const candidateId = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
it('links the authenticated list to the matching subject without sharing that candidate publicly', async () => {
  const { service, records, job } = setup();
  records.one.mockImplementation(async (_context, kind) => {
    if (kind === 'recruitingMatchRun')
      return {
        payload: {
          input: { direction: 'CANDIDATE_TO_JOBS', subjectId: candidateId },
          results: [{ jobId, candidateId }],
        },
      } as never;
    if (kind === 'person')
      return { name: { firstName: '测试', lastName: '候选人' } } as never;
    return job as never;
  });
  const url = await service.create({} as never, [jobId], [], runId);
  const rows = await service.list({} as never);
  expect(rows[0]).toMatchObject({
    subjectLabel: '测试 候选人',
    matchRunId: runId,
  });
  expect(
    (await service.view(new URL(url).pathname.split('/').pop()!)).candidates,
  ).toEqual([]);
});
it('rejects a source match that does not contain the requested share', async () => {
  const { service, records, job } = setup();
  records.one.mockImplementation(async (_context, kind) =>
    kind === 'recruitingMatchRun'
      ? ({
          payload: {
            input: { direction: 'CANDIDATE_TO_JOBS', subjectId: candidateId },
            results: [],
          },
        } as never)
      : (job as never),
  );
  await expect(service.create({} as never, [jobId], [], runId)).rejects.toThrow(
    '不属于',
  );
});
it('keeps older shares readable without inventing a source match', async () => {
  const { service } = setup();
  await service.create({} as never, [jobId]);
  expect((await service.list({} as never))[0]).toMatchObject({
    subjectLabel: '工程师',
    matchRunId: undefined,
  });
});

/** Multiple operators collaborate through one workspace without crossing tenant boundaries. */
it('lets another workspace operator list and revoke a share', async () => {
  const { service, actors } = setup();
  const url = await service.create({} as never, [jobId]);
  actors.capture.mockReturnValue({
    ...actor,
    userWorkspaceId: '66666666-6666-4666-8666-666666666666',
  });
  expect(await service.list({} as never)).toHaveLength(1);
  await service.revoke({} as never, new URL(url).pathname.split('/').pop()!);
  expect(await service.list({} as never)).toHaveLength(0);
});
it('never grants another workspace access to shared links', async () => {
  const { service, actors } = setup();
  const url = await service.create({} as never, [jobId]);
  actors.capture.mockReturnValue({
    ...actor,
    workspaceId: '77777777-7777-4777-8777-777777777777',
  });
  expect(await service.list({} as never)).toHaveLength(0);
  await expect(
    service.revoke({} as never, new URL(url).pathname.split('/').pop()!),
  ).rejects.toThrow('无权');
});

it('checks share membership and revocation before downloading candidate attachments', async () => {
  const { service, records, files } = setup();
  const candidateId = '44444444-4444-4444-8444-444444444444';
  records.one.mockImplementation(async (_context, kind) =>
    kind === 'person'
      ? ({
          id: candidateId,
          name: 'Candidate',
          contactRoles: ['CANDIDATE'],
        } as never)
      : ({ id: jobId, name: 'Job' } as never),
  );
  const url = await service.create({} as never, [], [candidateId]);
  const token = new URL(url).pathname.split('/').pop()!;
  await service.download(token, candidateId, 'resume');
  expect(files.download).toHaveBeenCalledTimes(1);
  await expect(service.download(token, jobId, 'resume')).rejects.toThrow(
    '不包含',
  );
  expect(files.download).toHaveBeenCalledTimes(1);
  await service.revoke({} as never, token);
  await expect(service.download(token, candidateId, 'resume')).rejects.toThrow(
    '已失效',
  );
  expect(files.download).toHaveBeenCalledTimes(1);
});

it('omits and refuses PDFs when sharing is disabled', async () => {
  const { service, records, files } = setup();
  records.one.mockImplementation(async (_context, kind) =>
    kind === 'person'
      ? ({
          id: candidateId,
          name: 'Candidate',
          contactRoles: ['CANDIDATE'],
        } as never)
      : ({ id: jobId, name: 'Job' } as never),
  );
  const url = await service.create(
    {} as never,
    [],
    [candidateId],
    undefined,
    false,
  );
  const token = new URL(url).pathname.split('/').pop()!;
  expect((await service.view(token)).candidates[0].files).toEqual([]);
  await expect(
    service.download(token, candidateId, 'resume'),
  ).rejects.toThrow();
  expect(files.download).not.toHaveBeenCalled();
});
it('freezes the file scope when the share is created', async () => {
  const { service, records, files } = setup();
  records.one.mockImplementation(async (_context, kind) =>
    kind === 'person'
      ? ({
          id: candidateId,
          name: 'Candidate',
          contactRoles: ['CANDIDATE'],
        } as never)
      : ({ id: jobId, name: 'Job' } as never),
  );
  const url = await service.create({} as never, [], [candidateId]);
  const token = new URL(url).pathname.split('/').pop()!;
  files.list.mockResolvedValue({
    files: [
      { fileId: 'resume', label: 'resume.pdf' },
      { fileId: 'private-new', label: 'new.pdf' },
    ],
  });
  expect((await service.view(token)).candidates[0].files).toHaveLength(1);
  await expect(
    service.download(token, candidateId, 'private-new'),
  ).rejects.toThrow();
});

it('paginates a large share index using bounded identity queries without loading resume bodies', async () => {
  const { service, records, tokens, files } = setup();
  for (let i = 0; i < 500; i++)
    tokens.set(`recruiting-share-meta:share-${i}`, {
      key: `share-${i}`,
      owner: actor.workspaceId,
      jobIds: [`job-${i}`],
      candidateIds: [],
      createdAt: new Date(1_700_000_000_000 + i).toISOString(),
    } as never);
  records.list.mockImplementation(async (_context, kind, options) => ({
    records: options.filter.id.in.map((id) => ({
      id,
      name: kind === 'company' ? '检索公司' : id,
      ...(kind === 'recruitmentJob'
        ? { companyId: 'company', jobStatus: 'RECRUITING' }
        : {}),
    })),
  }));
  const page = await service.listPage({} as never, '', 200, 20);
  expect(page).toMatchObject({ count: 500, hasNextPage: true });
  expect(page.records).toHaveLength(20);
  expect(page.records[0].key).toBe('share-299');
  expect(records.one).not.toHaveBeenCalled();
  expect(files.list).not.toHaveBeenCalled();
  expect(records.list).toHaveBeenCalledTimes(6);
  for (const [, , options] of records.list.mock.calls) {
    expect(options.filter.id.in.length).toBeLessThanOrEqual(100);
    expect(options.select).not.toContain('recruitingProfile');
    expect(options.select).not.toContain('jobDescription');
  }
  expect((await service.list({} as never)).length).toBe(50);
  expect(
    (await service.listPage({} as never, '检索公司', 495, 100)).records,
  ).toHaveLength(5);
});

it('excludes shares whose subject records are no longer readable', async () => {
  const { service, records, tokens } = setup();
  tokens.set('recruiting-share-meta:restricted', {
    key: 'restricted',
    owner: actor.workspaceId,
    jobIds: ['inaccessible'],
    candidateIds: [],
    createdAt: new Date().toISOString(),
  } as never);
  records.list.mockResolvedValue({ records: [] });
  expect(await service.listPage({} as never, '', 0, 20)).toEqual({
    records: [],
    count: 0,
    hasNextPage: false,
  });
});
