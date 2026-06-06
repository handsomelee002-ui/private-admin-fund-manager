type SearchParamsValue = string | string[] | undefined;
type SearchParams = Record<string, SearchParamsValue>;

export const DEFAULT_PAGE_SIZE = 12;

function firstValue(value: SearchParamsValue) {
  return Array.isArray(value) ? value[0] : value;
}

export function getPageNumber(searchParams: SearchParams, prefix = "") {
  const value = firstValue(searchParams[`${prefix}page`]);
  const page = value ? Number(value) : 1;
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function paginateRows<TRow>(
  rows: readonly TRow[],
  searchParams: SearchParams,
  prefix = "",
  pageSize = DEFAULT_PAGE_SIZE,
) {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(getPageNumber(searchParams, prefix), pageCount);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(startIndex, startIndex + pageSize);
  const showingStart = total === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(startIndex + pageRows.length, total);

  return {
    pageRows,
    currentPage,
    pageCount,
    pageSize,
    total,
    showingStart,
    showingEnd,
  };
}

