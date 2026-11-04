import {
  ResultInput,
  ResultSelect,
} from '@/recruiting/shared/components/ResultControls';
/** Keeps result pagination visible and supports direct navigation without a wall of page buttons. */
import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';

/** Derives a bounded page window, including first and last pages. */
export const resultPages = (page: number, totalPages: number) =>
  [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((left, right) => left - right);

/** Uses one-based pages; changing page size returns to the first page at the caller. */
export const ResultPagination = ({
  count,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  count: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) => {
  const [jump, setJump] = useState('');
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const pages = resultPages(page, totalPages);
  return (
    <nav
      aria-label={t`结果分页`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        paddingTop: 12,
      }}
    >
      <span>
        {t`共 ${count} 条`} · {page} / {totalPages}
      </span>
      <ResultSelect
        aria-label={t`每页条数`}
        value={pageSize}
        onChange={(event) => onPageSize(Number(event.target.value))}
      >
        {[20, 50, 100].map((size) => (
          <option key={size} value={size}>{t`每页 ${size} 条`}</option>
        ))}
      </ResultSelect>
      <Button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >{t`上一页`}</Button>
      {pages.map((value, index) => (
        <span key={value}>
          {index > 0 && value - pages[index - 1] > 1 && <span> … </span>}
          <Button
            aria-current={value === page ? 'page' : undefined}
            disabled={value === page}
            onClick={() => onPage(value)}
          >
            {value}
          </Button>
        </span>
      ))}
      <Button
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >{t`下一页`}</Button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(jump);
          if (Number.isInteger(value) && value >= 1 && value <= totalPages)
            onPage(value);
        }}
      >
        <ResultInput
          aria-label={t`跳转页码`}
          type="number"
          min={1}
          max={totalPages}
          value={jump}
          onChange={(event) => setJump(event.target.value)}
          style={{ width: 64 }}
        />
        <button type="submit">{t`跳转`}</button>
      </form>
    </nav>
  );
};
