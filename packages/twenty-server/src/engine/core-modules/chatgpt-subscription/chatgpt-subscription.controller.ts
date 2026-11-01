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
import { loadLocalCodexCredential } from './local-codex-credential';

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
  /** Lists account state and availability of the existing read-only local login. */
  @Get() async list(@Req() request: Request) {
    const ownerId = this.owner(request);
    let localCodex: object = { available: false };
    try {
      const account = await loadLocalCodexCredential();
      localCodex = { available: true, accountId: account.accountId };
    } catch {
      /* An absent local login is an ordinary source state. */
    }
    return {
      connections: await this.store.list(),
      localCodex,
      pendingAttempt: this.login.active(ownerId),
    };
  }
  @Get('local/usage') usage(@Req() request: Request) {
    this.owner(request);
    return this.account.usage();
  }
  @Post('local/models/sync') syncModels(@Req() request: Request) {
    this.owner(request);
    return this.account.syncModels();
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
      .object({ connectionId: z.string().uuid().optional() })
      .strict()
      .safeParse(value);
    if (!parsed.success) throw new BadRequestException('请选择有效的账号连接');
    return this.login.start(owner, parsed.data.connectionId);
  }
  /** Returns one administrator's own authorization attempt. */
  @Get('attempts/:id') status(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.login.status(this.owner(request), id);
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
  /** Clears local use and reports remote renewable-session revocation separately. */
  @Post(':id/disconnect') disconnect(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    this.owner(request);
    return this.store.disconnect(z.uuid().parse(id));
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
