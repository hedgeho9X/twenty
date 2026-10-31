/** Keeps company contract metadata and internal tasks available without exposing an unconfigured signing-platform action. */
import { useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Field, Input } from 'twenty-ui/primitives/input';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { recruitingRequest } from '@/recruiting/utils/recruitingRequest';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingTitle,
} from './recruitingStyles';

/** Template inputs remain distinct from signed content and actual signing-platform state. */
type Details = {
  legalName: string;
  creditCode: string;
  address: string;
  contactName: string;
  phone: string;
};
type Contract = {
  companyId: string;
  companyName: string;
  updatedAt: string;
  version: string;
  status: string;
  preparation: string;
  hasExternalDraft: boolean;
  details: Details;
  canEdit: boolean;
  canEditDetails: boolean;
  companyUrl: string;
  taskUrl?: string;
  taskNeedsReview?: boolean;
  statusSyncPending?: boolean;
  assigned?: boolean;
  alreadyInProgress?: boolean;
};
const labels = {
  legalName: t`公司法定名称`,
  creditCode: t`统一社会信用代码`,
  address: t`合同地址`,
  contactName: t`联系人`,
  phone: t`联系电话`,
};

/** Freezes an edit's source version so a refreshed view cannot overwrite concurrent owner changes. */
export const RecruitingContracts = ({
  companyId,
  active,
  onEditingChange,
}: {
  companyId: string;
  active: boolean;
  onEditingChange: (editing: boolean) => void;
}) => {
  const query = useRecruitingQuery<Contract>(
    `contracts/${companyId}`,
    0,
    active,
  );
  const [editor, setEditor] = useState<{
    details: Details;
    version: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [taskUrl, setTaskUrl] = useState('');
  useEffect(() => {
    onEditingChange(Boolean(editor));
    return () => onEditingChange(false);
  }, [editor, onEditingChange]);
  const data = query.data;
  const changed = Boolean(editor && data && editor.version !== data.version);
  /** Calls the shared owner/CAS service; successful local metadata writes do not invoke an external signing request. */
  const action = async (body: object, reminder = false) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await recruitingRequest<Contract>(
        `contracts/${companyId}${reminder ? '/reminder' : ''}`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setEditor(undefined);
      if (value.taskUrl) setTaskUrl(value.taskUrl);
      setNotice(
        value.taskNeedsReview
          ? t`合同状态已保存，请在任务列表核对提醒状态。`
          : value.statusSyncPending
            ? t`内部提醒已创建，公司状态需要负责人核对。`
            : value.alreadyInProgress
              ? t`公司已有发起或签署状态，保留现有记录。`
              : reminder
                ? t`内部提醒已准备，可由公司负责人继续处理。`
                : t`合同资料已保存。`,
      );
      await query.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`操作未完成`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <StyledRecruitingPanel>
      <StyledRecruitingTitle>{t`合同资料与内部提醒`}</StyledRecruitingTitle>
      <StyledRecruitingMuted>{t`保留原有模板资料和手工状态，由公司负责人维护。本地签约平台尚未配置；请在实际发起或签署后确认状态。`}</StyledRecruitingMuted>
      {(query.error || error) && (
        <StyledRecruitingError role="alert">
          {error || query.error}
        </StyledRecruitingError>
      )}
      {notice && <div role="status">{notice}</div>}
      {data && (
        <>
          <div>
            {t`当前状态`}：
            {{
              NOT_STARTED: t`尚未发起`,
              PENDING: t`待发起`,
              SENT: t`已发起（手工确认）`,
              SIGNED: t`已签署（手工确认）`,
            }[data.status] ?? data.status}
          </div>
          {!data.canEdit && (
            <StyledRecruitingMuted>{t`合同资料及实际状态需由公司负责人本人确认。`}</StyledRecruitingMuted>
          )}
          {Object.entries(labels).map(([key, label]) => (
            <Field.Root key={key}>
              <Field.Label>{label}</Field.Label>
              <Input
                value={(editor?.details ?? data.details)[key as keyof Details]}
                disabled={busy || !data.canEditDetails}
                maxLength={500}
                onValueChange={(value) =>
                  setEditor((previous) => ({
                    details: {
                      ...(previous?.details ?? data.details),
                      [key]: value,
                    },
                    version: previous?.version ?? data.version,
                  }))
                }
              />
            </Field.Root>
          ))}
          {changed && (
            <StyledRecruitingError role="alert">{t`记录已变化，请核对当前公司资料后重新编辑。`}</StyledRecruitingError>
          )}
          <StyledRecruitingRow>
            <Button
              disabled={busy || !editor || changed || !data.canEditDetails}
              onClick={() => {
                if (editor)
                  void action({
                    action: 'DETAILS',
                    details: editor.details,
                    version: editor.version,
                  });
              }}
            >{t`保存合同资料`}</Button>
            {editor && (
              <Button
                disabled={busy}
                onClick={() => setEditor(undefined)}
              >{t`放弃本次编辑`}</Button>
            )}
            <Button
              disabled={busy || Boolean(editor)}
              onClick={() => {
                void action({}, true);
              }}
            >{t`查看或创建内部提醒`}</Button>
            {taskUrl && <a href={taskUrl}>{t`打开签约提醒任务`}</a>}
          </StyledRecruitingRow>
          <StyledRecruitingRow>
            <Button
              disabled={
                busy ||
                Boolean(editor) ||
                !data.canEdit ||
                ['SENT', 'SIGNED'].includes(data.status)
              }
              onClick={() => {
                void action({
                  action: 'STATUS',
                  status: 'SENT',
                  version: data.version,
                });
              }}
            >{t`确认实际已发起`}</Button>
            <Button
              disabled={
                busy ||
                Boolean(editor) ||
                !data.canEdit ||
                data.status === 'SIGNED'
              }
              onClick={() => {
                void action({
                  action: 'STATUS',
                  status: 'SIGNED',
                  version: data.version,
                });
              }}
            >{t`确认实际已签署`}</Button>
            <a href={data.companyUrl}>{t`打开公司记录`}</a>
          </StyledRecruitingRow>
        </>
      )}
    </StyledRecruitingPanel>
  );
};
