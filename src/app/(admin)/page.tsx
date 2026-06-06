import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PaginationControls } from "@/components/PaginationControls";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getDashboardSummary } from "@/lib/fundDb";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Activity, Banknote, Landmark, Percent, Users, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const dashboardInvestorSorts = ["investor", "units", "ownership", "marketValue"] as const;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, dashboardInvestorSorts, { sort: "marketValue", dir: "desc" });
  const summary = await timeAsync("route.dashboard.getDashboardSummary", () => getDashboardSummary(), { route: "/" });
  const sortedInvestors = sortRows(summary.investors, sortState, {
    investor: (investor: any) => investor.name,
    units: (investor: any) => investor.units,
    ownership: (investor: any) => investor.ownershipPercent,
    marketValue: (investor: any) => investor.marketValue,
  });
  const investorPagination = paginateRows(sortedInvestors, resolvedSearchParams);
  const latestNav = summary.latestNav;
  const navPerUnit = latestNav ? Number(latestNav.nav_per_unit) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">Equity NAV, investor units, and fixed savings principal.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Equity NAV</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(summary.aum)}</div>
            <p className="text-xs text-muted-foreground mt-1">Excludes fixed savings funding</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Fixed Savings Principal</CardTitle>
            <Banknote className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">{formatMoney(summary.fixedSavingsLiability)}</div>
            <p className="text-xs text-muted-foreground mt-1">Interest excluded from this total</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Investor Capital</CardTitle>
            <Landmark className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(summary.totalInvestorCapital)}</div>
            <p className="text-xs text-muted-foreground mt-1">Equity NAV + fixed savings principal</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">NAV / Unit</CardTitle>
            <Percent className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">{navPerUnit.toFixed(6)}</div>
            <p className="text-xs text-muted-foreground mt-1">{latestNav?.week_ending ?? "No locked NAV"}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Units</CardTitle>
            <Users className="h-4 w-4 text-violet-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUnits(summary.totalUnits)}</div>
            <p className="text-xs text-muted-foreground mt-1">{summary.investors.length} investors</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Investor Unit Balances</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead className="pl-6" sortKey="investor" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Investor</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="units" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Units</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="ownership" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Ownership</SortableTableHead>
                <SortableTableHead className="text-right pr-6" sortKey="marketValue" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Market Value</SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investorPagination.pageRows.map((investor: any) => (
                <TableRow key={investor.id}>
                  <TableCell className="pl-6 font-medium">{investor.name}</TableCell>
                  <TableCell className="text-right">{formatUnits(investor.units)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">{investor.ownershipPercent.toFixed(4)}%</Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6 font-semibold">{formatMoney(investor.marketValue)}</TableCell>
                </TableRow>
              ))}
              {sortedInvestors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                    No investors or units yet. Use Settings to import dummy data or add investors manually.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <PaginationControls {...investorPagination} searchParams={resolvedSearchParams} />
        </CardContent>
      </Card>
    </div>
  );
}
