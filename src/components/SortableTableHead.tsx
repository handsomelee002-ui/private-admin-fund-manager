import Link from "next/link";
import type React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDirection } from "@/lib/tableSorting";

type Props = {
  children: React.ReactNode;
  sortKey: string;
  activeSort: string;
  activeDir: SortDirection;
  searchParams: Record<string, string | string[] | undefined>;
  className?: string;
  prefix?: string;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function SortableTableHead({
  children,
  sortKey,
  activeSort,
  activeDir,
  searchParams,
  className,
  prefix = "",
}: Props) {
  const isActive = activeSort === sortKey;
  const nextDir: SortDirection = isActive && activeDir === "asc" ? "desc" : "asc";
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    const normalized = firstValue(value);
    if (normalized) params.set(key, normalized);
  }
  params.set(`${prefix}sort`, sortKey);
  params.set(`${prefix}dir`, nextDir);

  const Icon = isActive ? (activeDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead className={className}>
      <Link
        href={`?${params.toString()}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm hover:text-foreground",
          className?.includes("text-right") && "justify-end w-full",
        )}
      >
        {children}
        <Icon className="h-3 w-3" aria-hidden="true" />
      </Link>
    </TableHead>
  );
}
