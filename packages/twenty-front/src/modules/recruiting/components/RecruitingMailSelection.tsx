/** Shows complete archived assets and lets the operator explicitly choose candidate material. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Checkbox, Field, Textarea } from 'twenty-ui/primitives/input';
import { type RecruitingMailArchive } from '@/recruiting/types/RecruitingMailArchive';
import { type RecruitingCandidate } from '@/recruiting/types/RecruitingCandidate';
import { type RecruitingIntake } from '@/recruiting/types/RecruitingIntake';
import { RecruitingRecordPicker } from '@/recruiting/components/RecruitingRecordPicker';
import {
  downloadRecruitingArtifact,
  recruitingBlob,
  recruitingRequest,
} from '@/recruiting/utils/recruitingRequest';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingTable,
  StyledRecruitingTitle,
} from '@/recruiting/components/recruitingStyles';

/** Complete body and source archives are added by the server; copying a file ID cannot bypass parent permission. */
export const RecruitingMailSelection = ({
  archive,
  onSubmitted,
}: {
  archive: RecruitingMailArchive;
  onSubmitted: () => void;
}) => {
  const artifacts = archive.detail?.artifacts ?? [];
  const [selected, setSelected] = useState(
    () =>
      new Set(
        artifacts
          .filter((file) => file.suggestedResume)
          .map((file) => file.key),
      ),
  );
  const [candidate, setCandidate] = useState<RecruitingCandidate>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string>();
  const [receipt, setReceipt] = useState<RecruitingIntake>();
  const [confirmNewCandidate, setConfirmNewCandidate] = useState(false);
  const locked = attempted || busy;
  const artifactPath = (key: string) =>
    `mail-archives/${archive.archiveId}/artifacts/${encodeURIComponent(key)}`;
  const submit = async () => {
    setAttempted(true);
    setBusy(true);
    setError('');
    try {
      const intake = await recruitingRequest<RecruitingIntake>(
        `mail-archives/${archive.archiveId}/intakes`,
        {
          method: 'POST',
          body: JSON.stringify({
            artifactKeys: [...selected],
            candidateId: candidate?.id,
            note,
          }),
        },
      );
      setReceipt(intake);
      onSubmitted();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t`材料尚未受理，请重试`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingTitle>{t`选择候选人材料`}</StyledRecruitingTitle>
      <StyledRecruitingMuted>{t`完整原文、正文和所有内嵌资源均已保留。默认选择普通简历附件；签名图保留为归档，可按实际情况手动选择。完整邮件正文会自动加入资料整理。`}</StyledRecruitingMuted>
      <StyledRecruitingTable>
        <thead>
          <tr>
            <th>{t`作为简历`}</th>
            <th>{t`材料`}</th>
            <th>{t`类型`}</th>
            <th>{t`查看原件`}</th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((file) => (
            <tr key={file.key}>
              <td>
                {!['raw', 'metadata'].includes(file.kind) && (
                  <Checkbox
                    aria-label={`${t`选择材料`} ${file.label}`}
                    checked={selected.has(file.key)}
                    disabled={locked}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(file.key);
                        else next.delete(file.key);
                        return next;
                      })
                    }
                  />
                )}
              </td>
              <td>{file.label}</td>
              <td>
                {file.inline
                  ? t`内嵌资源`
                  : file.kind === 'attachment'
                    ? t`附件`
                    : file.kind === 'raw'
                      ? t`邮件原文`
                      : file.kind === 'metadata'
                        ? t`原始信息`
                        : t`完整正文`}
              </td>
              <td>
                <Button
                  size="sm"
                  onClick={() => {
                    void downloadRecruitingArtifact(
                      artifactPath(file.key),
                      file.label,
                    ).catch((failure) => setError(failure.message));
                  }}
                >{t`下载`}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </StyledRecruitingTable>
      {artifacts.some((file) => file.kind === 'text') && (
        <Button
          onClick={() => {
            const text = artifacts.find((file) => file.kind === 'text')!;
            void recruitingBlob(artifactPath(text.key))
              .then((blob) => blob.text())
              .then(setPreview)
              .catch((failure) => setError(failure.message));
          }}
        >{t`查看完整邮件正文`}</Button>
      )}
      {preview !== undefined && (
        <StyledRecruitingPanel>
          <Textarea readOnly value={preview} rows={12} />
          <Button onClick={() => setPreview(undefined)}>{t`收起正文`}</Button>
        </StyledRecruitingPanel>
      )}
      <RecruitingRecordPicker<RecruitingCandidate>
        label={t`关联已有候选人（可选）`}
        path="candidates"
        selected={candidate}
        disabled={locked}
        onSelect={setCandidate}
        renderLabel={(record) =>
          `${record.name.firstName} ${record.name.lastName}`.trim()
        }
      />
      <StyledRecruitingMuted>
        {candidate
          ? t`将补充已选候选人的材料，不按姓名自动合并。`
          : t`默认建立新候选人；补充已有资料时请先选择对应记录。`}
      </StyledRecruitingMuted>
      {candidate && (
        <Button
          disabled={locked}
          onClick={() => setCandidate(undefined)}
        >{t`改为新候选人`}</Button>
      )}
      {archive.intakeIds.length > 0 && !candidate && (
        <Field.Root>
          <Field.Item>
            <Checkbox
              checked={confirmNewCandidate}
              disabled={locked}
              onCheckedChange={(checked) =>
                setConfirmNewCandidate(checked === true)
              }
            />
            <Field.Label>{t`这些材料属于另一位新候选人`}</Field.Label>
          </Field.Item>
          <Field.Description>{t`这封邮件已有处理记录。补充同一人的资料时，请先查看队列并关联已建候选人。`}</Field.Description>
        </Field.Root>
      )}
      <Field.Root>
        <Field.Label>{t`额外说明（可选）`}</Field.Label>
        <Textarea
          value={note}
          onValueChange={setNote}
          disabled={locked}
          rows={3}
          maxLength={90000}
        />
      </Field.Root>
      {selected.size > 24 && (
        <StyledRecruitingError>{t`一次最多选择24份资料，请核对属于同一候选人的材料。`}</StyledRecruitingError>
      )}
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
      {receipt ? (
        <StyledRecruitingRow>
          <span>{t`材料已受理，可在处理队列查看入库和匹配进度。`}</span>
          {receipt.recordUrl && <a href={receipt.recordUrl}>{t`打开候选人`}</a>}
        </StyledRecruitingRow>
      ) : (
        <Button
          variant="solid"
          color="accent"
          loading={busy}
          disabled={
            !selected.size ||
            selected.size > 24 ||
            (archive.intakeIds.length > 0 && !candidate && !confirmNewCandidate)
          }
          onClick={() => {
            void submit();
          }}
        >
          {attempted ? t`重试相同材料` : t`提交材料并开始整理`}
        </Button>
      )}
    </StyledRecruitingPanel>
  );
};
