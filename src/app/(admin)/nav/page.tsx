import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateNavWeekForm } from "@/components/CreateNavWeekForm";
import { LockNavButton } from "@/components/LockNavButton";
import { PaginationControls } from "@/components/PaginationControls";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getNavWeeks } from "@/lib/fundDb";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { CalendarClock } from "lucide-react";

export const dynamic = "force-dynamic";

const navSorts = ["week", "grossAssets", "nav", "units", "navPerUnit", "status"] as const;

export default async function NavPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, navSorts, { sort: "week", dir: "desc" });
  const navWeeks = await timeAsync("route.nav.getNavWeeks", () => getNavWeeks(), { route: "/nav" });
  const sortedNavWeeks = sortRows(navWeeks, sortState, {
    week: (week: any) => week.week_ending,
    grossAssets: (week: any) => week.gross_assets,
    nav: (week: any) => week.net_asset_value,
    units: (week: any) => week.total_units,
    navPerUnit: (week: any) => week.nav_per_unit,
    status: (week: any) => week.status,
  });
  const navPagination = paginateRows(sortedNavWeeks, resolvedSearchParams);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Valuations &amp; NAV</h1>
        </div>
        <div className="flex gap-2">
          <CreateNavWeekForm />
        </div>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">NAV Register</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead className="pl-6" sortKey="week" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Week Ending</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="grossAssets" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Gross Assets</SortableTableHead>
                <TableHead className="text-right">Fund Cash</TableHead>
                <SortableTableHead className="text-right" sortKey="nav" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Net Asset Value</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="units" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Total Units</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="navPerUnit" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>NAV / Unit</SortableTableHead>
                <SortableTableHead sortKey="status" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Status</SortableTableHead>
                <TableHead className="text-right pr-6">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {navPagination.pageRows.map((week: any) => (
                <TableRow key={week.id}>
                  <TableCell className="pl-6 font-medium">{week.week_ending}</TableCell>
                  <TableCell className="text-right">{formatMoney(week.gross_assets)}</TableCell>
                  <TableCell className="text-muted-foreground text-right">{formatMoney(week.fund_cash ?? 0)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(week.net_asset_value)}</TableCell>
                  <TableCell className="text-right">{formatUnits(week.total_units)}</TableCell>
                  <TableCell className="text-right font-semibold text-primary">{Number(week.nav_per_unit).toFixed(6)}</TableCell>
                  <TableCell>
                    <Badge variant={week.status === "locked" ? "default" : "outline"}>{week.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    {week.status === "draft" ? <LockNavButton id={week.id} /> : null}
                  </TableCell>
                </TableRow>
              ))}
              {sortedNavWeeks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                    No NAV weeks recorded. Add a platform, create a draft NAV, then lock it before recording capital movements.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <PaginationControls {...navPagination} searchParams={resolvedSearchParams} />
        </CardContent>
      </Card>
    </div>
  );
}
