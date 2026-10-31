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
  UploadedFile,
  UseInterceptors,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';

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
import { RecruitingMatchingService } from './recruiting-matching.service';
import { RecruitingUploadService } from './recruiting-upload.service';
import { RecruitingUploadPermissionGuard } from './recruiting-upload-permission.guard';
import { contentVersion } from './domain/match-context';
import { userIsFullAdmin } from 'src/engine/core-modules/impersonation/utils/user-is-full-admin.util';
import { isImpersonating } from 'src/engine/guards/utils/is-impersonating.util';

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
    private readonly matching: RecruitingMatchingService,
    private readonly uploads: RecruitingUploadService,
  ) {}

  /** Upgrades known local legacy envelopes only while a server-side maintenance switch is enabled. */
  @Post('admin/seal-legacy-state')
  sealLegacyState(@Req() request: Request) {
    const context = buildWorkspaceAuthContextFromRequest(request);
    if (
      context.type !== 'user' ||
      context.application ||
      context.viaApplication ||
      context.agentId ||
      isImpersonating(request.impersonationContext) ||
      !userIsFullAdmin(context.user)
    )
      throw new ForbiddenException('仅服务器管理员的本人会话可升级任务记录');
    return this.records.sealLegacyState(context);
  }

  /** Accepts one resume and an optional note in a single authenticated multipart request. */
  @Post('resume-intakes/upload')
  @HttpCode(202)
  @UseGuards(RecruitingUploadPermissionGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: 50 * 1024 * 1024,
        fields: 4,
        fieldSize: 100_000,
        parts: 5,
      },
    }),
  )
  async uploadResume(
    @Req() request: Request,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() value: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!file) throw new BadRequestException('请上传简历文件（file）');
    const parsed = z
      .object({
        note: z.string().max(100_000).optional(),
        candidateId: z.string().uuid().optional(),
        batchId: z.string().uuid().optional(),
        source: z.enum(['manual', 'api']).optional(),
      })
      .strict()
      .safeParse(value);
    if (
      !parsed.success ||
      (key !== undefined && (!key.length || key.length > 256))
    )
      throw new BadRequestException('请检查材料说明、候选人和提交标识');
    const context = buildWorkspaceAuthContextFromRequest(request);
    const { source = 'api', ...details } = parsed.data;
    const metadata = { ...details, note: details.note ?? '' };
    const digest = contentVersion({
      metadata,
      filename: file.originalname,
      bytes: createHash('sha256').update(file.buffer).digest('hex'),
    });
    const existing = await this.intakes.existingMultipart(
      context,
      key,
      digest,
      source,
    );
    if (existing) return existing;
    const uploaded = await this.uploads.buffer(context, file);
    return this.intakes.submit(
      context,
      {
        ...metadata,
        kind: 'CANDIDATE',
        source,
        files: [uploaded],
        ...(key ? { idempotencyKey: key } : {}),
      },
      { transportDigest: digest },
    );
  }

  /** Creates a native storage upload target with a caller-bound recruiting submission receipt. */
  @Post('uploads/targets')
  uploadTarget(@Req() request: Request, @Body() body: unknown) {
    return this.uploads.target(
      buildWorkspaceAuthContextFromRequest(request),
      body,
    );
  }

  /** Completes native MIME/size checks and returns a reusable authorized material reference. */
  @Post('uploads/complete')
  completeUpload(@Req() request: Request, @Body() body: unknown) {
    return this.uploads.complete(
      buildWorkspaceAuthContextFromRequest(request),
      body,
    );
  }

  /** Starts either direction or a specified pair without holding an HTTP request open. */
  @Post('match-runs')
  @HttpCode(202)
  match(@Req() request: Request, @Body() body: unknown) {
    return this.matching.submit(
      buildWorkspaceAuthContextFromRequest(request),
      body,
    );
  }

  /** Lists persistent matching progress independently of ingestion. */
  @Get('match-runs')
  matchQueue(@Req() request: Request, @Query('offset') offset = '0') {
    return this.matching.list(
      buildWorkspaceAuthContextFromRequest(request),
      Math.max(0, Number.parseInt(offset, 10) || 0),
    );
  }

  /** Returns current, authorized results with coverage and source links. */
  @Get('match-runs/:id')
  matchResult(@Req() request: Request, @Param('id') id: string) {
    return this.matching.one(buildWorkspaceAuthContextFromRequest(request), id);
  }

  /** Reuses valid pair caches and retries only the necessary scoring work. */
  @Post('match-runs/:id/retry')
  @HttpCode(202)
  retryMatch(@Req() request: Request, @Param('id') id: string) {
    return this.matching.retry(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }

  /** Keeps viewed state separate from real communication and recommendations. */
  @Post('match-runs/:id/reviewed')
  reviewMatch(@Req() request: Request, @Param('id') id: string) {
    return this.matching.reviewed(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }

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
