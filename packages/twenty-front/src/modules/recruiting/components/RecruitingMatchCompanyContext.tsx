/** Expands current company context from the existing permission-aware directory without another model request. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { getRichTextFieldTextLines } from '@/object-record/record-field/ui/utils/getRichTextFieldTextLines';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import { type RecruitingCompany } from '@/recruiting/types/RecruitingCompany';
import {
  StyledRecruitingContextText,
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingStack,
} from '@/recruiting/components/recruitingStyles';

/** Displays company facts as escaped text and keeps them distinct from model scoring explanations. */
export const RecruitingMatchCompanyContext = ({
  companyId,
  active = true,
}: {
  companyId?: string;
  active?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const query = useRecruitingQuery<RecruitingCompany>(
    expanded && companyId ? `companies/${companyId}` : null,
    0,
    active && expanded,
  );
  const company = query.error ? undefined : query.data;
  const preferences = company?.recruitmentPreferences;
  const preferencesText =
    typeof preferences === 'string'
      ? preferences
      : getRichTextFieldTextLines(preferences).join('\n');
  if (!companyId)
    return <StyledRecruitingMuted>{t`未关联公司`}</StyledRecruitingMuted>;
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? t`收起公司资料` : t`查看公司资料`}
      </Button>
      {expanded && (
        <StyledRecruitingStack>
          {query.loading && (
            <StyledRecruitingMuted>{t`正在读取公司资料…`}</StyledRecruitingMuted>
          )}
          {query.error && (
            <StyledRecruitingError role="alert">
              {query.error}
            </StyledRecruitingError>
          )}
          {company && (
            <>
              <a href={`/object/company/${company.id}`}>{company.name}</a>
              {company.domainName?.primaryLinkUrl && (
                <StyledRecruitingMuted>
                  {company.domainName.primaryLinkUrl}
                </StyledRecruitingMuted>
              )}
              <strong>{t`公司简介`}</strong>
              <StyledRecruitingContextText>
                {company.recruitingDescription?.trim() || t`尚未填写公司简介`}
              </StyledRecruitingContextText>
              <strong>{t`招聘偏好`}</strong>
              <StyledRecruitingContextText>
                {preferencesText.trim() || t`尚未填写招聘偏好`}
              </StyledRecruitingContextText>
              <StyledRecruitingMuted>{t`这里显示当前公司资料，资料更新后请刷新匹配结果。`}</StyledRecruitingMuted>
            </>
          )}
        </StyledRecruitingStack>
      )}
    </div>
  );
};
