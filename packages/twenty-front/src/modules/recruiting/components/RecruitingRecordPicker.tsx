/** Searches small native record choices without loading the full material pool into the browser. */
import { useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button, Field, Input } from 'twenty-ui/primitives/input';
import { type RecruitingPage } from '@/recruiting/types/RecruitingPage';
import { useRecruitingQuery } from '@/recruiting/hooks/useRecruitingQuery';
import {
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
  StyledRecruitingScroll,
  StyledRecruitingStack,
} from '@/recruiting/components/recruitingStyles';

/** Keeps selection explicit, with cancellable debounced search and a clear selected-record state. */
export const RecruitingRecordPicker = <T extends { id: string }>({
  label,
  path,
  selected,
  renderLabel,
  renderHint,
  onSelect,
  disabled = false,
}: {
  label: string;
  path: string;
  selected?: T;
  renderLabel: (record: T) => string;
  renderHint?: (record: T) => string | undefined;
  onSelect: (record: T | undefined) => void;
  disabled?: boolean;
}) => {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const query = useRecruitingQuery<RecruitingPage<T>>(
    !selected && !disabled
      ? `${path}${path.includes('?') ? '&' : '?'}search=${encodeURIComponent(debounced)}`
      : null,
  );
  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      {selected ? (
        <StyledRecruitingRow>
          <strong>{renderLabel(selected)}</strong>
          <Button
            disabled={disabled}
            size="sm"
            onClick={() => onSelect(undefined)}
          >{t`重新选择`}</Button>
        </StyledRecruitingRow>
      ) : (
        <StyledRecruitingStack>
          <Input
            aria-label={label}
            value={search}
            disabled={disabled}
            onValueChange={setSearch}
            placeholder={t`输入名称搜索`}
          />
          {query.error && (
            <StyledRecruitingError role="alert">
              {query.error}
            </StyledRecruitingError>
          )}
          <StyledRecruitingScroll>
            {query.data?.records.map((record) => (
              <Button
                key={record.id}
                variant="ghost"
                fullWidth
                onClick={() => onSelect(record)}
              >
                {renderLabel(record)}
                {renderHint?.(record) && ` · ${renderHint(record)}`}
              </Button>
            ))}
          </StyledRecruitingScroll>
          {query.loading && (
            <StyledRecruitingMuted>{t`正在查找…`}</StyledRecruitingMuted>
          )}
          {!query.loading && query.data && !query.data.records.length && (
            <StyledRecruitingMuted>{t`没有找到对应记录，请修改搜索内容。`}</StyledRecruitingMuted>
          )}
          {query.data?.hasNextPage && (
            <StyledRecruitingMuted>{t`还有更多记录，请继续输入名称缩小范围。`}</StyledRecruitingMuted>
          )}
        </StyledRecruitingStack>
      )}
    </Field.Root>
  );
};
