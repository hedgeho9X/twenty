/** Compact shadcn pagination with bounded page buttons and explicit direct jumps. */
import { useEffect, useState } from 'react';
import { Button } from '@/recruiting/shadcn/ui/button';
import { Input } from '@/recruiting/shadcn/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/recruiting/shadcn/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/recruiting/shadcn/ui/pagination';
export const resultPages = (page: number, totalPages: number) =>
  [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);
/** Uses one-based pages and clamps page jumps to the current filtered result count. */
export const ResultPagination = ({
  count,
  page,
  pageSize,
  onPage,
  onPageSize,
  isLoading = false,
  hasCount = true,
}: {
  count: number;
  isLoading?: boolean;
  hasCount?: boolean;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) => {
  const [jump, setJump] = useState('');
  const total = Math.max(1, Math.ceil(count / pageSize));
  const pages = resultPages(page, total);
  useEffect(() => {
    if (!isLoading && hasCount && page > total) onPage(total);
  }, [isLoading, hasCount, page, total, onPage]);
  return (
    <div className="recruiting-pagination flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3">
      <span className="text-sm text-muted-foreground">
        {isLoading
          ? '正在加载…'
          : !hasCount
            ? '—'
            : `共 ${count} 条 · 第 ${page} / ${total} 页`}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select
          disabled={isLoading || !hasCount}
          value={String(pageSize)}
          onValueChange={(value) => onPageSize(Number(value))}
        >
          <SelectTrigger aria-label="每页条数" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {[20, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  每页 {size} 条
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Pagination className="w-auto">
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="outline"
                size="sm"
                disabled={isLoading || !hasCount || page <= 1}
                onClick={() => onPage(page - 1)}
              >
                上一页
              </Button>
            </PaginationItem>
            {pages.map((value, index) => (
              <PaginationItem
                key={value}
                className="flex shrink-0 items-center"
              >
                {index > 0 && value - pages[index - 1] > 1 && (
                  <span className="px-1">…</span>
                )}
                <Button
                  variant={value === page ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  disabled={isLoading || !hasCount}
                  aria-current={value === page ? 'page' : undefined}
                  onClick={() => onPage(value)}
                >
                  {value}
                </Button>
              </PaginationItem>
            ))}
            <PaginationItem>
              <Button
                variant="outline"
                size="sm"
                disabled={isLoading || !hasCount || page >= total}
                onClick={() => onPage(page + 1)}
              >
                下一页
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (isLoading || !hasCount) return;
            const value = Number(jump);
            if (Number.isInteger(value) && value >= 1 && value <= total)
              onPage(value);
          }}
        >
          <Input
            disabled={isLoading || !hasCount}
            aria-label="跳转页码"
            inputMode="numeric"
            value={jump}
            onChange={(event) => setJump(event.target.value)}
            className="w-16"
          />
          <Button
            variant="ghost"
            size="sm"
            type="submit"
            disabled={isLoading || !hasCount}
          >
            跳转
          </Button>
        </form>
      </div>
    </div>
  );
};
