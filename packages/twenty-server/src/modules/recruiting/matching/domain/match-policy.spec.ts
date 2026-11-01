/** Regression cases for eligibility errors observed in the recruiting experiment. */
import {
  evaluateRecruitingEligibility,
  getPairEvaluationCacheKey,
  type PairEvaluationVersion,
} from './match-policy';

describe('recruiting eligibility', () => {
  it('excludes an internship when full-time-only is explicitly confirmed', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          employmentTypes: { values: ['full_time'], certainty: 'confirmed' },
        },
        { status: 'RECRUITING', employmentTypes: ['internship'] },
      ),
    ).toMatchObject({
      status: 'excluded',
      reasons: [{ code: 'employment_type_conflict', blocking: true }],
    });
  });

  it('does not invent employment preferences from missing information', () => {
    expect(
      evaluateRecruitingEligibility(
        {},
        {
          status: 'RECRUITING',
          employmentTypes: ['internship'],
        },
      ).status,
    ).toBe('eligible');
  });

  it('keeps an unconfirmed conflicting preference for manual confirmation', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          employmentTypes: { values: ['full_time'], certainty: 'unconfirmed' },
        },
        { status: 'RECRUITING', employmentTypes: ['internship'] },
      ).status,
    ).toBe('needs_confirmation');
  });

  it('keeps a missing job employment type unknown', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          employmentTypes: { values: ['full_time'], certainty: 'confirmed' },
        },
        { status: 'RECRUITING' },
      ).status,
    ).toBe('needs_confirmation');
  });

  it('excludes closed or incomplete jobs before any model evaluation', () => {
    for (const status of ['CLOSED', 'PAUSED', 'NEEDS_DETAILS'] as const) {
      expect(evaluateRecruitingEligibility({}, { status }).status).toBe(
        'excluded',
      );
    }
  });

  it('accepts any overlap among explicitly allowed employment types', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          employmentTypes: {
            values: ['part_time', 'internship'],
            certainty: 'confirmed',
          },
        },
        { status: 'RECRUITING', employmentTypes: ['internship'] },
      ).status,
    ).toBe('eligible');
  });

  it('accepts a job offering both internship and full-time employment', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          employmentTypes: { values: ['full_time'], certainty: 'confirmed' },
        },
        { status: 'RECRUITING', employmentTypes: ['internship', 'full_time'] },
      ).status,
    ).toBe('eligible');
  });

  it('does not impose an onsite city restriction on a remote job', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          locationIds: { values: ['city:CN-SH'], certainty: 'confirmed' },
        },
        {
          status: 'RECRUITING',
          workModes: ['remote'],
          locationIds: ['city:CN-BJ'],
        },
      ).status,
    ).toBe('eligible');
  });

  it('does retain an explicit rejection of remote work', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          workModes: { values: ['onsite'], certainty: 'confirmed' },
        },
        { status: 'RECRUITING', workModes: ['remote'] },
      ).status,
    ).toBe('excluded');
  });

  it('does not reject a city conflict before the onsite requirement is known', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          locationIds: { values: ['city:CN-SH'], certainty: 'confirmed' },
        },
        { status: 'RECRUITING', locationIds: ['city:CN-BJ'] },
      ).status,
    ).toBe('needs_confirmation');
  });

  it('excludes an explicit onsite city conflict', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          locationIds: { values: ['city:CN-SH'], certainty: 'confirmed' },
        },
        {
          status: 'RECRUITING',
          workModes: ['onsite'],
          locationIds: ['city:CN-BJ'],
        },
      ).status,
    ).toBe('excluded');
  });

  it('checks location when the candidate only accepts the onsite option', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          workModes: { values: ['onsite'], certainty: 'confirmed' },
          locationIds: { values: ['city:CN-SH'], certainty: 'confirmed' },
        },
        {
          status: 'RECRUITING',
          workModes: ['onsite', 'remote'],
          locationIds: ['city:CN-BJ'],
        },
      ).status,
    ).toBe('excluded');
  });

  it('does not convert an empty work-mode preference into a restriction', () => {
    expect(
      evaluateRecruitingEligibility(
        {
          workModes: { values: [], certainty: 'confirmed' },
          locationIds: { values: ['city:CN-SH'], certainty: 'confirmed' },
        },
        {
          status: 'RECRUITING',
          workModes: ['remote'],
          locationIds: ['city:CN-BJ'],
        },
      ).status,
    ).toBe('eligible');
  });
});

describe('pair evaluation cache', () => {
  const version: PairEvaluationVersion = {
    workspaceId: 'workspace',
    candidateId: 'candidate',
    candidateVersion: 'cv1',
    jobId: 'job',
    jobVersion: 'jv1',
    companyVersion: 'company1',
    protocolVersion: 'match-v0.1',
    modelVersion: 'provider/model/build',
  };

  it('is independent of object property insertion order', () => {
    const reordered = Object.fromEntries(
      Object.entries(version).reverse(),
    ) as PairEvaluationVersion;
    expect(getPairEvaluationCacheKey(reordered)).toBe(
      getPairEvaluationCacheKey(version),
    );
  });

  it.each(Object.keys(version) as (keyof PairEvaluationVersion)[])(
    'invalidates when %s changes',
    (key) => {
      expect(
        getPairEvaluationCacheKey({
          ...version,
          [key]: `${version[key]}-changed`,
        }),
      ).not.toBe(getPairEvaluationCacheKey(version));
    },
  );
});
