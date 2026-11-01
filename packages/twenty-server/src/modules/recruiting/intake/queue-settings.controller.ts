/** Persists and applies administrator-owned queue limits through native configuration and queue drivers. */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { AuthPrincipalGuard } from 'src/engine/guards/auth-principal.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { userIsFullAdmin } from 'src/engine/core-modules/impersonation/utils/user-is-full-admin.util';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

@Controller('recruiting/queue-settings')
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
export class RecruitingQueueSettingsController {
  constructor(
    private readonly config: TwentyConfigService,
    @InjectMessageQueue(MessageQueue.recruitingQueue)
    private readonly parsing: MessageQueueService,
    @InjectMessageQueue(MessageQueue.recruitingMatchQueue)
    private readonly matching: MessageQueueService,
  ) {}
  private authorize(request: Request) {
    if (!request.user || !userIsFullAdmin(request.user))
      throw new ForbiddenException('请由管理员设置并发');
  }
  @Get() get(@Req() request: Request) {
    this.authorize(request);
    return this.values();
  }
  private values() {
    const saved = this.config.get('MESSAGE_QUEUE_CONCURRENCY');
    return {
      parsing: saved[MessageQueue.recruitingQueue] ?? 10,
      matching: saved[MessageQueue.recruitingMatchQueue] ?? 2,
    };
  }
  @Post() async set(@Req() request: Request, @Body() body: unknown) {
    this.authorize(request);
    const parsed = z
      .object({
        parsing: z.number().int().min(1).max(20),
        matching: z.number().int().min(1).max(20),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('解析并发为 1–20，匹配并发为 1–20');
    await this.config.set('MESSAGE_QUEUE_CONCURRENCY', {
      ...this.config.get('MESSAGE_QUEUE_CONCURRENCY'),
      [MessageQueue.recruitingQueue]: parsed.data.parsing,
      [MessageQueue.recruitingMatchQueue]: parsed.data.matching,
    });
    await this.parsing.setGlobalConcurrency(parsed.data.parsing);
    await this.matching.setGlobalConcurrency(parsed.data.matching);
    return this.values();
  }
}
