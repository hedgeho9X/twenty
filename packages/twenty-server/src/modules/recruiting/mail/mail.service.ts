/** Archives complete email bytes and MIME assets before handing complete candidate material to the unified intake queue. */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RECRUITING_ADVISORY_LOCK } from '../shared/locking/advisory-lock.constant';
import { createHash } from 'node:crypto';
import { v4, v5 } from 'uuid';
import { z } from 'zod';
import { OrderByDirection } from 'twenty-shared/types';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import {
  RecruitingActorService,
  type RecruitingActor,
} from '../auth/actor.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from '../records/records.service';
import { RecruitingUploadService } from '../files/upload.service';
import { RecruitingParserService } from '../files/parser.service';
import { RecruitingIntakeService } from '../intake/intake.service';
import {
  expandRecruitingMail,
  type RecruitingMailArtifact,
} from './domain/mail-material';
import { contentVersion } from '../matching/domain/match-context';
import { intakeFileSchema } from '../intake/schemas';
import { RecruitingMailFilesService } from './mail-files.service';

/** Transport identifiers are produced by the trusted receiver, never interpreted as authorization. */
export type RecruitingMailSource =
  | { transport: 'EML_UPLOAD' }
  | {
      transport: 'IMAP';
      connectedAccountId: string;
      folder: string;
      uidValidity: string;
      uid: number;
      internalDate?: string;
      flags: string[];
    };

/** IMAP delivery identity excludes mutable flags while including UIDVALIDITY to distinguish mailbox resets. */
const mailSourceKey = (source: RecruitingMailSource) =>
  source.transport === 'IMAP'
    ? contentVersion({
        account: source.connectedAccountId,
        folder: source.folder,
        uidValidity: source.uidValidity,
        uid: source.uid,
      })
    : 'EML_UPLOAD';
type ArchivedAsset = Omit<RecruitingMailArtifact, 'content'> & {
  fileId: string;
};
export type MailPayload = {
  version: 1;
  actor: RecruitingActor;
  sources: RecruitingMailSource[];
  rawFile?: { fileId: string; label: string };
  artifacts: ArchivedAsset[];
  metadata?: Awaited<ReturnType<typeof expandRecruitingMail>>['metadata'];
  autoSubmit: boolean;
  intakeIds: string[];
  parserVersion?: string;
  fileOwnershipVersion?: 1;
  canonicalCopies?: Record<
    string,
    { fileId: string; label: string; fieldName: string }
  >;
  intakeCopies?: Record<
    string,
    { key: string; fileId: string; label: string }[]
  >;
};
/** Queue payloads retain stable identity, not raw email bodies or credentials. */
export type RecruitingMailJobData = {
  archiveId: string;
  actor: RecruitingActor;
};

@Injectable()
/** Archive recovery and candidate processing remain independent: an intake failure never deletes the original email. */
export class RecruitingMailService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
    private readonly uploads: RecruitingUploadService,
    private readonly parser: RecruitingParserService,
    private readonly intakes: RecruitingIntakeService,
    @Inject(RECRUITING_ADVISORY_LOCK)
    private readonly locks: PostgresAdvisoryLockService,
    @InjectMessageQueue(MessageQueue.recruitingQueue)
    private readonly queue: MessageQueueService,
    private readonly mailFiles: RecruitingMailFilesService,
  ) {}

  /** Accepts an Agent-owned completed upload, preserving the same parent archive and file authorization boundary. */
  async importUploaded(context: WorkspaceAuthContext, value: unknown) {
    const parsed = intakeFileSchema
      .required({ uploadReceipt: true })
      .safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请先上传完整EML并取得提交凭据');
    this.uploads.authorize(context, parsed.data);
    const raw = await this.parser.original(
      this.actors.capture(context),
      parsed.data.fileId,
    );
    return this.receive(
      context,
      raw,
      { transport: 'EML_UPLOAD' },
      true,
      parsed.data,
    );
  }

  /** Deduplicates exact original bytes before file allocation; Message-ID alone never merges distinct mail. */
  async receive(
    context: WorkspaceAuthContext,
    raw: Buffer,
    source: RecruitingMailSource,
    autoSubmit = false,
    uploaded?: z.infer<typeof intakeFileSchema>,
  ) {
    if (!raw.length || raw.length > 50 * 1024 * 1024)
      throw new BadRequestException('邮件原文必须在50MB以内');
    const sourceHash = createHash('sha256').update(raw).digest('hex');
    const id = v5(`${context.workspace.id}:mail:${sourceHash}`, v5.URL);
    const actor = this.actors.capture(context);
    if (uploaded) this.uploads.authorize(context, uploaded);
    if (source.transport === 'IMAP')
      await this.registerImapEvent(context, source, sourceHash, id);
    const accepted = await this.optional(context, id);
    if (accepted) {
      const saved = this.payload(accepted);
      if (
        saved.rawFile &&
        !['FAILED', 'UPLOADING'].includes(String(accepted.status)) &&
        saved.sources.some(
          (entry) => mailSourceKey(entry) === mailSourceKey(source),
        )
      ) {
        if (accepted.status === 'QUEUED') await this.enqueue(id, actor);
        return this.receipt(accepted);
      }
    }
    const locked = await this.locks.tryWithLock(
      `recruiting-mail:${id}`,
      async () => {
        let record = await this.optional(context, id);
        let payload: MailPayload = record
          ? this.payload(record)
          : {
              version: 1,
              actor,
              sources: [source],
              artifacts: [],
              autoSubmit: source.transport === 'IMAP' || autoSubmit,
              intakeIds: [],
            };
        if (!record)
          record = await this.records.create(context, 'recruitingMailArchive', {
            id,
            name: '邮件原文归档',
            status: 'UPLOADING',
            sourceHash,
            payload,
          });
        if (
          !payload.sources.some(
            (entry) => mailSourceKey(entry) === mailSourceKey(source),
          )
        ) {
          if (payload.sources.length >= 100)
            throw new BadRequestException(
              '邮件来源事件数量超过核对上限，原文仍已保留',
            );
          payload = { ...payload, sources: [...payload.sources, source] };
          record = await this.records.update(
            context,
            'recruitingMailArchive',
            id,
            { payload },
          );
        }
        if (!payload.rawFile) {
          const file =
            uploaded ??
            (await this.mailFiles.upload(context, id, {
              buffer: raw,
              originalname: 'original.eml',
            }));
          payload = {
            ...payload,
            rawFile: { fileId: file.fileId, label: file.label },
          };
          record = await this.records.update(
            context,
            'recruitingMailArchive',
            id,
            { status: 'QUEUED', payload },
          );
          record = await this.mailFiles.ensureCanonicalOwnership(context, id);
        }
        return record;
      },
    );
    if (!locked.acquired)
      throw new BadRequestException('同一邮件正在接收，请稍后重试');
    // A worker may start as soon as Redis accepts the job, so release the archive lock before enqueueing.
    if (!['READY', 'NEEDS_SELECTION'].includes(String(locked.value.status)))
      await this.enqueue(id, actor);
    return this.receipt(locked.value);
  }

  /** Migrates only this authorized archive's canonical files without reprocessing materials or changing existing intakes. */
  async ensureCanonicalOwnership(context: WorkspaceAuthContext, id: string) {
    const locked = await this.locks.tryWithLock(`recruiting-mail:${id}`, () =>
      this.mailFiles.ensureCanonicalOwnership(context, id),
    );
    if (!locked.acquired)
      throw new ConflictException('邮件正在处理，请稍后重试');
    return locked.value;
  }

  /** Exposes raw metadata and owned artifact identities only after native parent-record access. */
  async one(context: WorkspaceAuthContext, id: string) {
    const record = await this.records.one(context, 'recruitingMailArchive', id);
    const payload = this.payload(record);
    const previews = new Map<string, { intakeId: string; fileId: string }>();
    let processingError = '';
    for (const intakeId of payload.intakeIds) {
      try {
        const intake = await this.intakes.one(context, intakeId);
        if (typeof intake.error === 'string') processingError ||= intake.error;
        for (const material of intake.detail.materials ?? []) {
          const original = Object.values(payload.intakeCopies ?? {})
            .flat()
            .find((file) => file.fileId === material.fileId);
          if (original)
            previews.set(original.key, { intakeId, fileId: material.fileId });
        }
      } catch {
        /* An inaccessible intake must not expose its files through the mail archive. */
      }
    }
    return {
      ...this.receipt(record),
      error: record.error || processingError,
      processingStatus: await this.processingStatus(context, record),
      detail: {
        sources: payload.sources,
        metadata: payload.metadata,
        parserVersion: payload.parserVersion,
        artifacts: payload.artifacts.map((file) => ({
          ...file,
          preview: previews.get(file.key),
          downloadPath: `/recruiting/mail-archives/${record.id}/artifacts/${encodeURIComponent(file.key)}`,
        })),
      },
    };
  }

  /** Serves only a manifest-listed artifact after the signed parent and current native permissions were checked. */
  async artifact(context: WorkspaceAuthContext, id: string, key: string) {
    const record = await this.records.one(context, 'recruitingMailArchive', id);
    const file = this.payload(record).artifacts.find(
      (entry) => entry.key === key,
    );
    if (!file) throw new NotFoundException('邮件材料不存在或当前无权访问');
    return {
      label: file.label,
      bytes: await this.parser.original(
        this.actors.capture(context),
        file.fileId,
      ),
    };
  }

  /** Lists compact email receipts for source selection and recovery. */
  async list(context: WorkspaceAuthContext, offset = 0) {
    const page = await this.records.list(context, 'recruitingMailArchive', {
      offset,
      limit: 30,
      orderBy: [{ createdAt: OrderByDirection.DescNullsLast }],
    });
    return {
      ...page,
      records: await Promise.all(
        page.records.map(async (record) => ({
          ...this.receipt(record as RecruitingRecord),
          processingStatus: await this.processingStatus(
            context,
            record as RecruitingRecord,
          ),
        })),
      ),
    };
  }

  /** Requeues archive expansion under current authority without discarding already uploaded MIME assets. */
  async retry(context: WorkspaceAuthContext, id: string) {
    const actor = this.actors.capture(context);
    const locked = await this.locks.tryWithLock(
      `recruiting-mail:${id}`,
      async () => {
        const record = await this.records.one(
          context,
          'recruitingMailArchive',
          id,
        );
        const payload = this.payload(record);
        if (!payload.rawFile)
          throw new BadRequestException(
            '原文尚未上传完成，请重新提交同一封EML',
          );
        if (payload.intakeIds.length > 0) return { record, enqueue: false };
        const active =
          await this.queue.getInFlightJobs<RecruitingMailJobData>();
        if (
          active.some(
            (entry) =>
              entry.data.archiveId === id &&
              entry.data.actor.workspaceId === context.workspace.id,
          )
        )
          return { record, enqueue: false };
        const authorized = await this.actors.resolve(actor);
        const updated = await this.records.update(
          authorized,
          'recruitingMailArchive',
          id,
          {
            status: 'QUEUED',
            error: '',
            payload: { ...payload, actor, autoSubmit: true },
          },
        );
        return { record: updated, enqueue: true };
      },
    );
    if (!locked.acquired)
      throw new ConflictException('邮件正在接收或处理，请稍后重试');
    if (!locked.value.enqueue) return this.receipt(locked.value.record);
    await this.enqueue(id, actor);
    return this.one(context, id);
  }

  /** Binds only chosen archive assets into normal resume intake, retaining full mail context and a separate business idempotency key. */
  async submitIntake(
    context: WorkspaceAuthContext,
    id: string,
    value: unknown,
  ) {
    const locked = await this.locks.tryWithLock(`recruiting-mail:${id}`, () =>
      this.submitIntakeUnderLock(context, id, value),
    );
    if (!locked.acquired)
      throw new BadRequestException('这封邮件正在处理，请稍后重试');
    return locked.value;
  }

  /** Serializes material selection with MIME checkpoint and source-event updates on the same parent archive. */
  private async submitIntakeUnderLock(
    context: WorkspaceAuthContext,
    id: string,
    value: unknown,
  ) {
    const parsed = z
      .object({
        artifactKeys: z.array(z.string()).min(1).max(28),
        candidateId: z.string().uuid().optional(),
        note: z.string().max(90_000).default(''),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请选择1至28份候选人材料，并检查补充说明');
    const record = await this.records.one(context, 'recruitingMailArchive', id);
    if (!['READY', 'NEEDS_SELECTION'].includes(String(record.status)))
      throw new BadRequestException('请等待邮件归档完成后选择材料');
    const payload = this.payload(record);
    const selection = [...new Set(parsed.data.artifactKeys)].sort();
    if (
      selection.some(
        (key) =>
          !payload.artifacts.some(
            (file) =>
              file.key === key && !['raw', 'metadata'].includes(file.kind),
          ),
      )
    )
      throw new BadRequestException('所选材料不属于邮件或不是可解析正文/附件');
    const body = payload.artifacts.find((file) => file.kind === 'text');
    const html = payload.artifacts.find((file) => file.kind === 'html');
    const metadata = payload.artifacts.find((file) => file.kind === 'metadata');
    const raw = payload.artifacts.find((file) => file.kind === 'raw');
    const allKeys = [
      ...new Set([
        ...selection,
        ...(body ? [body.key] : html ? [html.key] : []),
        ...(raw ? [raw.key] : []),
        ...(metadata ? [metadata.key] : []),
      ]),
    ];
    const digest = contentVersion({
      selection,
      candidateId: parsed.data.candidateId,
      note: parsed.data.note,
    });
    const idempotencyKey = `mail:${id}:${digest}`;
    const intakeId = v5(
      `${context.workspace.id}:CANDIDATE:email:${idempotencyKey}`,
      v5.URL,
    );
    if (payload.intakeIds.includes(intakeId))
      return this.intakes.mailBinding(context, intakeId, {
        archiveId: id,
        sourceHash: String(record.sourceHash),
        idempotencyKey,
      });
    const bound = await this.mailFiles.intakeFiles(
      context,
      id,
      digest,
      allKeys,
    );
    const files = bound.map((file, index) => ({
      ...file,
      role: selection.includes(allKeys[index])
        ? ('primary' as const)
        : [raw?.key, metadata?.key].includes(allKeys[index])
          ? ('archive' as const)
          : ('supplement' as const),
    }));
    const note = `${parsed.data.note}\n邮件主题：${payload.metadata?.subject ?? ''}\n邮件原始信息：${JSON.stringify({ from: payload.metadata?.from, to: payload.metadata?.to, date: payload.metadata?.date })}`;
    const intake = await this.intakes.submit(context, {
      kind: 'CANDIDATE',
      files,
      note,
      candidateId: parsed.data.candidateId,
      source: 'email',
      sourceId: id,
      idempotencyKey,
      mail: {
        archiveId: id,
        sourceHash: record.sourceHash,
        // Source aliases remain on the archive; submitted intake provenance stays stable for idempotency.
        sources: payload.sources.slice(0, 1),
        metadata: payload.metadata,
      },
    });
    const fresh = await this.records.one(context, 'recruitingMailArchive', id);
    const current = this.payload(fresh);
    if (!current.intakeIds.includes(intake.intakeId))
      await this.records.update(context, 'recruitingMailArchive', id, {
        payload: {
          ...current,
          intakeIds: [...current.intakeIds, intake.intakeId],
        },
      });
    return intake;
  }

  /** Expands every MIME artifact with independent checkpoints; all bodies and attachments enter candidate parsing, including inline images. */
  async process(data: RecruitingMailJobData) {
    const locked = await this.locks.tryWithLock(
      `recruiting-mail:${data.archiveId}`,
      async () => {
        let context = await this.actors.resolve(data.actor);
        let record = await this.records.one(
          context,
          'recruitingMailArchive',
          data.archiveId,
        );
        record = await this.mailFiles.ensureCanonicalOwnership(
          context,
          record.id,
        );
        let payload = this.payload(record);
        if (
          ['READY', 'NEEDS_SELECTION'].includes(String(record.status)) &&
          (!payload.autoSubmit || payload.intakeIds.length > 0)
        )
          return;
        /** Rebuilds current authority after attachment I/O and before every durable checkpoint. */
        const update = async (patch: Record<string, unknown>) => {
          context = await this.actors.resolve(data.actor);
          return this.records.update(
            context,
            'recruitingMailArchive',
            record.id,
            patch,
          );
        };
        try {
          await update({ status: 'EXPANDING', error: '' });
          const raw = await this.parser.original(
            data.actor,
            payload.rawFile!.fileId,
          );
          const expanded = await expandRecruitingMail(raw);
          if (expanded.sourceHash !== record.sourceHash)
            throw new Error('Archive hash mismatch');
          for (const artifact of expanded.artifacts) {
            if (payload.artifacts.some((file) => file.key === artifact.key))
              continue;
            const file =
              artifact.kind === 'raw'
                ? payload.rawFile!
                : await this.mailFiles.upload(context, record.id, {
                    buffer: artifact.content,
                    originalname: artifact.label,
                  });
            const { content: _content, ...description } = artifact;
            payload = {
              ...payload,
              metadata: expanded.metadata,
              parserVersion: expanded.parserVersion,
              artifacts: [
                ...payload.artifacts,
                { ...description, fileId: file.fileId },
              ],
            };
            record = await update({
              name: expanded.metadata.subject?.slice(0, 180) || '无主题邮件',
              payload,
            });
            record = await this.mailFiles.ensureCanonicalOwnership(
              context,
              record.id,
            );
            payload = this.payload(record);
          }
          const materials = payload.artifacts.filter(
            (file) => !['raw', 'metadata'].includes(file.kind),
          );
          const automatic =
            payload.autoSubmit &&
            materials.length > 0 &&
            materials.length <= 28;
          const admissionError = !payload.autoSubmit
            ? ''
            : materials.length === 0
              ? '邮件没有可解析的正文或附件，原始邮件已保留'
              : materials.length > 28
                ? '附件和正文超过单封邮件处理上限，全部原件已保留，请拆分后处理'
                : '';
          await update({
            status: admissionError
              ? 'FAILED'
              : automatic
                ? 'READY'
                : 'NEEDS_SELECTION',
            error: admissionError,
            payload,
          });
          if (automatic) {
            try {
              context = await this.actors.resolve(data.actor);
              await this.submitIntakeUnderLock(context, record.id, {
                artifactKeys: materials.map((file) => file.key),
              });
            } catch {
              await update({
                error: '邮件已完整归档，候选人处理尚未受理，请重试处理',
              });
            }
          }
        } catch {
          context = await this.actors.resolve(data.actor);
          payload = this.payload(
            await this.records.one(context, 'recruitingMailArchive', record.id),
          );
          await update({
            status: 'FAILED',
            error: '邮件展开未完成，原始EML已保留；请核对格式或重试归档',
            payload,
          });
        }
      },
    );
    if (!locked.acquired)
      throw new ConflictException('邮件正在接收或处理，稍后自动重试');
  }

  /** Uses only native not-found as permission-preserving absence. */
  private async optional(context: WorkspaceAuthContext, id: string) {
    try {
      return await this.records.one(context, 'recruitingMailArchive', id);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }

  /** A durable source-event binding prevents the same UID from silently accepting changed original bytes. */
  private async registerImapEvent(
    context: WorkspaceAuthContext,
    source: RecruitingMailSource,
    sourceHash: string,
    archiveId: string,
  ) {
    const sourceKey = mailSourceKey(source);
    const id = v5(`${context.workspace.id}:mail-event:${sourceKey}`, v5.URL);
    const locked = await this.locks.tryWithLock(
      `recruiting-mail-event:${id}`,
      async () => {
        let existing;
        try {
          existing = await this.records.one(context, 'recruitingMailEvent', id);
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
        if (existing) {
          if (
            existing.sourceHash !== sourceHash ||
            existing.archiveId !== archiveId
          )
            throw new ConflictException(
              '同一收信事件对应不同原文，请人工核对，系统未合并或重复建人',
            );
          return;
        }
        await this.records.create(context, 'recruitingMailEvent', {
          id,
          name: 'IMAP接收事件',
          sourceKey,
          sourceHash,
          archiveId,
          payload: { version: 1, actor: this.actors.capture(context), source },
        });
      },
    );
    if (!locked.acquired)
      throw new BadRequestException('同一收信事件正在接收，请稍后重试');
  }
  /** Reads only a signed server-owned envelope. */
  private payload(record: RecruitingRecord) {
    return record.payload as MailPayload;
  }
  /** Reports actual downstream intake progress without exposing inaccessible candidate records. */
  private async processingStatus(
    context: WorkspaceAuthContext,
    record: RecruitingRecord,
  ) {
    const ids = this.payload(record).intakeIds;
    if (!ids.length) return record.error ? 'FAILED' : record.status;
    const states: string[] = [];
    for (const id of ids) {
      try {
        const intake = await this.intakes.one(context, id);
        states.push(
          intake.state === 'COMPLETED'
            ? 'COMPLETED'
            : intake.state === 'NEEDS_REVIEW'
              ? intake.stage === 'FAILED'
                ? 'FAILED'
                : 'NEEDS_REVIEW'
              : intake.stage,
        );
      } catch {
        states.push('UNAVAILABLE');
      }
    }
    return (
      states.find((state) => ['FAILED', 'NEEDS_REVIEW'].includes(state)) ??
      states.find((state) => state !== 'COMPLETED') ??
      'COMPLETED'
    );
  }
  /** Omits full email text and addresses from polling rows. */
  private receipt(record: RecruitingRecord) {
    const payload = this.payload(record);
    const received = payload.sources
      .flatMap((source) =>
        source.transport === 'IMAP' &&
        source.internalDate &&
        Number.isFinite(Date.parse(source.internalDate))
          ? [source.internalDate]
          : [],
      )
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    return {
      archiveId: record.id,
      name: record.name,
      status: record.status,
      error: record.error,
      createdAt: record.createdAt,
      receivedAt: received[0] ?? record.createdAt,
      receivedAtSource: received.length ? 'mailbox' : 'archive',
      sourceHash: record.sourceHash,
      artifactCount: payload.artifacts.length,
      attachmentCount: payload.artifacts.filter(
        (file) => file.kind === 'attachment',
      ).length,
      intakeIds: payload.intakeIds,
    };
  }
  /** Returns after durable queue acceptance; parsing does not block the IMAP source fetch. */
  private async enqueue(id: string, actor: RecruitingActor) {
    await this.queue.add(
      'RecruitingMailJob',
      { archiveId: id, actor },
      {
        id: `recruiting-mail-${id}-${v4()}`,
        workspaceId: actor.workspaceId,
        isWorkspaceJob: true,
        retryLimit: 6,
        backoff: {
          strategy: 'exponential',
          initialDelayMilliseconds: 5_000,
        },
        deduplication: { id: `recruiting-mail-${id}` },
      },
    );
  }
}
