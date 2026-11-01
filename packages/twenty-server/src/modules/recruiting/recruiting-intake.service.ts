/** Archives unified submissions and coordinates resumable parsing, extraction and native record writes. */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { createHash } from 'node:crypto';
import { v4, v5 } from 'uuid';
import { isPlainObject } from 'twenty-shared/utils';
import { OrderByDirection } from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  RecruitingActorService,
  type RecruitingActor,
} from './recruiting-actor.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from './recruiting-records.service';
import {
  RecruitingParserService,
  type ParsedRecruitingMaterial,
} from './recruiting-parser.service';
import {
  RecruitingExtractorService,
  type RecruitingExtractionPart,
} from './recruiting-extractor.service';
import { RecruitingMatchingService } from './recruiting-matching.service';
import { RecruitingUploadService } from './recruiting-upload.service';
import { RecruitingJobConfirmationService } from './recruiting-job-confirmation.service';
import { RecruitingCandidateRecordsService } from './recruiting-candidate-records.service';
import {
  candidateProfileSchema,
  intakeInputSchema,
  type RecruitingIntakeInput,
} from './recruiting-schemas';

/** Queue data contains no login token and fixes the record target before any model runs. */
export type RecruitingIntakeJobData = {
  intakeId: string;
  actor: RecruitingActor;
};

/** Processing state lives in the CRM even after queue entries expire. */
export type IntakeEnvelope = {
  schemaVersion: 2;
  input: RecruitingIntakeInput;
  inputHash: string;
  actor: RecruitingActor;
  stage: string;
  materials?: ParsedRecruitingMaterial[];
  candidateFiles?: { sourceFileId: string; fileId: string; label: string }[];
  extraction?: Record<string, unknown>;
  extractionParts?: RecruitingExtractionPart[];
  candidateId?: string;
  jobIds?: string[];
  recordUrl?: string;
  error?: string;
  matchingStatus?: string;
  matchingRunIds?: string[];
  matchingError?: string;
  transportDigest?: string;
  jobItems?: import('./recruiting-job-confirmation.service').RecruitingJobItem[];
};

@Injectable()
/** Makes ingestion independent from later matching failures. */
export class RecruitingIntakeService {
  private readonly logger = new Logger(RecruitingIntakeService.name);
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
    private readonly parser: RecruitingParserService,
    private readonly extractor: RecruitingExtractorService,
    private readonly matching: RecruitingMatchingService,
    private readonly uploads: RecruitingUploadService,
    private readonly jobs: RecruitingJobConfirmationService,
    private readonly candidates: RecruitingCandidateRecordsService,
    @InjectMessageQueue(MessageQueue.recruitingQueue)
    private readonly queue: MessageQueueService,
  ) {}

  /** Accepts completed file references once; retries must reuse the same payload and key. */
  async submit(
    context: WorkspaceAuthContext,
    value: unknown,
    options?: { transportDigest?: string },
  ) {
    const parsed = intakeInputSchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map((issue) => issue.message).join('；'),
      );
    for (const file of parsed.data.files) this.uploads.authorize(context, file);
    const input = {
      ...parsed.data,
      note: parsed.data.note ?? '',
      files: parsed.data.files.map((file) => ({
        fileId: file.fileId,
        label: file.label,
        role: file.role,
      })),
    };
    const actor = this.actors.capture(context);
    if (input.companyId)
      await this.records.one(context, 'company', input.companyId);
    if (input.candidateId) {
      const candidate = await this.records.one(
        context,
        'person',
        input.candidateId,
      );
      if (
        !Array.isArray(candidate.contactRoles) ||
        !candidate.contactRoles.includes('CANDIDATE')
      )
        throw new BadRequestException(
          '目标联系人不属于候选人，请先核对候选人记录',
        );
    }
    for (const file of input.files) await this.parser.file(actor, file.fileId);
    const inputHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const key = input.idempotencyKey ?? input.sourceId;
    const id = key
      ? v5(`${actor.workspaceId}:${input.kind}:${input.source}:${key}`, v5.URL)
      : v4();
    let record = await this.optional(context, 'recruitingIntake', id);
    if (record) {
      const envelope = this.envelope(record);
      if (
        envelope.inputHash !== inputHash &&
        (!options?.transportDigest ||
          envelope.transportDigest !== options.transportDigest)
      )
        throw new ConflictException(
          '同一提交标识已对应另一份材料，请使用新的提交标识',
        );
      if (['COMPLETED', 'NEEDS_REVIEW'].includes(String(record.state)))
        return this.receipt(record);
    } else {
      const envelope: IntakeEnvelope = {
        schemaVersion: 2,
        input,
        inputHash,
        actor,
        stage: 'QUEUED',
        transportDigest: options?.transportDigest,
      };
      try {
        record = await this.records.create(context, 'recruitingIntake', {
          id,
          name: `[recruiting-v2] ${input.files[0]?.label ?? '岗位文字'}`,
          kind: input.kind,
          rawText: input.note ?? '',
          files: input.files.map((file) => ({
            fileId: file.fileId,
            label: file.label,
          })),
          state: 'READY',
          result: envelope,
        });
      } catch (error) {
        const concurrent = await this.optional(context, 'recruitingIntake', id);
        if (
          !concurrent ||
          (this.envelope(concurrent).inputHash !== inputHash &&
            (!options?.transportDigest ||
              this.envelope(concurrent).transportDigest !==
                options.transportDigest))
        )
          throw error;
        record = concurrent;
      }
    }
    await this.enqueue(id, actor);
    return this.receipt(record);
  }

  /** Reuses a previously accepted multipart request before allocating another native file. */
  async existingMultipart(
    context: WorkspaceAuthContext,
    key: string | undefined,
    digest: string,
    source: 'api' | 'manual' = 'api',
  ) {
    if (!key) return undefined;
    const id = v5(`${context.workspace.id}:CANDIDATE:${source}:${key}`, v5.URL);
    const record = await this.optional(context, 'recruitingIntake', id);
    if (!record) return undefined;
    if (this.envelope(record).transportDigest !== digest)
      throw new ConflictException(
        '同一提交标识已对应其他材料，请使用新的提交标识',
      );
    if (record.state === 'READY')
      await this.enqueue(id, this.actors.capture(context));
    return this.receipt(record);
  }

  /** Lists submission summaries without returning every resume's OCR text to the queue popup. */
  async list(context: WorkspaceAuthContext, offset = 0) {
    const page = await this.records.list(context, 'recruitingIntake', {
      filter: { name: { ilike: '[recruiting-v2]%' } },
      offset,
      limit: 50,
      orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
    });
    return {
      ...page,
      count: Number(page.count),
      records: page.records.map((record) =>
        this.receipt(record as RecruitingRecord),
      ),
    };
  }

  /** Returns the full authorized material state for a detail/preview view. */
  async one(context: WorkspaceAuthContext, id: string) {
    const record = await this.records.one(context, 'recruitingIntake', id);
    const envelope = this.envelope(record);
    return {
      ...this.receipt(record),
      detail: {
        ...envelope,
        ...(envelope.input.kind === 'JOB'
          ? await this.jobs.describePreview(context, id, envelope)
          : {}),
      },
    };
  }

  /** Reads an original only when both the authorized parent files field and immutable submission reference it. */
  async material(context: WorkspaceAuthContext, id: string, fileId: string) {
    const record = await this.records.one(context, 'recruitingIntake', id);
    const source = this.envelope(record).input.files.find(
      (file) => file.fileId === fileId,
    );
    const visible =
      Array.isArray(record.files) &&
      record.files.some(
        (file) => isPlainObject(file) && file.fileId === fileId,
      );
    if (!source || !visible)
      throw new NotFoundException('当前记录没有可读取的这份材料');
    return {
      label: source.label,
      bytes: await this.parser.original(this.actors.capture(context), fileId),
    };
  }

  /** Returns only a previously archive-accepted mail binding after verifying its signed origin. */
  async mailBinding(
    context: WorkspaceAuthContext,
    id: string,
    binding: { archiveId: string; sourceHash: string; idempotencyKey: string },
  ) {
    const record = await this.records.one(context, 'recruitingIntake', id);
    const envelope = this.envelope(record);
    const input = envelope.input;
    if (
      input.kind !== 'CANDIDATE' ||
      input.source !== 'email' ||
      input.sourceId !== binding.archiveId ||
      input.idempotencyKey !== binding.idempotencyKey ||
      input.mail?.archiveId !== binding.archiveId ||
      input.mail?.sourceHash !== binding.sourceHash
    )
      throw new ConflictException('邮件入库绑定不一致，请核对原处理记录');
    return this.receipt(record);
  }

  /** Reuses successful material and extraction stages while binding the retry to its current caller. */
  async retry(context: WorkspaceAuthContext, id: string) {
    const record = await this.records.one(context, 'recruitingIntake', id);
    const envelope = this.envelope(record);
    if (record.state === 'COMPLETED') return this.receipt(record);
    if (
      envelope.stage === 'AWAITING_CONFIRMATION' &&
      envelope.input.kind !== 'JOB'
    )
      return this.receipt(record);
    if (['READY', 'PROCESSING'].includes(String(record.state))) {
      const active =
        await this.queue.getInFlightJobs<RecruitingIntakeJobData>();
      if (
        active.some(
          (entry) =>
            entry.data.intakeId === id &&
            entry.data.actor.workspaceId === context.workspace.id,
        )
      )
        return this.receipt(record);
    }
    const actor = this.actors.capture(context);
    await this.records.update(context, 'recruitingIntake', id, {
      state: 'READY',
      error: null,
      result: { ...envelope, actor, stage: 'QUEUED', error: undefined },
    });
    await this.queue.add(
      'ResumeIngestJob',
      { intakeId: id, actor },
      {
        id: `recruiting-retry-${id}-${v4()}`,
        isWorkspaceJob: true,
        workspaceId: actor.workspaceId,
        retryLimit: 1,
        broadcastTo: {
          workspaceId: actor.workspaceId,
          userWorkspaceId: actor.userWorkspaceId,
        },
        deduplication: { id: `recruiting-intake-${id}` },
      },
    );
    return { intakeId: id, jobId: id, stage: 'QUEUED', state: 'READY' };
  }

  /** The queue handler validates current access before reading or mutating any business record. */
  async process(data: RecruitingIntakeJobData) {
    let context = await this.actors.resolve(data.actor);
    const record = await this.records.one(
      context,
      'recruitingIntake',
      data.intakeId,
    );
    let envelope = this.envelope(record);
    if (record.state === 'COMPLETED') return;
    const update = async (
      stage: string,
      patch: Partial<IntakeEnvelope> = {},
    ) => {
      context = await this.actors.resolve(data.actor);
      envelope = { ...envelope, ...patch, stage };
      await this.records.update(context, 'recruitingIntake', record.id, {
        state: 'PROCESSING',
        result: envelope,
        error: null,
      });
    };
    try {
      const materials = envelope.materials ?? [];
      await update('PARSING');
      for (const file of envelope.input.files.filter(
        (entry) => entry.role !== 'archive',
      )) {
        if (materials.some((material) => material.fileId === file.fileId))
          continue;
        materials.push(
          await this.parser.parse(data.actor, file.fileId, file.label),
        );
        await update('PARSING', { materials });
      }
      await update('EXTRACTING');
      let extraction = envelope.extraction;
      if (!extraction) {
        const parts = envelope.extractionParts ?? [];
        const progress = {
          parts,
          save: async (part: RecruitingExtractionPart) => {
            parts.push(part);
            await update('EXTRACTING', { extractionParts: parts });
          },
        };
        if (envelope.input.kind === 'CANDIDATE')
          extraction = await this.extractor.candidate(
            materials,
            envelope.input.note ?? '',
            progress,
          );
        else {
          const company = await this.records.one(
            context,
            'company',
            envelope.input.companyId!,
          );
          extraction = await this.extractor.jobs(
            materials,
            envelope.input.text ?? '',
            envelope.input.note ?? '',
            JSON.stringify({
              name: company.name,
              description: company.recruitingDescription,
              preferences: company.recruitmentPreferences,
            }),
            progress,
          );
        }
        await update('EXTRACTED', { extraction });
      }
      if (envelope.input.kind === 'JOB') {
        context = await this.actors.resolve(data.actor);
        await update('SAVING_JOBS');
        const items = this.jobs
          .preview(record.id, envelope)
          .filter((item) => !['CREATED', 'DISCARDED'].includes(item.status))
          .map((item) => ({ itemId: item.itemId, draft: item.draft }));
        try {
          await this.jobs.confirm(context, record.id, { items }, true);
        } catch (error) {
          // Preserve per-item creation checkpoints if a later external operation failed.
          envelope = this.envelope(
            await this.records.one(context, 'recruitingIntake', record.id),
          );
          throw error;
        }
        return;
      }
      const profile = candidateProfileSchema.parse(extraction.profile);
      const materialKind = isPlainObject(extraction.profile)
        ? extraction.profile.materialKind
        : undefined;
      if (
        materialKind === 'job' ||
        materialKind === 'other' ||
        (profile.needsReview &&
          profile.skills.length +
            profile.experience.length +
            profile.education.length ===
            0)
      ) {
        await this.records.update(context, 'recruitingIntake', record.id, {
          state: 'NEEDS_REVIEW',
          result: { ...envelope, stage: 'MATERIAL_REVIEW' },
          error:
            materialKind === 'job'
              ? '这些材料更像岗位JD，请在公司与岗位入口提交；原件已保留'
              : '尚未识别到足够的候选人职业资料，请核对材料后重新提交',
        });
        return;
      }
      if (profile.identityConflict) {
        await this.records.update(context, 'recruitingIntake', record.id, {
          state: 'NEEDS_REVIEW',
          result: { ...envelope, stage: 'IDENTITY_REVIEW' },
          error: '材料身份存在冲突，请拆分或核对后重新提交',
        });
        return;
      }
      const candidateId =
        envelope.input.candidateId ?? v5(`${record.id}:candidate`, v5.URL);
      const candidateFiles = envelope.candidateFiles ?? [];
      for (const file of envelope.input.files.filter(
        (entry) => entry.role !== 'archive',
      )) {
        if (candidateFiles.some((entry) => entry.sourceFileId === file.fileId))
          continue;
        const copy = await this.parser.copyResumeAttachment(
          data.actor,
          file.fileId,
        );
        candidateFiles.push({
          sourceFileId: file.fileId,
          fileId: copy.id,
          label: file.label,
        });
        await update('COPYING_FILES', { candidateFiles });
      }
      const files = candidateFiles.map((file) => ({
        fileId: file.fileId,
        label: file.label,
      }));
      const recruitingProfile = {
        ...profile,
        sourceIntakeId: record.id,
        sourceHash: envelope.inputHash,
        sourceText: materials.map((material) => material.text).join('\n\n'),
        note: envelope.input.note ?? '',
        modelId: extraction.modelId,
        generatedAt: new Date().toISOString(),
      };
      context = await this.actors.resolve(data.actor);
      try {
        await this.candidates.replaceProfile(
          context,
          candidateId,
          recruitingProfile,
          files,
        );
      } catch (error) {
        if (!(error instanceof NotFoundException) || envelope.input.candidateId)
          throw error;
        await this.records.create(context, 'person', {
          id: candidateId,
          name: { firstName: profile.name || '待补全姓名', lastName: '' },
          contactRoles: ['CANDIDATE'],
          ...(profile.email && /.+@.+\..+/.test(profile.email)
            ? { emails: { primaryEmail: profile.email, additionalEmails: [] } }
            : {}),
          recruitingProfile,
          candidateResumes: files,
          ...(envelope.input.note
            ? {
                candidatePreferences: {
                  markdown: envelope.input.note,
                  blocknote: null,
                },
              }
            : {}),
        });
      }
      await this.records.update(context, 'recruitingIntake', record.id, {
        state: 'COMPLETED',
        targetId: candidateId,
        result: {
          ...envelope,
          stage: 'STORED',
          candidateId,
          recordUrl: `/object/person/${candidateId}`,
          needsReview:
            profile.needsReview ||
            materials.some((material) => material.status !== 'complete'),
          matchingStatus: 'PENDING',
        },
      });
      await this.scheduleMatching(
        context,
        record.id,
        this.envelope(
          await this.records.one(context, 'recruitingIntake', record.id),
        ),
        'person',
        [candidateId],
      );
    } catch (error) {
      // A revoked caller cannot persist even a failure using the authority captured before inference.
      context = await this.actors.resolve(data.actor);
      const message =
        error instanceof BadRequestException ||
        error instanceof ConflictException
          ? String(error.message)
          : error instanceof Error &&
              error.message.includes('ChatGPT subscription is unavailable')
            ? '资料整理模型的账号连接已失效，请在AI设置更新连接后重试'
            : '处理失败，请查看材料后重试';
      await this.records.update(context, 'recruitingIntake', record.id, {
        state: 'NEEDS_REVIEW',
        error: message,
        result: { ...envelope, stage: 'FAILED', error: message },
      });
    }
  }

  /** Confirms stable server-owned job items and returns persistent per-item outcomes. */
  async confirmJobs(context: WorkspaceAuthContext, id: string, value: unknown) {
    return this.receipt(await this.jobs.confirm(context, id, value));
  }

  /** Resolves preview authorization from its parent intake rather than accepting a storage path. */
  async preview(
    context: WorkspaceAuthContext,
    id: string,
    requestId: string,
    name: string,
  ) {
    const record = await this.records.one(context, 'recruitingIntake', id);
    const material = this.envelope(record).materials?.find(
      (entry) => entry.requestId === requestId,
    );
    if (!material) throw new NotFoundException('预览不存在');
    return this.parser.preview(material, name);
  }

  /** Queues an actual durable job before returning an accepted receipt. */
  private enqueue(intakeId: string, actor: RecruitingActor) {
    return this.queue.add(
      'ResumeIngestJob',
      { intakeId, actor },
      {
        id: `recruiting-intake-${intakeId}`,
        isWorkspaceJob: true,
        workspaceId: actor.workspaceId,
        retryLimit: 1,
        deduplication: { id: `recruiting-intake-${intakeId}` },
        broadcastTo: {
          workspaceId: actor.workspaceId,
          userWorkspaceId: actor.userWorkspaceId,
        },
      },
    );
  }

  /** Writes only matching state after ingestion commits; scoring errors never become intake failures. */
  private async scheduleMatching(
    context: WorkspaceAuthContext,
    intakeId: string,
    envelope: IntakeEnvelope,
    object: 'person' | 'recruitmentJob',
    ids: string[],
  ) {
    const automaticMatchingEnabled =
      process.env.RECRUITING_AUTO_MATCH_ENABLED !== 'false';
    const matchingRunIds = [];
    let matchingError;
    for (const id of automaticMatchingEnabled ? ids : []) {
      try {
        matchingRunIds.push(
          (
            await this.matching.submitForRecord(
              context,
              object,
              id,
              envelope.input.source,
            )
          ).runId,
        );
      } catch {
        matchingError = '资料已保存，自动匹配暂未排队，可单独重试匹配';
      }
    }
    try {
      await this.records.update(context, 'recruitingIntake', intakeId, {
        state: 'COMPLETED',
        result: {
          ...envelope,
          matchingRunIds,
          matchingStatus: !automaticMatchingEnabled
            ? 'DISABLED'
            : matchingError
              ? 'FAILED_TO_QUEUE'
              : 'QUEUED',
          matchingError,
        },
      });
    } catch {
      this.logger.warn(
        'Recruiting material remains stored; matching receipt could not be refreshed.',
      );
    }
  }

  /** Refuses legacy envelopes so archived intake rows cannot restart the former execution chain. */
  private envelope(record: RecruitingRecord): IntakeEnvelope {
    if (!isPlainObject(record.result) || record.result.schemaVersion !== 2)
      throw new BadRequestException('该记录属于历史流程，请重新提交材料');
    return record.result as unknown as IntakeEnvelope;
  }

  /** Keeps queue receipts small while exposing links only after their target record exists. */
  private receipt(record: RecruitingRecord) {
    const envelope = this.envelope(record);
    return {
      intakeId: record.id,
      jobId: record.id,
      name: record.name,
      kind: record.kind,
      source: envelope.input.source,
      state: record.state,
      stage: envelope.stage,
      error: record.error,
      createdAt: record.createdAt,
      candidateId: envelope.candidateId,
      jobIds: envelope.jobIds,
      items:
        envelope.input.kind === 'JOB'
          ? this.jobs.preview(record.id, envelope).map((item) => ({
              itemId: item.itemId,
              jobId: item.status === 'CREATED' ? item.jobId : undefined,
              title: item.draft.title,
              status: item.status,
              error: item.error,
              matchingError: item.matchingError,
              matchingRunId: item.matchingRunId,
              recordUrl:
                item.status === 'CREATED'
                  ? `/object/recruitmentJob/${item.jobId}`
                  : undefined,
            }))
          : undefined,
      recordUrl: envelope.recordUrl,
      batchId:
        envelope.input.batchId ??
        (envelope.input.kind === 'JOB' ? record.id : undefined),
      matchingStatus: envelope.matchingStatus,
      matchingRunIds: envelope.matchingRunIds,
      matchingError: envelope.matchingError,
      files: record.files,
    };
  }

  /** Uses only not-found as absence; validation and authorization errors retain their meaning. */
  private async optional(
    context: WorkspaceAuthContext,
    objectName: string,
    id: string,
  ) {
    try {
      return await this.records.one(context, objectName, id);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
}
