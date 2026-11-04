import '@/recruiting/shadcn.css';
/** Provides candidate self-service and consented company viewing outside the authenticated CRM workspace. */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Textarea,
} from '@/recruiting/shadcn/compat';
import { themeCssVariables } from 'twenty-ui/theme';
import { portalDownload, portalRequest } from '@/recruiting/portal/api/request';
import {
  type RecruitingPortalView,
  type PortalSelfProfile,
} from '@/recruiting/portal/types/PortalView';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
  StyledRecruitingTitle,
} from '@/recruiting/shared/styles';

const StyledPortalMain = styled.main`
  margin: 0 auto;
  max-width: 960px;
  padding: ${themeCssVariables.spacing[6]};
`;

/** Editable list text preserves separators until save rather than erasing them on each keystroke. */
type PortalFormDraft = Omit<
  PortalSelfProfile,
  'expectedRoles' | 'skills' | 'locations'
> & { expectedRolesText: string; skillsText: string; locationsText: string };

/** Maps only visible/self-authored fields into the editable form, preserving unknown preference defaults. */
const draftFrom = (view: RecruitingPortalView): PortalFormDraft => {
  const profile: PortalSelfProfile = view.selfProfile ?? {
    fullName: view.profile.name,
    email: view.profile.email,
    phone: view.profile.phone,
    summary: view.profile.selfIntroduction,
    skills: [],
    expectedRoles: view.profile.expectedRoles,
    employmentTypes: view.profile.employmentTypes.filter((value) =>
      ['full_time', 'part_time', 'internship', 'contract'].includes(value),
    ),
    strictEmployment: view.profile.strictEmployment ?? false,
    workModes: view.profile.workModes.filter((value) =>
      ['remote', 'onsite', 'hybrid'].includes(value),
    ),
    strictWorkMode: view.profile.strictWorkMode ?? false,
    locations: view.profile.locations,
    note: view.profile.candidateNote,
  };
  return {
    ...profile,
    expectedRolesText: profile.expectedRoles.join('、'),
    skillsText: profile.skills.join('、'),
    locationsText: profile.locations.join('、'),
  };
};

/** Never treats interest, sharing consent, file upload and real contact as the same state. */
export const RecruitingPortalPage = () => {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get('access') ?? '';
  const [state, setState] = useState<{
    view?: RecruitingPortalView;
    draft?: PortalFormDraft;
    dirty: boolean;
  }>({ dirty: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sharedFiles, setSharedFiles] = useState<Set<string>>(() => new Set());
  const [file, setFile] = useState<File>();
  const [completedFileId, setCompletedFileId] = useState<string>();
  const [resumeKey, setResumeKey] = useState(() => crypto.randomUUID());
  const [note, setNote] = useState('');
  const [intakeId, setIntakeId] = useState<string>();
  const view = state.view;
  const draft = state.draft;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await portalRequest<RecruitingPortalView>(
        token,
        { action: 'view' },
        signal,
      );
      if (!signal?.aborted)
        setState((current) => ({
          view: result,
          draft: current.dirty ? current.draft : draftFrom(result),
          dirty: current.dirty,
        }));
    },
    [token],
  );
  useEffect(() => {
    const controller = new AbortController();
    setState({ dirty: false });
    setError('');
    setSharedFiles(new Set());
    setFile(undefined);
    setCompletedFileId(undefined);
    setIntakeId(undefined);
    setNote('');
    setResumeKey(crypto.randomUUID());
    setMessage('');
    if (!token) {
      setError(t`链接缺少访问凭据，请向运营人员获取完整入口`);
      return;
    }
    void load(controller.signal).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [load, token]);

  /** Prevents a background refresh from erasing unsaved candidate input. */
  const edit = <TKey extends keyof PortalFormDraft>(
    key: TKey,
    value: PortalFormDraft[TKey],
  ) =>
    setState((current) => ({
      ...current,
      draft: current.draft ? { ...current.draft, [key]: value } : undefined,
      dirty: true,
    }));
  const act = async (input: object, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await portalRequest(token, input);
      setMessage(success);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`操作尚未完成`);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const { expectedRolesText, skillsText, locationsText, ...fields } = draft;
      const profile = {
        ...fields,
        expectedRoles: split(expectedRolesText),
        skills: split(skillsText),
        locations: split(locationsText),
      };
      await portalRequest(token, { action: 'profile_save', profile });
      setState((current) => ({ ...current, dirty: false }));
      setMessage(t`资料已保存，分享前请核对下方实际展示内容`);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`资料未保存`);
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      let id = completedFileId;
      if (!id) {
        const target = await portalRequest<{
          fileId: string;
          uploadUrl: string;
          contentType: string;
        }>(token, {
          action: 'upload_target',
          filename: file.name,
          size: file.size,
        });
        const transfer = await fetch(target.uploadUrl, {
          method: 'PUT',
          credentials: 'omit',
          redirect: 'error',
          headers: { 'content-type': target.contentType },
          body: file,
          signal: AbortSignal.timeout(120_000),
        });
        if (!transfer.ok) throw new Error(t`文件传输未完成，请重试`);
        await portalRequest(token, {
          action: 'upload_complete',
          fileId: target.fileId,
        });
        id = target.fileId;
        setCompletedFileId(id);
      }
      const accepted = await portalRequest<{ intakeId: string }>(token, {
        action: 'resume_submit',
        fileIds: [id],
        note,
        idempotencyKey: resumeKey,
      });
      setIntakeId(accepted.intakeId);
      setMessage(t`新版简历已接收，资料将在后台整理，原件历史保留`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t`简历尚未受理，请重试`,
      );
    } finally {
      setBusy(false);
    }
  };
  const split = (text: string) =>
    text
      .split(/[\n,，、]/)
      .map((value) => value.trim())
      .filter(Boolean);

  return (
    <StyledPortalMain className="recruiting-shadcn">
      <StyledRecruitingStack>
        <h1>
          {view?.kind === 'COMPANY' ? t`候选人推荐资料` : t`候选人资料确认`}
        </h1>
        {view?.kind === 'COMPANY' && view.job && (
          <StyledRecruitingPanel>
            <StyledRecruitingTitle>{`${view.job.companyName} · ${view.job.title}`}</StyledRecruitingTitle>
            <p>{view.job.description}</p>
          </StyledRecruitingPanel>
        )}
        <StyledRecruitingMuted>{t`链接仅用于指定候选人与岗位。资料填写、岗位兴趣、分享确认及实际招聘沟通分别记录。`}</StyledRecruitingMuted>
        {error && (
          <StyledRecruitingError role="alert">{error}</StyledRecruitingError>
        )}
        {message && (
          <StyledRecruitingMuted role="status">{message}</StyledRecruitingMuted>
        )}
        {!view && !error && (
          <StyledRecruitingMuted>{t`正在读取资料…`}</StyledRecruitingMuted>
        )}
        {view?.kind === 'CANDIDATE' && draft && (
          <StyledRecruitingPanel>
            <StyledRecruitingTitle>{t`本人求职资料`}</StyledRecruitingTitle>
            <Field.Root>
              <Field.Label>{t`姓名`}</Field.Label>
              <Input
                value={draft.fullName}
                disabled={busy}
                onValueChange={(value) => edit('fullName', value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`邮箱`}</Field.Label>
              <Input
                value={draft.email}
                disabled={busy}
                onValueChange={(value) => edit('email', value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`联系电话`}</Field.Label>
              <Input
                value={draft.phone}
                disabled={busy}
                onValueChange={(value) => edit('phone', value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`自我介绍（可选）`}</Field.Label>
              <Textarea
                value={draft.summary}
                disabled={busy}
                rows={4}
                onValueChange={(value) => edit('summary', value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`本次目标岗位`}</Field.Label>
              <Textarea
                value={draft.expectedRolesText}
                disabled={busy}
                rows={2}
                onValueChange={(value) => edit('expectedRolesText', value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`补充技能（可选）`}</Field.Label>
              <Textarea
                value={draft.skillsText}
                disabled={busy}
                rows={2}
                onValueChange={(value) => edit('skillsText', value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`希望的工作类型`}</Field.Label>
              <StyledRecruitingRow>
                {[
                  { value: 'full_time', label: t`全职` },
                  { value: 'part_time', label: t`兼职` },
                  { value: 'internship', label: t`实习` },
                  { value: 'contract', label: t`合同项目` },
                ].map((item) => (
                  <Field.Item key={item.value}>
                    <Checkbox
                      checked={draft.employmentTypes.includes(item.value)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        edit(
                          'employmentTypes',
                          checked
                            ? [...draft.employmentTypes, item.value]
                            : draft.employmentTypes.filter(
                                (value) => value !== item.value,
                              ),
                        )
                      }
                    />
                    <Field.Label>{item.label}</Field.Label>
                  </Field.Item>
                ))}
              </StyledRecruitingRow>
              <Field.Item>
                <Checkbox
                  checked={draft.strictEmployment}
                  disabled={busy || !draft.employmentTypes.length}
                  onCheckedChange={(checked) =>
                    edit('strictEmployment', checked === true)
                  }
                />
                <Field.Label>{t`仅接受以上勾选类型`}</Field.Label>
              </Field.Item>
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`工作方式`}</Field.Label>
              <StyledRecruitingRow>
                {[
                  { value: 'remote', label: t`远程` },
                  { value: 'onsite', label: t`线下` },
                  { value: 'hybrid', label: t`混合` },
                ].map((item) => (
                  <Field.Item key={item.value}>
                    <Checkbox
                      checked={draft.workModes.includes(item.value)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        edit(
                          'workModes',
                          checked
                            ? [...draft.workModes, item.value]
                            : draft.workModes.filter(
                                (value) => value !== item.value,
                              ),
                        )
                      }
                    />
                    <Field.Label>{item.label}</Field.Label>
                  </Field.Item>
                ))}
              </StyledRecruitingRow>
              <Field.Item>
                <Checkbox
                  checked={draft.strictWorkMode}
                  disabled={busy || !draft.workModes.length}
                  onCheckedChange={(checked) =>
                    edit('strictWorkMode', checked === true)
                  }
                />
                <Field.Label>{t`仅接受以上工作方式`}</Field.Label>
              </Field.Item>
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`地点偏好（可选）`}</Field.Label>
              <Input
                value={draft.locationsText}
                disabled={busy}
                onValueChange={(value) => edit('locationsText', value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t`其他说明（可选）`}</Field.Label>
              <Textarea
                value={draft.note}
                disabled={busy}
                rows={3}
                onValueChange={(value) => edit('note', value)}
              />
            </Field.Root>
            <Button
              loading={busy}
              variant="solid"
              color="accent"
              onClick={() => {
                void save();
              }}
            >{t`保存本人资料`}</Button>
          </StyledRecruitingPanel>
        )}
        {view?.kind === 'CANDIDATE' && (
          <StyledRecruitingPanel>
            <StyledRecruitingTitle>{t`上传新版简历`}</StyledRecruitingTitle>
            <StyledRecruitingMuted>{t`支持图片、PDF、Word、TXT、HTML与Markdown，单个文件50MB以内。结构化职业资料以本次完整材料为准，历史原件保留。`}</StyledRecruitingMuted>
            <Input
              type="file"
              aria-label={t`选择新版简历`}
              accept="image/*,.pdf,.doc,.docx,.txt,.html,.htm,.md,.markdown"
              disabled={busy || Boolean(intakeId)}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen && chosen.size > 50 * 1024 * 1024) {
                  setError(t`单个文件最大50MB`);
                  return;
                }
                setFile(chosen);
                setCompletedFileId(undefined);
                setResumeKey(crypto.randomUUID());
              }}
            />
            <Textarea
              value={note}
              onValueChange={setNote}
              rows={3}
              disabled={busy || Boolean(completedFileId)}
              placeholder={t`随简历提交的补充说明（可选）`}
            />
            <Button
              loading={busy}
              disabled={!file || Boolean(intakeId)}
              onClick={() => {
                void upload();
              }}
            >{t`提交新版简历`}</Button>
            {intakeId && (
              <Button
                disabled={busy}
                onClick={() => {
                  void portalRequest<{
                    state: string;
                    stage: string;
                    error?: string;
                  }>(token, { action: 'intake_progress', intakeId })
                    .then((receipt) => {
                      setMessage(
                        receipt.error ||
                          (receipt.state === 'COMPLETED'
                            ? t`简历已整理并保存`
                            : t`材料正在后台处理，请稍后刷新`),
                      );
                      return load();
                    })
                    .catch((failure) => setError(failure.message));
                }}
              >{t`刷新处理进度`}</Button>
            )}
          </StyledRecruitingPanel>
        )}
        {view && (
          <StyledRecruitingPanel>
            <StyledRecruitingTitle>
              {view.kind === 'COMPANY'
                ? t`候选人已确认的资料`
                : t`实际分享内容预览`}
            </StyledRecruitingTitle>
            <strong>{view.profile.name}</strong>
            <StyledRecruitingMuted>
              {[view.profile.email, view.profile.phone]
                .filter(Boolean)
                .join(' · ')}
            </StyledRecruitingMuted>
            <p>{view.profile.summary}</p>
            <p>{view.profile.selfIntroduction}</p>
            <p>{view.profile.skills.join('、')}</p>
            {view.profile.experience.map((text, index) => (
              <p key={`experience-${index}`}>{text}</p>
            ))}
            {view.profile.education.map((text, index) => (
              <p key={`education-${index}`}>{text}</p>
            ))}
            <p>{view.profile.candidateNote}</p>
            {view.files.map((item) => (
              <StyledRecruitingRow key={item.fileId}>
                {view.kind === 'CANDIDATE' && (
                  <Checkbox
                    aria-label={`${t`同意分享附件`} ${item.label}`}
                    checked={sharedFiles.has(item.fileId)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setSharedFiles((current) => {
                        const next = new Set(current);
                        if (checked) next.add(item.fileId);
                        else next.delete(item.fileId);
                        return next;
                      })
                    }
                  />
                )}
                <span>{item.label}</span>
                <Button
                  size="sm"
                  onClick={() => {
                    void portalDownload(token, item.fileId, item.label).catch(
                      (failure) => setError(failure.message),
                    );
                  }}
                >{t`下载查看`}</Button>
              </StyledRecruitingRow>
            ))}
            {view.kind === 'CANDIDATE' && (
              <StyledRecruitingMuted>{t`勾选希望提供给公司的简历附件；邮件原文与运营私密备注不在此分享范围内。`}</StyledRecruitingMuted>
            )}
          </StyledRecruitingPanel>
        )}
        {view?.jobs?.map((job) => (
          <StyledRecruitingPanel key={job.jobId}>
            <StyledRecruitingTitle>
              {job.companyName
                ? `${job.companyName} · ${job.title}`
                : job.title}
            </StyledRecruitingTitle>
            <p>{job.description}</p>
            <StyledRecruitingRow>
              <Button
                disabled={busy || !job.recruiting}
                onClick={() => {
                  void act(
                    { action: 'intent', jobId: job.jobId, interested: true },
                    t`已记录岗位兴趣，尚未授权分享`,
                  );
                }}
              >
                {job.interested ? t`已感兴趣` : t`我感兴趣`}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  void act(
                    { action: 'intent', jobId: job.jobId, interested: false },
                    t`已记录暂不考虑`,
                  );
                }}
              >{t`暂不考虑`}</Button>
            </StyledRecruitingRow>
            <StyledRecruitingMuted>
              {job.consent?.status === 'WITHDRAWN'
                ? t`分享已撤回，企业入口不能继续访问本系统资料。`
                : job.consent?.valid
                  ? t`已确认本次资料分享。`
                  : t`尚未确认分享，或资料更新后需要重新确认。`}
            </StyledRecruitingMuted>
            <StyledRecruitingMuted>{t`确认后允许向这家公司分享上方求职资料、联系方式及勾选的简历，用于此岗位招聘沟通。`}</StyledRecruitingMuted>
            {state.dirty && (
              <StyledRecruitingMuted>{t`请先保存资料，再确认分享。`}</StyledRecruitingMuted>
            )}
            <StyledRecruitingRow>
              <Button
                variant="solid"
                color="accent"
                disabled={busy || state.dirty || !job.recruiting}
                onClick={() => {
                  void act(
                    {
                      action: 'consent',
                      jobId: job.jobId,
                      choice: 'CONFIRM',
                      fileIds: [...sharedFiles],
                    },
                    t`分享已确认；实际推荐与联系由运营人员进行。`,
                  );
                }}
              >{t`确认分享给这家公司`}</Button>
              <Button
                disabled={busy}
                onClick={() => {
                  void act(
                    { action: 'consent', jobId: job.jobId, choice: 'WITHDRAW' },
                    t`已撤回分享，后续企业访问已停止。`,
                  );
                }}
              >{t`撤回分享`}</Button>
            </StyledRecruitingRow>
          </StyledRecruitingPanel>
        ))}
        {view && (
          <StyledRecruitingMuted>{t`入口有效期至 ${new Date(view.expiresAt).toLocaleString()}。撤回会停止本系统后续访问，已被接收方保存的副本无法通过此入口删除。`}</StyledRecruitingMuted>
        )}
      </StyledRecruitingStack>
    </StyledPortalMain>
  );
};
