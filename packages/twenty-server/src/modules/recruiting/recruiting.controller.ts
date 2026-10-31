/** Exposes recruiting operations through the same authenticated workspace used by native APIs. */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  Param,
  Headers,
  HttpCode,
  Res,
} from '@nestjs/common';

import { type Request, type Response } from 'express';
import { ApiPath } from 'twenty-shared/types';
import { z } from 'zod';
import { isPlainObject } from 'twenty-shared/utils';

import { buildWorkspaceAuthContextFromRequest } from 'src/engine/core-modules/auth/utils/build-workspace-auth-context-from-request.util';
import { AuthPrincipalGuard } from 'src/engine/guards/auth-principal.guard';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { RecruitingRecordsService } from './recruiting-records.service';
import { RecruitingIntakeService } from './recruiting-intake.service';

const companySchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    domain: z.string().trim().max(1000).optional(),
    description: z.string().max(50_000).optional(),
    recruitmentPreferences: z.string().max(50_000).optional(),
  })
  .strict();

@Controller(ApiPath.Recruiting)
@UseGuards(
  JwtAuthGuard,
  AuthPrincipalGuard({
    userSession: {
      standard: true,
      impersonated: true,
      playground: true,
      workspaceAgnostic: false,
    },
    apiKey: true,
    oauthClient: true,
    application: true,
  }),
  NoPermissionGuard,
)
/** Accepts identifiers from callers while preserving the native record permission checks. */
export class RecruitingController {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly intakes: RecruitingIntakeService,
  ) {}

  /** Submits native file references through the same boundary used by upload UI and mail. */
  @Post('resume-intakes')
  @HttpCode(202)
  async submitResume(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!isPlainObject(body))
      throw new BadRequestException('请提交有效的材料信息');
    return this.intakes.submit(buildWorkspaceAuthContextFromRequest(request), {
      ...body,
      kind: 'CANDIDATE',
      ...(key ? { idempotencyKey: key } : {}),
    });
  }

  /** Starts a company-bound JD preview task without publishing unconfirmed model output. */
  @Post('job-intakes')
  @HttpCode(202)
  async submitJobs(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!isPlainObject(body))
      throw new BadRequestException('请提交有效的岗位信息');
    return this.intakes.submit(buildWorkspaceAuthContextFromRequest(request), {
      ...body,
      kind: 'JOB',
      ...(key ? { idempotencyKey: key } : {}),
    });
  }

  /** Lists persistent task receipts even after native queue cleanup. */
  @Get('resume-intakes')
  queue(@Req() request: Request, @Query('offset') offset = '0') {
    return this.intakes.list(
      buildWorkspaceAuthContextFromRequest(request),
      Math.max(0, Number.parseInt(offset, 10) || 0),
    );
  }

  /** Opens an authorized intake and its material/extraction details. */
  @Get('resume-intakes/:id')
  intake(@Req() request: Request, @Param('id') id: string) {
    return this.intakes.one(buildWorkspaceAuthContextFromRequest(request), id);
  }

  /** Retries failed work under the currently authenticated caller. */
  @Post('resume-intakes/:id/retry')
  @HttpCode(202)
  retry(@Req() request: Request, @Param('id') id: string) {
    return this.intakes.retry(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }

  /** Confirms the reviewed JD rows while preserving the previously chosen company. */
  @Post('job-intakes/:id/confirm')
  confirmJobs(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.intakes.confirmJobs(
      buildWorkspaceAuthContextFromRequest(request),
      id,
      body,
    );
  }

  /** Serves only manifest-listed previews after the parent's native read permission succeeds. */
  @Get('resume-intakes/:id/previews/:requestId/:name')
  async preview(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Param('name') name: string,
    @Res() response: Response,
  ) {
    const bytes = await this.intakes.preview(
      buildWorkspaceAuthContextFromRequest(request),
      id,
      requestId,
      name,
    );
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(Buffer.from(bytes));
  }

  /** Searches actual companies before the operator starts a JD batch. */
  @Get('companies')
  async companies(
    @Req() request: Request,
    @Query('search') search = '',
    @Query('offset') offset = '0',
  ) {
    const context = buildWorkspaceAuthContextFromRequest(request);
    const query = search.trim().slice(0, 200);
    return this.records.list(context, 'company', {
      filter: query
        ? {
            or: [
              { name: { ilike: `%${query}%` } },
              { domainName: { primaryLinkUrl: { ilike: `%${query}%` } } },
            ],
          }
        : undefined,
      offset: Math.max(0, Number.parseInt(offset, 10) || 0),
      limit: 50,
      select: [
        'id',
        'name',
        'domainName',
        'recruitingDescription',
        'recruitmentPreferences',
      ],
    });
  }

  /** Creates a selected company without requiring a second screen or rewriting existing company data. */
  @Post('companies')
  async createCompany(@Req() request: Request, @Body() body: unknown) {
    const parsed = companySchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('请填写公司名称，并检查输入字段');
    const data = parsed.data;
    let domain;
    if (data.domain) {
      try {
        const url = new URL(
          data.domain.includes('://') ? data.domain : `https://${data.domain}`,
        );
        if (!['https:', 'http:'].includes(url.protocol))
          throw new Error('unsupported_protocol');
        domain = {
          primaryLinkLabel: url.hostname,
          primaryLinkUrl: url.origin,
          secondaryLinks: [],
        };
      } catch {
        throw new BadRequestException('请填写有效的公司网站地址');
      }
    }
    return this.records.create(
      buildWorkspaceAuthContextFromRequest(request),
      'company',
      {
        name: data.name,
        ...(domain ? { domainName: domain } : {}),
        ...(data.description
          ? { recruitingDescription: data.description }
          : {}),
        ...(data.recruitmentPreferences
          ? {
              recruitmentPreferences: {
                markdown: data.recruitmentPreferences,
                blocknote: null,
              },
            }
          : {}),
      },
    );
  }
}
