/** Reads unchanged submitted text and original files through the parent intake's existing permission boundary. */
import { t } from '@lingui/core/macro';
import { type RecruitingIntake } from '@/recruiting/intake/types/Intake';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { RecruitingMaterialLinks } from './MaterialLinks';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingStack,
} from '@/recruiting/shared/styles';

type SourceMaterial = Pick<RecruitingIntake, 'files' | 'kind'> & {
  detail?: { input?: { text?: string; note?: string } };
};

export const SourceMaterialView = ({
  intakeId,
  onPreview,
}: {
  intakeId: string;
  onPreview?: (file: NonNullable<RecruitingIntake['files']>[number]) => void;
}) => {
  const query = useRecruitingQuery<SourceMaterial>(
    `resume-intakes/${intakeId}`,
  );
  if (query.error)
    return (
      <StyledRecruitingError role="alert">{query.error}</StyledRecruitingError>
    );
  if (!query.data)
    return (
      <StyledRecruitingMuted>{t`正在读取原始材料…`}</StyledRecruitingMuted>
    );
  const input = query.data.detail?.input;
  return (
    <StyledRecruitingStack>
      {input?.text ? (
        <section>
          <strong>
            {query.data.kind === 'JOB' ? t`提交时的 JD 原文` : t`提交正文`}
          </strong>
          <p
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              lineHeight: 1.7,
            }}
          >
            {input.text}
          </p>
        </section>
      ) : (
        <StyledRecruitingMuted>{t`该任务未提交文字正文`}</StyledRecruitingMuted>
      )}
      {query.data.kind !== 'JOB' && input?.note && (
        <section>
          <strong>{t`提交说明`}</strong>
          <p
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              lineHeight: 1.7,
            }}
          >
            {input.note}
          </p>
        </section>
      )}
      {query.data.kind !== 'JOB' && !!query.data.files?.length && (
        <>
          <strong>{t`原始附件`}</strong>
          <RecruitingMaterialLinks
            intakeId={intakeId}
            files={query.data.files}
            onPreview={onPreview}
          />
        </>
      )}
    </StyledRecruitingStack>
  );
};
