/** Server-owned draft identity survives reorder, partial failure and retries. */
import { type RecruitingJobDraft } from './RecruitingJobDraft';
export type RecruitingJobItem = {
  itemId: string;
  jobId: string;
  draft: RecruitingJobDraft;
  status: 'DRAFT' | 'CREATED' | 'FAILED' | 'DISCARDED';
  error?: string;
  matchingError?: string;
  matchingRunId?: string;
};
