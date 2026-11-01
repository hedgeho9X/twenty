/** Rehydrates native tool callers and checks that business operations preserve their current role intersection. */
import { ForbiddenException, Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { RecruitingActorService } from './actor.service';
import { stableSerialize } from '../matching/domain/match-context';
import { RecruitingRequestLimitService } from './request-limit.service';

@Injectable()
/** Never builds a system identity from a workspace ID or accepts permission bypass from tool metadata. */
export class RecruitingToolAuthorizationService {
  constructor(
    private readonly actors: RecruitingActorService,
    private readonly cache: WorkspaceCacheService,
    private readonly limits: RecruitingRequestLimitService,
  ) {}

  /** Preserves user/API-key/application identity, delegated application and agent references before service dispatch. */
  async resolve(original: ToolProviderContext): Promise<WorkspaceAuthContext> {
    const context = original.resolveExecutionContext
      ? await original.resolveExecutionContext()
      : original;
    const input = context.authContext;
    if (
      !input ||
      input.workspace.id !== context.workspaceId ||
      input.type === 'system' ||
      input.type === 'pendingActivationUser'
    )
      throw new ForbiddenException(
        '招聘工具需要已授权的工作区用户、API Key或应用身份',
      );
    // Native Agent runs keep delegation in viaApplication; ordinary record services derive that restriction from application.
    const scoped =
      input.type === 'user'
        ? {
            ...input,
            application: input.application ?? input.viaApplication,
            agentId: context.agentId ?? input.agentId,
          }
        : input.type === 'application'
          ? { ...input, agentId: context.agentId ?? input.agentId }
          : input;
    const current = await this.actors.resolve(this.actors.capture(scoped));
    const maps = await this.cache.getOrRecompute(context.workspaceId, [
      'userWorkspaceRoleMap',
      'apiKeyRoleMap',
      'flatRoleTargetByAgentIdMaps',
    ]);
    const resolved = resolveRolePermissionConfig({
      authContext: current,
      ...maps,
    });
    if (
      !resolved ||
      'shouldBypassPermissionChecks' in context.rolePermissionConfig ||
      stableSerialize(resolved) !==
        stableSerialize(context.rolePermissionConfig)
    )
      throw new ForbiddenException(
        '工具权限已变化或无法完整保留，请刷新授权后重试',
      );
    await this.limits.admit(current);
    return current;
  }
}
