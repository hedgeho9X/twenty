/** Defines candidate-authored preferences and a deliberately bounded public projection of CRM data. */
import {
  buildCandidateMatchContext,
  contentVersion,
  type MatchSource,
} from './match-context';
import { readPortalSelfProfile } from './portal-schemas';

/** Public file identities never carry native signed download URLs. */
export type PortalFile = { fileId: string; label: string };

/** Narrows stored JSON without converting internal objects into public strings. */
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** Returns only actual strings from career arrays, preserving all supplied facts rather than truncating them. */
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
/** Excludes raw email, intake archives, private notes and original download credentials from shareable identities. */
export const portalCandidateFiles = (record: MatchSource): PortalFile[] => {
  const files = Array.isArray(record.candidateResumes)
    ? record.candidateResumes
    : [];
  return files.flatMap((value) => {
    const file = object(value);
    return typeof file.fileId === 'string' &&
      typeof file.label === 'string' &&
      !/^(?:mail-body\.|mail-metadata\.|original\.eml$)/i.test(file.label)
      ? [{ fileId: file.fileId, label: file.label }]
      : [];
  });
};

/** Keeps only career facts and candidate-reviewed contact data; no sourceText, inbox body or service notes cross this boundary. */
export const publicCandidateProfile = (record: MatchSource) => {
  const profile = object(record.recruitingProfile);
  const name = object(record.name);
  const self = readPortalSelfProfile(record.candidatePortalProfile);
  const eligibility = buildCandidateMatchContext(record).eligibility;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    name: self
      ? self.fullName
      : [text(name.firstName), text(name.lastName)].filter(Boolean).join(' ') ||
        text(profile.name),
    email: self
      ? self.email
      : text(profile.email) || text(object(record.emails).primaryEmail),
    phone: self
      ? self.phone
      : text(profile.phone) || text(object(record.phones).primaryPhoneNumber),
    summary: text(profile.summary),
    experience: strings(profile.experience),
    education: strings(profile.education),
    skills: [...new Set([...strings(profile.skills), ...(self?.skills ?? [])])],
    selfIntroduction: self?.summary ?? '',
    candidateNote: self?.note ?? '',
    expectedRoles: self ? self.expectedRoles : strings(profile.expectedRoles),
    employmentTypes: self
      ? self.employmentTypes
      : (eligibility.employmentTypes?.values ??
        strings(profile.employmentTypes)),
    strictEmployment: self
      ? self.strictEmployment
      : eligibility.employmentTypes?.certainty === 'confirmed',
    strictWorkMode: self
      ? self.strictWorkMode
      : eligibility.workModes?.certainty === 'confirmed',
    workModes: self ? self.workModes : strings(profile.workModes),
    locations: self ? self.locations : strings(profile.locations),
  };
};

/** Freezes exactly the selected file set and visible data so later private edits do not silently disclose new material. */
export const portalShareSnapshot = (record: MatchSource, fileIds: string[]) => {
  const allowed = portalCandidateFiles(record);
  const selected = [...new Set(fileIds)].sort().map((id) => {
    const file = allowed.find((entry) => entry.fileId === id);
    if (!file)
      throw new Error('Selected resume does not belong to the candidate');
    return file;
  });
  const snapshot = { profile: publicCandidateProfile(record), files: selected };
  return { snapshot, profileHash: contentVersion(snapshot) };
};
