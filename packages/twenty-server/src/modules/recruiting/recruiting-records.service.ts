/** Keeps recruiting data access on the official permission-aware record services. */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { isPlainObject } from 'twenty-shared/utils';
import { FieldActorSource } from 'twenty-shared/types';
import { type ObjectRecordOrderBy } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';

/** A native record remains extensible without weakening individual field values to any. */
export type RecruitingRecord = Record<string, unknown> & { id: string };

@Injectable()
/** Shares access checks across HTTP, native MCP tools and queued processing. */
export class RecruitingRecordsService {
  constructor(
    private readonly findRecordsService: FindRecordsService,
    private readonly createRecordService: CreateRecordService,
    private readonly updateRecordService: UpdateRecordService,
  ) {}

  /** Reads one bounded page; the native service applies record and field permissions. */
  async list(
    context: WorkspaceAuthContext,
    objectName: string,
    options: {
      filter?: Record<string, unknown>;
      offset?: number;
      limit?: number;
      select?: string[];
      orderBy?: ObjectRecordOrderBy;
    } = {},
  ) {
    const response = await this.findRecordsService.execute({
      authContext: context,
      objectName,
      filter: options.filter,
      offset: options.offset ?? 0,
      limit: options.limit ?? 100,
      select: options.select,
      orderBy: options.orderBy,
      shouldBuildEffectiveSelectFields: Boolean(options.select?.length),
    });
    if (!response.success || !response.result)
      throw new BadRequestException('当前权限下无法读取这些招聘记录');
    return { ...response.result, count: Number(response.result.count) };
  }

  /** Reads all permitted pages when the business operation explicitly needs the complete pool. */
  async all(
    context: WorkspaceAuthContext,
    objectName: string,
    filter?: Record<string, unknown>,
  ): Promise<RecruitingRecord[]> {
    const records: RecruitingRecord[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.list(context, objectName, {
        filter,
        offset,
        limit: 100,
      });
      records.push(...(page.records as RecruitingRecord[]));
      if (!page.hasNextPage) return records;
    }
  }

  /** Returns no inaccessible record content in the not-found response. */
  async one(
    context: WorkspaceAuthContext,
    objectName: string,
    id: string,
  ): Promise<RecruitingRecord> {
    const page = await this.list(context, objectName, {
      filter: { id: { eq: id } },
      limit: 1,
    });
    const record = page.records[0];
    if (!record) throw new NotFoundException('记录不存在或当前无权访问');
    return record as RecruitingRecord;
  }

  /** Creates through the native query runner so permissions, audit and events stay active. */
  async create(
    context: WorkspaceAuthContext,
    objectName: string,
    data: Record<string, unknown>,
  ): Promise<RecruitingRecord> {
    const response = await this.createRecordService.execute({
      authContext: context,
      objectName,
      objectRecord: data,
      createdBy: {
        source:
          context.type === 'application'
            ? FieldActorSource.APPLICATION
            : FieldActorSource.API,
        workspaceMemberId:
          context.type === 'user' ? context.workspaceMemberId : null,
        name: 'Recruiting',
        context: {},
      },
    });
    if (
      !response.success ||
      !isPlainObject(response.result) ||
      typeof response.result.id !== 'string'
    ) {
      throw new BadRequestException('无法创建招聘记录，请检查字段和创建权限');
    }
    return response.result as RecruitingRecord;
  }

  /** Updates only supplied fields; model output cannot select an arbitrary object or target ID. */
  async update(
    context: WorkspaceAuthContext,
    objectName: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<RecruitingRecord> {
    const response = await this.updateRecordService.execute({
      authContext: context,
      objectName,
      objectRecordId: id,
      objectRecord: data,
    });
    if (
      !response.success ||
      !isPlainObject(response.result) ||
      typeof response.result.id !== 'string'
    ) {
      throw new BadRequestException('无法更新招聘记录，请检查字段和编辑权限');
    }
    return response.result as RecruitingRecord;
  }
}
