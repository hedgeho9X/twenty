/** Shows mutually exclusive create and active-link states with serialized mutations. */
import { useEffect, useState } from 'react';
import { Button } from 'twenty-ui/primitives/input';
import { IconCopy, IconExternalLink, IconLink } from 'twenty-ui/icon';
import { recruitingRequest } from '../api/request';
import { StyledRecruitingPanel, StyledRecruitingRow } from '../styles';
export const MatchShareActions = ({
  jobIds,
  candidateIds,
  currentUrl,
}: {
  jobIds: string[];
  candidateIds: string[];
  currentUrl?: string;
}) => {
  const [url, setUrl] = useState(currentUrl ?? '');
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
                    body: JSON.stringify({ jobIds, candidateIds }),
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
