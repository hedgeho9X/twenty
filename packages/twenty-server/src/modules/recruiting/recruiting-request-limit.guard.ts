/** Applies one native request admission before a recruiting HTTP operation. */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { type Request } from 'express';
import { buildWorkspaceAuthContextFromRequest } from 'src/engine/core-modules/auth/utils/build-workspace-auth-context-from-request.util';
import { RecruitingRequestLimitService } from './recruiting-request-limit.service';

@Injectable()
/** Runs after authentication and leaves all record and field permission checks in the domain services. */
export class RecruitingRequestLimitGuard implements CanActivate {
  constructor(private readonly limits: RecruitingRequestLimitService) {}
  async canActivate(context: ExecutionContext) {
    await this.limits.admit(
      buildWorkspaceAuthContextFromRequest(
        context.switchToHttp().getRequest<Request>(),
      ),
    );
    return true;
  }
}
