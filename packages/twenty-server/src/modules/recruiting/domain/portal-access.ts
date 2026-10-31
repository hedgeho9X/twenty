/** Issues purpose-bound portal capabilities without exposing a native user or workspace access token. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { stableSerialize } from './match-context';

const actorSchema = z
  .object({
    workspaceId: z.string().uuid(),
    userWorkspaceId: z.string().uuid().optional(),
    apiKeyId: z.string().uuid().optional(),
    applicationId: z.string().uuid().optional(),
    viaApplicationId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
  })
  .strict()
  .refine((actor) =>
    Boolean(actor.userWorkspaceId || actor.apiKeyId || actor.applicationId),
  );
const scopeSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal('recruiting-portal'),
    inviteId: z.string().uuid(),
    actor: actorSchema,
    expiresAt: z.number().int().positive(),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** Only stable principal references enter this capability; the invitation row owns candidate and audience scope. */
export type RecruitingPortalAccess = z.infer<typeof scopeSchema>;

/** Uses a separate purpose prefix and a two-part encoding that native JWT authentication cannot consume. */
export const signPortalAccess = (
  value: RecruitingPortalAccess,
  secret: string,
) => {
  const body = Buffer.from(stableSerialize(scopeSchema.parse(value))).toString(
    'base64url',
  );
  const signature = createHmac('sha256', secret)
    .update(`recruiting-portal-v1:${body}`)
    .digest('base64url');
  return `${body}.${signature}`;
};

/** Validates integrity and expiry before a caller can trigger principal resolution or record reads. */
export const verifyPortalAccess = (
  token: string,
  secret: string,
  now = Date.now(),
): RecruitingPortalAccess => {
  if (typeof token !== 'string' || token.length > 8192)
    throw new Error('Portal access is unavailable');
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Portal access is unavailable');
  const expected = createHmac('sha256', secret)
    .update(`recruiting-portal-v1:${parts[0]}`)
    .digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new Error('Portal access is unavailable');
  const scope = scopeSchema.parse(
    JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
  );
  if (scope.expiresAt <= now) throw new Error('Portal access is unavailable');
  return scope;
};
