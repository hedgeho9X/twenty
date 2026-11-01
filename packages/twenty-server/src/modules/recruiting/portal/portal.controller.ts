/** Exposes a capability-only public portal without inheriting browser cookies or accepting native record operations. */
import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { type Response } from 'express';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { RecruitingPortalActionsService } from './portal-actions.service';

@Controller('recruiting-portal')
@UseGuards(PublicEndpointGuard, NoPermissionGuard)
/** Capability verification and scoped native principal resolution run inside every action dispatch. */
export class RecruitingPortalController {
  constructor(private readonly actions: RecruitingPortalActionsService) {}
  /** The capability travels in a bounded JSON body rather than a logged URL or native Authorization header. */
  @Post()
  async execute(@Body() body: unknown, @Res() response: Response) {
    const result = await this.actions.execute(body);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'download') {
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(result.label)}`,
      );
      response.send(result.bytes);
    } else response.json(result.data);
  }
}
