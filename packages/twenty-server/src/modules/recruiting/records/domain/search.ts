import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import {
  decodeCursor,
  encodeCursorData,
} from 'src/engine/api/graphql/graphql-query-runner/utils/cursors.util';

/** Search syntax is server-owned; only bounded scalar values cross the API boundary. */
export type RecruitingSearchResource = 'candidates' | 'companies' | 'jobs';

const cursorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => {
    try {
      const decoded = z
        .object({ id: z.string().uuid() })
        .strict()
        .safeParse(decodeCursor(value));
      return decoded.success && encodeCursorData(decoded.data) === value;
    } catch {
      return false;
    }
  }, 'Invalid search cursor');

const querySchema = z
  .object({
    q: z.string().trim().min(1).max(100),
    limit: z
      .string()
      .regex(/^[1-9]\d*$/)
      .default('20')
      .transform(Number)
      .refine(Number.isSafeInteger)
      .transform((value) => Math.min(value, 50)),
    cursor: cursorSchema.optional(),
  })
  .strict();

export const parseRecruitingSearch = (
  resource: RecruitingSearchResource,
  value: unknown,
) => {
  const schema =
    resource === 'jobs'
      ? querySchema.extend({ companyId: z.string().uuid().optional() })
      : querySchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException(
      'Invalid search query, limit, cursor or companyId',
    );
  return {
    ...parsed.data,
    companyId:
      'companyId' in parsed.data
        ? (parsed.data.companyId as string | undefined)
        : undefined,
  };
};

/** PostgreSQL LIKE uses backslash as its default escape character. */
export const recruitingLikePattern = (query: string) =>
  `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/** No client input supplies an object, field path, operator or projection. */
export const recruitingSearchPolicies = {
  candidates: {
    objectName: 'person',
    paths: [
      'name.firstName',
      'name.lastName',
      'jobTitle',
      'emails.primaryEmail',
      'phones.primaryPhoneNumber',
    ],
    output: ['id', 'name', 'jobTitle'],
  },
  companies: {
    objectName: 'company',
    paths: ['name', 'domainName.primaryLinkUrl'],
    output: ['id', 'name', 'domainName'],
  },
  jobs: {
    objectName: 'recruitmentJob',
    paths: ['name', 'jobDescription.markdown'],
    output: ['id', 'name', 'companyId', 'jobStatus'],
  },
} as const;
