/** Keeps canonical MIME resources on their archive and creates resumable, independently owned intake copies. */
import { BadRequestException, Injectable } from '@nestjs/common';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { FilesFieldService } from 'src/engine/core-modules/file/files-field/services/files-field.service';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecruitingRecordsService } from '../records/records.service';
import { RecruitingActorService } from '../auth/actor.service';
import { RecruitingParserService } from '../files/parser.service';
import { RecruitingUploadService } from '../files/upload.service';
import { type MailPayload } from './mail.service';
import { RECRUITING_MAIL_FILE_LAYOUT } from './domain/mail-file-layout';

/** Native references omit readonly URLs and extensions when written back. */
type FileRef = { fileId: string; label: string };

@Injectable()
/** Callers serialize each archive with the existing archive lock; no parsing or model generation occurs here. */
export class RecruitingMailFilesService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
    private readonly cache: WorkspaceCacheService,
    private readonly nativeFiles: FilesFieldService,
    private readonly parser: RecruitingParserService,
    private readonly uploads: RecruitingUploadService,
  ) {}

  /** Allocates new canonical bytes in the next native slot; archive mutation remains serialized by the caller. */
  async upload(
    context: WorkspaceAuthContext,
    id: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    const authorized = await this.actors.resolve(this.actors.capture(context));
    const record = await this.records.one(
      authorized,
      'recruitingMailArchive',
      id,
    );
    const slot = this.availableSlot(record);
    return this.uploads.bufferForMailArchive(authorized, file, slot);
  }

  /** Migrates existing references by native copies; already accepted intakes retain their original files. */
  async ensureCanonicalOwnership(context: WorkspaceAuthContext, id: string) {
    let record = await this.records.one(context, 'recruitingMailArchive', id);
    let payload = record.payload as MailPayload;
    const actor = this.actors.capture(context);
    const slots = Object.fromEntries(
      RECRUITING_MAIL_FILE_LAYOUT.fields.map((name) => [
        name,
        this.references(record[name]),
      ]),
    );
    const owned = Object.values(slots).flat();
    if (owned.length && payload.fileOwnershipVersion !== 1)
      throw new BadRequestException('邮件文件归属尚未核对，请联系管理员');
    const sources = [
      ...(payload.rawFile ? [payload.rawFile] : []),
      ...payload.artifacts,
    ].filter(
      (file, index, all) =>
        all.findIndex((value) => value.fileId === file.fileId) === index,
    );
    for (const source of sources) {
      if (owned.some((file) => file.fileId === source.fileId)) continue;
      let copy = payload.canonicalCopies?.[source.fileId];
      const slot = copy?.fieldName ?? this.availableSlot(slots);
      const field = await this.field(context, 'recruitingMailArchive', slot);
      if (!copy) {
        const authorized = await this.actors.resolve(actor);
        await this.uploads.assertUploadPermission(authorized);
        const original = await this.parser.file(actor, source.fileId);
        const file =
          original.settings?.isTemporaryFile &&
          original.path.includes(field.universalIdentifier)
            ? original
            : await this.nativeFiles.copyFileIntoFilesField({
                fileId: source.fileId,
                workspaceId: authorized.workspace.id,
                fieldMetadataId: field.id,
              });
        copy = { fileId: file.id, label: source.label, fieldName: slot };
        payload = {
          ...payload,
          canonicalCopies: {
            ...payload.canonicalCopies,
            [source.fileId]: copy,
          },
        };
        record = await this.records.update(
          await this.actors.resolve(actor),
          'recruitingMailArchive',
          id,
          { payload },
        );
      }
      if (!owned.some((file) => file.fileId === copy.fileId)) {
        const reference = { fileId: copy.fileId, label: copy.label };
        owned.push(reference);
        slots[slot].push(reference);
      }
      payload = {
        ...payload,
        fileOwnershipVersion: 1,
        ...(payload.rawFile?.fileId === source.fileId
          ? { rawFile: { fileId: copy.fileId, label: copy.label } }
          : {}),
        artifacts: payload.artifacts.map((file) =>
          file.fileId === source.fileId
            ? { ...file, fileId: copy.fileId, label: copy.label }
            : file,
        ),
      };
      record = await this.records.update(
        await this.actors.resolve(actor),
        'recruitingMailArchive',
        id,
        {
          [slot]: slots[slot],
          payload,
        },
      );
    }
    return record;
  }

  /** Rejects exhausted layouts explicitly; no MIME resource is dropped or assigned beyond its native limit. */
  private availableSlot(record: Record<string, unknown>) {
    const slot = RECRUITING_MAIL_FILE_LAYOUT.fields.find(
      (name) =>
        this.references(record[name]).length <
        RECRUITING_MAIL_FILE_LAYOUT.perField,
    );
    if (!slot)
      throw new BadRequestException('邮件原件超过归档容量，完整原文仍已保留');
    return slot;
  }

  /** Removes native readonly display fields before writing canonical file references back. */
  private references(value: unknown): FileRef[] {
    if (!Array.isArray(value)) return [];
    return value.map((file) => ({ fileId: file.fileId, label: file.label }));
  }

  /** Checkpoints every native copy before intake submission so duplicate requests and interrupted submissions reuse identities. */
  async intakeFiles(
    context: WorkspaceAuthContext,
    id: string,
    bindingKey: string,
    keys: string[],
  ) {
    let record = await this.ensureCanonicalOwnership(context, id);
    let payload = record.payload as MailPayload;
    const field = await this.field(context, 'recruitingIntake', 'files');
    const actor = this.actors.capture(context);
    for (const key of keys) {
      if (payload.intakeCopies?.[bindingKey]?.some((file) => file.key === key))
        continue;
      const source = payload.artifacts.find((file) => file.key === key);
      if (!source) throw new BadRequestException('所选材料不属于邮件归档');
      const authorized = await this.actors.resolve(actor);
      await this.uploads.assertUploadPermission(authorized);
      const copy = await this.nativeFiles.copyFileIntoFilesField({
        fileId: source.fileId,
        workspaceId: authorized.workspace.id,
        fieldMetadataId: field.id,
      });
      payload = {
        ...payload,
        intakeCopies: {
          ...payload.intakeCopies,
          [bindingKey]: [
            ...(payload.intakeCopies?.[bindingKey] ?? []),
            { key, fileId: copy.id, label: source.label },
          ],
        },
      };
      record = await this.records.update(
        await this.actors.resolve(actor),
        'recruitingMailArchive',
        id,
        { payload },
      );
    }
    return this.uploads.fromMailArchive(context, id, keys, bindingKey);
  }

  /** Resolves fixed business field identities through native workspace metadata. */
  private async field(
    context: WorkspaceAuthContext,
    objectName: string,
    fieldName: string,
  ) {
    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.cache.getOrRecompute(context.workspace.id, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
      ]);
    const object = Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).find((value) => value?.nameSingular === objectName);
    const field = Object.values(
      flatFieldMetadataMaps.byUniversalIdentifier,
    ).find(
      (value) =>
        value?.objectMetadataId === object?.id && value?.name === fieldName,
    );
    if (!field) throw new BadRequestException('邮件原件字段尚未配置');
    return field;
  }
}
