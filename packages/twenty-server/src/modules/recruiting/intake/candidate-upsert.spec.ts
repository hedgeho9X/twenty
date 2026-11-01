/** Verifies email-based reuse, explicit targets and concurrent duplicate submissions without a second person. */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RecruitingIntakeService } from './intake.service';

const input = {
  proposedId: 'new-id',
  email: 'candidate@example.test',
  profile: { name: 'Candidate' },
  files: [{ fileId: 'resume', label: 'resume.pdf' }],
  createData: { name: { firstName: 'Candidate', lastName: '' } },
};
/** Exercises the persistence boundary without parser, model or file-copy side effects. */
const setup = () => {
  const records = {
    list: jest.fn().mockResolvedValue({ records: [] }),
    create: jest.fn().mockResolvedValue({ id: 'new-id' }),
  };
  const candidates = { replaceProfile: jest.fn().mockResolvedValue(undefined) };
  const service = new RecruitingIntakeService(
    records as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    candidates as never,
    {} as never,
  );
  return {
    records,
    candidates,
    save: (value = input) => service['storeCandidate']({} as never, value),
  };
};
it('updates an exact-email candidate without creating another person', async () => {
  const { records, candidates, save } = setup();
  records.list.mockResolvedValue({ records: [{ id: 'existing' }] });
  expect(await save()).toBe('existing');
  expect(candidates.replaceProfile).toHaveBeenCalledWith(
    {},
    'existing',
    input.profile,
    input.files,
  );
  expect(records.create).not.toHaveBeenCalled();
});
it('creates a person only when no candidate exists', async () => {
  const { records, candidates, save } = setup();
  candidates.replaceProfile.mockRejectedValueOnce(new NotFoundException());
  expect(await save()).toBe('new-id');
  expect(records.create).toHaveBeenCalledTimes(1);
});
it('reuses the winner when another submission creates the email concurrently', async () => {
  const { records, candidates, save } = setup();
  records.list
    .mockResolvedValueOnce({ records: [] })
    .mockResolvedValueOnce({ records: [{ id: 'winner' }] });
  candidates.replaceProfile.mockRejectedValueOnce(new NotFoundException());
  records.create.mockRejectedValueOnce(new Error('unique email'));
  expect(await save()).toBe('winner');
  expect(candidates.replaceProfile).toHaveBeenLastCalledWith(
    {},
    'winner',
    input.profile,
    input.files,
  );
});
it('does not fall through to creation on update permission failures', async () => {
  const { records, candidates, save } = setup();
  records.list.mockResolvedValue({ records: [{ id: 'existing' }] });
  candidates.replaceProfile.mockRejectedValue(new ForbiddenException());
  await expect(save()).rejects.toThrow(ForbiddenException);
  expect(records.create).not.toHaveBeenCalled();
});
it('retains explicitly selected candidate identity without rematching its email', async () => {
  const { records, save } = setup();
  expect(await save({ ...input, explicitId: 'selected' } as typeof input)).toBe(
    'selected',
  );
  expect(records.list).not.toHaveBeenCalled();
});
