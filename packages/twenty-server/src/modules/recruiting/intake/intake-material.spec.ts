/** Ensures original downloads require a readable parent, its native files field and an immutable input reference. */
import { NotFoundException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecruitingIntakeService } from './intake.service';

const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
const source = { fileId: 'source', label: 'resume.html' };
const actor = { workspaceId: 'workspace' };

/** Uses synthetic native projections so permission failures occur before any storage read. */
const setup = (files: unknown = [source], inputs: unknown = [source]) => {
  const records = {
    one: jest.fn(async () => ({
      id: 'intake',
      files,
      result: { schemaVersion: 2, input: { files: inputs } },
    })),
  };
  const parser = {
    original: jest.fn(async () => Buffer.from('untrusted html')),
  };
  const actors = { capture: jest.fn(() => actor) };
  const service = new RecruitingIntakeService(
    records as never,
    actors as never,
    parser as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { records, parser, service };
};

it('downloads exact archived bytes after the caller reads the owning intake and files field', async () => {
  const { records, parser, service } = setup();
  expect(await service.material(context, 'intake', 'source')).toEqual({
    label: 'resume.html',
    bytes: Buffer.from('untrusted html'),
  });
  expect(records.one).toHaveBeenCalledWith(
    context,
    'recruitingIntake',
    'intake',
  );
  expect(parser.original).toHaveBeenCalledWith(actor, 'source');
});

it.each([
  { files: undefined },
  { files: [] },
  { files: [{ fileId: 'foreign', label: 'other.pdf' }] },
])(
  'rejects a missing, hidden or unrelated native files field: %j',
  async ({ files }) => {
    const { records, parser, service } = setup(files);
    if (files === undefined)
      records.one.mockResolvedValueOnce({
        id: 'intake',
        files: undefined,
        result: { schemaVersion: 2, input: { files: [source] } },
      });
    await expect(service.material(context, 'intake', 'source')).rejects.toThrow(
      NotFoundException,
    );
    expect(parser.original).not.toHaveBeenCalled();
  },
);

it('rejects a native attachment absent from the original submitted manifest', async () => {
  const { parser, service } = setup([source], []);
  await expect(service.material(context, 'intake', 'source')).rejects.toThrow(
    NotFoundException,
  );
  expect(parser.original).not.toHaveBeenCalled();
});

it('preserves parent permission errors and never calls storage for an unreadable record', async () => {
  const { records, parser, service } = setup();
  records.one.mockRejectedValueOnce(new NotFoundException('hidden parent'));
  await expect(service.material(context, 'intake', 'source')).rejects.toThrow(
    'hidden parent',
  );
  expect(parser.original).not.toHaveBeenCalled();
});
