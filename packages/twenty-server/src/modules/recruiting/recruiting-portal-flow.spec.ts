/** Exercises scoped portal, consent and file actions together without browser cookies, model calls or external messaging. */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import { type RecruitingActorService } from './recruiting-actor.service';
import { type RecruitingUploadService } from './recruiting-upload.service';
import { type RecruitingParserService } from './recruiting-parser.service';
import { type RecruitingIntakeService } from './recruiting-intake.service';
import { type RecruitingMatchingService } from './recruiting-matching.service';
import { RecruitingShareConsentService } from './recruiting-share-consent.service';
import { RecruitingPortalService } from './recruiting-portal.service';
import { RecruitingPortalActionsService } from './recruiting-portal-actions.service';
import {
  recruitingEnvelopeKey,
  sealRecruitingRecord,
  verifyRecruitingRecord,
} from './domain/record-integrity';

const workspaceId = '9306b819-c040-40db-b6e2-e7be28e98e5b';
const ownerId = '8a0578bb-ff1c-4b3e-b4f9-40aa6fa65a33';
const candidateId = '16b80e6d-b2f9-44a6-bfac-5f8a644dc280';
const jobId = '1ed4c476-3cab-48c0-8621-8d2a65d3110c';
const companyId = '6b7a5c24-ec65-4dab-815c-3b5169fdddee';
const fileId = 'a65c4998-9ff9-4aa4-8c93-4177f790603b';
const uploadedId = '6d9e79ab-c908-428e-876c-5bd3acb42f18';
const context = {
  type: 'user',
  workspace: { id: workspaceId },
  userWorkspaceId: ownerId,
} as WorkspaceAuthContext;
const actor = { workspaceId, userWorkspaceId: ownerId };
const secret = 'synthetic-portal-test-secret';
const tokenOf = (url: string) =>
  new URLSearchParams(new URL(url).hash.slice(1)).get('access')!;

/** Native-like storage seals internal rows and rejects generic-CRUD tampering before domain code runs. */
const setup = () => {
  const candidate = {
    id: candidateId,
    name: { firstName: '合成候选人' },
    contactRoles: ['CANDIDATE'],
    recruitingProfile: {
      summary: '后端开发',
      skills: ['Go'],
      sourceText: 'private inbox raw',
    },
    candidateServiceNotes: 'private operator note',
    candidateResumes: [{ fileId, label: 'cv.pdf', url: 'private native URL' }],
  };
  const rows = new Map<string, Record<string, unknown>>([
    [`person:${candidateId}`, candidate],
    [
      `company:${companyId}`,
      {
        id: companyId,
        name: '合成公司',
        recruitmentStatus: 'ACTIVE',
        recruitmentPreferences: { markdown: 'private hiring notes' },
      },
    ],
    [
      `recruitmentJob:${jobId}`,
      {
        id: jobId,
        name: '后端工程师',
        companyId,
        jobStatus: 'RECRUITING',
        jobDescription: { markdown: '维护Go服务' },
      },
    ],
  ]);
  const records = {
    one: jest.fn(async (_context, object: string, id: string) => {
      const value = rows.get(`${object}:${id}`);
      if (
        !value ||
        (recruitingEnvelopeKey(object) &&
          !verifyRecruitingRecord(workspaceId, object, value, secret))
      )
        throw new NotFoundException();
      return structuredClone(value);
    }),
    create: jest.fn(
      async (
        _context,
        object: string,
        data: Record<string, unknown> & { id: string },
      ) => {
        const value = sealRecruitingRecord(workspaceId, object, data, secret);
        rows.set(`${object}:${data.id}`, value);
        return structuredClone(value);
      },
    ),
    update: jest.fn(
      async (
        _context,
        object: string,
        id: string,
        patch: Record<string, unknown>,
      ) => {
        const value = sealRecruitingRecord(
          workspaceId,
          object,
          { ...rows.get(`${object}:${id}`), ...structuredClone(patch) },
          secret,
        );
        rows.set(`${object}:${id}`, value);
        return structuredClone(value);
      },
    ),
  };
  const actors = {
    capture: jest.fn((value: WorkspaceAuthContext) =>
      value.type === 'user'
        ? {
            workspaceId: value.workspace.id,
            userWorkspaceId: value.userWorkspaceId,
          }
        : actor,
    ),
    resolve: jest.fn(async (_actor: { userWorkspaceId?: string }) => context),
  };
  const config = {
    get: (key: string) =>
      key === 'APP_SECRET' ? secret : 'http://localhost:23000',
  };
  const locks = {
    tryWithLock: async (_key: string, callback: () => Promise<unknown>) => ({
      acquired: true,
      value: await callback(),
    }),
  };
  const cache = {
    setIfAbsent: jest.fn(async () => true),
    incrBy: jest.fn(async () => 1),
  };
  const consents = new RecruitingShareConsentService(
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
  );
  const portals = new RecruitingPortalService(
    records as unknown as RecruitingRecordsService,
    actors as unknown as RecruitingActorService,
    consents,
    config as unknown as TwentyConfigService,
    locks as unknown as PostgresAdvisoryLockService,
    cache as unknown as CacheStorageService,
  );
  const uploads = {
    target: jest.fn(async () => ({
      fileId: uploadedId,
      uploadUrl: 'https://storage.example.test/upload',
      contentType: 'application/pdf',
      uploadReceipt: 'owner-bound-proof',
    })),
    complete: jest.fn(async () => ({ fileId: uploadedId })),
    fromPortalInvitation: jest.fn(
      async (_context, inviteId: string, ids: string[]) => {
        const payload = rows.get(`recruitingPortalInvite:${inviteId}`)!
          .payload as {
          uploads: { fileId: string; label: string; completed?: boolean }[];
        };
        return ids.map((id) => {
          const file = payload.uploads.find(
            (entry) => entry.fileId === id && entry.completed,
          );
          if (!file) throw new ForbiddenException();
          return {
            fileId: id,
            label: file.label,
            uploadReceipt: 'renewed-proof',
            role: 'primary',
          };
        });
      },
    ),
  };
  const parser = {
    original: jest.fn(async () => Buffer.from('synthetic CV bytes')),
  };
  const intakes = {
    submit: jest.fn(async () => ({
      intakeId: '349f052a-2d01-421a-80d1-14c21e13eb70',
      state: 'READY',
      stage: 'QUEUED',
    })),
  };
  const matching = { submitForRecord: jest.fn() };
  const actions = new RecruitingPortalActionsService(
    portals,
    consents,
    records as unknown as RecruitingRecordsService,
    uploads as unknown as RecruitingUploadService,
    parser as unknown as RecruitingParserService,
    intakes as unknown as RecruitingIntakeService,
    matching as unknown as RecruitingMatchingService,
  );
  return {
    rows,
    records,
    actors,
    portals,
    consents,
    actions,
    uploads,
    intakes,
  };
};

it('binds company access to consent and keeps old links dead after withdrawal and reconfirmation', async () => {
  const { portals, actions } = setup();
  const candidateLink = await portals.create(context, {
    kind: 'CANDIDATE',
    candidateId,
    jobIds: [jobId],
    idempotencyKey: 'candidate',
  });
  const token = tokenOf(candidateLink.url);
  await expect(
    portals.create(context, {
      kind: 'COMPANY',
      candidateId,
      jobIds: [jobId],
      idempotencyKey: 'before-consent',
    }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await actions.execute({
    token,
    action: 'consent',
    jobId,
    choice: 'CONFIRM',
    fileIds: [fileId],
  });
  const companyLink = await portals.create(context, {
    kind: 'COMPANY',
    candidateId,
    jobIds: [jobId],
    idempotencyKey: 'company',
  });
  const companyToken = tokenOf(companyLink.url);
  const view = await actions.execute({ token: companyToken, action: 'view' });
  expect(JSON.stringify(view)).not.toContain('private');
  await expect(
    actions.execute({
      token: companyToken,
      action: 'profile_save',
      profile: {},
    }),
  ).rejects.toBeDefined();
  await actions.execute({
    token,
    action: 'consent',
    jobId,
    choice: 'WITHDRAW',
  });
  await expect(
    actions.execute({ token: companyToken, action: 'download', fileId }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await actions.execute({
    token,
    action: 'consent',
    jobId,
    choice: 'CONFIRM',
    fileIds: [fileId],
  });
  await expect(
    actions.execute({ token: companyToken, action: 'view' }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const renewed = await portals.create(context, {
    kind: 'COMPANY',
    candidateId,
    jobIds: [jobId],
    idempotencyKey: 'company-new-grant',
  });
  await actions.execute({ token: tokenOf(renewed.url), action: 'view' });
  await portals.revoke(context, candidateLink.inviteId);
  await expect(
    actions.execute({ token: tokenOf(renewed.url), action: 'view' }),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

it('rejects foreign jobs/files, native-row tampering and link copying by another principal', async () => {
  const { portals, actions, rows } = setup();
  const link = await portals.create(context, {
    kind: 'CANDIDATE',
    candidateId,
    jobIds: [jobId],
    idempotencyKey: 'scope',
  });
  const token = tokenOf(link.url);
  await expect(
    actions.execute({ token, action: 'download', fileId: uploadedId }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    actions.execute({
      token,
      action: 'consent',
      jobId: companyId,
      choice: 'WITHDRAW',
    }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    portals.copyLink(
      { ...context, userWorkspaceId: companyId } as WorkspaceAuthContext,
      link.inviteId,
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const row = rows.get(`recruitingPortalInvite:${link.inviteId}`)!;
  row.candidateId = companyId;
  await expect(
    actions.execute({ token, action: 'view' }),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

it('rechecks the original candidate-link principal even when another operator created the company link', async () => {
  const { portals, actions, actors } = setup();
  const candidateLink = await portals.create(context, {
    kind: 'CANDIDATE',
    candidateId,
    jobIds: [jobId],
    idempotencyKey: 'origin',
  });
  await actions.execute({
    token: tokenOf(candidateLink.url),
    action: 'consent',
    jobId,
    choice: 'CONFIRM',
    fileIds: [fileId],
  });
  const other = {
    ...context,
    userWorkspaceId: companyId,
  } as WorkspaceAuthContext;
  const companyLink = await portals.create(other, {
    kind: 'COMPANY',
    candidateId,
    jobIds: [jobId],
    idempotencyKey: 'other-operator',
  });
  actors.resolve.mockImplementation(async (value) => {
    if (value.userWorkspaceId === ownerId) throw new ForbiddenException();
    return other;
  });
  await expect(
    actions.execute({ token: tokenOf(companyLink.url), action: 'view' }),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

it('keeps anonymous uploads inside one invitation and routes completed files through the shared intake', async () => {
  const { portals, actions, uploads, intakes } = setup();
  const link = await portals.create(context, {
    kind: 'CANDIDATE',
    candidateId,
    idempotencyKey: 'upload',
  });
  const token = tokenOf(link.url);
  await expect(
    actions.execute({ token, action: 'upload_complete', fileId }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const target = await actions.execute({
    token,
    action: 'upload_target',
    filename: 'updated.pdf',
    size: 100,
  });
  expect(JSON.stringify(target)).not.toContain('owner-bound-proof');
  await actions.execute({
    token,
    action: 'upload_complete',
    fileId: uploadedId,
  });
  expect(uploads.complete).toHaveBeenCalledTimes(1);
  await actions.execute({
    token,
    action: 'resume_submit',
    fileIds: [uploadedId],
    note: 'Optional candidate statement',
    idempotencyKey: 'resume',
  });
  expect(intakes.submit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      candidateId,
      note: 'Optional candidate statement',
    }),
  );
});
