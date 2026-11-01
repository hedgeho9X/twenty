/** Keeps recruiting data access on the official permission-aware record services. */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { isPlainObject } from 'twenty-shared/utils';
import { FieldActorSource } from 'twenty-shared/types';
import { type ObjectRecordOrderBy } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  recruitingEnvelopeKey,
  sealRecruitingRecord,
  verifyRecruitingRecord,
} from './domain/record-integrity';

/** A native record remains extensible without weakening individual field values to any. */
export type RecruitingRecord = Record<string, unknown> & { id: string };

@Injectable()
/** Shares access checks across HTTP, native MCP tools and queued processing. */
export class RecruitingRecordsService {
  private readonly logger = new Logger(RecruitingRecordsService.name);
  constructor(
    private readonly findRecordsService: FindRecordsService,
    private readonly createRecordService: CreateRecordService,
    private readonly updateRecordService: UpdateRecordService,
    private readonly config: TwentyConfigService,
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
      isInternalRecordOperation: true,
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
    const verified = recruitingEnvelopeKey(objectName)
      ? response.result.records.filter((record) =>
          this.trusted(
            context.workspace.id,
            objectName,
            record as RecruitingRecord,
          ),
        )
      : response.result.records;
    return {
      ...response.result,
      records: verified,
      integrityRejected: response.result.records.length - verified.length,
      count: Number(response.result.count),
    };
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
    const objectRecord = sealRecruitingRecord(
      context.workspace.id,
      objectName,
      data,
      this.signingKey(),
    );
    const response = await this.createRecordService.execute({
      authContext: context,
      isInternalRecordOperation: true,
      objectName,
      objectRecord,
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
      const reason = response.error ?? '';
      this.logger.error({ operation: 'create', objectName, reason });
      if (/duplicate|unique|already exists/i.test(reason))
        throw new BadRequestException(
          '记录重复：相同唯一字段的记录已存在，请更新已有记录',
        );
      if (/permission|forbidden|unauthorized/i.test(reason))
        throw new BadRequestException('当前账号没有创建此类记录的权限');
      throw new BadRequestException(
        '创建记录失败：字段校验未通过，请管理员检查服务端日志',
      );
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
    let objectRecord = data;
    const key = recruitingEnvelopeKey(objectName);
    if (key) {
      const current = await this.one(context, objectName, id);
      const sealed = sealRecruitingRecord(
        context.workspace.id,
        objectName,
        { ...current, ...data },
        this.signingKey(),
      );
      objectRecord = { ...data, [key]: sealed[key] };
    }
    const response = await this.updateRecordService.execute({
      authContext: context,
      isInternalRecordOperation: true,
      objectName,
      objectRecordId: id,
      objectRecord,
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

  /** Makes invalid task data indistinguishable from inaccessible records to ordinary callers. */
  private trusted(
    workspaceId: string,
    object: string,
    record: RecruitingRecord,
  ) {
    return verifyRecruitingRecord(
      workspaceId,
      object,
      record,
      this.signingKey(),
    );
  }

  /** Uses a stable local state key; deployed instances may provide the same independent environment key. */
  private signingKey() {
    return (
      process.env.RECRUITING_STATE_SIGNING_KEY || this.config.get('APP_SECRET')
    );
  }

  /** One-time local upgrade, gated by the controller's admin guard and an explicit server-side switch. */
  async sealLegacyState(context: WorkspaceAuthContext) {
    if (process.env.RECRUITING_ALLOW_LEGACY_STATE_SEALING !== 'true')
      throw new BadRequestException('当前未开放历史任务升级');
    const report: Record<string, number> = {};
    for (const object of [
      'recruitingIntake',
      'recruitingMatchRun',
      'recruitingPairEvaluation',
    ]) {
      report[object] = 0;
      for (let offset = 0; ; offset += 100) {
        const page = await this.findRecordsService.execute({
          authContext: context,
          isInternalRecordOperation: true,
          objectName: object,
          offset,
          limit: 100,
          shouldBuildEffectiveSelectFields: false,
        });
        if (!page.success || !page.result)
          throw new BadRequestException('无法读取待升级的任务');
        for (const item of page.result.records as RecruitingRecord[]) {
          const key = recruitingEnvelopeKey(object);
          const value = item[key];
          if (!isPlainObject(value) || value.integrity) continue;
          if (object === 'recruitingIntake' && value.schemaVersion !== 2)
            continue;
          if (object === 'recruitingMatchRun' && value.version !== 1) continue;
          const sealed = sealRecruitingRecord(
            context.workspace.id,
            object,
            item,
            this.signingKey(),
          );
          const response = await this.updateRecordService.execute({
            authContext: context,
            isInternalRecordOperation: true,
            objectName: object,
            objectRecordId: item.id,
            objectRecord: { [key]: sealed[key] },
          });
          if (!response.success) throw new BadRequestException('任务升级失败');
          report[object]++;
        }
        if (!page.result.hasNextPage) break;
      }
    }
    return report;
  }
}
