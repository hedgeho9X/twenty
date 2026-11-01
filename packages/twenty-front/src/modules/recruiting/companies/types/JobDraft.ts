/** Operators review each extracted JD before it becomes a native recruiting job. */
export type RecruitingJobDraft = {
  title: string;
  description: string;
  preferences: string;
  category: string | null;
  employmentTypes: string[];
  workModes: string[];
  locations: string[];
};
