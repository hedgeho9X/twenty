/** Projects explicit parsed facts onto native candidate columns without overwriting manual values. */
import { parsePhoneNumberFromString } from 'libphonenumber-js';

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
  const phones =
    current.phones && typeof current.phones === 'object'
      ? (current.phones as Record<string, unknown>)
      : {};
  // Missing country context must not silently turn a foreign local number into a Chinese number.
  if (!phones.primaryPhoneNumber && typeof profile.phone === 'string') {
    const raw = profile.phone.trim();
    const parsed = parsePhoneNumberFromString(raw);
    if (parsed?.isValid()) {
      fields.phones = {
        ...phones,
        primaryPhoneNumber: parsed.nationalNumber,
        primaryPhoneCallingCode: `+${parsed.countryCallingCode}`,
        primaryPhoneCountryCode: parsed.country ?? '',
        additionalPhones: phones.additionalPhones ?? [],
      };
    } else if (raw && /^[+\d][\d\s().-]*$/.test(raw)) {
      fields.phones = {
        ...phones,
        primaryPhoneNumber: raw,
        primaryPhoneCallingCode: '',
        primaryPhoneCountryCode: '',
        additionalPhones: phones.additionalPhones ?? [],
      };
    }
  }
  return fields;
};
