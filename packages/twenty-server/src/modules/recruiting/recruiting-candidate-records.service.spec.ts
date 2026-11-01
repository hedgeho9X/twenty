/** Verifies concurrent material merging and exact native revisions without modifying any recruiting data. */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { RecruitingCandidateRecordsService } from './recruiting-candidate-records.service';

const context = {
  type: 'user',
  workspace: { id: 'workspace' },
} as WorkspaceAuthContext;
/** Gives the native-like fluent mock an explicit recursive return type. */
type CandidateQuery = {
  version: string;
  select: () => CandidateQuery;
  where: () => CandidateQuery;
  andWhere: (
    sql: string,
    parameters: { expectedVersion: string },
  ) => CandidateQuery;
  getRawAndEntities: () => Promise<{
    entities: Record<string, unknown>[];
    raw: { person_updatedAt: string }[];
  }>;
};
/** Models atomic PostgreSQL updates; a read barrier forces two writers to observe the same initial revision. */
const setup = (concurrent = false) => {
  let candidate = {
    id: 'candidate',
    contactRoles: ['CANDIDATE'],
    candidateResumes: [
      { fileId: 'original', label: 'Original', url: 'read-only-url' },
    ],
  } as Record<string, unknown>;
  let revision = '2026-11-01 00:00:00.123456+00';
  let reads = 0,
    release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mutation = jest.fn(async ({ selectQueryBuilder, data }) => {
    if (selectQueryBuilder.version !== revision) return [];
    candidate = { ...candidate, ...structuredClone(data) };
    revision += '-next';
    return [{ id: candidate.id }];
  });
  const repository = {
    createQueryBuilder: () => {
      const query: CandidateQuery = {
        version: '',
        select: jest.fn(() => query),
        where: jest.fn(() => query),
        andWhere: jest.fn((_sql, params) => {
          query.version = params.expectedVersion;
          return query;
        }),
        getRawAndEntities: async () => {
          const snapshot = structuredClone(candidate),
            version = revision;
          if (concurrent && reads < 2) {
            if (++reads === 2) release();
            await barrier;
          }
          return { entities: [snapshot], raw: [{ person_updatedAt: version }] };
        },
      };
      return query;
    },
    runMutation: mutation,
  };
  const orm = {
    getRepositoryWithContextPermissions: jest.fn(() => repository),
    executeInWorkspaceContext: jest.fn(async (callback) => callback()),
  };
  return {
    service: new RecruitingCandidateRecordsService(
      orm as unknown as WorkspaceOrmManager,
    ),
    mutation,
    orm,
    row: () => candidate,
    set: (value: Record<string, unknown>) => {
      candidate = { ...candidate, ...value };
    },
  };
};

it('retries a conflicting revision and retains both new attachments and the original reference', async () => {
  const { service, row, mutation, orm } = setup(true);
  await Promise.all([
    service.replaceProfile(
      context,
      'candidate',
      { summary: 'first complete material' },
      [{ fileId: 'first', label: 'First' }],
    ),
    service.replaceProfile(
      context,
      'candidate',
      { summary: 'second complete material' },
      [{ fileId: 'second', label: 'Second' }],
    ),
  ]);
  expect(
    (row().candidateResumes as { fileId: string }[])
      .map((file) => file.fileId)
      .sort(),
  ).toEqual(['first', 'original', 'second']);
  expect(row().candidateResumes).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ url: expect.anything() }),
    ]),
  );
  expect(mutation).toHaveBeenCalledTimes(3);
  expect(mutation.mock.calls[0][0].selectQueryBuilder.version).toBe(
    '2026-11-01 00:00:00.123456+00',
  );
  expect(orm.getRepositoryWithContextPermissions).toHaveBeenCalledWith(
    'person',
  );
  expect(orm.executeInWorkspaceContext).toHaveBeenCalledWith(
    expect.any(Function),
    context,
  );
});

it('refuses a removed candidate role before mutating the native contact', async () => {
  const { service, set, mutation } = setup();
  set({ contactRoles: ['CLIENT'] });
  await expect(
    service.replaceProfile(context, 'candidate', {}, []),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(mutation).not.toHaveBeenCalled();
});

it('does not silently discard malformed historical attachment references', async () => {
  const { service, set, mutation } = setup();
  set({ candidateResumes: [{ fileId: 'original' }] });
  await expect(
    service.replaceProfile(context, 'candidate', {}, [
      { fileId: 'new', label: 'New' },
    ]),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(mutation).not.toHaveBeenCalled();
});

it('bounds conflicts and preserves material references when a record keeps changing', async () => {
  const { service, mutation, row } = setup();
  mutation.mockImplementation(async () => []);
  await expect(
    service.replaceProfile(context, 'candidate', {}, []),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(mutation).toHaveBeenCalledTimes(5);
  expect(row().candidateResumes).toEqual([
    expect.objectContaining({ fileId: 'original' }),
  ]);
});
