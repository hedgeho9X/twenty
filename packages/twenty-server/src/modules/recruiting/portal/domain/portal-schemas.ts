/** Defines bounded candidate-authored preferences and portal operations; database identity stays server-owned. */
import { z } from 'zod';
import { employmentTypeSchema, workModeSchema } from '../../intake/schemas';

/** Empty preferences remain unknown; strict flags require an explicit candidate choice. */
export const portalProfileSchema = z
  .object({
    fullName: z.string().max(300),
    email: z.string().max(500),
    phone: z.string().max(100),
    summary: z.string().max(10_000),
    skills: z.array(z.string().max(300)).max(100),
    expectedRoles: z.array(z.string().max(300)).max(30),
    employmentTypes: z.array(employmentTypeSchema).max(4),
    strictEmployment: z.boolean(),
    workModes: z.array(workModeSchema).max(3),
    strictWorkMode: z.boolean(),
    locations: z.array(z.string().max(300)).max(30),
    note: z.string().max(10_000),
  })
  .strict()
  .refine(
    (value) => !value.strictEmployment || value.employmentTypes.length > 0,
    { path: ['employmentTypes'], message: '请选择至少一种可接受的雇佣类型' },
  )
  .refine((value) => !value.strictWorkMode || value.workModes.length > 0, {
    path: ['workModes'],
    message: '请选择至少一种可接受的工作方式',
  });
/** Candidate claims remain separate from resume extraction and private operator notes. */
export type PortalProfile = z.infer<typeof portalProfileSchema>;

/** Accepts only versioned self-reports, never arbitrary private CRM objects. */
export const readPortalSelfProfile = (
  value: unknown,
): PortalProfile | undefined => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('profile' in value)
  )
    return undefined;
  const result = portalProfileSchema.safeParse(value.profile);
  return result.success ? result.data : undefined;
};

/** Each link has one candidate; a company-view link is further narrowed to one job. */
export const portalInviteInputSchema = z
  .object({
    kind: z.enum(['CANDIDATE', 'COMPANY']),
    candidateId: z.string().uuid(),
    jobIds: z.array(z.string().uuid()).max(5).default([]),
    expiresInDays: z.number().int().min(1).max(14).default(7),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict()
  .refine((value) => value.kind !== 'COMPANY' || value.jobIds.length === 1);

/** Public requests carry only a portal capability, not a native login cookie or workspace token. */
export const portalActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('view') }),
  z.object({ action: z.literal('profile_save'), profile: portalProfileSchema }),
  z.object({
    action: z.literal('upload_target'),
    filename: z.string().min(1).max(512),
    size: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
  }),
  z.object({ action: z.literal('upload_complete'), fileId: z.string().uuid() }),
  z.object({
    action: z.literal('resume_submit'),
    fileIds: z.array(z.string().uuid()).min(1).max(10),
    note: z.string().max(100_000).default(''),
    idempotencyKey: z.string().min(1).max(256),
  }),
  z.object({
    action: z.literal('intake_progress'),
    intakeId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('intent'),
    jobId: z.string().uuid(),
    interested: z.boolean(),
  }),
  z.object({
    action: z.literal('consent'),
    jobId: z.string().uuid(),
    choice: z.enum(['CONFIRM', 'WITHDRAW']),
    fileIds: z.array(z.string().uuid()).max(30).default([]),
  }),
  z.object({ action: z.literal('download'), fileId: z.string().uuid() }),
]);
