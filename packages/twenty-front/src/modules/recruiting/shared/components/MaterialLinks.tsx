/** Downloads intake-bound originals through native authorization instead of opening untrusted source URLs. */
import { RecruitingFilePreview } from './FilePreview';
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { type RecruitingIntake } from '@/recruiting/intake/types/Intake';
import { downloadRecruitingArtifact } from '@/recruiting/shared/api/request';
import {
  StyledRecruitingError,
  StyledRecruitingRow,
  StyledRecruitingStack,
} from '@/recruiting/shared/styles';

/** Limits download inputs to native receipt references without accepting arbitrary file URLs. */
type RecruitingMaterialLinksProps = Pick<
  RecruitingIntake,
  'intakeId' | 'files'
>;

/** Keeps failed downloads retryable without changing material processing or displaying signed file URLs. */
export const RecruitingMaterialLinks = ({
  intakeId,
  files = [],
}: RecruitingMaterialLinksProps) => {
  const [preview, setPreview] =
    useState<NonNullable<RecruitingIntake['files']>[number]>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  /** Serializes downloads for this list and presents authorization or transport failures without retrying ingestion. */
  const download = async (
    file: NonNullable<RecruitingIntake['files']>[number],
  ) => {
    if (busy) return;
    setBusy(file.fileId);
    setError('');
    try {
      await downloadRecruitingArtifact(
        `resume-intakes/${encodeURIComponent(intakeId)}/files/${encodeURIComponent(file.fileId)}`,
        file.label,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t`材料暂时无法下载`,
      );
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <StyledRecruitingStack>
      {files.map((file) => (
        <StyledRecruitingRow key={file.fileId}>
          <span>{file.label}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPreview(file)}
          >{t`查看`}</Button>
          <Button
            size="sm"
            disabled={Boolean(busy)}
            loading={busy === file.fileId}
            onClick={() => {
              void download(file);
            }}
          >{t`下载`}</Button>
        </StyledRecruitingRow>
      ))}
      {preview && (
        <RecruitingFilePreview
          key={preview.fileId}
          path={`resume-intakes/${intakeId}/files/${preview.fileId}`}
          label={preview.label}
          intakeId={intakeId}
          fileId={preview.fileId}
          onClose={() => setPreview(undefined)}
        />
      )}
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
    </StyledRecruitingStack>
  );
};
