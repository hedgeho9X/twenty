/** Tests owner-only contract declarations, version conflicts and idempotent internal reminders without a signing provider. */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type RecruitingContractRecordsService } from './recruiting-contract-records.service';
import { type PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { type RecruitingRecordsService } from './recruiting-records.service';
import { type RecruitingDraftsService } from './recruiting-drafts.service';
import {
  contractReminderId,
  RecruitingContractsService,
} from './recruiting-contracts.service';

const context = {
  type: 'user',
  workspace: { id: 'workspace' },
  workspaceMemberId: 'owner',
} as WorkspaceAuthContext;
/** Native-like records retain manually edited tasks and compare-and-swap outcomes independently from side effects. */
const setup = () => {
  const company = {
    id: 'company',
    name: '合成公司',
    updatedAt: new Date().toISOString(),
    accountOwnerId: 'owner',
    contractStatus: null as string | null,
    contractDetails: {
      legalName: '合成公司',
      creditCode: '',
      address: '',
      contactName: '',
      phone: '',
    },
  };
  const rows = new Map<string, Record<string, unknown>>([
    ['company:company', company],
  ]);
  const records = {
    one: jest.fn(async (_context, object: string, id: string) => {
      const row = rows.get(`${object}:${id}`);
      if (!row) throw new NotFoundException();
      return row;
    }),
    list: jest.fn(async () => ({ records: [{ id: 'job' }] })),
    create: jest.fn(async (_context, object: string, data) => {
      rows.set(`${object}:${data.id}`, data);
      return data;
    }),
    update: jest.fn(async (_context, object: string, id: string, data) => {
      const value = { ...rows.get(`${object}:${id}`), ...data };
      rows.set(`${object}:${id}`, value);
      return value;
    }),
  };
  let revision = 'unit-v1';
  const updates = {
    one: jest.fn(async () => ({ company, version: revision })),
    update: jest.fn(
      async (
        _context: WorkspaceAuthContext,
        _id: string,
        _version: string,
        data: Record<string, unknown>,
      ) => {
        Object.assign(company, data);
        revision += '-next';
        return true;
      },
    ),
  };
  const drafts = {
    requireHuman: (value: WorkspaceAuthContext) => {
      if (
        value.type !== 'user' ||
        value.application ||
        value.viaApplication ||
        value.agentId
      )
        throw new ForbiddenException();
    },
  };
  const locks = {
    tryWithLock: async <T>(_key: string, callback: () => Promise<T>) => ({
      acquired: true,
      value: await callback(),
    }),
  };
  const service = new RecruitingContractsService(
    records as unknown as RecruitingRecordsService,
    updates as unknown as RecruitingContractRecordsService,
    drafts as unknown as RecruitingDraftsService,
    locks as unknown as PostgresAdvisoryLockService,
  );
  return { service, records, updates, company, rows };
};
it('allows reading existing manual state while rejecting Agent and non-owner declarations', async () => {
  const { service, company } = setup();
  const api = { ...context, type: 'apiKey' } as WorkspaceAuthContext;
  expect((await service.one(api, company.id)).canEdit).toBe(false);
  const input = {
    action: 'STATUS',
    status: 'SIGNED',
    version: (await service.one(context, company.id)).version,
  };
  await expect(service.update(api, company.id, input)).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  await expect(
    service.update(
      { ...context, workspaceMemberId: 'other' } as WorkspaceAuthContext,
      company.id,
      input,
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
});
it('rejects a changed version and a lost compare-and-swap instead of overwriting another owner edit', async () => {
  const { service, company, updates } = setup();
  const input = {
    action: 'STATUS',
    status: 'SENT',
    version: (await service.one(context, company.id)).version,
  };
  await expect(
    service.update(context, company.id, {
      ...input,
      version: 'stale-revision',
    }),
  ).rejects.toBeInstanceOf(ConflictException);
  updates.update.mockResolvedValueOnce(false);
  await expect(
    service.update(context, company.id, input),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(company.contractStatus).toBe(null);
});
it('creates one company reminder and relation while preserving later human task edits', async () => {
  const { service, records, company, rows } = setup();
  const first = await service.remind(context, company.id);
  rows.get(`task:${contractReminderId(company.id)}`)!.title = '人工已编辑';
  const second = await service.remind(context, company.id);
  expect(first).toMatchObject({ taskId: contractReminderId(company.id) });
  expect(second).toMatchObject({ taskId: contractReminderId(company.id) });
  expect(records.create).toHaveBeenCalledTimes(2);
  expect(rows.get(`task:${contractReminderId(company.id)}`)!.title).toBe(
    '人工已编辑',
  );
  expect(company.contractStatus).toBe('PENDING');
});
it('retains signed metadata, completes an existing reminder and never creates another external draft', async () => {
  const { service, company, rows } = setup();
  await service.remind(context, company.id);
  const signed = await service.update(context, company.id, {
    action: 'STATUS',
    status: 'SIGNED',
    version: (await service.one(context, company.id)).version,
  });
  expect(signed.status).toBe('SIGNED');
  expect(rows.get(`task:${contractReminderId(company.id)}`)!.status).toBe(
    'DONE',
  );
  await expect(
    service.update(context, company.id, {
      action: 'DETAILS',
      details: company.contractDetails,
      version: (await service.one(context, company.id)).version,
    }),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(await service.remind(context, company.id)).toMatchObject({
    alreadyInProgress: true,
  });
});
