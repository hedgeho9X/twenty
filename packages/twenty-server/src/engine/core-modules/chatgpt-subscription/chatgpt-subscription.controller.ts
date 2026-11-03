import { SubscriptionAccountService } from './subscription-account.service';
import { AiFeatureModelsService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-feature-models.service';
/** Exposes administrator-owned connection management, never model tokens or a general unauthenticated compatible API. */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { AuthPrincipalGuard } from 'src/engine/guards/auth-principal.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { isImpersonating } from 'src/engine/guards/utils/is-impersonating.util';
import { userIsFullAdmin } from 'src/engine/core-modules/impersonation/utils/user-is-full-admin.util';
import { SiwcStoreService } from './siwc-store.service';
import { SiwcLoginService } from './siwc-login.service';

@Controller('chatgpt-subscriptions')
@UseGuards(
  JwtAuthGuard,
  AuthPrincipalGuard({
    userSession: {
      standard: true,
      impersonated: false,
      playground: false,
      workspaceAgnostic: false,
    },
    apiKey: false,
    oauthClient: false,
    application: false,
  }),
  NoPermissionGuard,
)
/** These instance-level provider settings require a direct full-administrator session. */
export class ChatgptSubscriptionController {
  constructor(
    private readonly store: SiwcStoreService,
    private readonly login: SiwcLoginService,
    private readonly account: SubscriptionAccountService,
    private readonly features: AiFeatureModelsService,
  ) {}
  /** Lists only independently managed account registrations. */
  @Get() async list(@Req() request: Request) {
    const ownerId = this.owner(request);
    const connections = await this.store.list();
    const active = this.account.activeConnectionId();
    return {
      connections,
      activeConnectionId: connections.some(
        (connection) =>
          connection.id === active && connection.status === 'READY',
      )
        ? active
        : null,
      pendingAttempt: this.login.active(ownerId),
    };
  }
  @Get(['usage', 'local/usage']) usage(@Req() request: Request) {
    this.owner(request);
    return this.account.usage();
  }
  @Post(['models/sync', 'local/models/sync']) syncModels(
    @Req() request: Request,
  ) {
    this.owner(request);
    return this.account.syncModels();
  }
  @Get('brief-templates') briefTemplates(@Req() request: Request) {
    this.owner(request);
    return this.features.briefTemplates();
  }
  @Post('brief-templates') saveBriefTemplates(
    @Req() request: Request,
    @Body() input: unknown,
  ) {
    this.owner(request);
    return this.features.saveBriefTemplates(input);
  }
  @Get('features') featureList(@Req() request: Request) {
    this.owner(request);
    return this.features.list();
  }
  @Post('features/:id') async setFeature(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    this.owner(request);
    const parsed = z
      .object({ modelId: z.string().min(1) })
      .strict()
      .safeParse(input);
    if (!parsed.success) throw new BadRequestException('请选择模型');
    return this.features.set(id, parsed.data.modelId);
  }
  @Post('jev/test') testJev(@Req() request: Request, @Body() input: unknown) {
    this.owner(request);
    return this.features.testJev(input);
  }
  @Get('jev') jevConfig(@Req() request: Request) {
    this.owner(request);
    return this.features.jevConfig();
  }
  @Post('jev') saveJev(@Req() request: Request, @Body() input: unknown) {
    this.owner(request);
    return this.features.saveJev(input);
  }
  /** Starts only on explicit user action; loading settings never opens authorization. */
  @Post('authorize') start(@Req() request: Request, @Body() value: unknown) {
    const owner = this.owner(request);
    const parsed = z
      .object({
        connectionId: z.string().uuid().optional(),
        protocol: z.enum(['codex', 'siwc']).default('codex'),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success) throw new BadRequestException('请选择有效的账号连接');
    return this.login.start(
      owner,
      parsed.data.connectionId,
      parsed.data.protocol,
    );
  }
  /** Returns one administrator's own authorization attempt. */
  @Get('attempts/:id') status(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.login.status(this.owner(request), id);
  }
  /** Accepts a browser loopback redirect for the administrator's own pending attempt. */
  @Post('attempts/:id/complete') complete(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const owner = this.owner(request);
    const parsed = z
      .object({ redirect: z.string().max(8192) })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('请输入完整的授权回调地址');
    return this.login.completeFromRedirect(owner, id, parsed.data.redirect);
  }
  /** Cancels a pending, unconsumed authorization. */
  @Post('attempts/:id/cancel') cancel(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.login.cancel(this.owner(request), id);
  }
  /** Uses the selected account credential for model discovery without returning that credential. */
  @Get(':id/models') models(@Req() request: Request, @Param('id') id: string) {
    this.owner(request);
    return this.store.models(z.uuid().parse(id));
  }
  @Post(':id/activate') activate(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    this.owner(request);
    return this.account.activate(z.uuid().parse(id));
  }
  /** Clears local use and reports remote renewable-session revocation separately. */
  @Post(':id/disconnect') async disconnect(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    this.owner(request);
    const result = await this.store.disconnect(z.uuid().parse(id));
    await this.account.detach(id);
    return result;
  }
  /** REST reuses the native full-admin predicate with explicit principal/impersonation checks. */
  private owner(request: Request) {
    if (
      !request.user ||
      !userIsFullAdmin(request.user) ||
      isImpersonating(request.impersonationContext) ||
      request.application ||
      request.agentId
    )
      throw new ForbiddenException('请由实例管理员本人管理ChatGPT订阅连接');
    return request.user.id;
  }
}
