/** Rebuilds queued callers from current membership and roles instead of persisting tokens. */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { ApiKeyEntity } from 'src/engine/core-modules/api-key/api-key.entity';
import { fromApiKeyEntityToFlat } from 'src/engine/core-modules/api-key/utils/from-api-key-entity-to-flat.util';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { buildApiKeyAuthContext } from 'src/engine/core-modules/auth/utils/build-api-key-auth-context.util';
import { buildApplicationAuthContext } from 'src/engine/core-modules/auth/utils/build-application-auth-context.util';
import { UserWorkspaceAuthContextService } from 'src/engine/core-modules/user-workspace/services/user-workspace-auth-context.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

/** Only stable principal references enter the queue; access credentials and user entities do not. */
export type RecruitingActor = {
  workspaceId: string;
  userWorkspaceId?: string;
  apiKeyId?: string;
  applicationId?: string;
  viaApplicationId?: string;
  agentId?: string;
};

@Injectable()
/** Resolves the same constrained caller before background reads and writes. */
export class RecruitingActorService {
  constructor(
    private readonly userWorkspaceAuthContextService: UserWorkspaceAuthContextService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    @InjectWorkspaceScopedRepository(ApiKeyEntity)
    private readonly apiKeyRepository: WorkspaceScopedRepository<ApiKeyEntity>,
  ) {}

  /** Captures identifiers only and rejects onboarding identities before accepting work. */
  capture(context: WorkspaceAuthContext): RecruitingActor {
    if (context.type === 'pendingActivationUser')
      throw new ForbiddenException('请先完成工作区注册');
    const base = { workspaceId: context.workspace.id };
    if (context.type === 'apiKey')
      return { ...base, apiKeyId: context.apiKey.id };
    if (context.type === 'user')
      return {
        ...base,
        userWorkspaceId: context.userWorkspaceId,
        applicationId: context.application?.id,
        viaApplicationId: context.viaApplication?.id,
        agentId: context.agentId,
      };
    if (context.type === 'application')
      return {
        ...base,
        applicationId: context.application.id,
        agentId: context.agentId,
      };
    throw new ForbiddenException('招聘任务必须绑定具体的工作区发起人');
  }

  /** Rechecks disabled membership, key expiry and application access when a queued task starts. */
  async resolve(actor: RecruitingActor): Promise<WorkspaceAuthContext> {
    const workspace = await this.coreEntityCacheService.get(
      'workspaceEntity',
      actor.workspaceId,
    );
    if (!workspace || workspace.deletedAt || workspace.suspendedAt)
      throw new ForbiddenException('工作区已不可用');
    if (actor.apiKeyId) {
      const key = await this.apiKeyRepository.findOne(actor.workspaceId, {
        where: { id: actor.apiKeyId },
      });
      if (!key || key.revokedAt || key.expiresAt.getTime() <= Date.now())
        throw new ForbiddenException('任务的 API 授权已失效');
      return buildApiKeyAuthContext({
        workspace,
        apiKey: fromApiKeyEntityToFlat(key),
      });
    }
    if (actor.userWorkspaceId) {
      const context = await this.userWorkspaceAuthContextService.resolve({
        workspaceId: actor.workspaceId,
        userWorkspaceId: actor.userWorkspaceId,
        applicationId: actor.applicationId ?? null,
      });
      if (actor.viaApplicationId) {
        const { flatApplicationMaps } =
          await this.workspaceCacheService.getOrRecompute(actor.workspaceId, [
            'flatApplicationMaps',
          ]);
        const application = flatApplicationMaps.byId[actor.viaApplicationId];
        if (!application?.defaultRoleId)
          throw new ForbiddenException('任务的应用授权已失效');
        return {
          ...context,
          viaApplication: application,
          agentId: actor.agentId,
        };
      }
      return { ...context, agentId: actor.agentId };
    }
    if (actor.applicationId) {
      const { flatApplicationMaps } =
        await this.workspaceCacheService.getOrRecompute(actor.workspaceId, [
          'flatApplicationMaps',
        ]);
      const application = flatApplicationMaps.byId[actor.applicationId];
      if (!application?.defaultRoleId)
        throw new ForbiddenException('任务的应用授权已失效');
      return buildApplicationAuthContext({
        workspace,
        application,
        agentId: actor.agentId,
      });
    }
    throw new ForbiddenException('任务缺少有效发起人');
  }
}
