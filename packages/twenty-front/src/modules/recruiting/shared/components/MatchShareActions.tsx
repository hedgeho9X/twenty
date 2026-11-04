/** Shows mutually exclusive create and active-link states with serialized mutations. */
import { useEffect, useState, useId, useRef } from 'react';
import { Button, Checkbox, Field } from '@/recruiting/shadcn/compat';
import { IconCopy, IconExternalLink, IconLink } from 'twenty-ui/icon';
import { recruitingRequest } from '../api/request';
import { StyledRecruitingPanel, StyledRecruitingRow } from '../styles';
export const MatchShareActions = ({
  jobIds,
  candidateIds,
  currentUrl,
  matchRunId,
}: {
  jobIds: string[];
  candidateIds: string[];
  currentUrl?: string;
  matchRunId: string;
}) => {
  const [url, setUrl] = useState(currentUrl ?? '');
  const [includeFiles, setIncludeFiles] = useState(true);
  const optionId = useId();
  const selectionKey =
    [...jobIds].sort().join(',') + ':' + [...candidateIds].sort().join(',');
  const previousSelection = useRef(selectionKey);
  useEffect(() => {
    if (previousSelection.current !== selectionKey) {
      setUrl('');
      setMessage('');
      previousSelection.current = selectionKey;
    }
  }, [selectionKey]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setUrl(currentUrl ?? '');
    setMessage('');
  }, [currentUrl]);
  const execute = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingPanel style={{ padding: 16, gap: 12 }}>
      <StyledRecruitingRow style={{ justifyContent: 'space-between' }}>
        <StyledRecruitingRow>
          <IconLink size={16} />
          <strong>分享链接</strong>
        </StyledRecruitingRow>
        {!url && (
          <Button
            disabled={busy || (!jobIds.length && !candidateIds.length)}
            loading={busy}
            onClick={() =>
              void execute(async () => {
                const result = await recruitingRequest<{ url: string }>(
                  'share-links',
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      jobIds,
                      candidateIds,
                      matchRunId,
                      includeFiles,
                    }),
                  },
                );
                setUrl(result.url);
              })
            }
          >
            生成分享链接
          </Button>
        )}
      </StyledRecruitingRow>
      {!url && candidateIds.length > 0 && (
        <Field.Root orientation="horizontal">
          <Checkbox
            id={optionId}
            checked={includeFiles}
            onCheckedChange={setIncludeFiles}
            disabled={busy}
          />
          <Field.Label htmlFor={optionId}>
            附带所选候选人的全部 PDF / 原始附件
          </Field.Label>
        </Field.Root>
      )}
      {url && (
        <>
          <span style={{ overflowWrap: 'anywhere', fontSize: 13 }}>{url}</span>
          <StyledRecruitingRow>
            <Button
              disabled={busy}
              startIcon={<IconCopy size={16} />}
              onClick={() =>
                void execute(async () => {
                  await navigator.clipboard.writeText(url);
                  setMessage('已复制');
                })
              }
            >
              复制链接
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              startIcon={<IconExternalLink size={16} />}
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              预览分享页
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() =>
                void execute(async () => {
                  const key = new URL(url).pathname.split('/').pop();
                  await recruitingRequest(`share-links/${key}/revoke`, {
                    method: 'POST',
                  });
                  setUrl('');
                  setMessage('已撤销');
                })
              }
            >
              撤销分享
            </Button>
          </StyledRecruitingRow>
        </>
      )}
      {message && <span role="status">{message}</span>}
    </StyledRecruitingPanel>
  );
};
