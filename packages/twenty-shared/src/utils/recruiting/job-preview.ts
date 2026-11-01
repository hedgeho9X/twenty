/** Shares advisory job-preview facts across native services and operator edits without merging or creating records. */

/** Stable preview identities keep local edits independent from list ordering. */
export type RecruitingPreviewName = {
  itemId: string;
  jobId: string;
  status: string;
  title: string;
};

/** Existing names are supplied only after the caller applies company and native record permissions. */
export type RecruitingPreviewExistingJob = {
  id: string;
  name: string;
  companyId: string;
  jobStatus?: string;
};

/** A name warning is an operator hint, never evidence that two jobs are the same. */
export type RecruitingPreviewNameWarning = {
  source: 'EXISTING' | 'BATCH';
  id: string;
  label: string;
  status?: string;
};

/** Only case, width and whitespace are normalized; meaningful C++/C# or location/level text remains distinct. */
export const normalizeRecruitingPreviewName = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Finds visible same-name records and pending siblings without blocking legitimate same-name creation. */
export const getRecruitingPreviewNameWarnings = (
  item: RecruitingPreviewName,
  items: RecruitingPreviewName[],
  existing: RecruitingPreviewExistingJob[],
  companyId: string,
): RecruitingPreviewNameWarning[] => {
  const key = normalizeRecruitingPreviewName(item.title);
  if (!key || ['CREATED', 'DISCARDED'].includes(item.status)) return [];
  return [
    ...existing
      .filter(
        (job) =>
          job.companyId === companyId &&
          job.id !== item.jobId &&
          normalizeRecruitingPreviewName(job.name) === key,
      )
      .map((job) => ({
        source: 'EXISTING' as const,
        id: job.id,
        label: job.name,
        status: job.jobStatus,
      })),
    ...items
      .filter(
        (other) =>
          other.itemId !== item.itemId &&
          !['CREATED', 'DISCARDED'].includes(other.status) &&
          normalizeRecruitingPreviewName(other.title) === key,
      )
      .map((other) => ({
        source: 'BATCH' as const,
        id: other.itemId,
        label: other.title,
      })),
  ];
};

/** Missing optional facts remain unknown; only title and description are required by the existing creation schema. */
export const getRecruitingPreviewMissingFields = (draft: {
  title: string;
  description: string;
  category?: string | null;
  employmentTypes: readonly string[];
  workModes: readonly string[];
  locations: readonly string[];
}): string[] => [
  ...(!draft.title.trim() ? ['title'] : []),
  ...(!draft.description.trim() ? ['description'] : []),
  ...(!draft.category ? ['category'] : []),
  ...(!draft.employmentTypes.length ? ['employmentTypes'] : []),
  ...(!draft.workModes.length ? ['workModes'] : []),
  ...(!draft.locations.length ? ['locations'] : []),
];
