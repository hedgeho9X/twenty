/** Intake receipts remain useful after worker jobs are removed from Redis. */
export type RecruitingIntake = {
  intakeId: string;
  batchId?: string;
  files?: { fileId: string; label: string }[];
  name?: string;
  kind: 'CANDIDATE' | 'JOB';
  state: string;
  stage: string;
  error?: string;
  createdAt: string;
  recordUrl?: string;
  candidateId?: string;
  jobIds?: string[];
  matchingStatus?: string;
  matchingRunIds?: string[];
  matchingError?: string;
  needsReview?: boolean;
};
