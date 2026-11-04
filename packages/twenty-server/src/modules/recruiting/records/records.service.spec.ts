/** Verifies batched reads use the native authorization boundary and omit unavailable records. */
import { RecruitingRecordsService } from './records.service';

it('passes the current identity and bounded ID filter to permission-aware reads', async () => {
  const context = { workspace: { id: 'workspace' } };
  const find = {
    execute: jest.fn().mockResolvedValue({
      success: true,
      result: {
        records: [{ id: 'allowed', name: 'Visible' }],
        count: 1,
        hasNextPage: false,
      },
    }),
  };
  const service = new RecruitingRecordsService(
    find as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const records = await service.byIds(context as never, 'company', [
    'allowed',
    'hidden',
    'allowed',
  ]);
  expect(find.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      authContext: context,
      objectName: 'company',
      filter: { id: { in: ['allowed', 'hidden'] } },
      limit: 100,
    }),
  );
  expect([...records.keys()]).toEqual(['allowed']);
  await expect(service.byIds(context as never, 'company', [])).resolves.toEqual(
    new Map(),
  );
  expect(find.execute).toHaveBeenCalledTimes(1);
});
