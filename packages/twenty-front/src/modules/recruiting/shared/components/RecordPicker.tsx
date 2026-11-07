/** Fetches record choices only while an operator opens the paginated shadcn picker. */
import { useEffect, useState } from 'react';
import { Button } from '@/recruiting/shadcn/ui/button';
import { Input } from '@/recruiting/shadcn/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/recruiting/shadcn/ui/popover';
import { Field, FieldLabel } from '@/recruiting/shadcn/ui/field';
import { Skeleton } from '@/recruiting/shadcn/ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle } from '@/recruiting/shadcn/ui/empty';
import { Alert, AlertDescription } from '@/recruiting/shadcn/ui/alert';
import { type RecruitingPage } from '@/recruiting/shared/types/Page';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';

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
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [queryText, setQueryText] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setQueryText(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useRecruitingQuery<RecruitingPage<T>>(
    `${path}${path.includes('?') ? '&' : '?'}search=${encodeURIComponent(queryText)}&limit=8&offset=${offset}`,
    0,
    open && !disabled,
  );
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className="w-full justify-start truncate"
          >
            {selected ? renderLabel(selected) : `选择${label}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-72 p-3"
          align="start"
        >
          <Input
            autoFocus
            aria-label={label}
            value={search}
            placeholder="输入名称搜索"
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
          {query.error && (
            <Alert variant="destructive">
              <AlertDescription>{query.error}</AlertDescription>
            </Alert>
          )}
          <div
            role="listbox"
            aria-label={`${label}搜索结果`}
            className="my-2 flex max-h-72 flex-col gap-1 overflow-y-auto"
          >
            {query.loading
              ? Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))
              : query.data?.records.map((record) => (
                  <Button
                    key={record.id}
                    role="option"
                    aria-selected={selected?.id === record.id}
                    variant="ghost"
                    className="h-auto min-h-9 justify-start whitespace-normal text-left"
                    onClick={() => {
                      onSelect(record);
                      setOpen(false);
                    }}
                  >
                    <span>
                      <span className="block">{renderLabel(record)}</span>
                      {renderHint?.(record) && (
                        <span className="block text-xs text-muted-foreground">
                          {renderHint(record)}
                        </span>
                      )}
                    </span>
                  </Button>
                ))}
            {!query.loading && query.data && !query.data.records.length && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>未找到匹配记录</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!selected}
              onClick={() => {
                onSelect(undefined);
                setOpen(false);
              }}
            >
              清除
            </Button>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!offset || query.loading}
                onClick={() => setOffset(Math.max(0, offset - 8))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!query.data?.hasNextPage || query.loading}
                onClick={() => setOffset(offset + 8)}
              >
                下一页
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </Field>
  );
};
