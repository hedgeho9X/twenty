/** Checks upload authority before a multipart interceptor buffers any file content. */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { type Request } from 'express';

import { buildWorkspaceAuthContextFromRequest } from 'src/engine/core-modules/auth/utils/build-workspace-auth-context-from-request.util';
import { RecruitingUploadService } from '../files/upload.service';

@Injectable()
/** Reuses the native permission flag and the already authenticated workspace. */
export class RecruitingUploadPermissionGuard implements CanActivate {
  constructor(private readonly uploads: RecruitingUploadService) {}

  /** Does not read the request body or accept a caller-supplied workspace identity. */
  async canActivate(context: ExecutionContext) {
    await this.uploads.assertUploadPermission(
      buildWorkspaceAuthContextFromRequest(
        context.switchToHttp().getRequest<Request>(),
      ),
    );
    return true;
  }
}
