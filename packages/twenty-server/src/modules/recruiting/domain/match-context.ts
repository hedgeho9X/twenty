/** Builds versioned occupational context without mutating legacy source records or inferring consent. */
import { createHash } from 'node:crypto';

import { type CandidateEligibility, type JobEligibility } from './match-policy';
import { readPortalSelfProfile } from './portal-schemas';

/** Legacy and new native records share an extensible, permission-filtered boundary. */
export type MatchSource = Record<string, unknown> & { id: string };

/** Stable serialization makes versions independent of JSON property insertion order. */
export const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};

/** Hashes only supplied content; timestamps alone never cause model calls. */
export const contentVersion = (value: unknown): string =>
  createHash('sha256').update(stableSerialize(value)).digest('hex');

/** Reads native rich text without discarding a complete line containing a contact address. */
export const recruitingText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const rich = value as Record<string, unknown>;
  return typeof rich.markdown === 'string' ? rich.markdown : '';
};

/** Redacts contact substrings and explicit name headers without treating matching skill fragments as identities. */
export const minimizeRecruitingText = (
  text: string,
  names: string[] = [],
): string => {
  const identities = [
    ...new Set(names.filter((entry) => entry.trim().length >= 2)),
  ].sort((a, b) => b.length - a.length);
  const result = text.replace(
    /^([ \t]*(?:姓名|name)[ \t]*[:：][ \t]*)([^\r\n]*)/gim,
    (_match, label: string, value: string) => {
      const identity = identities.find(
        (name) =>
          value.startsWith(name) &&
          (!value[name.length] || /[\s|｜,，;；]/u.test(value[name.length])),
      );
      return identity
        ? `${label}[候选人]${value.slice(identity.length)}`
        : `${label}${value}`;
    },
  );
  return result
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱]')
    .replace(/https?:\/\/[^\s<>"，。；（）)]+/giu, '[链接]')
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[电话]');
};

/** Traverses strings rather than editing serialized JSON, which could corrupt quoted names or numbers. */
const minimizeContext = <T>(value: T, names: string[] = []): T => {
  if (typeof value === 'string')
    return minimizeRecruitingText(value, names) as T;
  if (Array.isArray(value))
    return value.map((entry) => minimizeContext(entry, names)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        minimizeContext(entry, names),
      ]),
    ) as T;
  return value;
};

/** Reads a legacy fact and all its supporting quotes, preserving content without exporting its old schema. */
const factTexts = (value: unknown): string[] => {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return [...new Set(value.flatMap(factTexts))];
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  return [
    ...new Set([
      ...factTexts(object.value),
      ...factTexts(object.quote),
      ...factTexts(object.evidence),
    ]),
  ];
};

/** Narrows arbitrary JSON without trusting metadata, evidence certainty or model-generated IDs. */
const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Normalizes canonical city spellings only; unknown cities remain distinct and cannot create false exclusions. */
const cityValues = (value: unknown): string[] =>
  factTexts(value).map((city) => city.trim().replace(/市$/, '').toLowerCase());

/** Builds the current and legacy occupational inputs plus explicit, source-backed preferences. */
export const buildCandidateMatchContext = (record: MatchSource) => {
  const profile = objectValue(record.recruitingProfile);
  const legacy = objectValue(record.candidateSearchJson);
  const legacyPreferences = objectValue(legacy.preferences);
  const name = objectValue(record.name);
  const self = readPortalSelfProfile(record.candidatePortalProfile);
  const nativeName = [name.firstName, name.lastName]
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' && Boolean(entry.trim()),
    )
    .join(' ');
  const names = [
    nativeName,
    name.firstName,
    name.lastName,
    profile.name,
    self?.fullName,
  ].filter((entry): entry is string => typeof entry === 'string');
  const note = recruitingText(record.candidatePreferences);
  const sourceText = recruitingText(profile.sourceText);
  const nativePreferences =
    record.candidatePreferences &&
    typeof record.candidatePreferences === 'object'
      ? (record.candidatePreferences as Record<string, unknown>)
      : undefined;
  const material =
    typeof nativePreferences?.markdown === 'string'
      ? note
      : [sourceText, recruitingText(profile.note)].join('\n');
  const compact = Object.keys(profile).length > 0;
  const context = {
    summary: recruitingText(profile.summary),
    skills: factTexts(compact ? profile.skills : legacy.skills),
    experience: factTexts(compact ? profile.experience : legacy.experience),
    projects: factTexts(legacy.projects),
    education: factTexts(compact ? profile.education : legacy.education),
    expectedRoles: self
      ? self.expectedRoles
      : factTexts(compact ? profile.expectedRoles : legacyPreferences.roles),
    jobTitle: recruitingText(record.jobTitle),
    sourceText,
    note: [recruitingText(profile.note), note].filter(Boolean).join('\n'),
    preferences: compact
      ? {
          employmentTypes: profile.employmentTypes,
          employmentEvidence: profile.employmentEvidence,
          workModes: profile.workModes,
          workModeEvidence: profile.workModeEvidence,
          locations: profile.locations,
          locationEvidence: profile.locationEvidence,
        }
      : legacyPreferences,
    unknowns: factTexts(legacy.unknowns),
    ...(self
      ? {
          selfReported: {
            summary: self.summary,
            skills: self.skills,
            note: self.note,
            employmentTypes: self.employmentTypes,
            workModes: self.workModes,
            locations: self.locations,
            source: 'candidate_portal',
          },
        }
      : {}),
  };
  const clean = minimizeContext(context, names);
  const eligibility: CandidateEligibility = {};
  const certainty = /^历史投递自述[：:]/.test(material.trim())
    ? ('unconfirmed' as const)
    : ('confirmed' as const);
  const statements = material.split(/[\n。；;，,]+/).map((text) =>
    text
      .trim()
      .replace(/^(?:求职意向|求职要求|本次说明)[：:]\s*/, '')
      .replace(/^(?:我|本人)?(?:目前|现在|本次)?\s*/, ''),
  );
  const explicitFullTime = statements.some(
    (text) =>
      /^(?:只|仅)(?:接受|考虑|找|投递|投)?\s*全职/i.test(text) &&
      !/或|以及|实习|兼职|合同/.test(text),
  );
  if (explicitFullTime)
    eligibility.employmentTypes = {
      values: ['full_time'],
      certainty,
    };
  else {
    const values = compact
      ? factTexts(profile.employmentTypes)
      : factTexts(record.candidateEmploymentType).map((entry) =>
          entry.toLowerCase(),
        );
    if (values.length)
      eligibility.employmentTypes = { values, certainty: 'unconfirmed' };
  }
  if (
    statements.some((text) =>
      /^(?:不接受|不考虑|不找|拒绝)\s*实习(?:岗位|工作|职位|生)?(?:\s|$)/i.test(
        text,
      ),
    )
  )
    eligibility.excludedEmploymentTypes = {
      values: ['internship'],
      certainty,
    };
  const workModes = factTexts(profile.workModes);
  if (workModes.length)
    eligibility.workModes = { values: workModes, certainty: 'unconfirmed' };
  const locations = cityValues(profile.locations);
  if (locations.length)
    eligibility.locationIds = { values: locations, certainty: 'unconfirmed' };
  if (self?.employmentTypes.length) {
    eligibility.employmentTypes = {
      values: self.employmentTypes,
      certainty: self.strictEmployment ? 'confirmed' : 'unconfirmed',
    };
    if (eligibility.excludedEmploymentTypes) {
      const remaining = eligibility.excludedEmploymentTypes.values.filter(
        (value) =>
          !self.employmentTypes.includes(
            value as (typeof self.employmentTypes)[number],
          ),
      );
      if (remaining.length)
        eligibility.excludedEmploymentTypes = {
          ...eligibility.excludedEmploymentTypes,
          values: remaining,
        };
      else delete eligibility.excludedEmploymentTypes;
    }
  }
  if (self?.workModes.length)
    eligibility.workModes = {
      values: self.workModes,
      certainty: self.strictWorkMode ? 'confirmed' : 'unconfirmed',
    };
  if (self?.locations.length)
    eligibility.locationIds = {
      values: cityValues(self.locations),
      certainty: 'unconfirmed',
    };
  const occupationalContent = [
    clean.summary,
    ...clean.skills,
    ...clean.experience,
    ...clean.projects,
    ...clean.education,
    clean.sourceText,
  ].join('');
  const supplementOnly =
    !occupationalContent.trim() &&
    (Boolean(self?.skills.length) ||
      ((clean.note + (self?.summary ?? '')).length >= 80 &&
        /经验|经历|负责|项目|工作|技能|毕业|学历|擅长|开发|设计|运营|管理|投资/.test(
          clean.note + (self?.summary ?? ''),
        )));
  const conflict =
    profile.identityConflict === true || Boolean(legacy['数据一致性提示']);
  return {
    id: record.id,
    label:
      nativeName || recruitingText(profile.name) || self?.fullName || '候选人',
    context: clean,
    eligibility,
    issue: conflict
      ? '候选人材料存在身份冲突'
      : !occupationalContent.trim() && !supplementOnly
        ? '缺少可评分的职业材料'
        : undefined,
    supplementOnly,
    version: contentVersion({
      context: clean,
      eligibility,
      conflict,
      ...(supplementOnly ? { supplementOnly: true } : {}),
    }),
  };
};

/** Keeps company background separate from the job-specific requirements and legacy snapshot. */
export const buildCompanyMatchContext = (company?: MatchSource) =>
  minimizeContext({
    name: recruitingText(company?.name),
    description: recruitingText(company?.recruitingDescription),
    preferences: recruitingText(company?.recruitmentPreferences),
    ...(['CLOSED', 'PAUSED'].includes(String(company?.recruitmentStatus))
      ? { recruitmentStatus: String(company?.recruitmentStatus) }
      : {}),
  });

/** Uses current company hiring state in eligibility without treating an unknown company status as closed. */
export const buildJobMatchContext = (
  record: MatchSource,
  company?: MatchSource,
) => {
  const profile = objectValue(record.recruitingProfile);
  const attributes = factTexts(record.jobAttributes).map((entry) =>
    entry.toLowerCase(),
  );
  const companyContext = buildCompanyMatchContext(company);
  const context = {
    title: recruitingText(record.name),
    description:
      recruitingText(record.jobDescription) ||
      recruitingText(profile.description),
    preferences:
      recruitingText(record.jobRecruitmentPreferences) ||
      recruitingText(profile.preferences),
    companyPreferencesSnapshot: recruitingText(
      record.companyRecruitmentPreferences,
    ),
    employmentTypes: factTexts(profile.employmentTypes),
    workModes: factTexts(profile.workModes),
    locations: factTexts(profile.locations),
  };
  const eligibility: JobEligibility = {
    status:
      record.jobStatus === 'RECRUITING'
        ? 'RECRUITING'
        : record.jobStatus === 'CLOSED'
          ? 'CLOSED'
          : record.jobStatus === 'PAUSED'
            ? 'PAUSED'
            : 'NEEDS_DETAILS',
    employmentTypes: context.employmentTypes.length
      ? context.employmentTypes
      : attributes.filter((entry) =>
          ['full_time', 'part_time', 'internship', 'contract'].includes(entry),
        ),
    workModes: context.workModes.length
      ? context.workModes
      : attributes.filter((entry) =>
          ['onsite', 'hybrid', 'remote'].includes(entry),
        ),
    locationIds: cityValues(profile.locations),
  };
  if (
    company?.recruitmentStatus === 'CLOSED' ||
    company?.recruitmentStatus === 'PAUSED'
  )
    eligibility.companyStatus = company.recruitmentStatus;
  if (
    !eligibility.employmentTypes?.length &&
    /实习/.test(context.title) &&
    !/全职|兼职|亦可|也可|可投/.test(context.title)
  )
    eligibility.employmentTypes = ['internship'];
  const clean = minimizeContext(context);
  const cleanCompany = minimizeContext(companyContext);
  return {
    id: record.id,
    label: context.title,
    companyId: company?.id,
    context: clean,
    company: cleanCompany,
    eligibility,
    issue: !context.description.trim() ? '岗位缺少 JD 正文' : undefined,
    version: contentVersion({ context: clean, eligibility }),
    companyVersion: contentVersion(cleanCompany),
    duplicateKey: contentVersion({
      companyId: company?.id ?? record.companyId,
      context: clean,
      eligibility,
    }),
  };
};
