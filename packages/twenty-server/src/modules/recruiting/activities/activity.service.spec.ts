/** Tests human-only assertions, idempotent history and integrity after ordinary native CRM edits. */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RecruitingActivityService } from './activity.service';
import { type RecruitingRecordsService } from '../records/records.service';
import { type RecruitingActorService } from '../auth/actor.service';
import { type RecruitingDraftsService } from '../drafts/drafts.service';
import { type RecruitingShareConsentService } from '../portal/share-consent.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';

const candidateId = '970e3547-46b8-41a7-bd6a-8ed4d3498ebe';
const jobId = '9db3115c-0714-45da-bfdd-1088e42c859d';
const context = {
  type: 'user',
  workspace: { id: 'workspace' },
} as WorkspaceAuthContext;
/** Keeps the native storage boundary visible without allowing the test to inject an unsigned success receipt. */
const setup = () => {
  const rows = new Map<string, Record<string, unknown>>();
  const records = {
    one: jest.fn(async (_context, object: string, id: string) => {
      if (object === 'person') return { id, contactRoles: ['CANDIDATE'] };
      if (object === 'recruitmentJob') return { id, companyId: 'company' };
      if (!rows.has(id)) throw new NotFoundException();
      return rows.get(id);
    }),
    create: jest.fn(async (_context, _object, data) => {
      const row = {
        ...JSON.parse(JSON.stringify(data)),
        personId: data.personId ?? null,
        vacancyId: data.vacancyId ?? null,
        companyId: data.companyId ?? null,
      };
      rows.set(row.id, row);
      return row;
    }),
    list: jest.fn(async () => ({
      records: [...rows.values()],
      count: rows.size,
      hasNextPage: false,
    })),
  };
  const consents = {
    assertAllowed: jest.fn(async () => ({ grantId: 'grant' })),
  };
  const drafts = {
    requireHuman: jest.fn((value) => {
      if (
        value.type !== 'user' ||
        value.agentId ||
        value.viaApplication ||
        value.application
      )
        throw new ForbiddenException();
    }),
  };
  const service = new RecruitingActivityService(
    records as unknown as RecruitingRecordsService,
    {
      capture: () => ({ workspaceId: 'workspace', userWorkspaceId: 'owner' }),
    } as unknown as RecruitingActorService,
    drafts as unknown as RecruitingDraftsService,
    consents as unknown as RecruitingShareConsentService,
    { get: () => 'synthetic-receipt-secret' } as unknown as TwentyConfigService,
  );
  return { service, records, rows, consents };
};
describe('recruiting activity receipts', () => {
  it('allows an Agent note without declaring contact, then rejects an actual-action assertion', async () => {
    const { service, records } = setup();
    const api = { ...context, type: 'apiKey' } as WorkspaceAuthContext;
    const note = await service.record(api, {
      action: 'NOTE',
      candidateId,
      note: '需要本人确认意向',
      idempotencyKey: 'note',
    });
    expect(note).toMatchObject({ verified: true, humanConfirmed: false });
    await expect(
      service.record(api, {
        action: 'CANDIDATE_CONTACTED',
        candidateId,
        note: 'claimed',
        idempotencyKey: 'claim',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(records.create).toHaveBeenCalledTimes(1);
  });
  it('reuses the original human receipt after withdrawal and rejects native-CRUD edits as unverified', async () => {
    const { service, rows, consents } = setup();
    const input = {
      action: 'COMPANY_RECOMMENDED',
      candidateId,
      jobId,
      note: '合成回执，无外发',
      idempotencyKey: 'recommended',
    };
    const result = await service.record(context, input);
    expect(result).toMatchObject({ verified: true, humanConfirmed: true });
    consents.assertAllowed.mockRejectedValueOnce(new ForbiddenException());
    expect((await service.record(context, input)).activityId).toBe(
      result.activityId,
    );
    expect(consents.assertAllowed).toHaveBeenCalledTimes(1);
    rows.get(result.activityId)!.followUpNote = 'tampered';
    expect((await service.list(context)).records[0].verified).toBe(false);
    await expect(service.record(context, input)).rejects.toThrow('标识');
  });
  it('requires live candidate confirmation before a new company recommendation receipt', async () => {
    const { service, records, consents } = setup();
    consents.assertAllowed.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.record(context, {
        action: 'COMPANY_RECOMMENDED',
        candidateId,
        jobId,
        note: 'unconfirmed',
        idempotencyKey: 'new',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(records.create).not.toHaveBeenCalled();
  });
});
