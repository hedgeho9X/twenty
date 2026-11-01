/** Checks the public admission boundary without disabling native usage policies. */
import { HttpException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  UsageLimitException,
  UsageLimitExceptionCode,
} from 'src/engine/core-modules/usage-limit/exceptions/usage-limit.exception';
import { type UsageLimitSpeedService } from 'src/engine/core-modules/usage-limit/services/usage-limit-speed.service';
import { RecruitingRequestLimitService } from './request-limit.service';

it('returns 429 for native speed exhaustion and does not mask unrelated failures', async () => {
  const speed = { consumeOrThrow: jest.fn() };
  const service = new RecruitingRequestLimitService(
    speed as unknown as UsageLimitSpeedService,
  );
  const auth = {
    type: 'user',
    workspace: { id: 'workspace' },
  } as WorkspaceAuthContext;
  speed.consumeOrThrow.mockRejectedValueOnce(
    new UsageLimitException('limited', UsageLimitExceptionCode.RATE_LIMITED),
  );
  try {
    await service.admit(auth);
    throw new Error('Expected admission to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  }
  const unavailable = new Error('storage unavailable');
  speed.consumeOrThrow.mockRejectedValueOnce(unavailable);
  await expect(service.admit(auth)).rejects.toBe(unavailable);
});
