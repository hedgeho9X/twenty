/** Wraps native file lifecycle with a recruiting-specific submission capability; it does not proxy storage. */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PermissionFlagType } from 'twenty-shared/constants';
import { FileFolder } from 'twenty-shared/types';
import { z } from 'zod';
import { Readable } from 'node:stream';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { FileUploadService } from 'src/engine/core-modules/file/file-upload/services/file-upload.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { RecruitingActorService } from './recruiting-actor.service';
import { RecruitingRecordsService } from './recruiting-records.service';
import { contentVersion } from './domain/match-context';
import { RECRUITING_MAIL_FILE_LAYOUT } from './domain/mail-file-layout';
import {
  signRecruitingUploadReceipt,
  verifyRecruitingUploadReceipt,
} from './domain/upload-receipt';

const targetSchema = z
  .object({
    filename: z.string().min(1).max(512),
    size: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
  })
  .strict();

@Injectable()
/** Prevents an arbitrary same-workspace file ID from becoming access to a restricted source document. */
export class RecruitingUploadService {
  constructor(
    private readonly nativeUploads: FileUploadService,
    private readonly actors: RecruitingActorService,
    private readonly permissions: PermissionsService,
    private readonly workspaceCache: WorkspaceCacheService,
    private readonly config: TwentyConfigService,
    private readonly records: RecruitingRecordsService,
  ) {}

  /** Rebinds only signed archive-owned artifacts after the caller can read that parent, never arbitrary file IDs. */
  async fromMailArchive(
    context: WorkspaceAuthContext,
    archiveId: string,
    keys: string[],
    bindingKey?: string,
  ) {
    const archive = await this.records.one(
      context,
      'recruitingMailArchive',
      archiveId,
    );
    const payload = archive.payload as {
      artifacts: { key: string; fileId: string; label: string }[];
      intakeCopies?: Record<
        string,
        { key: string; fileId: string; label: string }[]
      >;
    };
    const principal = await this.assertUploadPermission(context);
    return keys.map((key) => {
      const source = payload.artifacts.find((entry) => entry.key === key);
      const file = bindingKey
        ? payload.intakeCopies?.[bindingKey]?.find((entry) => entry.key === key)
        : source;
      if (!source || !file)
        throw new BadRequestException('所选材料不属于这封归档邮件');
      return {
        fileId: file.fileId,
        label: file.label,
        role: 'primary' as const,
        uploadReceipt: signRecruitingUploadReceipt(
          {
            version: 1,
            workspaceId: context.workspace.id,
            principalHash: contentVersion(principal),
            fileId: file.fileId,
            label: file.label,
            expiresAt: Date.now() + 24 * 60 * 60_000,
          },
          this.config.get('APP_SECRET'),
        ),
      };
    });
  }

  /** Renews only completed uploads bound to a readable signed portal invitation, never caller-supplied foreign file IDs. */
  async fromPortalInvitation(
    context: WorkspaceAuthContext,
    inviteId: string,
    fileIds: string[],
  ) {
    const invite = await this.records.one(
      context,
      'recruitingPortalInvite',
      inviteId,
    );
    const payload = invite.payload as {
      uploads: { fileId: string; label: string; completed?: boolean }[];
    };
    const principal = await this.assertUploadPermission(context);
    return fileIds.map((id) => {
      const file = payload.uploads.find(
        (entry) => entry.fileId === id && entry.completed,
      );
      if (!file)
        throw new BadRequestException('文件不属于此候选人入口或尚未完成上传');
      return {
        fileId: file.fileId,
        label: file.label,
        role: 'primary' as const,
        uploadReceipt: signRecruitingUploadReceipt(
          {
            version: 1,
            workspaceId: context.workspace.id,
            principalHash: contentVersion(principal),
            fileId: file.fileId,
            label: file.label,
            expiresAt: Date.now() + 24 * 60 * 60_000,
          },
          this.config.get('APP_SECRET'),
        ),
      };
    });
  }

  /** Keeps single-request uploads on native quarantine, MIME detection and immutable completion. */
  async buffer(
    context: WorkspaceAuthContext,
    file: { buffer: Buffer; originalname: string },
  ) {
    const target = await this.target(context, {
      filename: file.originalname,
      size: file.buffer.byteLength,
    });
    await this.nativeUploads.receiveFileStream({
      workspaceId: context.workspace.id,
      fileId: target.fileId,
      stream: Readable.from(file.buffer),
    });
    return this.complete(context, { uploadReceipt: target.uploadReceipt });
  }

  /** Uploads canonical bytes directly into one fixed archive ownership slot, without creating an intake-owned original. */
  async bufferForMailArchive(
    context: WorkspaceAuthContext,
    file: { buffer: Buffer; originalname: string },
    fieldName: string,
  ) {
    if (!RECRUITING_MAIL_FILE_LAYOUT.fields.includes(fieldName))
      throw new BadRequestException('邮件原件字段无效');
    const target = await this.targetForField(
      context,
      { filename: file.originalname, size: file.buffer.byteLength },
      'recruitingMailArchive',
      fieldName,
    );
    await this.nativeUploads.receiveFileStream({
      workspaceId: context.workspace.id,
      fileId: target.fileId,
      stream: Readable.from(file.buffer),
    });
    return this.complete(context, { uploadReceipt: target.uploadReceipt });
  }

  /** Creates a new file in the intake field partition under the native upload permission flag. */
  async target(context: WorkspaceAuthContext, value: unknown) {
    return this.targetForField(context, value, 'recruitingIntake', 'files');
  }

  /** Resolves an internal object field; public upload targets remain restricted to intake files. */
  private async targetForField(
    context: WorkspaceAuthContext,
    value: unknown,
    objectName: string,
    fieldName: string,
  ) {
    const parsed = targetSchema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(
        '请提供有效的文件名和大小，单个文件最大 50MB',
      );
    const principal = await this.assertUploadPermission(context);
    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.workspaceCache.getOrRecompute(context.workspace.id, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
      ]);
    const object = Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).find((entry) => entry?.nameSingular === objectName);
    const field = Object.values(
      flatFieldMetadataMaps.byUniversalIdentifier,
    ).find(
      (entry) =>
        entry?.objectMetadataId === object?.id && entry?.name === fieldName,
    );
    if (!field) throw new BadRequestException('招聘上传字段尚未配置');
    const target = await this.nativeUploads.createFileUpload({
      workspaceId: context.workspace.id,
      filename: parsed.data.filename,
      size: parsed.data.size,
      fileFolder: FileFolder.FilesField,
      fieldMetadataId: field.id,
    });
    const uploadReceipt = signRecruitingUploadReceipt(
      {
        version: 1,
        workspaceId: context.workspace.id,
        principalHash: contentVersion(principal),
        fileId: target.fileId,
        label: parsed.data.filename,
        expiresAt: Date.now() + 24 * 60 * 60_000,
      },
      this.config.get('APP_SECRET'),
    );
    return { ...target, uploadReceipt };
  }

  /** Finalizes the claimed file through native quarantine checks and returns the shared intake reference. */
  async complete(context: WorkspaceAuthContext, value: unknown) {
    const parsed = z
      .object({ uploadReceipt: z.string().max(4096) })
      .strict()
      .safeParse(value);
    if (!parsed.success) throw new BadRequestException('缺少上传提交凭据');
    await this.assertUploadPermission(context);
    const receipt = this.receipt(context, parsed.data.uploadReceipt);
    const completed = await this.nativeUploads.completeFileUpload({
      workspaceId: context.workspace.id,
      fileId: receipt.fileId,
    });
    return {
      fileId: completed.id,
      label: receipt.label,
      role: 'primary' as const,
      uploadReceipt: parsed.data.uploadReceipt,
    };
  }

  /** Validates new caller-supplied refs before intake persistence; stored intake retries rely on native record access. */
  authorize(
    context: WorkspaceAuthContext,
    file: { fileId: string; label: string; uploadReceipt?: string },
  ) {
    if (!file.uploadReceipt)
      throw new BadRequestException(
        '请从招聘上传入口上传材料，不能直接引用未经授权的文件 ID',
      );
    const receipt = this.receipt(context, file.uploadReceipt);
    if (receipt.fileId !== file.fileId || receipt.label !== file.label)
      throw new BadRequestException('文件引用与上传提交凭据不一致');
  }

  /** Uses the same stable principal references as queued work, including application/agent narrowing. */
  private receipt(context: WorkspaceAuthContext, token: string) {
    try {
      return verifyRecruitingUploadReceipt(
        token,
        {
          workspaceId: context.workspace.id,
          principalHash: contentVersion(this.actors.capture(context)),
        },
        this.config.get('APP_SECRET'),
      );
    } catch {
      throw new BadRequestException('上传提交凭据无效或已过期，请重新上传材料');
    }
  }

  /** Preserves official permission checks and intersects a delegated application's upload permission. */
  async assertUploadPermission(context: WorkspaceAuthContext) {
    const principal = this.actors.capture(context);
    const applicationIds: (string | undefined)[] = [principal.applicationId];
    if (
      principal.viaApplicationId &&
      principal.viaApplicationId !== principal.applicationId
    )
      applicationIds.push(principal.viaApplicationId);
    for (const applicationId of applicationIds) {
      const allowed = await this.permissions.userHasWorkspaceSettingPermission({
        workspaceId: principal.workspaceId,
        userWorkspaceId: principal.userWorkspaceId,
        apiKeyId: principal.apiKeyId,
        applicationId,
        agentId: principal.agentId,
        setting: PermissionFlagType.UPLOAD_FILE,
      });
      if (!allowed) throw new ForbiddenException('当前账号没有上传材料的权限');
    }
    return principal;
  }
}
