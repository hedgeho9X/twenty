/** Verifies administrator-only, bounded and persistent queue admission settings. */
import { RecruitingQueueSettingsController } from './queue-settings.controller';
const setup = () => {
  const values: Record<string, unknown> = { MESSAGE_QUEUE_CONCURRENCY: {} };
  const config = {
    get: jest.fn((key) => values[key]),
    set: jest.fn(async (key, value) => {
      values[key] = value;
    }),
  };
  const parsing = { setGlobalConcurrency: jest.fn(async () => undefined) };
  const matching = { setGlobalConcurrency: jest.fn(async () => undefined) };
  const controller = new RecruitingQueueSettingsController(
    config as never,
    parsing as never,
    matching as never,
  );
  return { controller, config, parsing, matching };
};
const admin = { user: { canAccessFullAdminPanel: true } };
it('persists and applies both limits', async () => {
  const { controller, parsing, matching } = setup();
  expect(
    await controller.set(admin as never, { parsing: 8, matching: 3 }),
  ).toEqual({ parsing: 8, matching: 3 });
  expect(parsing.setGlobalConcurrency).toHaveBeenCalledWith(8);
  expect(matching.setGlobalConcurrency).toHaveBeenCalledWith(3);
});
it.each([
  { parsing: 0, matching: 2 },
  { parsing: 21, matching: 2 },
  { parsing: 10, matching: 11 },
])('rejects invalid limits', async (value) => {
  const { controller, config } = setup();
  await expect(controller.set(admin as never, value)).rejects.toThrow();
  expect(config.set).not.toHaveBeenCalled();
});
it('rejects a non-admin', async () => {
  const { controller } = setup();
  await expect(
    controller.set({ user: {} } as never, { parsing: 5, matching: 2 }),
  ).rejects.toThrow();
});
