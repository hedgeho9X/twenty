/** Collects company-bound JD text entries and submits each independently to the background queue. */
import { useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Field, Input, Textarea } from 'twenty-ui/primitives/input';
import { IconPlus } from 'twenty-ui/icon';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/shared/api/request';
import { type RecruitingCompany } from '@/recruiting/companies/types/Company';
import { type RecruitingIntake } from '@/recruiting/intake/types/Intake';
import { RecruitingRecordPicker } from '@/recruiting/shared/components/RecordPicker';
import { RecruitingCompanyExistingJobs } from './ExistingJobs';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTitle,
  StyledRecruitingSteps,
  StyledRecruitingForm,
  StyledRecruitingRecordLink,
  StyledRecruitingStatus,
} from '@/recruiting/shared/styles';

type JobTextEntry = {
  key: string;
  text: string;
  attempted?: boolean;
  companyId?: string;
  receipt?: RecruitingIntake;
  error?: string;
};
/** Assigns a stable request identity before the first network attempt. */
const newEntry = (): JobTextEntry => ({
  key: crypto.randomUUID(),
  text: '',
});

/** Submission receipts stay in the input step; there is no mandatory preview or confirmation screen. */
export const RecruitingCompanyJobs = ({
  initialIntakeId,
  onSubmitted,
  onIntakeChange,
  onOpenQueue,
  active = true,
  onBrowseJobs,
}: {
  initialIntakeId?: string;
  onSubmitted: () => void;
  onIntakeChange: (id: string | undefined) => void;
  onOpenQueue?: () => void;
  active?: boolean;
  onBrowseJobs?: (companyId: string) => void;
}) => {
  const [step, setStep] = useState(initialIntakeId ? 2 : 1);
  const [company, setCompany] = useState<RecruitingCompany>();
  const [selectionChanged, setSelectionChanged] = useState(false);
  const [createCompany, setCreateCompany] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [description, setDescription] = useState('');
  const [preferences, setPreferences] = useState('');
  const [entries, setEntries] = useState<JobTextEntry[]>(() => [newEntry()]);
  const [batchId, setBatchId] = useState(() => crypto.randomUUID());
  const newEntryElement = useRef<HTMLDivElement>(null);
  const [scrollToNewEntry, setScrollToNewEntry] = useState<string>();
  useEffect(() => {
    if (!scrollToNewEntry) return;
    newEntryElement.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'center',
    });
  }, [scrollToNewEntry]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const previous = useRecruitingQuery<
    RecruitingIntake & { detail: { input: { companyId: string } } }
  >(initialIntakeId ? `resume-intakes/${initialIntakeId}` : null, 0, active);
  const initialCompany = useRecruitingQuery<RecruitingCompany>(
    previous.data?.detail.input.companyId
      ? `companies/${previous.data.detail.input.companyId}`
      : null,
    0,
    active,
  );
  const chosen = selectionChanged
    ? company
    : (company ?? (initialCompany.error ? undefined : initialCompany.data));
  const lockedCompany = busy || entries.some((entry) => entry.attempted);
  const pending = entries.filter(
    (entry) => !entry.receipt && Boolean(entry.text.trim()),
  );
  const submitted = entries.filter((entry) => entry.receipt).length;
  /** Retains successful entries and frozen failed requests while editing unsubmitted text independently. */
  const update = (key: string, patch: Partial<JobTextEntry>) =>
    setEntries((current) =>
      current.map((entry) =>
        entry.key === key ? { ...entry, ...patch } : entry,
      ),
    );
  /** Creates only the explicitly entered company, preserving all draft JD text. */
  const saveCompany = async () => {
    setBusy(true);
    setError('');
    try {
      const saved = await recruitingRequest<RecruitingCompany>('companies', {
        method: 'POST',
        body: JSON.stringify({
          name,
          domain,
          description,
          recruitmentPreferences: preferences,
        }),
      });
      setCompany(saved);
      setSelectionChanged(true);
      setCreateCompany(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`公司创建失败`);
    } finally {
      setBusy(false);
    }
  };
  /** Sends one immutable request per JD so partial network failures never resubmit successful entries. */
  const submit = async () => {
    if (!chosen || busy || !pending.length) return;
    setBusy(true);
    setError('');
    for (const entry of pending) {
      const companyId = entry.companyId ?? chosen.id;
      update(entry.key, { attempted: true, companyId, error: undefined });
      try {
        const receipt = await recruitingRequest<RecruitingIntake>(
          'job-intakes',
          {
            method: 'POST',
            body: JSON.stringify({
              companyId,
              text: entry.text,
              source: 'manual',
              batchId,
              idempotencyKey: entry.key,
            }),
          },
        );
        update(entry.key, { receipt });
        onSubmitted();
      } catch (failure) {
        update(entry.key, {
          error:
            failure instanceof Error ? failure.message : t`提交失败，请重试`,
        });
      }
    }
    setBusy(false);
    if (initialIntakeId) {
      setCompany(chosen);
      onIntakeChange(undefined);
    }
  };
  /** Starts another explicit batch without changing tasks that were already accepted by the server. */
  const reset = () => {
    setEntries([newEntry()]);
    setBatchId(crypto.randomUUID());
    setError('');
    setCompany(chosen);
    onIntakeChange(undefined);
  };
  return (
    <StyledRecruitingForm>
      <StyledRecruitingStack>
        <StyledRecruitingSteps aria-label={t`岗位录入步骤`}>
          {[t`选择公司`, t`填写 JD`].map((label, index) => (
            <span
              key={label}
              aria-current={step === index + 1 ? 'step' : undefined}
            >
              {index + 1}. {label}
            </span>
          ))}
        </StyledRecruitingSteps>
        {step === 1 ? (
          <StyledRecruitingPanel>
            <StyledRecruitingTitle>{t`选择公司`}</StyledRecruitingTitle>
            <RecruitingRecordPicker<RecruitingCompany>
              label={t`公司`}
              path="companies"
              selected={chosen}
              disabled={lockedCompany}
              renderLabel={(record) => record.name}
              renderHint={(record) => record.domainName?.primaryLinkUrl}
              onSelect={(value) => {
                setCompany(value);
                setSelectionChanged(true);
              }}
            />
            {chosen && (
              <>
                <StyledRecruitingRecordLink
                  href={`/object/company/${chosen.id}`}
                >{t`公司详情 ↗`}</StyledRecruitingRecordLink>
                <RecruitingCompanyExistingJobs
                  companyId={chosen.id}
                  active={active}
                  onViewAll={() => onBrowseJobs?.(chosen.id)}
                />
              </>
            )}
            {!chosen && !createCompany && (
              <Button
                startIcon={<IconPlus size={16} />}
                onClick={() => setCreateCompany(true)}
              >{t`新建公司`}</Button>
            )}
            {createCompany && (
              <StyledRecruitingPanel>
                <Field.Root>
                  <Field.Label>{t`公司名称`}</Field.Label>
                  <Input value={name} onValueChange={setName} />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t`公司网站（可选）`}</Field.Label>
                  <Input value={domain} onValueChange={setDomain} />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t`公司简介（可选）`}</Field.Label>
                  <Textarea
                    value={description}
                    onValueChange={setDescription}
                    rows={3}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t`公司招聘偏好（可选）`}</Field.Label>
                  <Textarea
                    value={preferences}
                    onValueChange={setPreferences}
                    rows={3}
                  />
                </Field.Root>
                <StyledRecruitingRow>
                  <Button
                    disabled={!name.trim()}
                    loading={busy}
                    onClick={() => {
                      void saveCompany();
                    }}
                  >{t`创建并选中`}</Button>
                  <Button
                    disabled={busy}
                    onClick={() => setCreateCompany(false)}
                  >{t`取消`}</Button>
                </StyledRecruitingRow>
              </StyledRecruitingPanel>
            )}
            {!createCompany && (
              <Button
                variant="solid"
                color="accent"
                disabled={!chosen}
                onClick={() => setStep(2)}
              >{t`下一步：填写 JD`}</Button>
            )}
          </StyledRecruitingPanel>
        ) : (
          <>
            <StyledRecruitingRow>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setStep(1)}
              >{t`返回选择公司`}</Button>
              <strong>{chosen?.name}</strong>
            </StyledRecruitingRow>
            {initialIntakeId && (
              <StyledRecruitingRow>
                <StyledRecruitingMuted>{t`刚才提交的 JD 可在队列中查看，可继续添加。`}</StyledRecruitingMuted>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onOpenQueue}
                >{t`查看队列`}</Button>
              </StyledRecruitingRow>
            )}
            {entries.map((entry, index) => (
              <StyledRecruitingPanel
                key={entry.key}
                ref={index === entries.length - 1 ? newEntryElement : undefined}
              >
                <StyledRecruitingRow
                  style={{ justifyContent: 'space-between' }}
                >
                  <StyledRecruitingTitle>
                    {t`JD`} {index + 1}
                  </StyledRecruitingTitle>
                  {entry.receipt ? (
                    <StyledRecruitingStatus data-tone="green">{t`已加入队列`}</StyledRecruitingStatus>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || entry.attempted || entries.length === 1}
                      onClick={() =>
                        setEntries((current) =>
                          current.filter((item) => item.key !== entry.key),
                        )
                      }
                    >{t`移除`}</Button>
                  )}
                </StyledRecruitingRow>
                <Field.Root>
                  <Field.Label>{t`岗位描述`}</Field.Label>
                  <Textarea
                    aria-label={`${t`岗位描述`} ${index + 1}`}
                    placeholder={t`直接粘贴岗位名称、职责、要求、地点和薪资等 JD 原文`}
                    value={entry.text}
                    onValueChange={(text) => update(entry.key, { text })}
                    disabled={busy || entry.attempted}
                    rows={7}
                    maxLength={500000}
                  />
                </Field.Root>
                {entry.error && (
                  <div>
                    <StyledRecruitingError role="alert">
                      {entry.error}
                    </StyledRecruitingError>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        update(entry.key, {
                          key: crypto.randomUUID(),
                          attempted: false,
                          companyId: undefined,
                          error: undefined,
                        })
                      }
                    >{t`修改内容后重新提交`}</Button>
                  </div>
                )}
              </StyledRecruitingPanel>
            ))}
            <StyledRecruitingRow>
              <Button
                startIcon={<IconPlus size={16} />}
                disabled={busy || entries.length >= 30}
                onClick={() => {
                  const entry = newEntry();
                  setEntries((current) => [...current, entry]);
                  setScrollToNewEntry(entry.key);
                }}
              >{t`再添加一个 JD`}</Button>
              <Button
                variant="solid"
                color="accent"
                disabled={busy || !chosen || !pending.length}
                loading={busy}
                onClick={() => {
                  void submit();
                }}
              >{t`提交到队列`}</Button>
              {submitted > 0 && (
                <>
                  <Button
                    variant="ghost"
                    onClick={onOpenQueue}
                  >{t`查看队列`}</Button>
                  <Button
                    disabled={busy}
                    variant="ghost"
                    onClick={reset}
                  >{t`开始另一批`}</Button>
                </>
              )}
            </StyledRecruitingRow>
          </>
        )}
        {error && (
          <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
        )}
      </StyledRecruitingStack>
    </StyledRecruitingForm>
  );
};
