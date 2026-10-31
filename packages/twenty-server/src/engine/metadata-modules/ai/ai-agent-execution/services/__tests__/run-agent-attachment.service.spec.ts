/** Verifies that local images cross the provider boundary as bytes, preserving native file scope and bounded memory. */
import { Readable } from 'node:stream';
import { RunAgentAttachmentService } from '../run-agent-attachment.service';
import { type FileService } from 'src/engine/core-modules/file/services/file.service';
import { type FileUrlService } from 'src/engine/core-modules/file/file-url/file-url.service';
import { type FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { type WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

/** Supplies a completed native upload without exposing the signed file URL to the model. */
const setup = (size = 3, bytes = Buffer.from('png')) => {
  const repository = {
    find: jest.fn(async () => [{ id: 'file', mimeType: 'image/png', size }]),
  };
  const urls = {
    signFileByIdUrl: jest.fn(
      async () => 'http://localhost/private?token=secret',
    ),
  };
  const storage = {
    getFileStreamById: jest.fn(async () => ({ stream: Readable.from(bytes) })),
  };
  const service = new RunAgentAttachmentService(
    repository as unknown as WorkspaceScopedRepository<FileEntity>,
    urls as unknown as FileUrlService,
    storage as unknown as FileService,
  );
  return { service, repository, urls, storage };
};
it('inlines only the authorized native uploaded image and never signs or sends its private URL', async () => {
  const { service, repository, urls, storage } = setup();
  const messages = await service.buildModelMessagesOrThrow({
    workspaceId: 'workspace',
    modalities: ['image'],
    messages: [
      {
        role: 'user',
        content: 'inspect',
        attachments: [{ fileId: 'file', filename: 'attachment.png' }],
      },
    ],
  });
  expect(JSON.stringify(messages)).toContain('data:image/png;base64,cG5n');
  expect(JSON.stringify(messages)).not.toContain('private');
  expect(urls.signFileByIdUrl).not.toHaveBeenCalled();
  expect(repository.find).toHaveBeenCalledWith('workspace', expect.any(Object));
  expect(storage.getFileStreamById).toHaveBeenCalledWith({
    fileId: 'file',
    workspaceId: 'workspace',
    allowedFileFolders: ['agent-chat'],
  });
});
it('rejects declared oversized images before reading file bytes', async () => {
  const { service, storage } = setup(21 * 1024 * 1024);
  await expect(
    service.buildModelMessagesOrThrow({
      workspaceId: 'workspace',
      modalities: ['image'],
      messages: [
        { role: 'user', content: 'inspect', attachments: [{ fileId: 'file' }] },
      ],
    }),
  ).rejects.toThrow('20MB');
  expect(storage.getFileStreamById).not.toHaveBeenCalled();
});
it('rejects actual oversized bytes even if stored size is stale', async () => {
  const { service } = setup(3, Buffer.alloc(21 * 1024 * 1024));
  await expect(
    service.buildModelMessagesOrThrow({
      workspaceId: 'workspace',
      modalities: ['image'],
      messages: [
        { role: 'user', content: 'inspect', attachments: [{ fileId: 'file' }] },
      ],
    }),
  ).rejects.toThrow('20MB');
});
