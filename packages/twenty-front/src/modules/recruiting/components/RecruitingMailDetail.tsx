/** Displays archived mail content and previewable attachments without a material selection step. */
import { useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { IconFile, IconPhoto } from 'twenty-ui/icon';
import { type RecruitingMailArchive } from '@/recruiting/types/RecruitingMailArchive';
import { recruitingBlob } from '@/recruiting/utils/recruitingRequest';
import { RecruitingFilePreview } from './RecruitingFilePreview';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
  StyledRecruitingStack,
} from './recruitingStyles';

/** Prefers the plain body and isolates HTML-only email from scripts and external resources. */
export const RecruitingMailDetail = ({
  archive,
}: {
  archive: RecruitingMailArchive;
}) => {
  const artifacts = archive.detail?.artifacts ?? [];
  const body =
    artifacts.find((file) => file.kind === 'text') ??
    artifacts.find((file) => file.kind === 'html');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<(typeof artifacts)[number]>();
  const bodyKey = body?.key;
  useEffect(() => {
    let cancelled = false;
    setContent('');
    setError('');
    if (bodyKey)
      void recruitingBlob(
        `mail-archives/${archive.archiveId}/artifacts/${encodeURIComponent(bodyKey)}`,
      )
        .then((blob) => blob.text())
        .then((text) => {
          if (!cancelled) setContent(text);
        })
        .catch(() => {
          if (!cancelled) setError(t`邮件正文暂时无法加载`);
        });
    return () => {
      cancelled = true;
    };
  }, [archive.archiveId, bodyKey]);
  return (
    <StyledRecruitingStack>
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
      {body?.kind === 'html' ? (
        <iframe
          title={t`邮件正文`}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'"><style>body{font:14px/1.6 system-ui;overflow-wrap:anywhere}img{max-width:100%}</style>${content}`}
          style={{ width: '100%', minHeight: 280, border: 0 }}
        />
      ) : (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            lineHeight: 1.7,
          }}
        >
          {content || (body ? t`加载正文…` : t`此邮件没有正文`)}
        </div>
      )}
      <StyledRecruitingMuted>{t`附件`}</StyledRecruitingMuted>
      <StyledRecruitingRow>
        {artifacts
          .filter((file) => file.kind === 'attachment')
          .map((file) => (
            <Button
              key={file.key}
              startIcon={
                file.mimeType.startsWith('image/') ? (
                  <IconPhoto size={16} />
                ) : (
                  <IconFile size={16} />
                )
              }
              onClick={() => setPreview(file)}
            >
              {file.label}
            </Button>
          ))}
        {!artifacts.some((file) => file.kind === 'attachment') && (
          <StyledRecruitingMuted>{t`无附件`}</StyledRecruitingMuted>
        )}
      </StyledRecruitingRow>
      {preview && (
        <RecruitingFilePreview
          path={`mail-archives/${archive.archiveId}/artifacts/${encodeURIComponent(preview.key)}`}
          label={preview.label}
          intakeId={preview.preview?.intakeId}
          fileId={preview.preview?.fileId}
          onClose={() => setPreview(undefined)}
        />
      )}
    </StyledRecruitingStack>
  );
};
