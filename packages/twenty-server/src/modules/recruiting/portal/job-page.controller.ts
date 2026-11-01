/** Accepts only a scoped job-page capability and does not inherit a CRM browser session. */
import {
  Body,
  Controller,
  Post,
  UseGuards,
  Header,
  BadRequestException,
} from '@nestjs/common';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { RecruitingJobPageService } from './job-page.service';

/** Exposes selected job descriptions through a signed capability, without CRM access. */
@Controller('recruiting-job-pages')
@UseGuards(PublicEndpointGuard, NoPermissionGuard)
export class RecruitingJobPageController {
  constructor(private readonly pages: RecruitingJobPageService) {}
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
