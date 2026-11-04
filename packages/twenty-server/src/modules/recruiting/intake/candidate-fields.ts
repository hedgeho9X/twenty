/** Projects explicit parsed facts onto native candidate columns without overwriting manual values. */
import { findPhoneNumbersInText } from 'libphonenumber-js';

export const candidateFields = (
  profile: Record<string, unknown>,
  current: Record<string, unknown> = {},
) => {
  const fields: Record<string, unknown> = { candidateAiStatus: 'COMPLETED' };
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
  const phones =
    current.phones && typeof current.phones === 'object'
      ? (current.phones as Record<string, unknown>)
      : {};
  // Missing country context must not silently turn a foreign local number into a Chinese number.
  if (!phones.primaryPhoneNumber && typeof profile.phone === 'string') {
    const raw = profile.phone.trim();
    const parsed = [
      ...new Map(
        findPhoneNumbersInText(raw).map(({ number }) => [
          number.number,
          number,
        ]),
      ).values(),
    ].filter((phone) => phone.isValid());
    const [primary, ...others] = parsed;
    if (primary) {
      const additional = phones.additionalPhones ?? [];
      const seen = new Set(
        Array.isArray(additional)
          ? additional.map((phone) =>
              `${phone.callingCode ?? ''}${phone.number ?? ''}`.replace(
                /\D/g,
                '',
              ),
            )
          : [],
      );
      const extra = others
        .filter((phone) => !seen.has(phone.number.replace(/\D/g, '')))
        .map((phone) => ({
          number: phone.nationalNumber,
          callingCode: `+${phone.countryCallingCode}`,
          countryCode: phone.country ?? '',
        }));
      fields.phones = {
        ...phones,
        primaryPhoneNumber: primary.nationalNumber,
        primaryPhoneCallingCode: `+${primary.countryCallingCode}`,
        primaryPhoneCountryCode: primary.country ?? '',
        additionalPhones: Array.isArray(additional)
          ? [...additional, ...extra]
          : additional,
      };
    }
  }
  return fields;
};
