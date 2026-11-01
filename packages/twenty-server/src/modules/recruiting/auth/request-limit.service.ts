/** Charges native API speed budgets at the recruiting boundary instead of once per internal CRUD step. */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { UsageLimitSpeedService } from 'src/engine/core-modules/usage-limit/services/usage-limit-speed.service';
import { UsageLimitException } from 'src/engine/core-modules/usage-limit/exceptions/usage-limit.exception';
import { UsageResourceType } from 'src/engine/core-modules/usage/enums/usage-resource-type.enum';
import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';

@Injectable()
/** Keeps the official per-key/application/user limits while allowing a durable task to do its internal work. */
export class RecruitingRequestLimitService {
  constructor(private readonly speed: UsageLimitSpeedService) {}
  /** Preserves HTTP429 instead of presenting a throttled caller as lacking data permissions. */
  async admit(context: WorkspaceAuthContext) {
    try {
      await this.speed.consumeOrThrow({
        resourceType: UsageResourceType.API,
        authContext: context,
        operationType: UsageOperationType.API_REQUEST,
      });
    } catch (error) {
      if (error instanceof UsageLimitException)
        throw new HttpException(
          '请求过于频繁，请稍后重试',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      throw error;
    }
  }
}
