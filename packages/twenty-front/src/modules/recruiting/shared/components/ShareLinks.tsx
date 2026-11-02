/** Lists creator-owned links and removes their access capability on revocation. */
import { Button } from 'twenty-ui/primitives/input';
import { useState } from 'react';
import { useRecruitingQuery } from '../hooks/useRecruitingQuery';
import { recruitingRequest } from '../api/request';
import {
  StyledRecruitingPanel,
  StyledRecruitingTable,
  StyledRecruitingTitle,
} from '../styles';
export const ShareLinks = ({ active }: { active: boolean }) => {
  const query = useRecruitingQuery<
    {
      key: string;
      url: string;
      createdAt: string;
      jobs: { name: string; status: string }[];
      jobIds: string[];
      candidateIds: string[];
    }[]
  >('share-links', 0, active);
  const [error, setError] = useState('');
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingTitle>分享链接</StyledRecruitingTitle>
      <StyledRecruitingTable>
        <thead>
          <tr>
            <th>内容</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {query.data?.map((row) => (
            <tr key={row.key}>
              <td>
                {row.jobs
                  ?.map(
                    (job) =>
                      `${job.name}（${job.status === 'RECRUITING' ? '在招' : '已停招'}）`,
                  )
                  .join('、')}{' '}
                · {row.candidateIds.length} 位候选人
              </td>
              <td>{new Date(row.createdAt).toLocaleString()}</td>
              <td>
                <a href={row.url} target="_blank" rel="noreferrer">
                  预览
                </a>{' '}
                <Button
                  onClick={() => void navigator.clipboard.writeText(row.url)}
                >
                  复制
                </Button>
                <Button
                  onClick={() => {
                    void recruitingRequest(`share-links/${row.key}/revoke`, {
                      method: 'POST',
                    })
                      .then(() => query.reload())
                      .catch((e) => setError(e.message));
                  }}
                >
                  撤销
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </StyledRecruitingTable>
      {!query.loading && !query.data?.length && <p>暂无分享链接</p>}
      <p role="status">{error || query.error}</p>
    </StyledRecruitingPanel>
  );
};
