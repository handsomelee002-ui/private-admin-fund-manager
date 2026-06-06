import { NoPrefetchLink } from "@/components/NoPrefetchLink";

type Props = {
  currentPage: number;
  pageCount: number;
  showingStart: number;
  showingEnd: number;
  total: number;
  searchParams: Record<string, string | string[] | undefined>;
  prefix?: string;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pageHref(searchParams: Props["searchParams"], page: number, prefix: string) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    const normalized = firstValue(value);
    if (normalized) params.set(key, normalized);
  }
  params.set(`${prefix}page`, String(page));

  return `?${params.toString()}`;
}

export function PaginationControls({
  currentPage,
  pageCount,
  showingStart,
  showingEnd,
  total,
  searchParams,
  prefix = "",
}: Props) {
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border/50 px-6 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
      <span className="text-muted-foreground">
        Showing {showingStart}-{showingEnd} of {total}
      </span>
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <NoPrefetchLink
            href={pageHref(searchParams, Math.max(1, currentPage - 1), prefix)}
            className={`rounded-md border px-3 py-1.5 ${currentPage === 1 ? "pointer-events-none text-muted-foreground opacity-50" : "hover:bg-muted"}`}
          >
            Previous
          </NoPrefetchLink>
          <span className="text-muted-foreground">Page {currentPage} / {pageCount}</span>
          <NoPrefetchLink
            href={pageHref(searchParams, Math.min(pageCount, currentPage + 1), prefix)}
            className={`rounded-md border px-3 py-1.5 ${currentPage === pageCount ? "pointer-events-none text-muted-foreground opacity-50" : "hover:bg-muted"}`}
          >
            Next
          </NoPrefetchLink>
        </div>
      )}
    </div>
  );
}

