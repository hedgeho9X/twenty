/** Edits and tests recipient-specific templates with explicit synthetic input. */
import { useEffect, useState } from 'react';
import { Button, Textarea } from 'twenty-ui/primitives/input';
import { BRIEF_EXAMPLE } from './briefExample';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { subscriptionRequest } from '@/settings/admin-panel/ai/utils/subscriptionRequest';
import {
  StyledSubscriptionPanel,
  StyledSubscriptionError,
} from '@/settings/admin-panel/ai/components/subscriptionSettingsStyles';

export const SettingsBriefTemplates = () => {
  const [value, setValue] = useState<{ candidate: string; company: string }>();
  const [example, setExample] = useState(
    JSON.stringify(BRIEF_EXAMPLE, null, 2),
  );
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void subscriptionRequest<{ candidate: string; company: string }>(
      '/brief-templates',
    )
      .then(setValue)
      .catch((error) => setMessage(error.message));
  }, []);
  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '请求失败');
    } finally {
      setBusy(false);
    }
  };
  const test = (direction: string) =>
    execute(async () => {
      const context = { ...JSON.parse(example), direction };
      const result = await recruitingRequest<{ body: string }>('brief-test', {
        method: 'POST',
        body: JSON.stringify({ templates: value, context }),
      });
      setOutput(result.body);
    });
  return (
    <StyledSubscriptionPanel>
      <strong>招聘沟通文案模板</strong>
      {value && (
        <>
          <label>
            给候选人
            <Textarea
              aria-label="给候选人的模板"
              rows={12}
              value={value.candidate}
              onValueChange={(candidate) => setValue({ ...value, candidate })}
            />
          </label>
          <label>
            给公司
            <Textarea
              aria-label="给公司的模板"
              rows={12}
              value={value.company}
              onValueChange={(company) => setValue({ ...value, company })}
            />
          </label>
          <Button
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                setValue(
                  await subscriptionRequest('/brief-templates', {
                    method: 'POST',
                    body: JSON.stringify(value),
                  }),
                );
                setMessage('已保存');
              })
            }
          >
            保存模板
          </Button>
          <details>
            <summary>Example：公司、岗位与候选人 JSON</summary>
            <Textarea rows={15} value={example} onValueChange={setExample} />
          </details>
          <Button
            disabled={busy}
            onClick={() => void test('CANDIDATE_TO_JOBS')}
          >
            测试给候选人的文案
          </Button>
          <Button
            disabled={busy}
            onClick={() => void test('JOB_TO_CANDIDATES')}
          >
            测试给公司的文案
          </Button>
        </>
      )}
      {output && (
        <Textarea
          aria-label="生成结果"
          rows={8}
          value={output}
          onValueChange={setOutput}
        />
      )}
      {message && (
        <StyledSubscriptionError role="status">
          {message}
        </StyledSubscriptionError>
      )}
    </StyledSubscriptionPanel>
  );
};
