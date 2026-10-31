/** Resolves uploaded AgentChat attachments, inlining bounded images so private local file URLs never reach a model provider. */
import { Injectable } from '@nestjs/common';

import { type ModelMessage } from 'ai';
import { type RunAgentMessage } from 'twenty-shared/application';
import { FileFolder } from 'twenty-shared/types';
import { isNonEmptyArray } from 'twenty-shared/utils';
import { In, Like } from 'typeorm';

import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { FileUrlService } from 'src/engine/core-modules/file/file-url/file-url.service';
import { FileService } from 'src/engine/core-modules/file/services/file.service';
import {
  AiException,
  AiExceptionCode,
} from 'src/engine/metadata-modules/ai/ai.exception';
import { FILE_STATUS } from 'src/engine/core-modules/file/types/file-status.type';
import { type ResolvedRunAgentAttachment } from 'src/engine/metadata-modules/ai/ai-agent-execution/types/resolved-run-agent-attachment.type';
import { buildRunAgentModelMessageOrThrow } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/build-run-agent-model-message.util';
import { extractRunAgentAttachmentFileIdsOrThrow } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/extract-run-agent-attachment-file-ids.util';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

@Injectable()
/** Keeps the native workspace/folder upload boundary while preparing provider-compatible messages. */
export class RunAgentAttachmentService {
  constructor(
    @InjectWorkspaceScopedRepository(FileEntity)
    private readonly fileRepository: WorkspaceScopedRepository<FileEntity>,
    private readonly fileUrlService: FileUrlService,
    private readonly fileService: FileService,
  ) {}

  /** Resolves only message-referenced files and preserves the model's supported-media check. */
  async buildModelMessagesOrThrow({
    messages,
    workspaceId,
    modalities,
  }: {
    messages: RunAgentMessage[];
    workspaceId: string;
    modalities: string[] | undefined;
  }): Promise<ModelMessage[]> {
    const fileIds = extractRunAgentAttachmentFileIdsOrThrow(messages);

    const attachmentsByFileId = isNonEmptyArray(fileIds)
      ? await this.resolveAttachments({ fileIds, workspaceId })
      : new Map<string, ResolvedRunAgentAttachment>();

    return messages.map((message) =>
      buildRunAgentModelMessageOrThrow({
        message,
        attachmentsByFileId,
        modalities,
      }),
    );
  }

  /** Enforces native upload state and total image size before allocating attachment buffers. */
  private async resolveAttachments({
    fileIds,
    workspaceId,
  }: {
    fileIds: string[];
    workspaceId: string;
  }): Promise<Map<string, ResolvedRunAgentAttachment>> {
    const files = await this.fileRepository.find(workspaceId, {
      where: {
        id: In(fileIds),
        path: Like(`${FileFolder.AgentChat}/%`),
        status: FILE_STATUS.UPLOADED,
      },
    });

    const images = files.filter((file) => file.mimeType.startsWith('image/'));
    if (
      images.some((file) => Number(file.size) > 20 * 1024 * 1024) ||
      images.reduce((sum, file) => sum + Number(file.size), 0) >
        50 * 1024 * 1024
    )
      throw new AiException(
        'Image attachments exceed the 20MB per file or 50MB total limit',
        AiExceptionCode.INVALID_AGENT_INPUT,
      );
    const resolvedEntries = await Promise.all(
      files.map(
        async (file): Promise<[string, ResolvedRunAgentAttachment]> => [
          file.id,
          {
            mediaType: file.mimeType,
            url: file.mimeType.startsWith('image/')
              ? await this.imageData(file, workspaceId)
              : await this.fileUrlService.signFileByIdUrl({
                  fileId: file.id,
                  workspaceId,
                  fileFolder: FileFolder.AgentChat,
                }),
          },
        ],
      ),
    );

    return new Map(resolvedEntries);
  }

  /** Reads only prevalidated uploaded AgentChat files; actual bytes are bounded independently from declared size. */
  private async imageData(file: FileEntity, workspaceId: string) {
    const original = await this.fileService.getFileStreamById({
      fileId: file.id,
      workspaceId,
      allowedFileFolders: [FileFolder.AgentChat],
    });
    if (!original)
      throw new AiException(
        'Image attachment is unavailable',
        AiExceptionCode.INVALID_AGENT_INPUT,
      );
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of original.stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 20 * 1024 * 1024) {
        original.stream.destroy();
        throw new AiException(
          'Image attachment exceeds 20MB',
          AiExceptionCode.INVALID_AGENT_INPUT,
        );
      }
      chunks.push(bytes);
    }
    return `data:${file.mimeType};base64,${Buffer.concat(chunks).toString('base64')}`;
  }
}
