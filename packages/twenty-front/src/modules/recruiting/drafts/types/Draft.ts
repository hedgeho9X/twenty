/** A text draft carries review state independently of actual communication or publication. */
export type RecruitingDraft = {
  draftId: string;
  selectedIds?: string[];
  jobPageUrl?: string;
  name: string;
  kind: 'GREETING' | 'JOB_PUBLICATION';
  candidateId?: string;
  jobId?: string;
  note?: string;
  status: string;
  error?: string;
  title?: string;
  body?: string;
  stale?: boolean;
  approvedAt?: string;
  generation?: { profile: { reviewNotes: string[] } };
  source?: { candidateUrl?: string; jobUrl?: string };
};
