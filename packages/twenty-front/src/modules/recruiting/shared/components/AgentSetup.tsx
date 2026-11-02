/** Offers the same downloadable recruiting tools to every authorized workspace operator. */
import { useState } from 'react';
import { Button } from 'twenty-ui/primitives/input';
import { Section } from 'twenty-ui/components/layout';
import { IconCopy } from 'twenty-ui/icon';
import {
  buildFanhanAgentPrompt,
  copyFanhanAgentPrompt,
  FANHAN_RELEASE_URL,
} from '../utils/agentSetup';

/** Copies the visible account's onboarding prompt without persisting its API key. */
export const RecruitingAgentSetup = ({ apiKey }: { apiKey?: string }) => {
  const [message, setMessage] = useState('');
  return (
    <Section.Root>
      <Section.Header title="招聘 Agent 接入" />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <Button
          startIcon={<IconCopy />}
          onClick={() => {
            void copyFanhanAgentPrompt(
              buildFanhanAgentPrompt(window.location.origin, apiKey),
            )
              .then(() => setMessage('接入提示词已复制'))
              .catch(() => setMessage('无法复制，请允许剪贴板访问后重试'));
          }}
        >
          复制 Agent 接入提示词
        </Button>
        <a href={`${FANHAN_RELEASE_URL}/fanhan-cli.tgz`}>下载 CLI</a>
        <a href={`${FANHAN_RELEASE_URL}/fanhan-recruiting-skill.zip`}>
          下载 Skill
        </a>
      </div>
      {message && <span role="status">{message}</span>}
    </Section.Root>
  );
};
