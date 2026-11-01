/** Allows operators to correct every fact that influences matching before creating a company-bound job. */
import { useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Textarea,
} from 'twenty-ui/primitives/input';
import { Badge } from 'twenty-ui/primitives/data-display';
import { Select } from '@/ui/input/components/Select';
import {
  getRecruitingPreviewMissingFields,
  type RecruitingPreviewNameWarning,
} from 'twenty-shared/utils';
import { type RecruitingJobDraft } from '@/recruiting/companies/types/JobDraft';
import { type RecruitingJobItem } from '@/recruiting/companies/types/JobItem';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
  StyledRecruitingStack,
} from '@/recruiting/shared/styles';

/** Edits a stable item; an ignored preview never deletes an already created native job. */
export const RecruitingJobDraftEditor = ({
  item,
  draft,
  ignored,
  busy,
  nameWarnings = [],
  onChange,
  onIgnore,
}: {
  item: RecruitingJobItem;
  draft: RecruitingJobDraft;
  ignored: boolean;
  busy: boolean;
  nameWarnings?: RecruitingPreviewNameWarning[];
  onChange: (draft: RecruitingJobDraft) => void;
  onIgnore: () => void;
}) => {
  const [locationsEditor, setLocationsEditor] = useState<{
    itemId: string;
    text: string;
  }>();
  useEffect(() => {
    setLocationsEditor(undefined);
  }, [item.itemId]);
  const locationsText =
    locationsEditor?.itemId === item.itemId
      ? locationsEditor.text
      : draft.locations.join('、');
  const created = item.status === 'CREATED';
  const disabled = created || item.status === 'DISCARDED' || ignored || busy;
  const update = (patch: Partial<RecruitingJobDraft>) =>
    onChange({ ...draft, ...patch });
  /** Commits list values after editing so a trailing separator remains available for the next location. */
  const saveLocations = () => {
    if (!locationsEditor || locationsEditor.itemId !== item.itemId) return;
    update({
      locations: locationsEditor.text
        .split(/[、,，;；\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    });
    setLocationsEditor(undefined);
  };
  const categories = [
    { value: '', label: t`待确认` },
    { value: 'engineering', label: t`研发` },
    { value: 'product', label: t`产品` },
    { value: 'design', label: t`设计` },
    { value: 'operations', label: t`运营` },
    { value: 'growth_marketing', label: t`市场与增长` },
    { value: 'sales_business', label: t`销售与商务` },
    { value: 'data_ai', label: t`数据与AI` },
    { value: 'other', label: t`其他` },
  ];
  const employment = [
    { value: 'full_time', label: t`全职` },
    { value: 'part_time', label: t`兼职` },
    { value: 'internship', label: t`实习` },
    { value: 'contract', label: t`合同制` },
  ];
  const modes = [
    { value: 'onsite', label: t`现场办公` },
    { value: 'hybrid', label: t`混合办公` },
    { value: 'remote', label: t`远程` },
  ];
  const missing = getRecruitingPreviewMissingFields(draft);
  const missingLabels: Record<string, string> = {
    title: t`岗位名称`,
    description: t`完整岗位正文`,
    category: t`岗位方向`,
    employmentTypes: t`雇佣类型`,
    workModes: t`工作方式`,
    locations: t`工作地点`,
  };
  const required = missing.filter((field) =>
    ['title', 'description'].includes(field),
  );
  const optional = missing.filter((field) => !required.includes(field));
  return (
    <StyledRecruitingPanel id={`recruiting-job-preview-${item.itemId}`}>
      <StyledRecruitingRow>
        <Badge>
          {created
            ? t`已创建`
            : item.status === 'FAILED'
              ? t`需要修正`
              : ignored || item.status === 'DISCARDED'
                ? t`已忽略`
                : t`待确认`}
        </Badge>
        {created ? (
          <a href={`/object/recruitmentJob/${item.jobId}`}>{t`打开岗位`}</a>
        ) : (
          item.status !== 'DISCARDED' && (
            <Button size="sm" disabled={busy} onClick={onIgnore}>
              {ignored ? t`恢复这条` : t`忽略这条`}
            </Button>
          )
        )}
      </StyledRecruitingRow>
      {item.error && (
        <StyledRecruitingError role="alert">{item.error}</StyledRecruitingError>
      )}
      {item.matchingError && (
        <StyledRecruitingMuted>{item.matchingError}</StyledRecruitingMuted>
      )}
      {required.length > 0 && (
        <StyledRecruitingError role="status">
          {t`请补充：${required.map((field) => missingLabels[field]).join('、')}`}
        </StyledRecruitingError>
      )}
      {optional.length > 0 && (
        <StyledRecruitingMuted>
          {t`未写明：${optional.map((field) => missingLabels[field]).join('、')}；可保持未知，不按经验猜测。`}
        </StyledRecruitingMuted>
      )}
      {nameWarnings.length > 0 && (
        <StyledRecruitingStack>
          <StyledRecruitingMuted>{t`名称相同不代表同一个岗位，请核对地点、级别和职责；确认后仍可单独创建。`}</StyledRecruitingMuted>
          {nameWarnings.slice(0, 3).map((warning) => (
            <StyledRecruitingRow key={`${warning.source}:${warning.id}`}>
              <span>
                {warning.source === 'EXISTING'
                  ? t`公司已有同名岗位`
                  : t`本批另有同名岗位`}
              </span>
              <a
                href={
                  warning.source === 'EXISTING'
                    ? `/object/recruitmentJob/${warning.id}`
                    : `#recruiting-job-preview-${warning.id}`
                }
              >
                {warning.label}
              </a>
              {warning.status === 'CLOSED' && <Badge>{t`已停招`}</Badge>}
              {warning.status === 'RECRUITING' && <Badge>{t`在招`}</Badge>}
            </StyledRecruitingRow>
          ))}
          {nameWarnings.length > 3 && (
            <StyledRecruitingMuted>{t`另有${nameWarnings.length - 3}条同名提示，请打开公司记录核对。`}</StyledRecruitingMuted>
          )}
        </StyledRecruitingStack>
      )}
      <Field.Root>
        <Field.Label>{t`岗位名称`}</Field.Label>
        <Input
          value={draft.title}
          disabled={disabled}
          onValueChange={(title) => update({ title })}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>{t`完整岗位正文`}</Field.Label>
        <Textarea
          rows={7}
          value={draft.description}
          disabled={disabled}
          onValueChange={(description) => update({ description })}
        />
      </Field.Root>
      <details>
        <summary>{t`招聘条件与识别信息`}</summary>
        <Field.Root>
          <Field.Label>{t`岗位补充要求`}</Field.Label>
          <Textarea
            rows={3}
            value={draft.preferences}
            disabled={disabled}
            onValueChange={(preferences) => update({ preferences })}
          />
        </Field.Root>
        <Select
          dropdownId={`job-category-${item.itemId}`}
          label={t`岗位方向`}
          value={draft.category ?? ''}
          options={categories}
          disabled={disabled}
          onChange={(category) => update({ category: category || null })}
          fullWidth
        />
        <Field.Root>
          <Field.Label>{t`雇佣类型`}</Field.Label>
          <StyledRecruitingRow>
            {employment.map((option) => (
              <Field.Item key={option.value}>
                <Checkbox
                  disabled={disabled}
                  checked={draft.employmentTypes.includes(option.value)}
                  onCheckedChange={(checked) =>
                    update({
                      employmentTypes: checked
                        ? [...draft.employmentTypes, option.value]
                        : draft.employmentTypes.filter(
                            (value) => value !== option.value,
                          ),
                    })
                  }
                />
                <Field.Label>{option.label}</Field.Label>
              </Field.Item>
            ))}
          </StyledRecruitingRow>
          <Field.Description>{t`未写明的条件保持空白，不按经验猜测。`}</Field.Description>
        </Field.Root>
        <Field.Root>
          <Field.Label>{t`工作方式`}</Field.Label>
          <StyledRecruitingRow>
            {modes.map((option) => (
              <Field.Item key={option.value}>
                <Checkbox
                  disabled={disabled}
                  checked={draft.workModes.includes(option.value)}
                  onCheckedChange={(checked) =>
                    update({
                      workModes: checked
                        ? [...draft.workModes, option.value]
                        : draft.workModes.filter(
                            (value) => value !== option.value,
                          ),
                    })
                  }
                />
                <Field.Label>{option.label}</Field.Label>
              </Field.Item>
            ))}
          </StyledRecruitingRow>
        </Field.Root>
        <Field.Root>
          <Field.Label>{t`工作地点`}</Field.Label>
          <Input
            disabled={disabled}
            value={locationsText}
            onValueChange={(value) =>
              setLocationsEditor({ itemId: item.itemId, text: value })
            }
            onBlur={saveLocations}
          />
          <Field.Description>{t`多个地点可用顿号或逗号分隔。`}</Field.Description>
        </Field.Root>
      </details>
    </StyledRecruitingPanel>
  );
};
