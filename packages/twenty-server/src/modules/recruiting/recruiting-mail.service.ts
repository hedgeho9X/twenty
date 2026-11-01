/** Archives complete email bytes and MIME assets before handing selected material to the unified intake queue. */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RECRUITING_ADVISORY_LOCK } from './recruiting-advisory-lock.constant';
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
} from './recruiting-actor.service';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from './recruiting-records.service';
import { RecruitingUploadService } from './recruiting-upload.service';
import { RecruitingParserService } from './recruiting-parser.service';
import { RecruitingIntakeService } from './recruiting-intake.service';
import {
  expandRecruitingMail,
  type RecruitingMailArtifact,
} from './domain/mail-material';
import { contentVersion } from './domain/match-context';
import { intakeFileSchema } from './recruiting-schemas';

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
type MailPayload = {
  version: 1;
  actor: RecruitingActor;
  sources: RecruitingMailSource[];
  rawFile?: { fileId: string; label: string };
  artifacts: ArchivedAsset[];
  metadata?: Awaited<ReturnType<typeof expandRecruitingMail>>['metadata'];
  autoSubmit: boolean;
  intakeIds: string[];
  parserVersion?: string;
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
      false,
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
              autoSubmit,
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
            (await this.uploads.buffer(context, {
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

  /** Exposes raw metadata and owned artifact identities only after native parent-record access. */
  async one(context: WorkspaceAuthContext, id: string) {
    const record = await this.records.one(context, 'recruitingMailArchive', id);
    const payload = this.payload(record);
    return {
      ...this.receipt(record),
      detail: {
        sources: payload.sources,
        metadata: payload.metadata,
        parserVersion: payload.parserVersion,
        artifacts: payload.artifacts.map((file) => ({
          ...file,
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
      records: page.records.map((record) =>
        this.receipt(record as RecruitingRecord),
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
        if (['READY', 'NEEDS_SELECTION'].includes(String(record.status)))
          return { record, enqueue: false };
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
            payload: { ...payload, actor },
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
        artifactKeys: z.array(z.string()).min(1).max(24),
        candidateId: z.string().uuid().optional(),
        note: z.string().max(90_000).default(''),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请选择1至24份候选人材料，并检查补充说明');
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
    const bound = await this.uploads.fromMailArchive(context, id, allKeys);
    const files = bound.map((file, index) => ({
      ...file,
      role: selection.includes(allKeys[index])
        ? ('primary' as const)
        : [raw?.key, metadata?.key].includes(allKeys[index])
          ? ('archive' as const)
          : ('supplement' as const),
    }));
    const note = `${parsed.data.note}\n邮件主题：${payload.metadata?.subject ?? ''}\n邮件原始信息：${JSON.stringify({ from: payload.metadata?.from, to: payload.metadata?.to, date: payload.metadata?.date })}`;
    const digest = contentVersion({
      selection,
      candidateId: parsed.data.candidateId,
      note: parsed.data.note,
    });
    const intake = await this.intakes.submit(context, {
      kind: 'CANDIDATE',
      files,
      note,
      candidateId: parsed.data.candidateId,
      source: 'email',
      sourceId: id,
      idempotencyKey: `mail:${id}:${digest}`,
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

  /** Expands every MIME artifact with independent checkpoints; automatic selection excludes inline logos without deleting them. */
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
        let payload = this.payload(record);
        if (['READY', 'NEEDS_SELECTION'].includes(String(record.status)))
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
                : await this.uploads.buffer(context, {
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
          }
          const suggested = payload.artifacts.filter(
            (file) => file.suggestedResume,
          );
          const automatic =
            payload.autoSubmit &&
            suggested.length > 0 &&
            suggested.length <= 24;
          await update({
            status: automatic ? 'READY' : 'NEEDS_SELECTION',
            error: '',
            payload,
          });
          if (automatic) {
            try {
              context = await this.actors.resolve(data.actor);
              await this.submitIntakeUnderLock(context, record.id, {
                artifactKeys: suggested.map((file) => file.key),
              });
            } catch {
              await update({
                error:
                  '邮件已完整归档，候选人入库尚未受理，请核对后重新提交所选材料',
              });
            }
          }
        } catch {
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
  /** Omits full email text and addresses from polling rows. */
  private receipt(record: RecruitingRecord) {
    const payload = this.payload(record);
    return {
      archiveId: record.id,
      name: record.name,
      status: record.status,
      error: record.error,
      createdAt: record.createdAt,
      sourceHash: record.sourceHash,
      artifactCount: payload.artifacts.length,
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
