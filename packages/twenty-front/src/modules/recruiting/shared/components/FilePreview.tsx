/** Previews authorized originals without executing HTML or loading remote resources from uploaded documents. */
import { lazy, Suspense, useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from '@/recruiting/shadcn/compat';
import { IconX, IconArrowLeft } from 'twenty-ui/icon';
import { Dialog } from '@/recruiting/shadcn/compat';
import {
  recruitingBlob,
  recruitingRequest,
} from '@/recruiting/shared/api/request';
import {
  recruitingDialogClass,
  StyledRecruitingError,
  StyledRecruitingMuted,
} from '@/recruiting/shared/styles';

/** Reuses the official PDF renderer; Office formats never go through remote Office Online. */
const DocumentViewer = lazy(() =>
  import('@/activities/files/components/DocumentViewer').then((module) => ({
    default: module.DocumentViewer,
  })),
);

type RecruitingFilePreviewProps = {
  path: string;
  label: string;
  intakeId?: string;
  fileId?: string;
  onClose: () => void;
  embedded?: boolean;
  onBack?: () => void;
};
/** Uses blob URLs only for PDF/images and parser-generated page PNGs; revokes every URL on close. */
export const RecruitingFilePreview = ({
  path,
  label,
  intakeId,
  fileId,
  onClose,
  embedded = false,
  onBack,
}: RecruitingFilePreviewProps) => {
  const [images, setImages] = useState<string[]>([]);
  const [pdf, setPdf] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setImages([]);
    setPdf('');
    setText('');
    setError('');
    setLoading(true);
    const urls: string[] = [];
    const url = (blob: Blob) => {
      if (cancelled) return '';
      const result = URL.createObjectURL(blob);
      urls.push(result);
      return result;
    };
    const load = async () => {
      const extension = label.split('.').pop()?.toLowerCase();
      if (
        ['doc', 'docx', 'pdf'].includes(extension ?? '') &&
        intakeId &&
        fileId
      ) {
        const detail = await recruitingRequest<{
          detail: {
            materials?: {
              fileId: string;
              requestId: string;
              previews: string[];
            }[];
          };
        }>(`resume-intakes/${intakeId}`);
        const material = detail.detail.materials?.find(
          (item) => item.fileId === fileId,
        );
        if (!material?.previews.length)
          throw new Error(t`文档页图尚未生成，请稍后查看或下载原件。`);
        const pages = [];
        for (const name of material.previews)
          pages.push(
            url(
              await recruitingBlob(
                `resume-intakes/${intakeId}/previews/${material.requestId}/${encodeURIComponent(name)}`,
              ),
            ),
          );
        if (!cancelled) setImages(pages);
      } else {
        const blob = await recruitingBlob(path);
        if (cancelled) return;
        if (extension === 'pdf')
          setPdf(url(new Blob([blob], { type: 'application/pdf' })));
        else if (
          ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(extension ?? '')
        )
          setImages([
            url(
              new Blob([blob], {
                type: `image/${extension === 'jpg' ? 'jpeg' : extension}`,
              }),
            ),
          ]);
        else if (
          [
            'txt',
            'md',
            'markdown',
            'html',
            'htm',
            'eml',
            'json',
            'csv',
          ].includes(extension ?? '')
        )
          setText(await blob.text());
        else throw new Error(t`此格式暂不支持预览，可下载原件查看。`);
      }
    };
    void load()
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof Error ? failure.message : t`暂时无法预览`,
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      urls.forEach((value) => URL.revokeObjectURL(value));
    };
  }, [path, label, intakeId, fileId]);
  const content = (
    <>
      <Dialog.Header>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {embedded && (
            <Button
              variant="ghost"
              startIcon={<IconArrowLeft size={16} />}
              onClick={onBack ?? onClose}
            >
              返回
            </Button>
          )}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            <Dialog.Title>{label}</Dialog.Title>
          </div>
          <Button variant="ghost" aria-label={t`关闭预览`} onClick={onClose}>
            <IconX size={18} />
          </Button>
        </div>
      </Dialog.Header>
      <Dialog.Body>
        {loading && (
          <StyledRecruitingMuted>{t`正在读取原件…`}</StyledRecruitingMuted>
        )}
        {error && (
          <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
        )}
        {pdf && (
          <Suspense
            fallback={
              <StyledRecruitingMuted>{t`正在打开文档…`}</StyledRecruitingMuted>
            }
          >
            <DocumentViewer
              documentName={label}
              documentUrl={pdf}
              documentExtension="pdf"
            />
          </Suspense>
        )}
        {images.map((src, index) => (
          <img
            key={src}
            src={src}
            alt={`${label} · ${index + 1}`}
            style={{ width: '100%', display: 'block' }}
          />
        ))}
        {text && (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: '65vh',
              overflow: 'auto',
            }}
          >
            {text}
          </pre>
        )}
      </Dialog.Body>
    </>
  );
  if (embedded) return content;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <div className={recruitingDialogClass}>
            <Dialog.Popup size="xl">{content}</Dialog.Popup>
          </div>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
