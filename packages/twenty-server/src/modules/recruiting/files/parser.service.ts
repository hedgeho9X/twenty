/** Sends verified native uploads to the shared parser and reads only declared preview artifacts. */
import { Injectable, BadRequestException } from '@nestjs/common';

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { FileFolder } from 'twenty-shared/types';

import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { FileService } from 'src/engine/core-modules/file/services/file.service';
import { FilesFieldService } from 'src/engine/core-modules/file/files-field/services/files-field.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type RecruitingActor } from '../auth/actor.service';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

const parsedSchema = z.object({
  parserVersion: z.string(),
  sourceHash: z.string(),
  format: z.string(),
  status: z.enum(['complete', 'partial', 'needs_review']),
  text: z.string(),
  pages: z.number(),
  previews: z.array(z.string().regex(/^page-\d+\.png$/)),
  coverage: z.string(),
  missingResources: z.number().optional(),
});

/** An artifact reference is server-generated and never accepts an arbitrary preview path. */
export type ParsedRecruitingMaterial = z.infer<typeof parsedSchema> & {
  requestId: string;
  fileId: string;
  label: string;
};

@Injectable()
/** Shares one Docling model process across the ten ingestion jobs. */
export class RecruitingParserService {
  constructor(
    @InjectWorkspaceScopedRepository(FileEntity)
    private readonly fileRepository: WorkspaceScopedRepository<FileEntity>,
    private readonly config: TwentyConfigService,
    private readonly fileService: FileService,
    private readonly filesFieldService: FilesFieldService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  /** Copies attachments into the candidate field partition through the native file lifecycle. */
  async copyResumeAttachment(actor: RecruitingActor, fileId: string) {
    await this.file(actor, fileId);
    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.workspaceCacheService.getOrRecompute(actor.workspaceId, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
      ]);
    const person = Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).find((object) => object?.nameSingular === 'person');
    const field = Object.values(
      flatFieldMetadataMaps.byUniversalIdentifier,
    ).find(
      (entry) =>
        entry?.objectMetadataId === person?.id &&
        entry?.name === 'candidateResumes',
    );
    if (!field) throw new BadRequestException('候选人简历字段尚未配置');
    return this.filesFieldService.copyFileIntoFilesField({
      fileId,
      workspaceId: actor.workspaceId,
      fieldMetadataId: field.id,
    });
  }

  /** Rejects unfinished, deleted, foreign-workspace and static application files. */
  async file(actor: RecruitingActor, fileId: string): Promise<FileEntity> {
    const file = await this.fileRepository.findOne(actor.workspaceId, {
      where: { id: fileId },
    });
    if (
      !file ||
      file.status !== 'UPLOADED' ||
      file.isStaticAsset ||
      file.size > 50 * 1024 * 1024
    ) {
      throw new BadRequestException('文件不存在、尚未上传完成或当前无权使用');
    }
    return file;
  }

  /** Parses immutable archive bytes and preserves an explicit partial/needs-review outcome. */
  async parse(
    actor: RecruitingActor,
    fileId: string,
    label: string,
  ): Promise<ParsedRecruitingMaterial> {
    const bytes = await this.original(actor, fileId);
    return this.parseBytes(actor, fileId, label, bytes);
  }

  /** Reads only a completed native archive attachment after its parent business record has authorized the reference. */
  async original(actor: RecruitingActor, fileId: string) {
    await this.file(actor, fileId);
    const original = await this.fileService.getFileStreamById({
      fileId,
      workspaceId: actor.workspaceId,
      allowedFileFolders: [
        FileFolder.FilesField,
        FileFolder.EmailAttachment,
        FileFolder.EmailImage,
      ],
    });
    if (!original) throw new BadRequestException('无法读取原始材料');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of original.stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 50 * 1024 * 1024)
        throw new BadRequestException('材料超过 50MB');
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    return bytes;
  }

  /** Keeps archive-byte access independent from document conversion and screenshot generation. */
  private async parseBytes(
    actor: RecruitingActor,
    fileId: string,
    label: string,
    bytes: Buffer,
  ): Promise<ParsedRecruitingMaterial> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const requestId = randomUUID();
    const root = resolve(this.config.get('STORAGE_LOCAL_PATH'));
    const storageKey = `_recruiting-input/${actor.workspaceId}/${requestId}`;
    await mkdir(dirname(join(root, storageKey)), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(join(root, storageKey), bytes, { mode: 0o600, flag: 'wx' });
    const response = await fetch(
      `${process.env.RECRUITING_PARSER_URL ?? 'http://127.0.0.1:23003'}/parse`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.RECRUITING_PARSER_TOKEN ?? ''}`,
        },
        body: JSON.stringify({
          requestId,
          storageKey,
          originalName: label,
          sha256: hash,
        }),
        signal: AbortSignal.timeout(180_000),
      },
    );
    if (!response.ok)
      throw new BadRequestException(
        '材料无法自动解析，请检查格式、加密或文件内容',
      );
    const parsed = parsedSchema.parse(await response.json());
    if (parsed.sourceHash !== hash || parsed.pages !== parsed.previews.length)
      throw new BadRequestException('解析材料的完整性校验失败');
    return { ...parsed, requestId, fileId, label };
  }

  /** Returns only manifest-listed images from this material's isolated output directory. */
  async preview(
    material: ParsedRecruitingMaterial,
    name: string,
  ): Promise<Uint8Array> {
    if (!material.previews.includes(name) || !/^page-\d+\.png$/.test(name))
      throw new BadRequestException('预览不存在');
    const root =
      process.env.RECRUITING_PARSER_OUTPUT_ROOT ??
      join(
        dirname(resolve(this.config.get('STORAGE_LOCAL_PATH'))),
        'parser-output',
      );
    return readFile(join(root, material.requestId, name));
  }
}
