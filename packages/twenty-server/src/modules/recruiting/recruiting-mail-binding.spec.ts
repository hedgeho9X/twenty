/** Verifies legacy mail receipts against accepted, signed intake provenance instead of trusting an email source label. */
import { ConflictException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecruitingIntakeService } from './recruiting-intake.service';

it('returns an existing receipt only when every persisted mail binding component matches', async () => {
  const context = { workspace: { id: 'workspace' } } as WorkspaceAuthContext;
  const binding = {
    archiveId: 'mail',
    sourceHash: 'sha',
    idempotencyKey: 'accepted-key',
  };
  const input = {
    kind: 'CANDIDATE',
    source: 'email',
    sourceId: 'mail',
    idempotencyKey: 'accepted-key',
    mail: { archiveId: 'mail', sourceHash: 'sha' },
  };
  let current = input;
  const records = {
    one: jest.fn(async () => ({
      id: 'intake',
      state: 'COMPLETED',
      result: {
        schemaVersion: 2,
        input: current,
        stage: 'STORED',
        candidateId: 'person',
      },
    })),
  };
  const service = new RecruitingIntakeService(
    records as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  expect(await service.mailBinding(context, 'intake', binding)).toMatchObject({
    intakeId: 'intake',
    candidateId: 'person',
  });
  for (const altered of [
    { ...input, sourceId: 'other-mail' },
    { ...input, idempotencyKey: 'fake-key' },
    { ...input, mail: { archiveId: 'other-mail', sourceHash: 'sha' } },
    { ...input, mail: { archiveId: 'mail', sourceHash: 'other-sha' } },
  ]) {
    current = altered;
    await expect(
      service.mailBinding(context, 'intake', binding),
    ).rejects.toBeInstanceOf(ConflictException);
  }
});
