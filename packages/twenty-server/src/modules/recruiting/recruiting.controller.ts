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
import { RecruitingDirectoryService } from './recruiting-directory.service';
import { RecruitingRequestLimitGuard } from './recruiting-request-limit.guard';
import { RecruitingDraftsService } from './recruiting-drafts.service';
import { RecruitingMailService } from './recruiting-mail.service';
import { RecruitingMailboxService } from './recruiting-mailbox.service';
import { RecruitingPortalService } from './recruiting-portal.service';
import { RecruitingActivityService } from './recruiting-activity.service';
import { RecruitingContractsService } from './recruiting-contracts.service';
import { RecruitingShareConsentService } from './recruiting-share-consent.service';
import { RecruitingRecordsService } from './recruiting-records.service';
import { RecruitingIntakeService } from './recruiting-intake.service';
import { RecruitingMatchingService } from './recruiting-matching.service';
import { RecruitingUploadService } from './recruiting-upload.service';
import { RecruitingUploadPermissionGuard } from './recruiting-upload-permission.guard';
import { contentVersion } from './domain/match-context';
import { userIsFullAdmin } from 'src/engine/core-modules/impersonation/utils/user-is-full-admin.util';
import { isImpersonating } from 'src/engine/guards/utils/is-impersonating.util';

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
  RecruitingRequestLimitGuard,
)
/** Accepts identifiers from callers while preserving the native record permission checks. */
export class RecruitingController {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly directory: RecruitingDirectoryService,
    private readonly intakes: RecruitingIntakeService,
    private readonly matching: RecruitingMatchingService,
    private readonly uploads: RecruitingUploadService,
    private readonly drafts: RecruitingDraftsService,
    private readonly mail: RecruitingMailService,
    private readonly mailboxes: RecruitingMailboxService,
    private readonly portals: RecruitingPortalService,
    private readonly consents: RecruitingShareConsentService,
    private readonly activities: RecruitingActivityService,
    private readonly contracts: RecruitingContractsService,
  ) {}
  /** Reads existing company contract metadata under native field and record permissions. */
  @Get('contracts/:id') contract(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.contracts.one(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }
  /** Writes only owner-reviewed template data or actual manual status, never a signing request. */
  @Post('contracts/:id') contractUpdate(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    if (isImpersonating(request.impersonationContext))
      throw new ForbiddenException('请由公司负责人本人确认');
    return this.contracts.update(
      buildWorkspaceAuthContextFromRequest(request),
      id,
      value,
    );
  }
  /** Prepares an internal reminder independently from external signing or human status confirmation. */
  @Post('contracts/:id/reminder') contractReminder(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.contracts.remind(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }
  /** Records external actions only after explicit human confirmation; notes remain Agent-callable. */
  @Post('activities')
  activityCreate(@Req() request: Request, @Body() body: unknown) {
    if (
      isPlainObject(body) &&
      body.action !== 'NOTE' &&
      isImpersonating(request.impersonationContext)
    )
      throw new ForbiddenException('实际操作回执需要运营人员本人会话');
    return this.activities.record(
      buildWorkspaceAuthContextFromRequest(request),
      body,
    );
  }
  /** Reads current permitted contact history without upgrading legacy status claims. */
  @Get('activities')
  activityList(
    @Req() request: Request,
    @Query('candidateId') candidateId?: string,
    @Query('offset') offset = '0',
  ) {
    return this.activities.list(
      buildWorkspaceAuthContextFromRequest(request),
      candidateId,
      Math.max(0, Number.parseInt(offset, 10) || 0),
    );
  }
  /** Prepares a scoped candidate or company link without sending it to anyone. */
  @Post('portal-invites')
  portalCreate(@Req() request: Request, @Body() body: unknown) {
    return this.portals.create(
      buildWorkspaceAuthContextFromRequest(request),
      body,
    );
  }
  /** Lists portal metadata without returning stored capabilities or native upload receipts. */
  @Get('portal-invites')
  portalList(@Req() request: Request, @Query('offset') offset = '0') {
    return this.portals.list(
      buildWorkspaceAuthContextFromRequest(request),
      Math.max(0, Number.parseInt(offset, 10) || 0),
    );
  }
  /** Copies only the current principal's own delegated capability. */
  @Post('portal-invites/:id/link')
  portalLink(@Req() request: Request, @Param('id') id: string) {
    return this.portals.copyLink(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }
  /** Revokes a portal entry independently of contact history. */
  @Post('portal-invites/:id/revoke')
  portalRevoke(@Req() request: Request, @Param('id') id: string) {
    return this.portals.revoke(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }
  /** Reads current sharing status, never a forged projection on the person record. */
  @Get('sharing-status')
  sharingStatus(
    @Req() request: Request,
    @Query('candidateId') candidateId: string,
    @Query('jobId') jobId: string,
  ) {
    return this.consents.status(
      buildWorkspaceAuthContextFromRequest(request),
      candidateId,
      jobId,
    );
  }
  /** Exposes only the current mailbox owner's native connections and capture choices. */
  @Get('mailboxes')
  mailboxList(@Req() request: Request) {
    return this.mailboxes.list(this.mailboxOwner(request));
  }
  /** Enables recruiting capture without turning on native historical synchronization. */
  @Post('mailboxes/configure')
  mailboxConfigure(@Req() request: Request, @Body() body: unknown) {
    return this.mailboxes.configure(this.mailboxOwner(request), body);
  }
  /** Reads one latest native message in a read-only mailbox; no send, move or flag mutation is available. */
  @Post('mailboxes/receive-latest')
  @HttpCode(202)
  mailboxReceive(@Req() request: Request, @Body() body: unknown) {
    return this.mailboxes.receiveLatest(this.mailboxOwner(request), body);
  }
  /** Impersonation does not grant mailbox-owner authority even when generic CRM operations allow it. */
  private mailboxOwner(request: Request) {
    if (isImpersonating(request.impersonationContext))
      throw new ForbiddenException('邮箱操作需要所有者本人会话');
    return buildWorkspaceAuthContextFromRequest(request);
  }
  /** Archives imported EML before MIME expansion; no mailbox is connected by this upload. */
  @Post('mail-archives/upload')
  @HttpCode(202)
  @UseGuards(RecruitingUploadPermissionGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 50 * 1024 * 1024, fields: 0, parts: 1 },
    }),
  )
  uploadMail(
    @Req() request: Request,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!file) throw new BadRequestException('请上传完整EML邮件原文');
    return this.mail.receive(
      buildWorkspaceAuthContextFromRequest(request),
      file.buffer,
      { transport: 'EML_UPLOAD' },
    );
  }

  /** Uses an authorized native upload reference for remote Agent EML imports. */
  @Post('mail-archives')
  @HttpCode(202)
  importMail(@Req() request: Request, @Body() body: unknown) {
    return this.mail.importUploaded(
      buildWorkspaceAuthContextFromRequest(request),
      body,
    );
  }
  /** Lists compact complete-mail receipts independently of candidate parsing. */
  @Get('mail-archives')
  mails(@Req() request: Request, @Query('offset') offset = '0') {
    return this.mail.list(
      buildWorkspaceAuthContextFromRequest(request),
      Math.max(0, Number.parseInt(offset, 10) || 0),
    );
  }
  /** Opens complete source metadata and artifact references under native parent permissions. */
  @Get('mail-archives/:id')
  mailDetail(@Req() request: Request, @Param('id') id: string) {
    return this.mail.one(buildWorkspaceAuthContextFromRequest(request), id);
  }

  /** Forces untrusted HTML and MIME assets to download instead of executing in the CRM origin. */
  @Get('mail-archives/:id/artifacts/:key')
  async mailArtifact(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('key') key: string,
    @Res() response: Response,
  ) {
    const artifact = await this.mail.artifact(
      buildWorkspaceAuthContextFromRequest(request),
      id,
      key,
    );
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(artifact.label)}`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(artifact.bytes);
  }
  /** Resumes incomplete MIME expansion, preserving uploaded originals and assets. */
  @Post('mail-archives/:id/retry')
  @HttpCode(202)
  mailRetry(@Req() request: Request, @Param('id') id: string) {
    return this.mail.retry(buildWorkspaceAuthContextFromRequest(request), id);
  }
  /** Sends chosen resume assets plus complete mail context to the ordinary intake service. */
  @Post('mail-archives/:id/intakes')
  @HttpCode(202)
  mailIntake(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.mail.submitIntake(
      buildWorkspaceAuthContextFromRequest(request),
      id,
      body,
    );
  }
  /** Resolves a linked candidate label through the same directory permissions. */
  @Get('candidates/:id')
  candidate(@Req() request: Request, @Param('id') id: string) {
    return this.directory.candidate(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }
  /** Resolves a linked job without loading its private raw materials into a selector. */
  @Get('jobs/:id')
  job(@Req() request: Request, @Param('id') id: string) {
    return this.directory.job(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }
  /** Queues editable text without contacting or publishing anything. */
  @Post('drafts')
  @HttpCode(202)
  draft(@Req() request: Request, @Body() body: unknown) {
    return this.drafts.submit(
      buildWorkspaceAuthContextFromRequest(request),
      body,
    );
  }
  /** Lists authorized draft receipts rather than complete candidate materials. */
  @Get('drafts')
  draftQueue(@Req() request: Request, @Query('offset') offset = '0') {
    return this.drafts.list(
      buildWorkspaceAuthContextFromRequest(request),
      Math.max(0, Number.parseInt(offset, 10) || 0),
    );
  }
  /** Rechecks source access and staleness before showing a draft. */
  @Get('drafts/:id')
  draftDetail(@Req() request: Request, @Param('id') id: string) {
    return this.drafts.one(buildWorkspaceAuthContextFromRequest(request), id);
  }
  /** Resumes failed generation using trusted checkpoints. */
  @Post('drafts/:id/retry')
  @HttpCode(202)
  draftRetry(@Req() request: Request, @Param('id') id: string) {
    return this.drafts.retry(buildWorkspaceAuthContextFromRequest(request), id);
  }
  /** Saves editable text; approval is restricted to the operator's direct session. */
  @Post('drafts/:id/review')
  draftReview(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.review(
      buildWorkspaceAuthContextFromRequest(request),
      id,
      body,
    );
  }
  /** Returns minimal candidate choices under native record permissions. */
  @Get('candidates')
  candidates(
    @Req() request: Request,
    @Query('search') search = '',
    @Query('offset') offset = '0',
  ) {
    return this.directory.candidates(
      buildWorkspaceAuthContextFromRequest(request),
      search,
      Math.max(0, Number.parseInt(offset, 10) || 0),
    );
  }

  /** Searches company-bound jobs without duplicating the matching pool rules. */
  @Get('jobs')
  jobs(
    @Req() request: Request,
    @Query('companyId') companyId?: string,
    @Query('search') search = '',
    @Query('active') active = 'true',
    @Query('offset') offset = '0',
  ) {
    return this.directory.jobs(buildWorkspaceAuthContextFromRequest(request), {
      companyId,
      search,
      active: active === 'true',
      offset: Math.max(0, Number.parseInt(offset, 10) || 0),
    });
  }

  /** Opens the authorized company already selected for an intake. */
  @Get('companies/:id')
  company(@Req() request: Request, @Param('id') id: string) {
    return this.directory.company(
      buildWorkspaceAuthContextFromRequest(request),
      id,
    );
  }

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

  /** Downloads parent-authorized originals without executing HTML or MIME assets in the CRM origin. */
  @Get('resume-intakes/:id/files/:fileId')
  async intakeMaterial(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res() response: Response,
  ) {
    const artifact = await this.intakes.material(
      buildWorkspaceAuthContextFromRequest(request),
      id,
      fileId,
    );
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(artifact.label)}`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(artifact.bytes);
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
  /** Searches existing companies before creating a JD batch. */
  @Get('companies')
  companies(
    @Req() request: Request,
    @Query('search') search = '',
    @Query('offset') offset = '0',
  ) {
    return this.directory.companies(
      buildWorkspaceAuthContextFromRequest(request),
      search,
      Math.max(0, Number.parseInt(offset, 10) || 0),
    );
  }

  /** Creates a company through the same validated domain boundary as native tools. */
  @Post('companies')
  createCompany(@Req() request: Request, @Body() body: unknown) {
    return this.directory.createCompany(
      buildWorkspaceAuthContextFromRequest(request),
      body,
    );
  }
}
