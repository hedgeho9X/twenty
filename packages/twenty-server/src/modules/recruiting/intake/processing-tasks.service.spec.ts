/** Verifies one material task follows its matching children without losing its ingestion progress. */
import { ProcessingTasksService } from './processing-tasks.service';
const setup = (states: { status: string; complete: boolean }[]) => {
  const records = {
    list: jest.fn(async () => ({
      records: [{ id: 'task' }],
      count: 1,
      hasNextPage: false,
    })),
  };
  const intakes = {
    one: jest.fn(async () => ({
      intakeId: 'task',
      state: 'COMPLETED',
      stage: 'STORED',
      matchingRunIds: states.map((_, i) => `run-${i}`),
      items: [],
    })),
  };
  const matching = {
    one: jest.fn(async (_c, id: string) => ({
      ...states[Number(id.split('-')[1])],
      runId: id,
      counts: { processed: 2, total: 4 },
    })),
  };
  return {
    records,
    intakes,
    service: new ProcessingTasksService(
      records as never,
      intakes as never,
      matching as never,
    ),
  };
};
it.each([
  [[{ status: 'PROCESSING', complete: false }], 'MATCHING'],
  [[{ status: 'COMPLETED', complete: true }], 'COMPLETED'],
  [[{ status: 'NO_RESULTS', complete: true }], 'NO_RESULTS'],
  [[{ status: 'FAILED', complete: false }], 'MATCH_FAILED'],
  [[{ status: 'COMPLETED', complete: false }], 'MATCH_STALE'],
] as const)('projects child state %j as %s', async (states, stage) => {
  const { service } = setup([...states]);
  const result = await service.list({} as never);
  expect(result.records[0].stage).toBe(stage);
  expect(result.records[0].progress).toEqual({ processed: 2, total: 4 });
});
it('filters direction before paginating the material roots', async () => {
  const { service, records } = setup([]);
  await service.list({} as never, 50, 'JOB_TO_CANDIDATES');
  expect(records.list).toHaveBeenCalledWith(
    {},
    'recruitingIntake',
    expect.objectContaining({
      offset: 50,
      filter: {
        and: [{ name: { ilike: '[recruiting-v2]%' } }, { kind: { eq: 'JOB' } }],
      },
    }),
  );
});

it('labels stored material with disabled matching as a separate terminal state', async () => {
  const { service, intakes } = setup([]);
  intakes.one.mockResolvedValue({
    intakeId: 'task',
    state: 'COMPLETED',
    stage: 'STORED',
    matchingRunIds: [],
    items: [],
    matchingStatus: 'DISABLED',
  } as never);
  const result = await service.list({} as never);
  expect(result.records[0]).toMatchObject({
    stage: 'MATCH_DISABLED',
    state: 'COMPLETED',
  });
});
