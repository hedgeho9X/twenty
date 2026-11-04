/** Exercises the search boundary and native permissions/query construction without database access. */
import {
  BadRequestException,
  ForbiddenException,
  RequestMethod,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { FieldMetadataType, OrderByDirection } from 'twenty-shared/types';

import { CommonApiContextBuilderService } from 'src/engine/core-modules/record-crud/services/common-api-context-builder.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { CommonFindManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-many-query-runner.service';
import {
  type CommonInput,
  type FindManyQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { GraphqlQueryParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query.parser';
import { GraphqlQueryFilterConditionParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query-filter/graphql-query-filter-condition.parser';
import {
  decodeCursor,
  encodeCursorData,
} from 'src/engine/api/graphql/graphql-query-runner/utils/cursors.util';
import { WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/query-builder/workspace-select-query-builder';
import {
  applyRowAccessCondition,
  buildQueryBuilder,
} from 'src/engine/twenty-orm/query-builder/__tests__/workspace-select-query-builder-test-shapes.util';
import { AUTH_PRINCIPAL_GUARD_CONFIG_KEY } from 'src/engine/guards/constants/auth-principal-guard-config-key.constant';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { RecruitingRequestLimitGuard } from '../auth/request-limit.guard';
import { RecruitingController } from '../api/recruiting.controller';
import { RecruitingDirectoryService } from './directory.service';
import { RecruitingRecordsService } from './records.service';
import {
  parseRecruitingSearch,
  recruitingLikePattern,
  type RecruitingSearchResource,
} from './domain/search';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = {
  type: 'apiKey',
  workspace: { id: 'workspace-a' },
  apiKey: { id: 'key' },
};
const fieldDefinitions = {
  person: {
    id: FieldMetadataType.UUID,
    name: FieldMetadataType.FULL_NAME,
    jobTitle: FieldMetadataType.TEXT,
    contactRoles: FieldMetadataType.MULTI_SELECT,
    emails: FieldMetadataType.EMAILS,
    phones: FieldMetadataType.PHONES,
  },
  company: {
    id: FieldMetadataType.UUID,
    name: FieldMetadataType.TEXT,
    domainName: FieldMetadataType.LINKS,
  },
  recruitmentJob: {
    id: FieldMetadataType.UUID,
    name: FieldMetadataType.TEXT,
    jobDescription: FieldMetadataType.RICH_TEXT,
    companyId: FieldMetadataType.UUID,
    jobStatus: FieldMetadataType.SELECT,
  },
};
const maps = <T extends { id: string; universalIdentifier: string }>(
  items: T[],
) => ({
  byUniversalIdentifier: Object.fromEntries(
    items.map((item) => [item.universalIdentifier, item]),
  ),
  universalIdentifierById: Object.fromEntries(
    items.map((item) => [item.id, item.universalIdentifier]),
  ),
  universalIdentifiersByApplicationId: {},
});
const fields = Object.entries(fieldDefinitions).flatMap(
  ([object, definitions]) =>
    Object.entries(definitions).map(([name, type]) => ({
      id: `${object}-${name}`,
      universalIdentifier: `${object}-${name}`,
      name,
      type,
      objectMetadataId: object,
      workspaceId: 'workspace-a',
      applicationId: 'app',
      settings: {},
      isActive: true,
    })),
);
const objects = Object.keys(fieldDefinitions).map((name) => ({
  id: name,
  universalIdentifier: name,
  nameSingular: name,
  namePlural: `${name}s`,
  fieldIds: fields
    .filter((field) => field.objectMetadataId === name)
    .map((field) => field.id),
  labelIdentifierFieldMetadataId: `${name}-name`,
}));
const flatFieldMetadataMaps = maps(fields);
const flatObjectMetadataMaps = maps(objects);

const setup = (restricted: string[] = [], deniedObject?: string) => {
  const permissions = Object.fromEntries(
    objects.map((object) => [
      object.id,
      {
        canReadObjectRecords: object.id !== deniedObject,
        canUpdateObjectRecords: false,
        canSoftDeleteObjectRecords: false,
        canDestroyObjectRecords: false,
        restrictedFields: Object.fromEntries(
          restricted.map((field) => [field, { canRead: false }]),
        ),
        rowLevelPermissionPredicates: [],
        rowLevelPermissionPredicateGroups: [],
      },
    ]),
  );
  const metadataCache = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn(async () => ({
      flatFieldMetadataMaps,
      flatObjectMetadataMaps,
      flatIndexMaps: maps([]),
    })),
  };
  const roleCache = {
    getOrRecompute: jest.fn(async () => ({
      flatFieldMetadataMaps,
      flatObjectMetadataMaps,
      flatApplicationMaps: { byId: {} },
      rolesPermissions: { role: permissions },
      apiKeyRoleMap: { key: 'role' },
      userWorkspaceRoleMap: { member: 'role' },
      flatRoleTargetByAgentIdMaps: {},
    })),
  };
  const builder = new CommonApiContextBuilderService(
    metadataCache as never,
    roleCache as never,
  );
  const runner = {
    execute: jest.fn(
      async (_args: CommonInput<FindManyQueryArgs>, _context: unknown) => ({
        results: {
          records: [] as Record<string, unknown>[],
          totalCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null as string | null },
        },
      }),
    ),
  };
  const find = new FindRecordsService(runner as never, builder);
  const records = new RecruitingRecordsService(
    find,
    {} as never,
    {} as never,
    {} as never,
    builder,
  );
  const directory = new RecruitingDirectoryService(records);
  return {
    permissions,
    builder,
    metadataCache,
    roleCache,
    runner,
    find,
    records,
    directory,
  };
};

it('retains all controller guards and exposes only explicit GET search routes', async () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, RecruitingController);
  expect(guards).toHaveLength(4);
  expect(guards[0]).toBe(JwtAuthGuard);
  expect(
    Reflect.getMetadata(AUTH_PRINCIPAL_GUARD_CONFIG_KEY, guards[1]),
  ).toMatchObject({
    apiKey: true,
    userSession: { standard: true, workspaceAgnostic: false },
  });
  expect(guards[2]).toBe(NoPermissionGuard);
  expect(guards[3]).toBe(RecruitingRequestLimitGuard);
  const directory = { search: jest.fn(async () => ({})) };
  const controller = Object.assign(
    Object.create(RecruitingController.prototype),
    { directory },
  );
  for (const [method, resource] of [
    ['searchCandidates', 'candidates'],
    ['searchCompanies', 'companies'],
    ['searchJobs', 'jobs'],
  ]) {
    expect(Reflect.getMetadata(PATH_METADATA, controller[method])).toBe(
      `search/${resource}`,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, controller[method])).toBe(
      RequestMethod.GET,
    );
    await controller[method](
      { workspace: context.workspace, apiKey: context.apiKey },
      { q: ' A ' },
    );
    expect(directory.search).toHaveBeenLastCalledWith(context, resource, {
      q: ' A ',
    });
  }
  expect(() => controller.searchCandidates({}, { q: 'x' })).toThrow();
});

it.each([
  {},
  { q: '' },
  { q: '   ' },
  { q: 'x'.repeat(101) },
  { q: ['a', 'b'] },
  { q: { ilike: 'x' } },
  { q: 'x', limit: '0' },
  { q: 'x', limit: '-2' },
  { q: 'x', limit: '2.1' },
  { q: 'x', limit: '2x' },
  { q: 'x', limit: ['2', '3'] },
  { q: 'x', limit: '9007199254740992' },
  { q: 'x', sort: 'name' },
  { q: 'x', filter: '{}' },
  { q: 'x', cursor: '' },
  { q: 'x', cursor: 'broken' },
  { q: 'x', cursor: encodeCursorData({ id: id(1), name: 'secret' }) },
  { q: 'x', cursor: encodeCursorData({ id: 'invalid' }) },
  { q: 'x', companyId: id(1) },
])('rejects malformed or non-whitelisted parameters: %j', async (query) => {
  const { directory, runner, metadataCache } = setup();
  await expect(
    directory.search(context as never, 'candidates', query),
  ).rejects.toThrow(BadRequestException);
  expect(
    metadataCache.getOrRecomputeManyOrAllFlatEntityMaps,
  ).not.toHaveBeenCalled();
  expect(runner.execute).not.toHaveBeenCalled();
});

it('validates bounded defaults, scalar UUID filters and native ID cursors', () => {
  expect(parseRecruitingSearch('companies', { q: '  Acme  ' })).toMatchObject({
    q: 'Acme',
    limit: 20,
  });
  expect(
    parseRecruitingSearch('jobs', { q: 'x', limit: '999', companyId: id(1) })
      .limit,
  ).toBe(50);
  expect(() =>
    parseRecruitingSearch('jobs', { q: 'x', companyId: 'bad' }),
  ).toThrow();
  expect(() =>
    parseRecruitingSearch('jobs', { q: 'x', companyId: [id(1)] }),
  ).toThrow();
  const cursor = encodeCursorData({ id: id(1) });
  expect(parseRecruitingSearch('companies', { q: 'x', cursor }).cursor).toBe(
    cursor,
  );
});

it.each(['candidates', 'companies', 'jobs'] as RecruitingSearchResource[])(
  'builds fixed readable %s filters and projects only minimal public fields',
  async (resource) => {
    const { directory, runner, metadataCache } = setup();
    runner.execute.mockResolvedValueOnce({
      results: {
        records: [
          {
            id: id(1),
            name:
              resource === 'candidates'
                ? { firstName: 'Ada', lastName: 'Lovelace', hidden: 'secret' }
                : 'Acme',
            jobTitle: 'Engineer',
            domainName: {
              primaryLinkUrl: 'https://acme.test',
              secondaryLinks: ['secret'],
            },
            companyId: id(2),
            jobStatus: 'CLOSED',
            emails: { primaryEmail: 'private' },
            phones: 'private',
            jobDescription: 'private',
            contactRoles: ['CANDIDATE'],
            files: ['private'],
            candidateSearchJson: 'private',
          },
        ],
        totalCount: 1,
        pageInfo: {
          hasNextPage: true,
          endCursor: encodeCursorData({ id: id(1) }),
        },
      },
    });
    const result = await directory.search(context as never, resource, {
      q: ' API ',
      limit: '100',
      ...(resource === 'jobs' ? { companyId: id(2) } : {}),
    });
    const args = runner.execute.mock.calls[0][0];
    expect(args.first).toBe(50);
    expect(args.orderBy).toEqual([{ id: OrderByDirection.AscNullsLast }]);
    expect(args.filter?.and[0].or).toEqual(
      resource === 'candidates'
        ? [
            { name: { firstName: { ilike: '%API%' } } },
            { name: { lastName: { ilike: '%API%' } } },
            { jobTitle: { ilike: '%API%' } },
            { emails: { primaryEmail: { ilike: '%API%' } } },
            { phones: { primaryPhoneNumber: { ilike: '%API%' } } },
          ]
        : resource === 'companies'
          ? [
              { name: { ilike: '%API%' } },
              { domainName: { primaryLinkUrl: { ilike: '%API%' } } },
            ]
          : [
              { name: { ilike: '%API%' } },
              { jobDescription: { markdown: { ilike: '%API%' } } },
            ],
    );
    if (resource === 'candidates')
      expect(args.filter?.and[1]).toEqual({
        contactRoles: { containsAny: ['CANDIDATE'] },
      });
    if (resource === 'jobs')
      expect(args.filter?.and[1]).toEqual({ companyId: { eq: id(2) } });
    expect(JSON.stringify(args.filter)).not.toContain('RECRUITING');
    expect(result).toEqual({
      records: [
        resource === 'candidates'
          ? {
              id: id(1),
              name: { firstName: 'Ada', lastName: 'Lovelace' },
              jobTitle: 'Engineer',
            }
          : resource === 'companies'
            ? {
                id: id(1),
                name: 'Acme',
                domainName: { primaryLinkUrl: 'https://acme.test' },
              }
            : {
                id: id(1),
                name: 'Acme',
                companyId: id(2),
                jobStatus: 'CLOSED',
              },
      ],
      hasNextPage: true,
      nextCursor: encodeCursorData({ id: id(1) }),
    });
    expect(
      metadataCache.getOrRecomputeManyOrAllFlatEntityMaps,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-a' }),
    );
  },
);

it('removes unreadable scalar/composite fields before searching and returning results', async () => {
  const { directory, runner } = setup([
    'person-name',
    'person-emails',
    'person-phones',
  ]);
  runner.execute.mockResolvedValueOnce({
    results: {
      records: [
        { id: id(1), name: 'private', jobTitle: 'Engineer', emails: 'private' },
      ],
      totalCount: 1,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  });
  const result = await directory.search(context as never, 'candidates', {
    q: 'x',
  });
  expect(runner.execute.mock.calls[0][0].filter?.and[0].or).toEqual([
    { jobTitle: { ilike: '%x%' } },
  ]);
  expect(result.records).toEqual([{ id: id(1), jobTitle: 'Engineer' }]);
  const companies = setup(['company-domainName']);
  await companies.directory.search(context as never, 'companies', { q: 'x' });
  expect(companies.runner.execute.mock.calls[0][0].filter?.and[0].or).toEqual([
    { name: { ilike: '%x%' } },
  ]);
  const jobs = setup(['recruitmentJob-jobDescription']);
  await jobs.directory.search(context as never, 'jobs', { q: 'x' });
  expect(jobs.runner.execute.mock.calls[0][0].filter?.and[0].or).toEqual([
    { name: { ilike: '%x%' } },
  ]);
});

it('fails closed on object, identity, membership and company filter denial; never broadens an empty OR', async () => {
  for (const [resource, restricted, deniedObject, query] of [
    ['companies', [], 'company', { q: 'x' }],
    ['candidates', ['person-contactRoles'], undefined, { q: 'x' }],
    [
      'jobs',
      ['recruitmentJob-companyId'],
      undefined,
      { q: 'x', companyId: id(2) },
    ],
  ] as const) {
    const { directory, runner } = setup([...restricted], deniedObject);
    await expect(
      directory.search(context as never, resource, query),
    ).rejects.toThrow(ForbiddenException);
    expect(runner.execute).not.toHaveBeenCalled();
  }
  const empty = setup(['company-name', 'company-domainName']);
  expect(
    await empty.directory.search(context as never, 'companies', { q: 'x' }),
  ).toEqual({ records: [], hasNextPage: false, nextCursor: null });
  expect(empty.runner.execute).not.toHaveBeenCalled();
  const noRole = setup();
  await expect(
    noRole.directory.search(
      { ...context, apiKey: { id: 'unknown' } } as never,
      'companies',
      { q: 'x' },
    ),
  ).rejects.toThrow();
  expect(noRole.runner.execute).not.toHaveBeenCalled();
});

it('preserves each workspace and principal, rechecking permissions on cursor pages', async () => {
  const { directory, runner, roleCache } = setup();
  for (const auth of [
    context,
    { ...context, workspace: { id: 'workspace-b' } },
    {
      type: 'user',
      workspace: { id: 'workspace-c' },
      userWorkspaceId: 'member',
    },
  ]) {
    await directory.search(auth as never, 'companies', {
      q: 'x',
      cursor: encodeCursorData({ id: id(1) }),
    });
    expect(runner.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        after: encodeCursorData({ id: id(1) }),
        offset: 0,
      }),
      expect.objectContaining({
        authContext: auth,
        isInternalRecordOperation: true,
      }),
    );
    expect(roleCache.getOrRecompute).toHaveBeenLastCalledWith(
      auth.workspace.id,
      expect.any(Array),
    );
  }
  roleCache.getOrRecompute.mockRejectedValueOnce(
    new ForbiddenException('revoked'),
  );
  await expect(
    directory.search(context as never, 'companies', { q: 'x' }),
  ).rejects.toThrow('revoked');
  expect(runner.execute).toHaveBeenCalledTimes(3);
});

it('keeps cursor fields opt-in and existing offset results backward compatible', async () => {
  const { find, records, runner } = setup();
  const result = await records.list(context as never, 'company', {
    offset: 8,
    limit: 2,
    select: ['id'],
  });
  expect(result).not.toHaveProperty('endCursor');
  expect(runner.execute.mock.calls[0][0]).not.toHaveProperty('after');
  expect(runner.execute.mock.calls[0][0]).toMatchObject({
    offset: 8,
    first: 2,
  });
  const cursor = encodeCursorData({ id: id(1) });
  runner.execute.mockResolvedValueOnce({
    results: {
      records: [],
      totalCount: 0,
      pageInfo: { hasNextPage: false, endCursor: cursor },
    },
  });
  const page = await find.execute({
    authContext: context,
    objectName: 'company',
    after: cursor,
    includeCursor: true,
    shouldBuildEffectiveSelectFields: false,
  } as never);
  expect(page.result?.endCursor).toBe(cursor);
  expect(runner.execute).toHaveBeenLastCalledWith(
    expect.objectContaining({ after: cursor }),
    expect.anything(),
  );
});

it.each(['%', '_', '\\', "x%' OR 1=1 --", '研发'])(
  'binds escaped input %s with native parser and preserves row/soft-delete conditions',
  async (q) => {
    const { queryBuilder, executedStatements } = buildQueryBuilder({
      onBeforeExecute: applyRowAccessCondition,
    });
    const person = objects[0];
    const filter = { name: { firstName: { ilike: recruitingLikePattern(q) } } };
    const parser = new GraphqlQueryFilterConditionParser(
      person as never,
      flatFieldMetadataMaps as never,
    );
    parser.parse(queryBuilder, 'person', filter);
    queryBuilder.setFindOptions({ select: { id: true } });
    await queryBuilder.getMany();
    const statement = executedStatements[0];
    expect(statement.text).toContain('ILIKE $');
    expect(statement.text).toContain('"person"."deletedAt" IS NULL');
    expect(statement.text).toContain('"person"."companyId" = $');
    expect(statement.text).not.toContain(q === '研发' ? q : 'OR 1=1');
    expect(statement.values).toContain(recruitingLikePattern(q));
    expect(statement.values).toContain('company-1');
    expect(recruitingLikePattern('%_\\')).toBe('%\\%\\_\\\\%');
  },
);

it('native parser rejects filtering unreadable fields even if a caller bypasses predicate pruning', () => {
  const { permissions } = setup(['person-emails']);
  const { queryBuilder } = buildQueryBuilder();
  Object.assign(queryBuilder.objectRecordsPermissions, permissions);
  const parser = new GraphqlQueryFilterConditionParser(
    objects[0] as never,
    flatFieldMetadataMaps as never,
  );
  expect(() =>
    parser.parse(queryBuilder, 'person', {
      emails: { primaryEmail: { ilike: '%private%' } },
    }),
  ).toThrow();
});

it('escapes all existing picker patterns while retaining empty searches, offsets and active-job defaults', async () => {
  const records = {
    list: jest.fn(
      async (
        _context: unknown,
        _objectName: string,
        _options: CommonInput<FindManyQueryArgs> & { limit?: number },
      ) => ({}),
    ),
  };
  const directory = new RecruitingDirectoryService(records as never);
  await directory.candidates(context as never, '%_\\', 5, 8);
  expect(records.list.mock.calls[0][2]).toMatchObject({
    offset: 5,
    limit: 8,
    filter: {
      and: [
        { contactRoles: { containsAny: ['CANDIDATE'] } },
        {
          or: [
            { name: { firstName: { ilike: '%\\%\\_\\\\%' } } },
            { name: { lastName: { ilike: '%\\%\\_\\\\%' } } },
            { jobTitle: { ilike: '%\\%\\_\\\\%' } },
          ],
        },
      ],
    },
  });
  await directory.companies(context as never, '%_\\', 2, 8);
  expect(records.list.mock.calls[1][2]).toMatchObject({
    offset: 2,
    limit: 8,
    filter: {
      or: [
        { name: { ilike: '%\\%\\_\\\\%' } },
        { domainName: { primaryLinkUrl: { ilike: '%\\%\\_\\\\%' } } },
      ],
    },
  });
  await directory.jobs(context as never, {
    search: '%_\\',
    companyId: id(2),
    limit: 8,
  });
  expect(records.list.mock.calls[2][2]).toMatchObject({
    limit: 8,
    filter: {
      and: [
        { companyId: { eq: id(2) } },
        { jobStatus: { eq: 'RECRUITING' } },
        { name: { ilike: '%\\%\\_\\\\%' } },
      ],
    },
  });
  await directory.companies(context as never);
  expect(records.list.mock.calls[3][2].filter).toBeUndefined();
  await directory.candidates(context as never);
  expect(records.list.mock.calls[4][2].filter).toEqual({
    and: [{ contactRoles: { containsAny: ['CANDIDATE'] } }],
  });
  await directory.jobs(context as never);
  expect(records.list.mock.calls[5][2]).toMatchObject({
    limit: 100,
    filter: { and: [{ jobStatus: { eq: 'RECRUITING' } }] },
  });
});

it('uses native ID keyset pages without duplicates for equal labels, empty/end pages and inserts', async () => {
  const company = objects[1];
  const tableShape = {
    objectMetadataId: 'company',
    nameSingular: 'company',
    tableName: 'company',
    schemaName: 'test_workspace',
    columnNames: ['id', 'name', 'deletedAt'],
    hasDeletedAtColumn: true,
    relationShapeByFieldName: {},
    columnShapeByColumnName: Object.fromEntries(
      ['id', 'name', 'deletedAt'].map((name) => [
        name,
        {
          columnName: name,
          fieldName: name,
          fieldMetadataId: `company-${name}`,
          fieldMetadataType: FieldMetadataType.TEXT,
        },
      ]),
    ),
  };
  const source = [id(1), id(2), id(3), id(4)];
  const statements: { text: string; values: unknown[] }[] = [];
  const runPage = async (after?: string, q = 'same') => {
    const boundary = after ? (decodeCursor(after) as { id: string }).id : '';
    const queryBuilder = new WorkspaceSelectQueryBuilder('company', {
      tableShape: tableShape as never,
      objectRecordsPermissions: {},
      tableShapeByObjectMetadataId: () => tableShape as never,
      onBeforeExecute: () => undefined,
      executor: {
        execute: async (statement) => {
          statements.push(statement as never);
          return source
            .filter((value) => value > boundary && q === 'same')
            .slice(0, 3)
            .map((value) => ({ company_id: value, company_name: 'same' }));
        },
      },
      formatResult: (records) => records as never,
    });
    const runner = new CommonFindManyQueryRunnerService();
    Object.assign(runner, {
      getReadRepository: () => ({ createQueryBuilder: () => queryBuilder }),
    });
    return runner.run(
      {
        first: 2,
        after,
        filter: { name: { ilike: `%${q}%` } },
        selectedFieldsResult: {
          select: { id: true, name: true },
          aggregate: {},
        },
      } as never,
      {
        flatObjectMetadata: company,
        flatFieldMetadataMaps,
        flatObjectMetadataMaps,
        commonQueryParser: new GraphqlQueryParser(
          company as never,
          flatObjectMetadataMaps as never,
          flatFieldMetadataMaps as never,
        ),
      } as never,
    );
  };
  const first = await runPage();
  expect(first.records.map((record) => record.id)).toEqual([id(1), id(2)]);
  expect(first.pageInfo.hasNextPage).toBe(true);
  expect(decodeCursor(first.pageInfo.endCursor!)).toEqual({ id: id(2) });
  source.unshift(id(0));
  const second = await runPage(first.pageInfo.endCursor!);
  expect(second.records.map((record) => record.id)).toEqual([id(3), id(4)]);
  expect(second.pageInfo.hasNextPage).toBe(false);
  expect(statements[1].text).toContain('"company"."id" > $');
  expect(statements[1].values).toContain(id(2));
  const end = await runPage(second.pageInfo.endCursor!);
  expect(end.records).toEqual([]);
  expect(end.pageInfo.endCursor).toBeNull();
  const empty = await runPage(undefined, 'absent');
  expect(empty.records).toEqual([]);
  expect(empty.pageInfo.hasNextPage).toBe(false);
});
