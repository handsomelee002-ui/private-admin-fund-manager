export type SortDirection = "asc" | "desc";

export type SortState<TSort extends string> = {
  sort: TSort;
  dir: SortDirection;
};

type SearchParamsValue = string | string[] | undefined;
type SearchParams = Record<string, SearchParamsValue>;

function firstValue(value: SearchParamsValue) {
  return Array.isArray(value) ? value[0] : value;
}

export function getSortState<TSort extends string>(
  searchParams: SearchParams,
  allowedSorts: readonly TSort[],
  defaultState: SortState<TSort>,
  prefix = "",
): SortState<TSort> {
  const sort = firstValue(searchParams[`${prefix}sort`]);
  const dir = firstValue(searchParams[`${prefix}dir`]);

  return {
    sort: sort && allowedSorts.includes(sort as TSort) ? (sort as TSort) : defaultState.sort,
    dir: dir === "asc" || dir === "desc" ? dir : defaultState.dir,
  };
}

function comparableValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    return value.trim() !== "" && Number.isFinite(numeric) ? numeric : value.toLowerCase();
  }
  if (value instanceof Date) return value.getTime();
  return String(value).toLowerCase();
}

export function sortRows<TRow, TSort extends string>(
  rows: readonly TRow[],
  state: SortState<TSort>,
  selectors: Record<TSort, (row: TRow) => unknown>,
) {
  const selector = selectors[state.sort];
  const direction = state.dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const aValue = comparableValue(selector(a));
    const bValue = comparableValue(selector(b));
    if (aValue < bValue) return -1 * direction;
    if (aValue > bValue) return 1 * direction;
    return 0;
  });
}
