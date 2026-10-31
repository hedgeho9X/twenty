/** Verifies that MCP preserves live role restrictions and never promotes missing or bypass identities. */
import { ForbiddenException } from '@nestjs/common';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type RecruitingActorService } from './recruiting-actor.service';
import { type RecruitingRequestLimitService } from './recruiting-request-limit.service';
import { RecruitingToolAuthorizationService } from './recruiting-tool-authorization.service';

/** Creates native role maps without a database, credential or privileged fallback. */
const setup = () => {
  const auth = {
    type: 'apiKey',
    workspace: { id: 'workspace' },
    apiKey: { id: 'key' },
  } as WorkspaceAuthContext;
  const actors = {
    capture: jest.fn(() => ({ workspaceId: 'workspace', apiKeyId: 'key' })),
    resolve: jest.fn(async () => auth),
  };
  const cache = {
    getOrRecompute: jest.fn(async () => ({
      userWorkspaceRoleMap: {},
      apiKeyRoleMap: { key: 'restricted-role' },
      flatRoleTargetByAgentIdMaps: { byId: {}, idByUniversalIdentifier: {} },
    })),
  };
  const limits = { admit: jest.fn(async () => undefined) };
  const service = new RecruitingToolAuthorizationService(
    actors as unknown as RecruitingActorService,
    cache as unknown as WorkspaceCacheService,
    limits as unknown as RecruitingRequestLimitService,
  );
  const context = {
    workspaceId: 'workspace',
    authContext: auth,
    rolePermissionConfig: {
      intersectionOf: { apiKeyRoleId: 'restricted-role' },
    },
  } as unknown as ToolProviderContext;
  return { service, context, actors, limits };
};

it('rehydrates the constrained caller and admits one external operation', async () => {
  const { service, context, actors, limits } = setup();
  await expect(service.resolve(context)).resolves.toEqual(context.authContext);
  expect(actors.resolve).toHaveBeenCalledTimes(1);
  expect(limits.admit).toHaveBeenCalledTimes(1);
});

it.each([
  { intersectionOf: { apiKeyRoleId: 'stale-admin-role' } },
  { shouldBypassPermissionChecks: true as const },
])('rejects stale or bypass permissions before admission', async (role) => {
  const { service, context, limits } = setup();
  await expect(
    service.resolve({ ...context, rolePermissionConfig: role }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(limits.admit).not.toHaveBeenCalled();
});

it.each(['system', 'pendingActivationUser'])(
  'rejects %s identities',
  async (type) => {
    const { service, context, actors } = setup();
    await expect(
      service.resolve({
        ...context,
        authContext: { ...context.authContext, type } as WorkspaceAuthContext,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(actors.capture).not.toHaveBeenCalled();
  },
);

it('rejects cross-workspace execution before rehydration', async () => {
  const { service, context, actors } = setup();
  await expect(
    service.resolve({ ...context, workspaceId: 'other-workspace' }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(actors.capture).not.toHaveBeenCalled();
});

it('preserves revoked authorization failure without an administrator fallback', async () => {
  const { service, context, actors, limits } = setup();
  actors.resolve.mockRejectedValueOnce(new ForbiddenException());
  await expect(service.resolve(context)).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(limits.admit).not.toHaveBeenCalled();
});

it('retains the native Agent application restriction when a member executes through viaApplication', async () => {
  const auth = {
    type: 'user',
    workspace: { id: 'workspace' },
    userWorkspaceId: 'member',
    viaApplication: { id: 'application', defaultRoleId: 'app-role' },
  } as unknown as WorkspaceAuthContext;
  const actors = {
    capture: jest.fn((value) => value),
    resolve: jest.fn(async (value) => value),
  };
  const cache = {
    getOrRecompute: jest.fn(async () => ({
      userWorkspaceRoleMap: { member: 'member-role' },
      apiKeyRoleMap: {},
      flatRoleTargetByAgentIdMaps: { agent: { roleId: 'agent-role' } },
    })),
  };
  const service = new RecruitingToolAuthorizationService(
    actors as unknown as RecruitingActorService,
    cache as unknown as WorkspaceCacheService,
    { admit: jest.fn() } as unknown as RecruitingRequestLimitService,
  );
  const result = await service.resolve({
    workspaceId: 'workspace',
    authContext: auth,
    agentId: 'agent',
    rolePermissionConfig: {
      intersectionOf: {
        userWorkspaceRoleId: 'member-role',
        applicationRoleId: 'app-role',
        agentRoleId: 'agent-role',
      },
    },
  });
  expect(result).toMatchObject({
    application: { defaultRoleId: 'app-role' },
    viaApplication: { defaultRoleId: 'app-role' },
    agentId: 'agent',
  });
  await expect(
    service.resolve({
      workspaceId: 'workspace',
      authContext: auth,
      agentId: 'agent',
      rolePermissionConfig: {
        intersectionOf: {
          userWorkspaceRoleId: 'member-role',
          agentRoleId: 'agent-role',
        },
      },
    }),
  ).rejects.toBeInstanceOf(ForbiddenException);
});
