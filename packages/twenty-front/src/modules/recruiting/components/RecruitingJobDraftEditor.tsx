/** Allows operators to correct every fact that influences matching before creating a company-bound job. */
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
import { type RecruitingJobDraft } from '@/recruiting/types/RecruitingJobDraft';
import { type RecruitingJobItem } from '@/recruiting/types/RecruitingJobItem';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingPanel,
  StyledRecruitingRow,
} from '@/recruiting/components/recruitingStyles';

/** Edits a stable item; an ignored preview never deletes an already created native job. */
export const RecruitingJobDraftEditor = ({
  item,
  draft,
  ignored,
  busy,
  onChange,
  onIgnore,
}: {
  item: RecruitingJobItem;
  draft: RecruitingJobDraft;
  ignored: boolean;
  busy: boolean;
  onChange: (draft: RecruitingJobDraft) => void;
  onIgnore: () => void;
}) => {
  const created = item.status === 'CREATED';
  const disabled = created || item.status === 'DISCARDED' || ignored || busy;
  const update = (patch: Partial<RecruitingJobDraft>) =>
    onChange({ ...draft, ...patch });
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
  return (
    <StyledRecruitingPanel>
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
            value={draft.locations.join('、')}
            onValueChange={(value) =>
              update({
                locations: value
                  .split(/[、,，;；\n]/)
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              })
            }
          />
          <Field.Description>{t`多个地点可用顿号或逗号分隔。`}</Field.Description>
        </Field.Root>
      </details>
      {draft.reviewNotes.map((note, index) => (
        <StyledRecruitingMuted key={index}>{note}</StyledRecruitingMuted>
      ))}
    </StyledRecruitingPanel>
  );
};
