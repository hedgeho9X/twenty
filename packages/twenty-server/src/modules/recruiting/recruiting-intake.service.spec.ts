/** Rejects ordinary contacts before parsing, task creation or paid extraction can make a misleading successful intake. */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecruitingIntakeService } from './recruiting-intake.service';

it('requires an existing candidate role when the API explicitly targets a person', async () => {
  const records = {
    one: jest.fn(async () => ({ contactRoles: ['CLIENT'] })),
    create: jest.fn(),
  };
  const parser = { file: jest.fn() };
  const uploads = { authorize: jest.fn() };
  const service = new RecruitingIntakeService(
    records as never,
    { capture: () => ({ workspaceId: 'workspace' }) } as never,
    parser as never,
    {} as never,
    {} as never,
    uploads as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    service.submit({ workspace: { id: 'workspace' } } as WorkspaceAuthContext, {
      kind: 'CANDIDATE',
      source: 'api',
      idempotencyKey: 'ordinary-contact-target',
      candidateId: '00000000-0000-4000-8000-000000000001',
      files: [
        {
          fileId: '00000000-0000-4000-8000-000000000002',
          label: 'resume.txt',
          role: 'primary',
          uploadReceipt: 'synthetic',
        },
      ],
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(records.one).toHaveBeenCalledTimes(1);
  expect(parser.file).not.toHaveBeenCalled();
  expect(records.create).not.toHaveBeenCalled();
});

it('stops after inference when queued API authority expires or is revoked, including failure-state writes', async () => {
  let revoked = false;
  const context = {
    type: 'apiKey',
    workspace: { id: 'workspace' },
  } as WorkspaceAuthContext;
  const actor = { workspaceId: 'workspace', apiKeyId: 'key' };
  const actors = {
    resolve: jest.fn(async () => {
      if (revoked) throw new ForbiddenException('任务的 API 授权已失效');
      return context;
    }),
  };
  const records = {
    one: jest.fn(async () => ({
      id: 'intake',
      state: 'READY',
      result: {
        schemaVersion: 2,
        actor,
        inputHash: 'synthetic',
        stage: 'QUEUED',
        input: {
          kind: 'CANDIDATE',
          source: 'api',
          files: [{ fileId: 'file', label: 'resume.txt', role: 'primary' }],
        },
      },
    })),
    update: jest.fn(async (_context, _object, _id, patch) => patch),
    create: jest.fn(),
  };
  const parser = {
    parse: jest.fn(async () => ({
      fileId: 'file',
      text: 'synthetic career material',
      status: 'complete',
    })),
    copyResumeAttachment: jest.fn(),
  };
  const extractor = {
    candidate: jest.fn(async () => {
      revoked = true;
      return { profile: {}, modelId: 'synthetic' };
    }),
  };
  const candidates = { replaceProfile: jest.fn() };
  const service = new RecruitingIntakeService(
    records as never,
    actors as never,
    parser as never,
    extractor as never,
    {} as never,
    {} as never,
    {} as never,
    candidates as never,
    {} as never,
  );
  await expect(
    service.process({ intakeId: 'intake', actor }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(extractor.candidate).toHaveBeenCalledTimes(1);
  expect(records.update.mock.calls.map((call) => call[3].result.stage)).toEqual(
    ['PARSING', 'PARSING', 'EXTRACTING'],
  );
  expect(parser.copyResumeAttachment).not.toHaveBeenCalled();
  expect(candidates.replaceProfile).not.toHaveBeenCalled();
  expect(records.create).not.toHaveBeenCalled();
});
