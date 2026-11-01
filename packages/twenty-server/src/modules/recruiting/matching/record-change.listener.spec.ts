/** Ensures native changes schedule only relevant work and never manufacture a system principal. */
import { type RecruitingActorService } from '../auth/actor.service';
import { type RecruitingMatchingService } from './matching.service';
import { type RecruitingRecordsService } from '../records/records.service';
import { RecruitingRecordChangeListener } from './record-change.listener';

const candidate = {
  id: 'candidate',
  contactRoles: ['CANDIDATE'],
  recruitingProfile: { summary: '构建 TypeScript 后端' },
};

/** Builds event snapshots and permission-aware dependency spies without model or database calls. */
const setup = () => {
  const context = { workspace: { id: 'workspace' } };
  const actors = { resolve: jest.fn(async () => context) };
  const records = { all: jest.fn(async () => [{ id: 'job' }]) };
  const matching = { submitForRecord: jest.fn(async () => ({ runId: 'run' })) };
  const listener = new RecruitingRecordChangeListener(
    actors as unknown as RecruitingActorService,
    records as unknown as RecruitingRecordsService,
    matching as unknown as RecruitingMatchingService,
  );
  const event = (object: string, after: object, before?: object) =>
    ({
      workspaceId: 'workspace',
      name: `${object}.updated`,
      objectMetadata: { nameSingular: object },
      actor: { apiKeyId: 'key' },
      events: [
        {
          recordId: 'candidate',
          properties: { after, ...(before ? { before } : {}) },
        },
      ],
    }) as unknown as Parameters<RecruitingRecordChangeListener['changed']>[0];
  return { listener, actors, records, matching, event };
};

describe('recruiting record changes', () => {
  const prior = process.env.RECRUITING_AUTO_MATCH_ENABLED;
  beforeEach(() => {
    process.env.RECRUITING_AUTO_MATCH_ENABLED = 'true';
  });
  afterAll(() => {
    if (prior === undefined) delete process.env.RECRUITING_AUTO_MATCH_ENABLED;
    else process.env.RECRUITING_AUTO_MATCH_ENABLED = prior;
  });

  it('retains the API-key principal when scheduling an actual new candidate', async () => {
    const { listener, actors, matching, event } = setup();
    await listener.changed(event('person', candidate));
    expect(actors.resolve).toHaveBeenCalledWith({
      workspaceId: 'workspace',
      apiKeyId: 'key',
    });
    expect(matching.submitForRecord).toHaveBeenCalledWith(
      expect.anything(),
      'person',
      'candidate',
    );
  });

  it('ignores follow-up state and timestamp changes without occupational content changes', async () => {
    const { listener, actors, matching, event } = setup();
    await listener.changed(
      event(
        'person',
        { ...candidate, recruitingFollowUp: '已联系', updatedAt: 'later' },
        candidate,
      ),
    );
    expect(actors.resolve).not.toHaveBeenCalled();
    expect(matching.submitForRecord).not.toHaveBeenCalled();
  });

  it('refreshes recruiting jobs of a changed company through the same service', async () => {
    const { listener, records, matching, event } = setup();
    await listener.changed(
      event(
        'company',
        { id: 'company', recruitingDescription: '金融' },
        { id: 'company', recruitingDescription: '机器人' },
      ),
    );
    expect(records.all).toHaveBeenCalledWith(
      expect.anything(),
      'recruitmentJob',
      expect.objectContaining({ and: expect.any(Array) }),
    );
    expect(matching.submitForRecord).toHaveBeenCalledWith(
      expect.anything(),
      'recruitmentJob',
      'job',
    );
  });

  it('schedules a recruiting job when only its associated company changes', async () => {
    const { listener, matching, event } = setup();
    const job = {
      id: 'job',
      name: '后端工程师',
      jobStatus: 'RECRUITING',
      jobDescription: { markdown: '维护 TypeScript 服务' },
    };
    await listener.changed(
      event(
        'recruitmentJob',
        { ...job, companyId: 'new-company' },
        { ...job, companyId: 'old-company' },
      ),
    );
    expect(matching.submitForRecord).toHaveBeenCalledWith(
      expect.anything(),
      'recruitmentJob',
      'job',
    );
  });

  it('refreshes company jobs when preferences change through the native rich-text editor', async () => {
    const { listener, matching, event } = setup();
    const preferences = (text: string) => ({
      markdown: null,
      tiptap: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      }),
    });
    await listener.changed(
      event(
        'company',
        { id: 'company', recruitmentPreferences: preferences('优先后端经验') },
        { id: 'company', recruitmentPreferences: preferences('优先前端经验') },
      ),
    );
    expect(matching.submitForRecord).toHaveBeenCalledWith(
      expect.anything(),
      'recruitmentJob',
      'job',
    );
  });

  it('does not use system updates or empty profiles to launch paid work', async () => {
    const { listener, matching, event } = setup();
    const system = { ...event('person', candidate), actor: undefined };
    await listener.changed(system);
    await listener.changed(
      event('person', { id: 'empty', contactRoles: ['CANDIDATE'] }),
    );
    expect(matching.submitForRecord).not.toHaveBeenCalled();
  });

  it('isolates a queue failure from a record which has already committed', async () => {
    const { listener, matching, event } = setup();
    matching.submitForRecord.mockRejectedValue(new Error('queue unavailable'));
    await expect(
      listener.changed(event('person', candidate)),
    ).resolves.toBeUndefined();
  });
});
