/** Provides a copyable setup prompt for the recruiting Agent. */
import { useState } from 'react';
import { Button } from 'twenty-ui/primitives/input';
import { Section } from 'twenty-ui/components/layout';
import { IconCopy } from 'twenty-ui/icon';
import {
  buildFanhanAgentPrompt,
  copyFanhanAgentPrompt,
} from '../utils/agentSetup';

/** Copies the visible account's onboarding prompt without persisting its API key. */
export const RecruitingAgentSetup = ({ apiKey }: { apiKey?: string }) => {
  const [message, setMessage] = useState('');
  return (
    <Section.Root>
      <Section.Header title="招聘 Agent 接入" />
      <div>
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
      </div>
      {message && <span role="status">{message}</span>}
    </Section.Root>
  );
};
