/** Projects explicit parsed facts onto native candidate columns without overwriting manual values. */
export const candidateFields = (
  profile: Record<string, unknown>,
  current: Record<string, unknown> = {},
) => {
  const fields: Record<string, unknown> = {};
  const roles = Array.isArray(profile.expectedRoles)
    ? profile.expectedRoles.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  if (!current.jobTitle && roles.length) fields.jobTitle = roles.join('、');
  const employment = Array.isArray(profile.employmentTypes)
    ? profile.employmentTypes.flatMap((value) =>
        value === 'internship'
          ? ['INTERNSHIP']
          : value === 'full_time'
            ? ['FULL_TIME']
            : [],
      )
    : [];
  if (
    (!Array.isArray(current.candidateEmploymentType) ||
      !current.candidateEmploymentType.length) &&
    employment.length
  )
    fields.candidateEmploymentType = employment;
  return fields;
};
