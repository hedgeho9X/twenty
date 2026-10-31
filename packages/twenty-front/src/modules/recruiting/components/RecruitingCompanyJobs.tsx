/** Guides operators from an actual company to resumable JD preview and per-item confirmation. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Field, Input, Textarea } from 'twenty-ui/primitives/input';
import { IconBuildingSkyscraper, IconPlus, IconUpload } from 'twenty-ui/icon';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import {
  recruitingRequest,
  uploadRecruitingFile,
} from '@/recruiting/utils/recruitingRequest';
import { type RecruitingCompany } from '@/recruiting/types/RecruitingCompany';
import { type RecruitingIntake } from '@/recruiting/types/RecruitingIntake';
import { type RecruitingJobDraft } from '@/recruiting/types/RecruitingJobDraft';
import { type RecruitingJobItem } from '@/recruiting/types/RecruitingJobItem';
import { type RecruitingUpload } from '@/recruiting/types/RecruitingUpload';
import { RecruitingRecordPicker } from '@/recruiting/components/RecruitingRecordPicker';
import { RecruitingContracts } from '@/recruiting/components/RecruitingContracts';
import { RecruitingJobDraftEditor } from '@/recruiting/components/RecruitingJobDraftEditor';
import {
  StyledRecruitingDrop,
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTitle,
} from '@/recruiting/components/recruitingStyles';

/** A refreshed preview keeps local edits separate from authoritative per-item server outcomes. */
type JobIntakeDetail = RecruitingIntake & {
  detail: {
    input: { companyId: string };
    jobItems: RecruitingJobItem[];
    extraction?: { profile: { reviewNotes: string[] } };
  };
};

/** Holds unfinished material through company creation instead of discarding it when switching forms. */
export const RecruitingCompanyJobs = ({
  initialIntakeId,
  onSubmitted,
  onIntakeChange,
  active = true,
}: {
  initialIntakeId?: string;
  onSubmitted: () => void;
  onIntakeChange: (id: string | undefined) => void;
  active?: boolean;
}) => {
  const [company, setCompany] = useState<RecruitingCompany>();
  const [contractsOpen, setContractsOpen] = useState(false);
  const [contractEditing, setContractEditing] = useState(false);
  const [createCompany, setCreateCompany] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [description, setDescription] = useState('');
  const [preferences, setPreferences] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<
    { file: File; uploaded?: RecruitingUpload }[]
  >([]);
  const [intakeId, setIntakeId] = useState(initialIntakeId);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [overrides, setOverrides] = useState<
    Record<string, RecruitingJobDraft>
  >({});
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const query = useRecruitingQuery<JobIntakeDetail>(
    intakeId ? `resume-intakes/${intakeId}` : null,
    intakeId ? 5000 : 0,
    active,
  );
  const boundCompany = useRecruitingQuery<RecruitingCompany>(
    query.data?.detail.input.companyId
      ? `companies/${query.data.detail.input.companyId}`
      : null,
  );
  const chosen = intakeId ? (boundCompany.data ?? company) : company;
  const items = query.data?.detail.jobItems ?? [];
  const locked = attempted || Boolean(intakeId) || busy;
  const actionable = items.filter(
    (item) => !['CREATED', 'DISCARDED'].includes(item.status),
  );

  /** Creates a company once without mutating the currently uploaded JD materials. */
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
      setCreateCompany(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`公司创建失败`);
    } finally {
      setBusy(false);
    }
  };

  /** Reuses completed file references and a stable batch key after a transient request failure. */
  const submit = async () => {
    if (!company) return;
    setBusy(true);
    setError('');
    setAttempted(true);
    try {
      const uploads = [];
      for (const [index, entry] of files.entries()) {
        const uploaded =
          entry.uploaded ?? (await uploadRecruitingFile(entry.file));
        uploads.push(uploaded);
        setFiles((current) =>
          current.map((item, position) =>
            position === index ? { ...item, uploaded } : item,
          ),
        );
      }
      const receipt = await recruitingRequest<RecruitingIntake>('job-intakes', {
        method: 'POST',
        body: JSON.stringify({
          companyId: company.id,
          files: uploads,
          text,
          note,
          source: 'manual',
          idempotencyKey: key,
        }),
      });
      setIntakeId(receipt.intakeId);
      onIntakeChange(receipt.intakeId);
      onSubmitted();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t`岗位材料提交失败`,
      );
    } finally {
      setBusy(false);
    }
  };

  /** Sends server-owned item IDs, preserving completed jobs and independently reporting failed rows. */
  const confirm = async () => {
    if (!intakeId) return;
    setBusy(true);
    setError('');
    try {
      await recruitingRequest(`job-intakes/${intakeId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          items: actionable
            .filter((item) => !ignored.has(item.itemId))
            .map((item) => ({
              itemId: item.itemId,
              draft: overrides[item.itemId] ?? item.draft,
            })),
          discardedItemIds: actionable
            .filter((item) => ignored.has(item.itemId))
            .map((item) => item.itemId),
        }),
      });
      await query.reload();
      onSubmitted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`岗位确认未完成`);
    } finally {
      setBusy(false);
    }
  };

  /** Starts another batch for the selected company while preserving already submitted server state. */
  const reset = () => {
    setCompany(chosen);
    setIntakeId(undefined);
    onIntakeChange(undefined);
    setAttempted(false);
    setText('');
    setNote('');
    setFiles([]);
    setOverrides({});
    setIgnored(new Set());
    setKey(crypto.randomUUID());
    setError('');
  };

  return (
    <StyledRecruitingStack>
      <StyledRecruitingPanel>
        <StyledRecruitingRow>
          <IconBuildingSkyscraper size={20} />
          <StyledRecruitingTitle>{t`1. 选择公司`}</StyledRecruitingTitle>
        </StyledRecruitingRow>
        <StyledRecruitingMuted>{t`先找到对应公司；没有记录时可就地新建，再为这家公司批量导入岗位。`}</StyledRecruitingMuted>
        <RecruitingRecordPicker<RecruitingCompany>
          label={t`公司`}
          path="companies"
          selected={chosen}
          disabled={locked || contractEditing}
          renderLabel={(record) => record.name}
          onSelect={setCompany}
        />
        {chosen && (
          <>
            <StyledRecruitingMuted>
              {chosen.domainName?.primaryLinkUrl}
            </StyledRecruitingMuted>
            {chosen.recruitingDescription && (
              <StyledRecruitingMuted>
                {chosen.recruitingDescription}
              </StyledRecruitingMuted>
            )}
            <a href={`/object/company/${chosen.id}`}>{t`打开公司记录`}</a>
            <Button
              disabled={contractEditing}
              onClick={() => setContractsOpen((value) => !value)}
            >
              {contractsOpen ? t`收起合同资料` : t`合同资料与内部提醒`}
            </Button>
          </>
        )}
        {!locked && !createCompany && !contractEditing && (
          <Button
            startIcon={<IconPlus size={16} />}
            onClick={() => setCreateCompany(true)}
          >{t`新建公司`}</Button>
        )}
        {createCompany && (
          <StyledRecruitingPanel>
            <Field.Root>
              <Field.Label>{t`公司名称`}</Field.Label>
              <Input value={name} onValueChange={setName} required />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`公司网站（可选）`}</Field.Label>
              <Input value={domain} onValueChange={setDomain} />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`公司简介（可选）`}</Field.Label>
              <Textarea
                rows={3}
                value={description}
                onValueChange={setDescription}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`公司招聘偏好（可选）`}</Field.Label>
              <Textarea
                rows={3}
                value={preferences}
                onValueChange={setPreferences}
              />
            </Field.Root>
            <StyledRecruitingRow>
              <Button
                variant="solid"
                color="accent"
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
      </StyledRecruitingPanel>
      {!intakeId && (
        <StyledRecruitingPanel>
          <StyledRecruitingTitle>{t`2. 添加岗位材料`}</StyledRecruitingTitle>
          <StyledRecruitingMuted>{t`可以粘贴多条岗位正文，也可以上传包含多条JD的文件。不同公司的材料请分批提交。`}</StyledRecruitingMuted>
          <Field.Root>
            <Field.Label>{t`岗位原文`}</Field.Label>
            <Textarea
              rows={9}
              value={text}
              onValueChange={setText}
              disabled={locked}
              placeholder={t`粘贴岗位名称、职责、要求，以及原文中的地点、薪资等信息。`}
            />
          </Field.Root>
          {!locked && (
            <StyledRecruitingDrop>
              <IconUpload size={24} />
              <strong>{t`添加岗位文件（可选）`}</strong>
              <input
                aria-label={t`添加岗位文件`}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt,.html,.htm,.md,.markdown"
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  if (
                    selected.length > 30 ||
                    selected.some((file) => file.size > 50 * 1024 * 1024)
                  ) {
                    setError(t`最多30个文件，每个文件最大50MB`);
                    return;
                  }
                  setFiles(selected.map((file) => ({ file })));
                }}
              />
            </StyledRecruitingDrop>
          )}
          {files.map((entry) => (
            <StyledRecruitingMuted
              key={`${entry.file.name}:${entry.file.lastModified}`}
            >
              {entry.file.name}
            </StyledRecruitingMuted>
          ))}
          <Field.Root>
            <Field.Label>{t`补充说明（可选）`}</Field.Label>
            <Textarea
              rows={3}
              value={note}
              onValueChange={setNote}
              disabled={locked}
            />
          </Field.Root>
          <StyledRecruitingRow>
            <Button
              variant="solid"
              color="accent"
              disabled={!company || (!text.trim() && !files.length)}
              loading={busy}
              onClick={() => {
                void submit();
              }}
            >{t`整理并预览岗位`}</Button>
            {attempted && (
              <Button disabled={busy} onClick={reset}>{t`重新编辑材料`}</Button>
            )}
          </StyledRecruitingRow>
        </StyledRecruitingPanel>
      )}
      {intakeId && (
        <StyledRecruitingPanel>
          <StyledRecruitingTitle>{t`3. 核对并确认岗位`}</StyledRecruitingTitle>
          {(query.error || query.data?.error) && (
            <StyledRecruitingError role="alert">
              {query.error || query.data?.error}
            </StyledRecruitingError>
          )}
          {query.data && !items.length && (
            <StyledRecruitingMuted>
              {query.data.stage === 'FAILED'
                ? t`材料尚未形成岗位预览，可检查队列错误并重新编辑。`
                : t`材料正在后台整理，预览完成后会在这里显示。`}
            </StyledRecruitingMuted>
          )}
          {query.data?.detail.extraction?.profile.reviewNotes.map((message) => (
            <StyledRecruitingMuted key={message}>
              {message}
            </StyledRecruitingMuted>
          ))}
          {items.map((item) => (
            <RecruitingJobDraftEditor
              key={item.itemId}
              item={item}
              draft={overrides[item.itemId] ?? item.draft}
              ignored={ignored.has(item.itemId)}
              busy={busy}
              onChange={(draft) =>
                setOverrides((current) => ({
                  ...current,
                  [item.itemId]: draft,
                }))
              }
              onIgnore={() =>
                setIgnored((current) => {
                  const next = new Set(current);
                  if (next.has(item.itemId)) next.delete(item.itemId);
                  else next.add(item.itemId);
                  return next;
                })
              }
            />
          ))}
          <StyledRecruitingRow>
            {actionable.length > 0 && (
              <Button
                variant="solid"
                color="accent"
                loading={busy}
                onClick={() => {
                  void confirm();
                }}
              >{t`确认本批岗位`}</Button>
            )}
            <Button disabled={busy} onClick={reset}>{t`继续导入另一批`}</Button>
          </StyledRecruitingRow>
        </StyledRecruitingPanel>
      )}
      {contractsOpen && chosen && (
        <RecruitingContracts
          key={chosen.id}
          companyId={chosen.id}
          active={active}
          onEditingChange={setContractEditing}
        />
      )}
      {error && (
        <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
      )}
    </StyledRecruitingStack>
  );
};
