import { type RecruitingPair } from './Pair';

/** Matching progress and review state are distinct from recommendation or contact status. */
export type RecruitingMatchRun = {
  runId: string;
  direction: string;
  subjectId: string;
  subjectLabel?: string;
  expectedRoles?: string[];
  status: string;
  source?: 'manual' | 'api' | 'email' | 'system';
  createdAt: string;
  reviewedAt?: string;
  error?: string;
  counts: {
    total: number;
    processed: number;
    scored: number;
    excluded: number;
    needsReview: number;
    failed: number;
    cached: number;
    pending?: number;
    unavailable?: number;
  };
  top?: RecruitingPair[];
  results?: RecruitingPair[];
  complete?: boolean;
  stale?: number;
  inaccessible?: number;
  poolChanged?: boolean;
  currentPoolCount?: number;
  notice?: string;
};
