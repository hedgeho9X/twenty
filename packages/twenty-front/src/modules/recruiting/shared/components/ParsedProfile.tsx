/** Presents extraction facts as readable recruiting information while keeping the exact response available on demand. */
import { t } from '@lingui/core/macro';
import {
  StyledRecruitingMuted,
  StyledRecruitingStack,
  StyledRecruitingStatus,
  StyledRecruitingTitle,
  StyledRecruitingProfileFacts,
  StyledRecruitingProfileSection,
} from '@/recruiting/shared/styles';

type RecruitingParsedProfileProps = {
  profile: unknown;
  kind: 'CANDIDATE' | 'JOB';
};
/** Rejects unexpected shapes at the display boundary without modifying saved extraction data. */
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** Preserves only actual nonempty strings; null and absent facts stay explicitly unknown. */
const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
/** Displays the saved string arrays without inventing facts from arbitrary objects. */
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter(Boolean) : [];
/** Maps canonical extraction enums to labels, retaining unknown future values as text. */
const label = (value: string): string =>
  ({
    engineering: t`研发`,
    product: t`产品`,
    design: t`设计`,
    operations: t`运营`,
    growth_marketing: t`增长与市场`,
    sales_business: t`销售与商务`,
    data_ai: t`数据与 AI`,
    other: t`其他`,
    full_time: t`全职`,
    part_time: t`兼职`,
    internship: t`实习`,
    contract: t`项目制`,
    onsite: t`现场办公`,
    hybrid: t`混合办公`,
    remote: t`远程`,
  })[value] ?? value;
/** Renders one fact group with a consistent missing-value label. */
const Fact = ({ name, values }: { name: string; values: string[] }) => (
  <div>
    <dt>{name}</dt>
    <dd>{values.length ? values.join('、') : t`未明确`}</dd>
  </div>
);
/** Keeps occupational history and education as readable separate entries. */
const History = ({ title, values }: { title: string; values: string[] }) => (
  <StyledRecruitingProfileSection>
    <strong>{title}</strong>
    {values.length ? (
      <ul>
        {values.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    ) : (
      <StyledRecruitingMuted>{t`未提供`}</StyledRecruitingMuted>
    )}
  </StyledRecruitingProfileSection>
);

/** Candidate identity, preferences and evidence remain distinct; original JSON is collapsed by default. */
export const RecruitingParsedProfile = ({
  profile,
  kind,
}: RecruitingParsedProfileProps) => {
  const data = object(profile);
  const needsReview =
    data.needsReview === true || data.identityConflict === true;
  const reviewNotes = list(data.reviewNotes);
  return (
    <StyledRecruitingStack>
      {kind === 'CANDIDATE' ? (
        <>
          <div>
            <StyledRecruitingTitle>
              {text(data.name) || t`姓名待补充`}
            </StyledRecruitingTitle>
            {needsReview && (
              <StyledRecruitingStatus data-tone="yellow">{t`资料待核对`}</StyledRecruitingStatus>
            )}
          </div>
          {data.materialKind && data.materialKind !== 'candidate' ? (
            <StyledRecruitingMuted>{t`材料类型尚未确认为候选人简历，请核对原件。`}</StyledRecruitingMuted>
          ) : null}
          {text(data.summary) && (
            <p style={{ margin: 0, lineHeight: 1.7 }}>{text(data.summary)}</p>
          )}
          <StyledRecruitingProfileFacts>
            <Fact
              name={t`邮箱`}
              values={text(data.email) ? [text(data.email)] : []}
            />
            <Fact
              name={t`电话`}
              values={text(data.phone) ? [text(data.phone)] : []}
            />
            <Fact name={t`期望岗位`} values={list(data.expectedRoles)} />
            <Fact
              name={t`岗位方向`}
              values={text(data.category) ? [label(text(data.category))] : []}
            />
            <Fact
              name={t`雇佣类型`}
              values={list(data.employmentTypes).map(label)}
            />
            <Fact name={t`工作方式`} values={list(data.workModes).map(label)} />
            <Fact name={t`期望地点`} values={list(data.locations)} />
          </StyledRecruitingProfileFacts>
          <StyledRecruitingProfileSection>
            <strong>{t`专业技能`}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {list(data.skills).length ? (
                list(data.skills).map((skill, index) => (
                  <StyledRecruitingStatus key={index} data-tone="neutral">
                    {skill}
                  </StyledRecruitingStatus>
                ))
              ) : (
                <StyledRecruitingMuted>{t`未提供`}</StyledRecruitingMuted>
              )}
            </div>
          </StyledRecruitingProfileSection>
          <History title={t`工作与项目经历`} values={list(data.experience)} />
          <History title={t`教育经历`} values={list(data.education)} />
        </>
      ) : (
        <>
          <StyledRecruitingTitle>{t`岗位资料`}</StyledRecruitingTitle>
          {(Array.isArray(data.jobs) ? data.jobs : []).map((value, index) => {
            const job = object(value);
            return (
              <StyledRecruitingProfileSection key={index}>
                <strong>{text(job.title) || t`岗位名称待补充`}</strong>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                  {text(job.description)}
                </p>
                <StyledRecruitingProfileFacts>
                  <Fact
                    name={t`岗位方向`}
                    values={
                      text(job.category) ? [label(text(job.category))] : []
                    }
                  />
                  <Fact
                    name={t`工作方式`}
                    values={list(job.workModes).map(label)}
                  />
                  <Fact
                    name={t`雇佣类型`}
                    values={list(job.employmentTypes).map(label)}
                  />
                  <Fact name={t`工作地点`} values={list(job.locations)} />
                </StyledRecruitingProfileFacts>
              </StyledRecruitingProfileSection>
            );
          })}
        </>
      )}
      {reviewNotes.length > 0 && (
        <History title={t`待核对事项`} values={reviewNotes} />
      )}
      <details>
        <summary>{t`查看原始 JSON`}</summary>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            fontSize: 12,
            maxHeight: '40vh',
            overflow: 'auto',
          }}
        >
          {JSON.stringify(profile, null, 2)}
        </pre>
      </details>
    </StyledRecruitingStack>
  );
};
