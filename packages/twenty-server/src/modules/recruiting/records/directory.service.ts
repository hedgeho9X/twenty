/** Shares permission-aware company and subject selection across operators, HTTP and native MCP tools. */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
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
              { name: { ilike: `%${query}%` } },
              { domainName: { primaryLinkUrl: { ilike: `%${query}%` } } },
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
                    { name: { firstName: { ilike: `%${query}%` } } },
                    { name: { lastName: { ilike: `%${query}%` } } },
                    { jobTitle: { ilike: `%${query}%` } },
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
        ? [{ name: { ilike: `%${options.search.trim().slice(0, 200)}%` } }]
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
