/** Exposes the shared recruiting workflow through Twenty's native tool registry and MCP transport. */
import { HttpException } from '@nestjs/common';
import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { RecruitingToolAuthorizationService } from './recruiting-tool-authorization.service';
import {
  RecruitingDirectoryService,
  recruitingCompanyInputSchema,
} from './recruiting-directory.service';
import { RecruitingUploadService } from './recruiting-upload.service';
import { RecruitingIntakeService } from './recruiting-intake.service';
import {
  RecruitingMatchingService,
  recruitingMatchInputSchema,
} from './recruiting-matching.service';
import { intakeFileSchema, jobProfilesSchema } from './recruiting-schemas';
import {
  RecruitingDraftsService,
  recruitingDraftInputSchema,
} from './recruiting-drafts.service';
import { RecruitingMailService } from './recruiting-mail.service';

const offset = z.number().int().nonnegative().default(0);
const task = {
  taskId: z.string().uuid(),
  kind: z.enum(['intake', 'match', 'draft', 'mail']),
};
const operationsSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('mail_import'),
    file: intakeFileSchema.required({ uploadReceipt: true }),
  }),
  z.object({
    operation: z.literal('mail_select'),
    archiveId: z.string().uuid(),
    artifactKeys: z.array(z.string()).min(1).max(24),
    candidateId: z.string().uuid().optional(),
    note: z.string().max(90_000).optional(),
  }),
  z.object({
    operation: z.literal('draft_submit'),
    request: recruitingDraftInputSchema,
  }),
  z.object({
    operation: z.literal('draft_edit'),
    draftId: z.string().uuid(),
    title: z.string().max(1000),
    body: z.string().min(1).max(100_000),
  }),
  z.object({
    operation: z.literal('companies_search'),
    search: z.string().default(''),
    offset,
  }),
  z.object({
    operation: z.literal('company_create'),
    company: recruitingCompanyInputSchema,
  }),
  z.object({
    operation: z.literal('candidates_search'),
    search: z.string().default(''),
    offset,
  }),
  z.object({
    operation: z.literal('jobs_search'),
    companyId: z.string().uuid().optional(),
    search: z.string().optional(),
    active: z.boolean().default(true),
    offset,
  }),
  z.object({
    operation: z.literal('upload_target'),
    filename: z.string().min(1).max(512),
    size: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
  }),
  z.object({
    operation: z.literal('upload_complete'),
    uploadReceipt: z.string().max(4096),
  }),
  z.object({
    operation: z.literal('resume_submit'),
    files: z
      .array(intakeFileSchema.required({ uploadReceipt: true }))
      .min(1)
      .max(30),
    note: z.string().max(100_000).optional(),
    candidateId: z.string().uuid().optional(),
    idempotencyKey: z.string().min(1).max(256),
    batchId: z.string().uuid().optional(),
  }),
  z.object({
    operation: z.literal('jobs_submit'),
    companyId: z.string().uuid(),
    files: z
      .array(intakeFileSchema.required({ uploadReceipt: true }))
      .max(30)
      .default([]),
    text: z.string().max(500_000).optional(),
    note: z.string().max(100_000).optional(),
    idempotencyKey: z.string().min(1).max(256),
    batchId: z.string().uuid().optional(),
  }),
  z.object({
    operation: z.literal('jobs_confirm'),
    intakeId: z.string().uuid(),
    items: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          draft: jobProfilesSchema.shape.jobs.element,
        }),
      )
      .max(200),
    discardedItemIds: z.array(z.string().uuid()).max(200).default([]),
  }),
  z.object({ operation: z.literal('task_get'), ...task }),
  z.object({ operation: z.literal('task_retry'), ...task }),
  z.object({
    operation: z.literal('queue_list'),
    kind: z.enum(['intake', 'match', 'draft', 'mail']),
    offset,
  }),
  z.object({
    operation: z.literal('match_start'),
    request: recruitingMatchInputSchema,
  }),
]);

@DefineTool({
  name: 'recruiting_operations',
  category: ToolCategory.ACTION,
  requiredPermissionFlags: [],
  icon: 'IconBriefcase',
  description:
    '招聘业务入口。先搜索或创建公司，再提交JD材料，task_get取稳定itemId预览后jobs_confirm确认；简历文件先upload_target，把字节PUT到返回URL，再upload_complete取得fileId与uploadReceipt，最后resume_submit。HTTP/MCP无法读取服务器本地路径。所有长任务返回intakeId或runId，queue_list/task_get查看进度，task_retry重试；匹配支持候选人找岗位、岗位找候选人、指定人岗，最多前五且需检查complete和覆盖量。必须检查逐项FAILED/NEEDS_REVIEW，受理不代表完成。不要通过通用CRUD改内部任务JSON、伪造评分、自动联系候选人或代替候选人同意分享。权限与普通业务API相同。',
})
/** Dispatches typed operations to the same services as UI and HTTP; no system principal or admin token is introduced. */
export class RecruitingOperationsTool extends BaseTool<
  typeof operationsSchema
> {
  readonly inputSchema = operationsSchema;
  constructor(
    private readonly authorization: RecruitingToolAuthorizationService,
    private readonly directory: RecruitingDirectoryService,
    private readonly uploads: RecruitingUploadService,
    private readonly intakes: RecruitingIntakeService,
    private readonly matching: RecruitingMatchingService,
    private readonly drafts: RecruitingDraftsService,
    private readonly mail: RecruitingMailService,
  ) {
    super();
  }

  /** Resolves the current caller before any operation, then returns durable business receipts. */
  async execute({
    input,
    context,
  }: ToolExecuteArgs<typeof operationsSchema>): Promise<ToolOutput> {
    try {
      const auth = await this.authorization.resolve(context);
      const tasks = {
        intake: this.intakes,
        match: this.matching,
        draft: this.drafts,
        mail: this.mail,
      };
      let result: object;
      switch (input.operation) {
        case 'mail_import':
          result = await this.mail.importUploaded(auth, input.file);
          break;
        case 'mail_select':
          result = await this.mail.submitIntake(auth, input.archiveId, {
            artifactKeys: input.artifactKeys,
            candidateId: input.candidateId,
            note: input.note,
          });
          break;
        case 'draft_submit':
          result = await this.drafts.submit(auth, input.request);
          break;
        case 'draft_edit':
          result = await this.drafts.review(auth, input.draftId, {
            title: input.title,
            body: input.body,
          });
          break;
        case 'companies_search':
          result = await this.directory.companies(
            auth,
            input.search,
            input.offset,
          );
          break;
        case 'company_create':
          result = await this.directory.createCompany(auth, input.company);
          break;
        case 'candidates_search':
          result = await this.directory.candidates(
            auth,
            input.search,
            input.offset,
          );
          break;
        case 'jobs_search':
          result = await this.directory.jobs(auth, input);
          break;
        case 'upload_target':
          result = await this.uploads.target(auth, {
            filename: input.filename,
            size: input.size,
          });
          break;
        case 'upload_complete':
          result = await this.uploads.complete(auth, {
            uploadReceipt: input.uploadReceipt,
          });
          break;
        case 'resume_submit': {
          const { operation: _operation, ...data } = input;
          result = await this.intakes.submit(auth, {
            ...data,
            kind: 'CANDIDATE',
            source: 'api',
          });
          break;
        }
        case 'jobs_submit': {
          const { operation: _operation, ...data } = input;
          result = await this.intakes.submit(auth, {
            ...data,
            kind: 'JOB',
            source: 'api',
          });
          break;
        }
        case 'jobs_confirm':
          result = await this.intakes.confirmJobs(auth, input.intakeId, {
            items: input.items,
            discardedItemIds: input.discardedItemIds,
          });
          break;
        case 'task_get':
          result = await tasks[input.kind].one(auth, input.taskId);
          break;
        case 'task_retry':
          result = await tasks[input.kind].retry(auth, input.taskId);
          break;
        case 'queue_list':
          result = await tasks[input.kind].list(auth, input.offset);
          break;
        case 'match_start':
          result = await this.matching.submit(auth, input.request);
          break;
      }
      return {
        success: true,
        message: '调用成功；长任务请继续查询状态及逐项结果，不代表已处理完成。',
        result,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof HttpException
            ? error.message
            : '招聘操作未完成，请检查输入、权限或任务状态',
        error: 'RECRUITING_OPERATION_FAILED',
      };
    }
  }
}
