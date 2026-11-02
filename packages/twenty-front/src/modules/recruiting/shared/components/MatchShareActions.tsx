/** Creates or revokes scoped shares for the selected matching results. */
import { useEffect, useState } from 'react';
import { Button } from 'twenty-ui/primitives/input';
import { recruitingRequest } from '../api/request';
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
  useEffect(() => setUrl(currentUrl ?? ''), [currentUrl]);
  const [message, setMessage] = useState('');
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <Button
        onClick={() => {
          void recruitingRequest<{ url: string }>('share-links', {
            method: 'POST',
            body: JSON.stringify({ jobIds, candidateIds }),
          })
            .then(async (r) => {
              setUrl(r.url);
              await navigator.clipboard.writeText(r.url);
              setMessage('链接已复制');
            })
            .catch((e) => setMessage(e.message));
        }}
      >
        生成分享链接
      </Button>
      {url && (
        <>
          <a href={url} target="_blank" rel="noreferrer">
            预览
          </a>
          <Button
            onClick={() => {
              const key = new URL(url).pathname.split('/').pop();
              void recruitingRequest(`share-links/${key}/revoke`, {
                method: 'POST',
              })
                .then(() => {
                  setUrl('');
                  setMessage('已撤销');
                })
                .catch((e) => setMessage(e.message));
            }}
          >
            撤销分享
          </Button>
        </>
      )}
      <span role="status">{message}</span>
    </div>
  );
};
