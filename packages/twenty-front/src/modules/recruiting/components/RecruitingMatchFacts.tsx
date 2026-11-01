/** Presents permission-checked candidate facts and job hover cards without triggering model work. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { getRichTextFieldTextLines } from '@/object-record/record-field/ui/utils/getRichTextFieldTextLines';
import { type FieldRichTextValue } from '@/object-record/record-field/ui/types/FieldMetadata';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { type RecruitingCompany } from '@/recruiting/types/RecruitingCompany';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingTitle,
  StyledRecruitingJobHover,
} from './recruitingStyles';

/** Preserves facts as escaped text; rich-text metadata and embedded HTML never execute. */
const text = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(' · ');
  if (!value || typeof value !== 'object') return '';
  if ('value' in value) return text(value.value);
  return getRichTextFieldTextLines(value as FieldRichTextValue).join('\n');
};

type CandidateFacts = {
  name?: { firstName?: string; lastName?: string };
  jobTitle?: string;
  recruitingProfile?: {
    summary?: string;
    skills?: string[];
    experience?: string[];
    expectedRoles?: string[];
  };
  candidatePreferences?: FieldRichTextValue;
  candidateSearchJson?: { skills?: unknown; preferences?: { roles?: unknown } };
};

/** Loads candidate details once in the subject header rather than repeating the candidate on every result row. */
export const RecruitingCandidateFacts = ({
  id,
  label,
}: {
  id: string;
  label?: string;
}) => {
  const query = useRecruitingQuery<CandidateFacts>(`candidates/${id}`);
  const person = query.error ? undefined : query.data;
  const profile = person?.recruitingProfile;
  const name =
    [person?.name?.firstName, person?.name?.lastName]
      .filter(Boolean)
      .join(' ') ||
    label ||
    t`姓名待补充`;
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingTitle>
        <a href={`/object/person/${id}`}>{name}</a>
      </StyledRecruitingTitle>
      {query.error && (
        <StyledRecruitingError>{query.error}</StyledRecruitingError>
      )}
      {person?.jobTitle && <strong>{person.jobTitle}</strong>}
      {profile?.summary && <p>{profile.summary}</p>}
      <StyledRecruitingMuted>
        {t`期望岗位`}：
        {text(
          profile?.expectedRoles ??
            person?.candidateSearchJson?.preferences?.roles,
        ) || '—'}
      </StyledRecruitingMuted>
      <StyledRecruitingMuted>
        {t`技能`}：
        {text(profile?.skills ?? person?.candidateSearchJson?.skills) || '—'}
      </StyledRecruitingMuted>
    </StyledRecruitingPanel>
  );
};

/** Reveals the current authorized JD on hover or keyboard focus, not a generated model explanation. */
export const RecruitingJobFacts = ({
  id,
  label,
}: {
  id: string;
  label: string;
}) => {
  const [open, setOpen] = useState(false);
  const query = useRecruitingQuery<{ jobDescription?: FieldRichTextValue }>(
    open ? `jobs/${id}` : null,
  );
  return (
    <StyledRecruitingJobHover
      onMouseEnter={() => setOpen(true)}
      onFocus={() => setOpen(true)}
    >
      <a
        href={`/object/recruitmentJob/${id}`}
        aria-describedby={`job-preview-${id}`}
      >
        {label}
      </a>
      {open && (
        <div
          className="job-preview-card"
          role="tooltip"
          id={`job-preview-${id}`}
        >
          <strong>{label}</strong>
          <p>
            {query.error ||
              text(query.data?.jobDescription) ||
              (query.loading ? t`正在读取…` : t`暂无岗位简介`)}
          </p>
        </div>
      )}
    </StyledRecruitingJobHover>
  );
};

/** Shows a company name in its own column, using native record permissions for lookup. */
export const RecruitingCompanyName = ({ id }: { id?: string }) => {
  const query = useRecruitingQuery<RecruitingCompany>(
    id ? `companies/${id}` : null,
  );
  return id && query.data && !query.error ? (
    <a href={`/object/company/${id}`}>{query.data.name}</a>
  ) : (
    <span>—</span>
  );
};
