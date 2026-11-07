/** Accepts only a scoped job-page capability and does not inherit a CRM browser session. */
import {
  Body,
  Controller,
  Post,
  UseGuards,
  Header,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { type Response } from 'express';
import { z } from 'zod';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { RecruitingJobPageService } from './job-page.service';

/** Exposes selected job descriptions through a signed capability, without CRM access. */
@Controller('recruiting-job-pages')
@UseGuards(PublicEndpointGuard, NoPermissionGuard)
export class RecruitingJobPageController {
  constructor(private readonly pages: RecruitingJobPageService) {}
  /** Streams attachments without placing bearer credentials in file URLs. */
  @Post('files')
  async download(@Body() value: unknown, @Res() response: Response) {
    const input = z
      .object({
        token: z.string().max(24),
        candidateId: z.string().uuid(),
        fileId: z.string().uuid(),
      })
      .strict()
      .parse(value);
    const file = await this.pages.download(
      input.token,
      input.candidateId,
      input.fileId,
    );
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.label)}`,
    );
    file.stream.on('error', () => response.destroy());
    file.stream.pipe(response);
  }

  /** Validates the capability and returns public job fields only. */
  @Post()
  @Header('Cache-Control', 'private, no-store')
  view(@Body() value: unknown) {
    if (
      !value ||
      typeof value !== 'object' ||
      !('token' in value) ||
      typeof value.token !== 'string'
    )
      throw new BadRequestException('请使用有效的岗位介绍链接');
    return this.pages.view(value.token);
  }
}
