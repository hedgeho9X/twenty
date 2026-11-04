/** Shares permission-aware company and subject selection across operators, HTTP and native MCP tools. */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type CommonSelectedFields } from 'src/engine/api/common/types/common-selected-fields-result.type';
import {
  parseRecruitingSearch,
  recruitingLikePattern,
  recruitingSearchPolicies,
  type RecruitingSearchResource,
} from './domain/search';
import { RecruitingRecordsService } from './records.service';

/** Company identity remains explicit; similar names never authorize an automatic merge. */
export const recruitingCompanyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    domain: z.string().trim().max(1000).optional(),
    description: z.string().max(50_000).optional(),
    recruitmentPreferences: z.string().max(50_000).optional(),
  })
  .strict();

@Injectable()
/** Reuses native CRUD, field permissions, record filters and audit events. */
export class RecruitingDirectoryService {
  constructor(private readonly records: RecruitingRecordsService) {}

  /** Extends picker reads with a fixed, permission-pruned search contract. */
  async search(
    context: WorkspaceAuthContext,
    resource: RecruitingSearchResource,
    query: unknown,
  ) {
    const { q, limit, cursor, companyId } = parseRecruitingSearch(
      resource,
      query,
    );
    const policy = recruitingSearchPolicies[resource];
    const readable = await this.records.readableFields(
      context,
      policy.objectName,
    );
    const canRead = (path: string) => {
      const [field, subfield] = path.split('.');
      const selection = readable[field];
      return subfield
        ? typeof selection === 'object' && selection[subfield] === true
        : selection === true;
    };
    if (
      !canRead('id') ||
      (resource === 'candidates' && !canRead('contactRoles')) ||
      (companyId && !canRead('companyId'))
    )
      throw new ForbiddenException('当前权限下无法搜索这些招聘记录');

    const pattern = recruitingLikePattern(q);
    const predicates = policy.paths.filter(canRead).map((path) => {
      const [field, subfield] = path.split('.');
      return {
        [field]: subfield
          ? { [subfield]: { ilike: pattern } }
          : { ilike: pattern },
      };
    });
    if (!predicates.length)
      return { records: [], hasNextPage: false, nextCursor: null };
    const constraints: Record<string, unknown>[] = [{ or: predicates }];
    if (resource === 'candidates')
      constraints.push({ contactRoles: { containsAny: ['CANDIDATE'] } });
    if (companyId) constraints.push({ companyId: { eq: companyId } });
    const select = policy.output.filter((field) => Boolean(readable[field]));
    const page = await this.records.list(context, policy.objectName, {
      filter: { and: constraints },
      select,
      limit,
      after: cursor,
      includeCursor: true,
      // The native runner applies its fixed ID ASC tie-breaker and keyset filter.
    });
    return {
      records: page.records.map((record) =>
        this.searchProjection(
          record as Record<string, unknown>,
          select,
          readable,
        ),
      ),
      hasNextPage: page.hasNextPage,
      nextCursor: page.hasNextPage ? (page.endCursor ?? null) : null,
    };
  }

  /** Native effective selection includes filter fields; never expose them implicitly. */
  private searchProjection(
    record: Record<string, unknown>,
    select: readonly string[],
    readable: CommonSelectedFields,
  ) {
    const result: Record<string, unknown> = {};
    for (const field of select) {
      const value = record[field];
      if (value === undefined) continue;
      if (field === 'name' && typeof readable[field] === 'object') {
        if (value && typeof value === 'object')
          result[field] = Object.fromEntries(
            ['firstName', 'lastName']
              .filter(
                (key) =>
                  (readable[field] as CommonSelectedFields)[key] === true,
              )
              .map((key) => [key, (value as Record<string, unknown>)[key]]),
          );
      } else if (field === 'domainName') {
        if (
          value &&
          typeof value === 'object' &&
          (readable[field] as CommonSelectedFields).primaryLinkUrl === true
        )
          result[field] = {
            primaryLinkUrl: (value as Record<string, unknown>).primaryLinkUrl,
          };
      } else if (readable[field] === true) result[field] = value;
    }
    return result;
  }

  /** Resolves a linked candidate into a minimal selection label under current permissions. */
  async candidate(context: WorkspaceAuthContext, id: string) {
    const page = await this.records.list(context, 'person', {
      filter: { id: { eq: id }, contactRoles: { containsAny: ['CANDIDATE'] } },
      limit: 1,
      select: [
        'id',
        'name',
        'jobTitle',
        'recruitingProfile',
        'candidatePreferences',
        'candidateSearchJson',
      ],
    });
    if (!page.records[0])
      throw new NotFoundException('候选人不存在或当前无权访问');
    return page.records[0];
  }

  /** Resolves a selected job without loading resumes or billing details into the picker. */
  async job(context: WorkspaceAuthContext, id: string) {
    const page = await this.records.list(context, 'recruitmentJob', {
      filter: { id: { eq: id } },
      limit: 1,
      select: [
        'id',
        'name',
        'companyId',
        'jobStatus',
        'jobDescription',
        'recruitingProfile',
      ],
    });
    if (!page.records[0])
      throw new NotFoundException('岗位不存在或当前无权访问');
    return page.records[0];
  }

  /** Searches bounded company choices before material submission. */
  companies(
    context: WorkspaceAuthContext,
    search = '',
    offset = 0,
    limit = 50,
  ) {
    const query = search.trim().slice(0, 200);
    return this.records.list(context, 'company', {
      filter: query
        ? {
            or: [
              { name: { ilike: recruitingLikePattern(query) } },
              {
                domainName: {
                  primaryLinkUrl: { ilike: recruitingLikePattern(query) },
                },
              },
            ],
          }
        : undefined,
      offset,
      limit: Math.min(50, Math.max(1, limit)),
      select: [
        'id',
        'name',
        'domainName',
        'recruitingDescription',
        'recruitmentPreferences',
      ],
    });
  }

  /** Reads only company fields used by the recruiting workflow, without contract or billing details. */
  async company(context: WorkspaceAuthContext, id: string) {
    const page = await this.records.list(context, 'company', {
      filter: { id: { eq: id } },
      limit: 1,
      select: [
        'id',
        'name',
        'domainName',
        'recruitingDescription',
        'recruitmentPreferences',
      ],
    });
    if (!page.records[0])
      throw new NotFoundException('公司不存在或当前无权访问');
    return page.records[0];
  }

  /** Creates an operator-selected company and validates its optional website locally. */
  async createCompany(context: WorkspaceAuthContext, value: unknown) {
    const parsed = recruitingCompanyInputSchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请填写公司名称，并检查输入字段');
    const data = parsed.data;
    let domain;
    if (data.domain) {
      try {
        const url = new URL(
          data.domain.includes('://') ? data.domain : `https://${data.domain}`,
        );
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
        domain = {
          primaryLinkLabel: url.hostname,
          primaryLinkUrl: url.origin,
          secondaryLinks: [],
        };
      } catch {
        throw new BadRequestException('请填写有效的公司网站地址');
      }
    }
    return this.records.create(context, 'company', {
      name: data.name,
      ...(domain ? { domainName: domain } : {}),
      ...(data.description ? { recruitingDescription: data.description } : {}),
      ...(data.recruitmentPreferences
        ? {
            recruitmentPreferences: {
              markdown: data.recruitmentPreferences,
              blocknote: null,
            },
          }
        : {}),
    });
  }

  /** Returns minimal candidate choices; full resumes are read only when the authorized matching task needs them. */
  candidates(
    context: WorkspaceAuthContext,
    search = '',
    offset = 0,
    limit = 50,
  ) {
    const query = search.trim().slice(0, 200);
    return this.records.list(context, 'person', {
      filter: {
        and: [
          { contactRoles: { containsAny: ['CANDIDATE'] } },
          ...(query
            ? [
                {
                  or: [
                    {
                      name: {
                        firstName: { ilike: recruitingLikePattern(query) },
                      },
                    },
                    {
                      name: {
                        lastName: { ilike: recruitingLikePattern(query) },
                      },
                    },
                    { jobTitle: { ilike: recruitingLikePattern(query) } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: ['id', 'name', 'jobTitle'],
      limit: Math.min(50, Math.max(1, limit)),
      offset,
    });
  }

  /** Shares active-job selection with explicit company binding and native pagination. */
  jobs(
    context: WorkspaceAuthContext,
    options: {
      companyId?: string;
      search?: string;
      active?: boolean;
      offset?: number;
      limit?: number;
    } = {},
  ) {
    if (
      options.companyId &&
      !z.string().uuid().safeParse(options.companyId).success
    )
      throw new BadRequestException('公司标识无效');
    const filter = [
      ...(options.companyId ? [{ companyId: { eq: options.companyId } }] : []),
      ...(options.active !== false
        ? [{ jobStatus: { eq: 'RECRUITING' } }]
        : []),
      ...(options.search?.trim()
        ? [
            {
              name: {
                ilike: recruitingLikePattern(
                  options.search.trim().slice(0, 200),
                ),
              },
            },
          ]
        : []),
    ];
    return this.records.list(context, 'recruitmentJob', {
      filter: filter.length ? { and: filter } : undefined,
      select: ['id', 'name', 'companyId', 'jobStatus'],
      limit: Math.min(100, Math.max(1, options.limit ?? 100)),
      offset: options.offset ?? 0,
    });
  }
}
