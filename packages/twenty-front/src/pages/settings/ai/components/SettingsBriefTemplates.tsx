import { BriefTemplateEditor } from './BriefTemplateEditor';
/** Opens one recipient template editor with protected context fields and local test output. */
import { useEffect, useState } from 'react';
import { Button, Textarea } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { IconX } from 'twenty-ui/icon';
import { BRIEF_EXAMPLE } from './briefExample';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { subscriptionRequest } from '@/settings/admin-panel/ai/utils/subscriptionRequest';
import {
  StyledSubscriptionPanel,
  StyledSubscriptionRow,
} from '@/settings/admin-panel/ai/components/subscriptionSettingsStyles';
const fields: Record<string, { label: string; value: unknown }> = {
  candidateInfo: { label: '候选人信息', value: BRIEF_EXAMPLE.candidates },
  jobInfo: { label: '岗位信息', value: BRIEF_EXAMPLE.jobs },
  companyInfo: { label: '公司信息', value: BRIEF_EXAMPLE.companies },
  recommendations: { label: '推荐关系', value: BRIEF_EXAMPLE.recommendations },
  jobPageUrl: { label: '分享链接', value: BRIEF_EXAMPLE.jobPageUrl },
};
const split = (value: string) =>
  value.split(
    /(\$\{(?:candidateInfo|jobInfo|companyInfo|recommendations|jobPageUrl)\})/g,
  );
export const SettingsBriefTemplates = () => {
  const [value, setValue] = useState<{ candidate: string; company: string }>();
  const [editing, setEditing] = useState<'candidate' | 'company'>();
  const [parts, setParts] = useState<string[]>([]);
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void subscriptionRequest<{ candidate: string; company: string }>(
      '/brief-templates',
    )
      .then(setValue)
      .catch((e) => setMessage(e.message));
  }, []);
  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '请求失败');
    } finally {
      setBusy(false);
    }
  };
  const open = (kind: 'candidate' | 'company') => {
    if (!value) return;
    setEditing(kind);
    setParts(split(value[kind]));
    setOutput('');
    setMessage('');
  };
  const draft = () => ({ ...value!, [editing!]: parts.join('') });
  return (
    <StyledSubscriptionPanel>
      <strong>招聘沟通文案模板</strong>
      <StyledSubscriptionRow>
        <Button disabled={!value} onClick={() => open('candidate')}>
          候选人模板设置
        </Button>
        <Button disabled={!value} onClick={() => open('company')}>
          公司模板设置
        </Button>
      </StyledSubscriptionRow>
      {!editing && message && <span role="alert">{message}</span>}
      <Dialog.Root
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Viewport>
            <Dialog.Popup size="xl">
              <Dialog.Header>
                <StyledSubscriptionRow
                  style={{ justifyContent: 'space-between' }}
                >
                  <Dialog.Title>
                    {editing === 'candidate'
                      ? '给候选人的模板'
                      : '给公司的模板'}
                  </Dialog.Title>
                  <Button
                    variant="ghost"
                    aria-label="关闭模板设置"
                    disabled={busy}
                    onClick={() => setEditing(undefined)}
                  >
                    <IconX size={16} />
                  </Button>
                </StyledSubscriptionRow>
              </Dialog.Header>
              <Dialog.Body>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <BriefTemplateEditor
                    key={editing}
                    value={parts.join('')}
                    fields={fields}
                    disabled={busy}
                    onChange={(text) => setParts(split(text))}
                  />
                  {output && (
                    <Textarea
                      aria-label="测试生成结果"
                      rows={6}
                      value={output}
                      onValueChange={setOutput}
                    />
                  )}
                  <span role="status">{message}</span>
                </div>
              </Dialog.Body>
              <Dialog.Footer>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void execute(async () => {
                      const result = await recruitingRequest<{ body: string }>(
                        'brief-test',
                        {
                          method: 'POST',
                          body: JSON.stringify({
                            templates: draft(),
                            context: {
                              ...BRIEF_EXAMPLE,
                              direction:
                                editing === 'candidate'
                                  ? 'CANDIDATE_TO_JOBS'
                                  : 'JOB_TO_CANDIDATES',
                            },
                          }),
                        },
                      );
                      setOutput(result.body);
                    })
                  }
                >
                  测试生成
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void execute(async () => {
                      setValue(
                        await subscriptionRequest('/brief-templates', {
                          method: 'POST',
                          body: JSON.stringify(draft()),
                        }),
                      );
                      setMessage('已保存');
                    })
                  }
                >
                  保存模板
                </Button>
              </Dialog.Footer>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </StyledSubscriptionPanel>
  );
};
