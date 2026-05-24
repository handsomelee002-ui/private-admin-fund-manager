import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getPlatforms } from "@/actions/trading";
import { getFundSummaryMetrics, getNavWeeks } from "@/lib/fundDb";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { BarChart3, DollarSign, TrendingUp, Users, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const reportPlatformSorts = ["platform", "netInvested", "realized", "unrealized"] as const;
const reportNavSorts = ["week", "nav", "units", "navPerUnit"] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const platformSortState = getSortState(resolvedSearchParams, reportPlatformSorts, { sort: "platform", dir: "asc" }, "platform");
  const navSortState = getSortState(resolvedSearchParams, reportNavSorts, { sort: "week", dir: "desc" }, "nav");
  const [summary, navWeeks, platforms] = await Promise.all([getFundSummaryMetrics(), getNavWeeks(), getPlatforms()]);
  const sortedPlatforms = sortRows(platforms, platformSortState, {
    platform: (platform: any) => platform.name,
    netInvested: (platform: any) => platform.netInvested,
    realized: (platform: any) => platform.realizedProfit,
    unrealized: (platform: any) => platform.unrealizedProfit,
  });
  const sortedNavWeeks = sortRows(navWeeks, navSortState, {
    week: (week: any) => week.week_ending,
    nav: (week: any) => week.net_asset_value,
    units: (week: any) => week.total_units,
    navPerUnit: (week: any) => week.nav_per_unit,
  });
  const totalRealized = platforms.reduce((sum: number, platform: any) => sum + platform.realizedProfit, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1 text-sm">NAV trend, unit ownership, fees, and fixed savings liability.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">AUM</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent><div className="text-xl font-bold">{formatMoney(summary.aum)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Units</CardTitle>
            <Users className="h-4 w-4 text-violet-400" />
          </CardHeader>
          <CardContent><div className="text-xl font-bold">{formatUnits(summary.totalUnits)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Realized Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-violet-400" />
          </CardHeader>
          <CardContent><div className={`text-xl font-bold ${totalRealized >= 0 ? "text-violet-400" : "text-red-400"}`}>{formatMoney(totalRealized)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Performance Fees</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent><div className="text-xl font-bold text-emerald-400">{formatMoney(summary.performanceFees)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Fixed Liability</CardTitle>
            <BarChart3 className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent><div className="text-xl font-bold text-amber-400">{formatMoney(summary.fixedSavingsLiability)}</div></CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader><CardTitle className="text-base">Realized Profit by Platform</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead className="pl-6" sortKey="platform" activeSort={platformSortState.sort} activeDir={platformSortState.dir} searchParams={resolvedSearchParams} prefix="platform">Platform</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="netInvested" activeSort={platformSortState.sort} activeDir={platformSortState.dir} searchParams={resolvedSearchParams} prefix="platform">Net Invested</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="realized" activeSort={platformSortState.sort} activeDir={platformSortState.dir} searchParams={resolvedSearchParams} prefix="platform">Realized Profit</SortableTableHead>
                <SortableTableHead className="text-right pr-6" sortKey="unrealized" activeSort={platformSortState.sort} activeDir={platformSortState.dir} searchParams={resolvedSearchParams} prefix="platform">Latest Unrealized</SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPlatforms.map((platform: any) => (
                <TableRow key={platform.id}>
                  <TableCell className="pl-6 font-medium">{platform.name}</TableCell>
                  <TableCell className="text-right">{formatMoney(platform.netInvested)}</TableCell>
                  <TableCell className={`text-right font-semibold ${platform.realizedProfit >= 0 ? "text-violet-400" : "text-red-400"}`}>{formatMoney(platform.realizedProfit)}</TableCell>
                  <TableCell className={`text-right pr-6 font-semibold ${platform.unrealizedProfit >= 0 ? "text-blue-400" : "text-red-400"}`}>{formatMoney(platform.unrealizedProfit)}</TableCell>
                </TableRow>
              ))}
              {sortedPlatforms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-12">No platforms recorded.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardHeader><CardTitle className="text-base">NAV Trend</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead className="pl-6" sortKey="week" activeSort={navSortState.sort} activeDir={navSortState.dir} searchParams={resolvedSearchParams} prefix="nav">Week Ending</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="nav" activeSort={navSortState.sort} activeDir={navSortState.dir} searchParams={resolvedSearchParams} prefix="nav">Net Asset Value</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="units" activeSort={navSortState.sort} activeDir={navSortState.dir} searchParams={resolvedSearchParams} prefix="nav">Total Units</SortableTableHead>
                <SortableTableHead className="text-right pr-6" sortKey="navPerUnit" activeSort={navSortState.sort} activeDir={navSortState.dir} searchParams={resolvedSearchParams} prefix="nav">NAV / Unit</SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedNavWeeks.map((week: any) => (
                <TableRow key={week.id}>
                  <TableCell className="pl-6">{week.week_ending}</TableCell>
                  <TableCell className="text-right">{formatMoney(week.net_asset_value)}</TableCell>
                  <TableCell className="text-right">{formatUnits(week.total_units)}</TableCell>
                  <TableCell className="text-right pr-6 font-semibold text-primary">{Number(week.nav_per_unit).toFixed(6)}</TableCell>
                </TableRow>
              ))}
              {sortedNavWeeks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-12">No NAV data.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
