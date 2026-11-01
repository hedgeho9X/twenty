/** A single pair never substitutes a failed or missing score with zero. */
export type RecruitingPair = {
  candidateId: string;
  jobId: string;
  candidateLabel: string;
  jobLabel: string;
  companyId?: string;
  candidateUrl: string;
  jobUrl: string;
  status: string;
  score?: number;
  error?: string;
  cached: boolean;
  eligibility: {
    status: string;
    reasons: { code: string; message: string; blocking: boolean }[];
  };
  intent?: { expectedRoles: string[]; requiresConfirmation: boolean };
};
