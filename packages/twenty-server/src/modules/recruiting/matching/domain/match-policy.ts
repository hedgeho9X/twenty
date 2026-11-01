/** Applies explicit eligibility constraints before model scoring; performs no I/O. */
import { createHash } from 'node:crypto';

/** A normalized constraint whose certainty is checked against source material upstream. */
export type RecruitingConstraint = {
  values: string[];
  certainty: 'confirmed' | 'unconfirmed';
};

/** Candidate preferences use canonical values, never inferred from seniority or age. */
export type CandidateEligibility = {
  employmentTypes?: RecruitingConstraint;
  excludedEmploymentTypes?: RecruitingConstraint;
  workModes?: RecruitingConstraint;
  locationIds?: RecruitingConstraint;
};

/** Facts refer to the current job version; location IDs must be canonical city IDs. */
export type JobEligibility = {
  status: 'RECRUITING' | 'CLOSED' | 'PAUSED' | 'NEEDS_DETAILS';
  companyStatus?: 'CLOSED' | 'PAUSED';
  employmentTypes?: string[];
  workModes?: string[];
  locationIds?: string[];
};

/** Reasons explain program decisions and must not be presented as Jev explanations. */
export type EligibilityReason = {
  code: string;
  message: string;
  blocking: boolean;
};

/** Eligible means no known conflict; it does not imply sufficient ability or a recommendation. */
export type EligibilityResult = {
  status: 'eligible' | 'excluded' | 'needs_confirmation';
  reasons: EligibilityReason[];
};

/** Checks set overlap without converting unknown preferences into negative evidence. */
const checkConstraint = (
  constraint: RecruitingConstraint | undefined,
  actualValues: string[],
  field: string,
  label: string,
): EligibilityReason[] => {
  if (!constraint || constraint.values.length === 0) return [];
  if (actualValues.some((value) => constraint.values.includes(value)))
    return [];
  const blocking =
    constraint.certainty === 'confirmed' && actualValues.length > 0;

  return [
    {
      code: `${field}_${blocking ? 'conflict' : 'unknown'}`,
      message: blocking ? `${label}与候选人明确条件冲突` : `${label}需要确认`,
      blocking,
    },
  ];
};

/** Filters known conflicts before paid evaluation while retaining unknowns for review. */
export const evaluateRecruitingEligibility = (
  candidate: CandidateEligibility,
  job: JobEligibility,
): EligibilityResult => {
  const reasons: EligibilityReason[] = [];
  if (job.companyStatus)
    reasons.push({
      code: 'company_not_recruiting',
      message: '公司当前已停止或暂停招聘',
      blocking: true,
    });
  if (job.status !== 'RECRUITING') {
    reasons.push({
      code: 'job_not_recruiting',
      message: '岗位当前不在招聘中',
      blocking: true,
    });
  }
  reasons.push(
    ...checkConstraint(
      candidate.employmentTypes,
      job.employmentTypes ?? [],
      'employment_type',
      '雇佣类型',
    ),
  );
  const excludedTypes = candidate.excludedEmploymentTypes;
  if (
    excludedTypes?.values.length &&
    job.employmentTypes?.length &&
    job.employmentTypes.every((value) => excludedTypes.values.includes(value))
  ) {
    const blocking = excludedTypes.certainty === 'confirmed';
    reasons.push({
      code: `employment_type_rejected_${blocking ? 'conflict' : 'unknown'}`,
      message: blocking
        ? '岗位仅提供候选人明确不接受的雇佣类型'
        : '需确认候选人是否接受该雇佣类型',
      blocking,
    });
  }
  reasons.push(
    ...checkConstraint(
      candidate.workModes,
      job.workModes ?? [],
      'work_mode',
      '工作方式',
    ),
  );
  const availableWorkModes = (job.workModes ?? []).filter(
    (mode) =>
      candidate.workModes?.certainty !== 'confirmed' ||
      candidate.workModes.values.length === 0 ||
      candidate.workModes.values.includes(mode),
  );

  if (!availableWorkModes.includes('remote')) {
    const locationConstraint =
      candidate.locationIds && !job.workModes?.length
        ? { ...candidate.locationIds, certainty: 'unconfirmed' as const }
        : candidate.locationIds;

    reasons.push(
      ...checkConstraint(
        locationConstraint,
        job.locationIds ?? [],
        'location',
        '工作地点',
      ),
    );
  } else if (
    candidate.workModes?.certainty === 'unconfirmed' &&
    candidate.workModes.values.length > 0 &&
    !candidate.workModes.values.includes('remote') &&
    candidate.locationIds?.values.length &&
    !job.locationIds?.some((location) =>
      candidate.locationIds?.values.includes(location),
    )
  ) {
    reasons.push({
      code: 'remote_alternative_unknown',
      message: '需确认候选人是否接受远程安排',
      blocking: false,
    });
  }

  return {
    status: reasons.some((reason) => reason.blocking)
      ? 'excluded'
      : reasons.length > 0
        ? 'needs_confirmation'
        : 'eligible',
    reasons,
  };
};

/** All content-bearing inputs are independently versioned to prevent stale score reuse. */
export type PairEvaluationVersion = {
  workspaceId: string;
  candidateId: string;
  candidateVersion: string;
  jobId: string;
  jobVersion: string;
  companyVersion: string;
  protocolVersion: string;
  modelVersion: string;
};

/** Produces the same key for both ranking directions and isolates workspace caches. */
export const getPairEvaluationCacheKey = (
  version: PairEvaluationVersion,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        version.workspaceId,
        version.candidateId,
        version.candidateVersion,
        version.jobId,
        version.jobVersion,
        version.companyVersion,
        version.protocolVersion,
        version.modelVersion,
      ]),
    )
    .digest('hex');
