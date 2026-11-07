/** Binds opt-in recruiting capture to native mailbox ownership without enabling historical synchronization or SMTP. */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type ImapFlow } from 'imapflow';
import { IsNull } from 'typeorm';
import { v5 } from 'uuid';
import { z } from 'zod';
import { ConnectedAccountProvider } from 'twenty-shared/types';
import {
  type WorkspaceAuthContext,
  type UserWorkspaceAuthContext,
} from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { ImapClientProvider } from 'src/modules/messaging/message-import-manager/drivers/imap/providers/imap-client.provider';
import { IMAP_RAW_MESSAGE_RECEIVED_EVENT } from 'src/modules/messaging/message-import-manager/drivers/imap/constants/imap-raw-message-received-event.constant';
import { type ImapRawMessageEvent } from 'src/modules/messaging/message-import-manager/drivers/imap/types/imap-raw-message-event.type';
import {
  RecruitingActorService,
  type RecruitingActor,
} from '../auth/actor.service';
import { RecruitingRecordsService } from '../records/records.service';
import { RecruitingUploadService } from '../files/upload.service';
import { RecruitingMailService } from './mail.service';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { RECRUITING_ADVISORY_LOCK } from '../shared/locking/advisory-lock.constant';
import { RECRUITING_MAILBOX_POLL_JOB } from './mailbox-poll-job.constant';

type MailboxPayload = {
  version: 1;
  actor: RecruitingActor;
  autoSubmit: boolean;
  acceptAfter: string;
  cursor?: { uidValidity: string; lastUid: number };
  lastPollAt?: string;
  lastPollError?: string;
};

/** Only actor references and native connection identity enter the durable timer job. */
export type RecruitingMailboxPollData = {
  workspaceId: string;
  connectedAccountId: string;
  actor: RecruitingActor;
};

@Injectable()
/** Native tokens stay inside ImapClientProvider; business tasks persist only current-owner references. */
export class RecruitingMailboxService {
  private readonly logger = new Logger(RecruitingMailboxService.name);
  constructor(
    @InjectWorkspaceScopedRepository(ConnectedAccountEntity)
    private readonly accounts: WorkspaceScopedRepository<ConnectedAccountEntity>,
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
    private readonly uploads: RecruitingUploadService,
    private readonly nativeImap: ImapClientProvider,
    private readonly mail: RecruitingMailService,
    private readonly config: TwentyConfigService,
    @InjectMessageQueue(MessageQueue.recruitingQueue)
    private readonly queue: MessageQueueService,
    @Inject(RECRUITING_ADVISORY_LOCK)
    private readonly locks: PostgresAdvisoryLockService,
  ) {}

  /** Lists only the caller's non-archived native IMAP connections, without passwords, OAuth tokens or server connection parameters. */
  async list(context: WorkspaceAuthContext, offset = 0, limit = 20) {
    const owner = this.owner(context);
    offset = Math.max(0, Math.floor(offset));
    limit = Math.min(100, Math.max(1, Math.floor(limit)));
    const [accounts, count] = await this.accounts.findAndCount(
      owner.workspace.id,
      {
        where: {
          userWorkspaceId: owner.userWorkspaceId,
          provider: ConnectedAccountProvider.IMAP_SMTP_CALDAV,
          archivedAt: IsNull(),
        },
        select: { id: true, handle: true, userWorkspaceId: true },
        skip: offset,
        take: limit,
        order: { id: 'ASC' },
      },
    );
    const connections = [];
    for (const account of accounts) {
      const setting = await this.setting(owner, account.id);
      connections.push({
        connectedAccountId: account.id,
        handle: account.handle,
        enabled: Boolean(setting?.enabled),
        autoSubmit: setting
          ? (setting.payload as MailboxPayload).autoSubmit
          : true,
        ...((setting?.payload as MailboxPayload | undefined)?.lastPollAt
          ? { lastPollAt: (setting!.payload as MailboxPayload).lastPollAt }
          : {}),
        ...((setting?.payload as MailboxPayload | undefined)?.lastPollError
          ? {
              lastPollError: (setting!.payload as MailboxPayload).lastPollError,
            }
          : {}),
      });
    }
    return {
      connections,
      count,
      hasNextPage: offset + accounts.length < count,
      nativeIntegrationEnabled: this.config.get('IS_IMAP_SMTP_CALDAV_ENABLED'),
      notice:
        '开启后约每分钟只读检查INBOX的新邮件；初次建立当前UID基线，不拉取历史、不改已读或原生同步游标，不发送邮件。',
    };
  }

  /** Explicit owner opt-in records current permissions; toggling capture never changes native synchronization state. */
  async configure(context: WorkspaceAuthContext, value: unknown) {
    const owner = this.owner(context);
    const parsed = z
      .object({
        connectedAccountId: z.string().uuid(),
        enabled: z.boolean(),
        autoSubmit: z.boolean().default(true),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请选择本人邮箱连接与接入方式');
    if (parsed.data.enabled && !this.config.get('IS_IMAP_SMTP_CALDAV_ENABLED'))
      throw new BadRequestException('邮箱连接功能尚未由管理员启用');
    const account = await this.account(owner, parsed.data.connectedAccountId);
    await this.uploads.assertUploadPermission(owner);
    return this.serial(owner, account.id, async () => {
      const existing = await this.setting(owner, account.id);
      const previous = existing?.payload as MailboxPayload | undefined;
      const continuing = Boolean(
        existing?.enabled &&
        previous?.actor.userWorkspaceId === owner.userWorkspaceId &&
        previous.cursor,
      );
      const cursor = parsed.data.enabled
        ? continuing
          ? previous!.cursor
          : await this.baseline(account.id)
        : previous?.cursor;
      const data = {
        name: '招聘收信设置',
        connectedAccountId: account.id,
        enabled: parsed.data.enabled,
        payload: {
          version: 1,
          actor: this.actors.capture(owner),
          autoSubmit: parsed.data.autoSubmit,
          ...(cursor ? { cursor } : {}),
          acceptAfter:
            continuing && previous?.acceptAfter
              ? previous.acceptAfter
              : new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
        },
      };
      if (existing)
        await this.records.update(
          owner,
          'recruitingMailbox',
          existing.id,
          data,
        );
      else
        await this.records.create(owner, 'recruitingMailbox', {
          id: this.id(owner.workspace.id, account.id),
          ...data,
        });
      const id = this.id(owner.workspace.id, account.id);
      if (parsed.data.enabled) {
        try {
          await this.queue.addCron({
            jobName: RECRUITING_MAILBOX_POLL_JOB,
            jobId: id,
            data: {
              workspaceId: owner.workspace.id,
              connectedAccountId: account.id,
              actor: this.actors.capture(owner),
            } satisfies RecruitingMailboxPollData,
            options: { repeat: { every: 60_000 } },
          });
        } catch {
          await this.records.update(owner, 'recruitingMailbox', id, {
            enabled: false,
          });
          throw new BadRequestException('自动收信未能开启，请稍后重试');
        }
      } else
        await this.queue
          .removeCron({ jobName: RECRUITING_MAILBOX_POLL_JOB, jobId: id })
          .catch(() => undefined);
      return {
        connectedAccountId: account.id,
        enabled: parsed.data.enabled,
        autoSubmit: parsed.data.autoSubmit,
      };
    });
  }

  /** Captures only UIDs after the owner-approved baseline, preserving each accepted original before advancing its cursor. */
  async poll(data: RecruitingMailboxPollData) {
    const owner = this.owner(await this.actors.resolve(data.actor));
    if (owner.workspace.id !== data.workspaceId)
      throw new ForbiddenException('收信工作区已变化');
    return this.serial(owner, data.connectedAccountId, async () => {
      const setting = await this.setting(owner, data.connectedAccountId);
      if (!setting?.enabled || !this.config.get('IS_IMAP_SMTP_CALDAV_ENABLED'))
        return { received: 0 };
      const payload = setting.payload as MailboxPayload;
      if (payload.actor.userWorkspaceId !== owner.userWorkspaceId)
        throw new ForbiddenException('邮箱接入所有者已变化');
      await this.account(owner, data.connectedAccountId);
      await this.uploads.assertUploadPermission(owner);
      let client: ImapFlow | undefined;
      let lock: { release: () => void } | undefined;
      let received = 0;
      let current = { ...payload };
      try {
        client = await this.nativeImap.getClient(data.connectedAccountId);
        lock = await client.getMailboxLock('INBOX', { readOnly: true });
        const position = this.position(client);
        if (!current.cursor) {
          current.cursor = position;
        } else if (current.cursor.uidValidity !== position.uidValidity) {
          await this.records.update(owner, 'recruitingMailbox', setting.id, {
            enabled: false,
            payload: {
              ...current,
              lastPollAt: new Date().toISOString(),
              lastPollError:
                '邮箱基线已变化，已停止自动收取；请核对最新原件后重新开启。',
            },
          });
          await this.queue.removeCron({
            jobName: RECRUITING_MAILBOX_POLL_JOB,
            jobId: setting.id,
          });
          return { received: 0, baselineChanged: true };
        } else {
          const cursor = current.cursor;
          const found = await client.search(
            { uid: `${cursor.lastUid + 1}:*` },
            { uid: true },
          );
          const ids = (found || [])
            .filter((uid) => uid > cursor.lastUid)
            .sort((a, b) => a - b)
            .slice(0, 10);
          for (const uid of ids) {
            const header = await client.fetchOne(
              String(uid),
              { uid: true, size: true, internalDate: true, flags: true },
              { uid: true },
            );
            if (!header) {
              current.cursor = { ...cursor, lastUid: uid };
              continue;
            }
            if (
              !Number.isFinite(header.size) ||
              Number(header.size) > 50 * 1024 * 1024
            )
              throw new BadRequestException(
                '有邮件大小未知或超过50MB，未下载或截断；请先在邮箱核对。',
              );
            const receivedAt =
              header.internalDate instanceof Date
                ? header.internalDate.getTime()
                : Date.parse(header.internalDate ?? '');
            if (!Number.isFinite(receivedAt))
              throw new BadRequestException(
                '新邮件缺少稳定接收时间，请核对原件。',
              );
            if (
              receivedAt >= Date.parse(current.acceptAfter) &&
              !header.flags?.has('\\Draft')
            ) {
              const message = await client.fetchOne(
                String(uid),
                { uid: true, source: true, internalDate: true, flags: true },
                { uid: true },
              );
              if (!message || !message.source)
                throw new BadRequestException(
                  '新邮件原文暂不可读，系统未推进该邮件。',
                );
              if (message.source.byteLength > 50 * 1024 * 1024)
                throw new BadRequestException('新邮件超过50MB，未导入或截断。');
              await this.accept(
                owner,
                {
                  workspaceId: owner.workspace.id,
                  userWorkspaceId: owner.userWorkspaceId,
                  connectedAccountId: data.connectedAccountId,
                  folder: 'INBOX',
                  uidValidity: cursor.uidValidity,
                  uid: message.uid,
                  source: message.source,
                  flags: [...(message.flags ?? [])],
                  internalDate: message.internalDate,
                },
                current.autoSubmit,
              );
              received++;
            }
            current = {
              ...current,
              cursor: { ...cursor, lastUid: uid },
              lastPollAt: new Date().toISOString(),
              lastPollError: undefined,
            };
            await this.records.update(owner, 'recruitingMailbox', setting.id, {
              payload: current,
            });
          }
        }
        await this.records.update(owner, 'recruitingMailbox', setting.id, {
          payload: {
            ...current,
            lastPollAt: new Date().toISOString(),
            lastPollError: undefined,
          },
        });
        return { received };
      } catch (error) {
        const message =
          error instanceof BadRequestException
            ? error.message
            : '自动收信未完成，请核对邮箱连接、网络及当前权限。';
        await this.records
          .update(owner, 'recruitingMailbox', setting.id, {
            payload: {
              ...current,
              lastPollAt: new Date().toISOString(),
              lastPollError: message,
            },
          })
          .catch(() => undefined);
        throw new BadRequestException(message);
      } finally {
        lock?.release();
        if (client) await this.nativeImap.closeClient(client);
      }
    });
  }

  /** Establishes the current INBOX position with EXAMINE semantics and no original downloads or synchronization changes. */
  private async baseline(accountId: string) {
    let client: ImapFlow | undefined;
    let lock: { release: () => void } | undefined;
    try {
      client = await this.nativeImap.getClient(accountId);
      lock = await client.getMailboxLock('INBOX', { readOnly: true });
      return this.position(client);
    } finally {
      lock?.release();
      if (client) await this.nativeImap.closeClient(client);
    }
  }
  /** Requires server UIDNEXT/UIDVALIDITY rather than guessing an initial historical range. */
  private position(client: ImapFlow) {
    const mailbox = client.mailbox;
    if (
      !mailbox ||
      typeof mailbox === 'boolean' ||
      !mailbox.uidValidity ||
      !Number.isSafeInteger(mailbox.uidNext) ||
      mailbox.uidNext < 1
    )
      throw new BadRequestException('邮箱缺少稳定UID基线，自动接入未开启。');
    return {
      uidValidity: String(mailbox.uidValidity),
      lastUid: mailbox.uidNext - 1,
    };
  }
  /** Configuration and acquisition share one short owner mailbox mutex, preventing a stale cursor from overwriting a new activation. */
  private async serial<T>(
    owner: UserWorkspaceAuthContext,
    accountId: string,
    callback: () => Promise<T>,
  ) {
    const result = await this.locks.tryWithLock(
      `recruiting-mailbox:${owner.workspace.id}:${accountId}`,
      callback,
    );
    if (!result.acquired)
      throw new ConflictException('邮箱正在读取或设置中，请稍后重试');
    return result.value;
  }

  /** Fetches exactly the latest message through the existing native client in read-only mode, without changing cursor, flags or background sync. */
  async receiveLatest(context: WorkspaceAuthContext, value: unknown) {
    const owner = this.owner(context);
    if (!this.config.get('IS_IMAP_SMTP_CALDAV_ENABLED'))
      throw new BadRequestException('邮箱连接功能尚未由管理员启用');
    const parsed = z
      .object({
        connectedAccountId: z.string().uuid(),
        folder: z
          .string()
          .min(1)
          .max(1024)
          .regex(/^[^\x00-\x1f\x7f]+$/)
          .default('INBOX'),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success)
      throw new BadRequestException('请选择本人邮箱与有效文件夹');
    const account = await this.account(owner, parsed.data.connectedAccountId);
    await this.uploads.assertUploadPermission(owner);
    await this.records.list(owner, 'recruitingMailArchive', { limit: 1 });
    let client: ImapFlow | undefined;
    let lock: { release: () => void } | undefined;
    let event: ImapRawMessageEvent;
    try {
      client = await this.nativeImap.getClient(account.id);
      lock = await client.getMailboxLock(parsed.data.folder, {
        readOnly: true,
      });
      const latest = await client.fetchOne(
        '*',
        { uid: true, size: true },
        { uid: false },
      );
      if (!latest) throw new BadRequestException('该文件夹没有可读取的邮件');
      if ((latest.size ?? 0) > 50 * 1024 * 1024)
        throw new BadRequestException('最新邮件超过50MB，系统未下载或截断原文');
      const message = await client.fetchOne(
        String(latest.uid),
        { uid: true, source: true, flags: true, internalDate: true },
        { uid: true },
      );
      const mailbox = client.mailbox;
      if (!message || !message.source)
        throw new BadRequestException('该邮件已不存在或无法读取原文');
      if (!mailbox || typeof mailbox === 'boolean' || !mailbox.uidValidity)
        throw new BadRequestException(
          '邮箱没有提供稳定的UIDVALIDITY，原文尚未导入',
        );
      if (message.source.byteLength > 50 * 1024 * 1024)
        throw new BadRequestException('最新邮件超过50MB，未自动展开或截断');
      event = {
        workspaceId: owner.workspace.id,
        userWorkspaceId: owner.userWorkspaceId,
        connectedAccountId: account.id,
        folder: parsed.data.folder,
        uidValidity: mailbox.uidValidity.toString(),
        uid: message.uid,
        source: message.source,
        flags: [...(message.flags ?? [])],
        internalDate: message.internalDate,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        '单封读取未完成，请检查本人邮箱连接、网络与授权后重试',
      );
    } finally {
      lock?.release();
      if (client) await this.nativeImap.closeClient(client);
    }
    return this.accept(owner, event, false);
  }

  /** Unconfigured mailboxes keep their native behavior; configured capture must durably accept originals before import proceeds. */
  @OnEvent(IMAP_RAW_MESSAGE_RECEIVED_EVENT, { suppressErrors: false })
  async capture(event: ImapRawMessageEvent) {
    if (!this.config.get('IS_IMAP_SMTP_CALDAV_ENABLED')) return;
    let context: WorkspaceAuthContext;
    let configuration;
    try {
      context = await this.actors.resolve({
        workspaceId: event.workspaceId,
        userWorkspaceId: event.userWorkspaceId,
      });
      const owner = this.owner(context);
      await this.account(owner, event.connectedAccountId);
      configuration = await this.setting(owner, event.connectedAccountId);
    } catch (error) {
      if (!(error instanceof NotFoundException))
        this.logger.warn(
          'Recruiting mailbox routing is unavailable under current owner permissions',
        );
      return;
    }
    if (!configuration?.enabled) return;
    const payload = configuration.payload as MailboxPayload;
    if (
      payload.actor.userWorkspaceId !== event.userWorkspaceId ||
      payload.actor.workspaceId !== event.workspaceId
    )
      throw new ForbiddenException(
        '招聘收信的原连接所有者已变化，请本人重新确认接入',
      );
    const receivedAt =
      event.internalDate instanceof Date
        ? event.internalDate.getTime()
        : Date.parse(event.internalDate ?? '');
    const boundary = Date.parse(payload.acceptAfter);
    if (!Number.isFinite(receivedAt) || !Number.isFinite(boundary))
      throw new BadRequestException(
        '收信事件缺少稳定接收时间，请邮箱所有者重新确认接入',
      );
    if (receivedAt < boundary) return;
    const authorized = await this.actors.resolve(payload.actor);
    await this.accept(authorized, event, payload.autoSubmit);
  }

  /** Preserves stable event and full-mail business dedupe while making transport authority explicit. */
  private accept(
    context: WorkspaceAuthContext,
    event: ImapRawMessageEvent,
    autoSubmit: boolean,
  ) {
    if (!event.uidValidity)
      throw new BadRequestException('收信事件缺少UIDVALIDITY，请核对原生连接');
    return this.mail.receive(
      context,
      event.source,
      {
        transport: 'IMAP',
        connectedAccountId: event.connectedAccountId,
        folder: event.folder,
        uidValidity: event.uidValidity,
        uid: event.uid,
        flags: event.flags,
        internalDate:
          event.internalDate instanceof Date
            ? event.internalDate.toISOString()
            : event.internalDate,
      },
      autoSubmit,
    );
  }
  /** API keys and delegated agents can process archives but cannot impersonate a native mailbox owner. */
  private owner(context: WorkspaceAuthContext): UserWorkspaceAuthContext {
    if (
      context.type !== 'user' ||
      context.application ||
      context.viaApplication ||
      context.agentId
    )
      throw new ForbiddenException(
        '邮箱连接与单封读取需要邮箱所有者的直接用户会话',
      );
    return context;
  }
  /** Looks up a connection by both workspace and native owner before any credential-bearing provider access. */
  private async account(context: UserWorkspaceAuthContext, id: string) {
    const account = await this.accounts.findOne(context.workspace.id, {
      where: {
        id,
        userWorkspaceId: context.userWorkspaceId,
        provider: ConnectedAccountProvider.IMAP_SMTP_CALDAV,
        archivedAt: IsNull(),
      },
      select: { id: true, handle: true, userWorkspaceId: true },
    });
    if (!account)
      throw new NotFoundException('该原生IMAP连接不存在或不属于当前用户');
    return account;
  }
  /** Missing configuration means capture is off, without granting a system identity. */
  private async setting(context: WorkspaceAuthContext, accountId: string) {
    try {
      return await this.records.one(
        context,
        'recruitingMailbox',
        this.id(context.workspace.id, accountId),
      );
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
  /** Keeps one opt-in record per workspace connection, independent from mailbox flags and cursors. */
  private id(workspaceId: string, accountId: string) {
    return v5(`${workspaceId}:mailbox:${accountId}`, v5.URL);
  }
}
