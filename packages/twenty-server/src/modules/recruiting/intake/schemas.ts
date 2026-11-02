/** Defines compact recruiting facts and intake contracts; database identities remain server-owned. */
import { z } from 'zod';

export const recruitingCategorySchema = z.enum([
  'engineering',
  'product',
  'design',
  'operations',
  'growth_marketing',
  'sales_business',
  'data_ai',
  'other',
]);
export const employmentTypeSchema = z.enum([
  'full_time',
  'part_time',
  'internship',
  'contract',
]);
export const workModeSchema = z.enum(['onsite', 'hybrid', 'remote']);

/** Includes explicit preference evidence only where deterministic hard filters need it. */
export const candidateProfileSchema = z.object({
  name: z.string().nullable(),
  summary: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  skills: z.array(z.string()),
  experience: z.array(z.string()),
  education: z.array(z.string()),
  expectedRoles: z.array(z.string()),
  category: recruitingCategorySchema.nullable(),
  employmentTypes: z.array(employmentTypeSchema),
  employmentEvidence: z.string().nullable(),
  workModes: z.array(workModeSchema),
  workModeEvidence: z.string().nullable(),
  locations: z.array(z.string()),
  locationEvidence: z.string().nullable(),
});

/** One company can submit several jobs in one source document without losing their boundaries. */
export const jobProfilesSchema = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      preferences: z.string(),
      category: recruitingCategorySchema.nullable(),
      employmentTypes: z.array(employmentTypeSchema),
      workModes: z.array(workModeSchema),
      locations: z.array(z.string()),
    }),
  ),
});

/** File references refer to completed native uploads in the caller's workspace. */
export const intakeFileSchema = z.object({
  fileId: z.string().uuid(),
  label: z.string().min(1).max(512),
  role: z.enum(['primary', 'supplement', 'archive']).default('primary'),
  uploadReceipt: z.string().max(4096).optional(),
});

/** API and UI submissions preserve the same raw text, notes and provenance. */
export const intakeInputSchema = z
  .object({
    kind: z.enum(['CANDIDATE', 'JOB']),
    employmentType: z.enum(['full_time', 'internship']).optional(),
    files: z.array(intakeFileSchema).max(30).default([]),
    text: z.string().max(500_000).optional(),
    note: z.string().max(100_000).nullish(),
    source: z.enum(['manual', 'api', 'email']).default('api'),
    sourceId: z.string().max(2048).optional(),
    companyId: z.string().uuid().optional(),
    candidateId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
    idempotencyKey: z.string().min(1).max(256).optional(),
    mail: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source !== 'email' && !value.employmentType) {
      context.addIssue({
        code: 'custom',
        path: ['employmentType'],
        message: '请选择正式或实习',
      });
    }
    if (
      value.kind === 'CANDIDATE' &&
      value.files.filter((file) => file.role !== 'archive').length > 5
    ) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: '同一候选人最多上传5份文件',
      });
    }

    if (
      !value.files.some((file) => file.role !== 'archive') &&
      !value.text?.trim()
    ) {
      context.addIssue({
        code: 'custom',
        message: '请上传文件或输入岗位正文',
        path: ['files'],
      });
    }
    if (
      value.kind === 'CANDIDATE' &&
      !value.files.some((file) => file.role !== 'archive')
    ) {
      context.addIssue({
        code: 'custom',
        message: '请上传简历文件',
        path: ['files'],
      });
    }
    if (value.kind === 'JOB' && !value.companyId) {
      context.addIssue({
        code: 'custom',
        message: '请先选择公司',
        path: ['companyId'],
      });
    }
  });

/** Candidate facts remain a simple object shared by the list, portal and pair scorer. */
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
/** Confirmed job facts remain separate from server-owned item and record identities. */
export type RecruitingJobProfile = z.infer<
  typeof jobProfilesSchema
>['jobs'][number];
/** Submission metadata is kept separate from model-generated facts. */
export type RecruitingIntakeInput = z.infer<typeof intakeInputSchema>;
