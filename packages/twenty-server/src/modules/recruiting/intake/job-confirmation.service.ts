/** Confirms company-bound job drafts with stable identities and recoverable per-item checkpoints. */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RECRUITING_ADVISORY_LOCK } from '../shared/locking/advisory-lock.constant';

import { v5 } from 'uuid';
import {
  getRecruitingPreviewMissingFields,
  getRecruitingPreviewNameWarnings,
  isPlainObject,
  type RecruitingPreviewExistingJob,
} from 'twenty-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type IntakeEnvelope } from './intake.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from '../records/records.service';
import { RecruitingMatchingService } from '../matching/matching.service';
import {
  jobProfilesSchema,
  type RecruitingJobProfile,
} from './schemas';
import { contentVersion } from '../matching/domain/match-context';

/** Item identity belongs to the original preview, never its current position after editing or deletion. */
export type RecruitingJobItem = {
  itemId: string;
  jobId: string;
  draft: RecruitingJobProfile;
  status: 'DRAFT' | 'CREATED' | 'FAILED' | 'DISCARDED';
  confirmedHash?: string;
  error?: string;
  matchingRunId?: string;
  matchingError?: string;
};

@Injectable()
/** Preserves previously created jobs and human edits while allowing independent retries of failed items. */
export class RecruitingJobConfirmationService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly matching: RecruitingMatchingService,
    private readonly cache: WorkspaceCacheService,
    @Inject(RECRUITING_ADVISORY_LOCK)
    private readonly locks: PostgresAdvisoryLockService,
  ) {}

  /** Creates deterministic preview identities without changing CRM state on reads. */
  preview(intakeId: string, envelope: IntakeEnvelope): RecruitingJobItem[] {
    if (envelope.jobItems) return envelope.jobItems;
    const parsed = jobProfilesSchema.safeParse(envelope.extraction?.profile);
    if (!parsed.success) return [];
    return parsed.data.jobs.map((draft, index) => {
      const jobId = v5(`${intakeId}:job:${index}`, v5.URL);
      return {
        itemId: v5(`${intakeId}:item:${index}`, v5.URL),
        jobId,
        draft,
        status: envelope.jobIds?.includes(jobId) ? 'CREATED' : 'DRAFT',
        ...(envelope.jobIds?.includes(jobId)
          ? { confirmedHash: contentVersion(draft) }
          : {}),
      };
    });
  }

  /** Enriches an authorized preview with current name hints and batch provenance; reads never modify stored items. */
  async describePreview(
    context: WorkspaceAuthContext,
    intakeId: string,
    envelope: IntakeEnvelope,
  ) {
    const items = this.preview(intakeId, envelope);
    let existingJobs: RecruitingPreviewExistingJob[] = [];
    let duplicateCheck: {
      status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_REQUIRED';
      checked: number;
      total?: number;
    } = { status: 'NOT_REQUIRED', checked: 0 };
    const pending = items.some(
      (item) => !['CREATED', 'DISCARDED'].includes(item.status),
    );
    if (pending && !envelope.input.companyId)
      duplicateCheck = { status: 'UNAVAILABLE', checked: 0 };
    if (pending && envelope.input.companyId) {
      try {
        const page = await this.records.list(context, 'recruitmentJob', {
          filter: { companyId: { eq: envelope.input.companyId } },
          select: ['id', 'name', 'companyId', 'jobStatus'],
          limit: 200,
        });
        existingJobs = page.records.flatMap((record) =>
          isPlainObject(record) &&
          typeof record.id === 'string' &&
          record.companyId === envelope.input.companyId &&
          typeof record.name === 'string' &&
          record.name.trim()
            ? [
                {
                  id: record.id,
                  name: record.name,
                  companyId: String(record.companyId),
                  jobStatus:
                    typeof record.jobStatus === 'string'
                      ? record.jobStatus
                      : undefined,
                },
              ]
            : [],
        );
        duplicateCheck = {
          status:
            page.hasNextPage || existingJobs.length !== page.records.length
              ? 'PARTIAL'
              : 'COMPLETE',
          checked: existingJobs.length,
          total: page.count,
        };
      } catch {
        duplicateCheck = { status: 'UNAVAILABLE', checked: 0 };
      }
    }
    const names = items.map((item) => ({ ...item, title: item.draft.title }));
    return {
      jobItems: items.map((item) => ({
        ...item,
        missingFields: getRecruitingPreviewMissingFields(item.draft),
        nameWarnings: getRecruitingPreviewNameWarnings(
          { ...item, title: item.draft.title },
          names,
          existingJobs,
          envelope.input.companyId ?? '',
        ),
      })),
      previewExistingJobs: existingJobs,
      duplicateCheck,
      previewSources: {
        attribution: 'BATCH' as const,
        files: (envelope.input.files ?? []).map((file) => ({
          fileId: file.fileId,
          label: file.label,
        })),
        hasText: Boolean(envelope.input.text?.trim()),
        hasNote: Boolean(envelope.input.note?.trim()),
      },
    };
  }

  /** Serializes confirmation of the same intake but never waits for child model jobs. */
  async confirm(
    context: WorkspaceAuthContext,
    intakeId: string,
    value: unknown,
    automatic = false,
  ) {
    const locked = await this.locks.tryWithLock(
      `recruiting-confirm:${context.workspace.id}:${intakeId}`,
      async () => this.confirmLocked(context, intakeId, value, automatic),
    );
    if (!locked.acquired)
      throw new ConflictException('这一批岗位正在确认，请稍后刷新');
    return locked.value;
  }

  /** Saves each outcome before continuing, so one invalid row does not discard successful work. */
  private async confirmLocked(
    context: WorkspaceAuthContext,
    id: string,
    value: unknown,
    automatic: boolean,
  ) {
    const record = await this.records.one(context, 'recruitingIntake', id);
    const envelope = record.result as IntakeEnvelope;
    if (
      envelope.schemaVersion !== 2 ||
      envelope.input.kind !== 'JOB' ||
      !envelope.input.companyId ||
      !envelope.extraction
    )
      throw new BadRequestException('请等待岗位材料整理完成后再确认');
    await this.records.one(context, 'company', envelope.input.companyId);
    const items = structuredClone(this.preview(id, envelope));
    if (!items.length)
      throw new BadRequestException('材料中没有可确认的岗位，请补充岗位正文');
    const request = this.parseRequest(value, items);
    const allowedIds = new Set(items.map((item) => item.itemId));
    const requestedIds = [
      ...request.items.map((item) => item.itemId),
      ...request.discardedItemIds,
    ];
    if (
      new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some((itemId) => !allowedIds.has(itemId))
    )
      throw new BadRequestException('岗位项标识无效或重复，请刷新原始预览');
    for (const itemId of request.discardedItemIds) {
      const item = items.find((entry) => entry.itemId === itemId)!;
      if (item.status === 'CREATED')
        throw new ConflictException(
          '已创建的岗位不能通过忽略预览删除，请打开岗位记录处理',
        );
      item.status = 'DISCARDED';
      item.error = undefined;
    }
    const attributes = await this.allowedAttributes(context);
    const automaticMatchingEnabled =
      process.env.RECRUITING_AUTO_MATCH_ENABLED !== 'false';
    const checkpoint = async () => {
      const created = items.filter((item) => item.status === 'CREATED');
      const done = items.every((item) =>
        ['CREATED', 'DISCARDED'].includes(item.status),
      );
      const failed = items.some((item) => item.status === 'FAILED');
      const matchingRunIds = created.flatMap((item) =>
        item.matchingRunId ? [item.matchingRunId] : [],
      );
      return this.records.update(context, 'recruitingIntake', id, {
        state: done
          ? 'COMPLETED'
          : failed || !automatic
            ? 'NEEDS_REVIEW'
            : 'PROCESSING',
        targetId: created[0]?.jobId ?? null,
        error: failed ? '部分岗位未创建，请修正后单独重试' : null,
        result: {
          ...envelope,
          jobItems: items,
          jobIds: created.map((item) => item.jobId),
          stage: done
            ? created.length
              ? 'STORED'
              : 'DISCARDED'
            : failed
              ? 'CONFIRMATION_PARTIAL'
              : automatic
                ? 'SAVING_JOBS'
                : 'AWAITING_CONFIRMATION',
          recordUrl: created[0]
            ? `/object/recruitmentJob/${created[0].jobId}`
            : undefined,
          matchingRunIds,
          matchingStatus:
            created.length && !automaticMatchingEnabled
              ? 'DISABLED'
              : created.some((item) => item.matchingError)
                ? 'PARTIAL'
                : created.length
                  ? 'QUEUED'
                  : 'NOT_REQUIRED',
        },
      });
    };
    // Validate write authority before creating the first job or scheduling any matching.
    await checkpoint();
    for (const submitted of request.items) {
      const item = items.find((entry) => entry.itemId === submitted.itemId)!;
      const parsed = jobProfilesSchema.shape.jobs.element.safeParse(
        submitted.draft,
      );
      if (
        !parsed.success ||
        !parsed.data.title.trim() ||
        !parsed.data.description.trim()
      ) {
        if (item.status === 'CREATED')
          throw new ConflictException('已创建岗位的确认内容不能再修改');
        item.status = 'FAILED';
        item.error = '请填写岗位名称和完整岗位正文，并检查识别字段';
        await checkpoint();
        continue;
      }
      const draft = parsed.data;
      const hash = contentVersion(draft);
      if (item.status === 'CREATED') {
        if (item.confirmedHash && item.confirmedHash !== hash)
          throw new ConflictException(
            '这条岗位已经创建，请在岗位记录中编辑，重试不会覆盖人工修改',
          );
        continue;
      }
      if (item.status === 'DISCARDED')
        throw new BadRequestException(
          '已忽略的岗位不能再次确认，请新建导入任务',
        );
      try {
        const existing = await this.optionalJob(context, item.jobId);
        if (existing) {
          const profile = isPlainObject(existing.recruitingProfile)
            ? existing.recruitingProfile
            : {};
          const oldDraft =
            jobProfilesSchema.shape.jobs.element.safeParse(profile);
          if (
            profile.sourceIntakeId !== id ||
            !(
              profile.sourceDraftHash === hash ||
              (oldDraft.success && contentVersion(oldDraft.data) === hash)
            )
          )
            throw new ConflictException(
              '该岗位已存在且确认内容不同，请打开记录核对',
            );
        } else
          await this.records.create(context, 'recruitmentJob', {
            id: item.jobId,
            name: draft.title,
            companyId: envelope.input.companyId,
            jobStatus: 'RECRUITING',
            jobDescription: { markdown: draft.description, blocknote: null },
            jobRecruitmentPreferences: {
              markdown: draft.preferences,
              blocknote: null,
            },
            jobAttributes: [...draft.employmentTypes, ...draft.workModes]
              .map((entry) => entry.toUpperCase())
              .filter((entry) => attributes.has(entry)),
            recruitingProfile: {
              ...draft,
              sourceIntakeId: id,
              sourceItemId: item.itemId,
              sourceHash: envelope.inputHash,
              sourceDraftHash: hash,
            },
          });
        item.status = 'CREATED';
        item.draft = draft;
        item.confirmedHash = hash;
        item.error = undefined;
        await checkpoint();
        if (!automaticMatchingEnabled) continue;
        try {
          item.matchingRunId = (
            await this.matching.submitForRecord(
              context,
              'recruitmentJob',
              item.jobId,
              envelope.input.source,
            )
          ).runId;
          item.matchingError = undefined;
        } catch {
          item.matchingError = '岗位已保存，匹配暂未排队，可单独发起';
        }
      } catch (error) {
        item.status = 'FAILED';
        item.draft = draft;
        item.error =
          error instanceof BadRequestException ||
          error instanceof ConflictException
            ? error.message
            : '创建失败，请检查字段或权限后重试';
      }
      await checkpoint();
    }
    return checkpoint();
  }

  /** Keeps the old full-array caller compatible while requiring stable IDs for removal or subset retries. */
  private parseRequest(value: unknown, items: RecruitingJobItem[]) {
    if (!isPlainObject(value))
      throw new BadRequestException('请提交岗位确认列表');
    if (Array.isArray(value.items)) {
      const selected = value.items.map((entry) => {
        if (!isPlainObject(entry) || typeof entry.itemId !== 'string')
          throw new BadRequestException('请提供岗位项标识');
        return { itemId: entry.itemId, draft: entry.draft };
      });
      const discarded = value.discardedItemIds ?? [];
      if (
        !Array.isArray(discarded) ||
        !discarded.every((entry) => typeof entry === 'string') ||
        (!selected.length && !discarded.length)
      )
        throw new BadRequestException('请至少确认或忽略一条岗位');
      return { items: selected, discardedItemIds: discarded as string[] };
    }
    const parsed = jobProfilesSchema.safeParse(value);
    if (!parsed.success || parsed.data.jobs.length !== items.length)
      throw new BadRequestException('请刷新预览，使用岗位项标识逐项确认');
    return {
      items: parsed.data.jobs.map((draft, index) => ({
        itemId: items[index].itemId,
        draft,
      })),
      discardedItemIds: [] as string[],
    };
  }

  /** Legacy select fields receive only supported projections; the full canonical facts remain in recruitingProfile. */
  private async allowedAttributes(context: WorkspaceAuthContext) {
    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.cache.getOrRecompute(context.workspace.id, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
      ]);
    const object = Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).find((entry) => entry?.nameSingular === 'recruitmentJob');
    const field = Object.values(
      flatFieldMetadataMaps.byUniversalIdentifier,
    ).find(
      (entry) =>
        entry?.objectMetadataId === object?.id &&
        entry?.name === 'jobAttributes',
    );
    return new Set((field?.options ?? []).map((option) => option.value));
  }

  /** A missing job can be created; a denied read never becomes an unrestricted overwrite. */
  private async optionalJob(
    context: WorkspaceAuthContext,
    id: string,
  ): Promise<RecruitingRecord | undefined> {
    try {
      return await this.records.one(context, 'recruitmentJob', id);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
}
