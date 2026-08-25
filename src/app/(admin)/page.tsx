import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AvailableCashPools } from "@/components/AvailableCashPools";
import { PaginationControls } from "@/components/PaginationControls";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getDashboardSummary, getFundCashAvailability } from "@/lib/fundDb";
import { formatMoney, formatPercent, formatUnits } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Activity, Banknote, Coins, Landmark, Percent, Users, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const dashboardInvestorSorts = ["investor", "units", "ownership", "marketValue"] as const;
const metricHeaderClass = "flex min-h-12 flex-row items-start justify-between gap-3 pb-2";
const metricTitleClass = "text-sm leading-5 text-muted-foreground";
const metricValueClass = "text-[1.625rem] leading-8 font-bold whitespace-nowrap tabular-nums tracking-normal";

function signedMoney(value: number) {
  return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, dashboardInvestorSorts, { sort: "marketValue", dir: "desc" });
  const [summary, cashAvailability] = await Promise.all([
    timeAsync("route.dashboard.getDashboardSummary", () => getDashboardSummary(), { route: "/" }),
    timeAsync("route.dashboard.getFundCashAvailability", () => getFundCashAvailability(), { route: "/" }),
  ]);
  // Each pool's free cash, in the same order the funding forms show them.
  const cashPools = [
    { key: "equity", label: "Equity", ...cashAvailability.equity, text: "text-blue-400", bg: "bg-blue-400" },
    { key: "fixed_savings", label: "Fixed Savings", ...cashAvailability.fixedSavings, text: "text-amber-400", bg: "bg-amber-400" },
    { key: "brokerage", label: "Brokerage", ...cashAvailability.brokerage, text: "text-emerald-400", bg: "bg-emerald-400" },
  ];

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
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Equity NAV</CardTitle>
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={metricValueClass}>{formatMoney(summary.aum)}</div>
            <p
              className={`text-xs mt-1 ${summary.equityPnlAmount >= 0 ? "text-emerald-400" : "text-red-400"}`}
              title="Equity P&L equals current equity NAV minus remaining investor equity cost basis."
            >
              {signedMoney(summary.equityPnlAmount)} | {formatPercent(summary.equityReturnPercent, { signed: true })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Excludes fixed savings funding</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Fixed Savings Liability</CardTitle>
            <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className={`${metricValueClass} text-amber-400`}>{formatMoney(summary.fixedSavingsLiability)}</div>
            <p className="text-xs text-muted-foreground mt-1">Principal, accrued interest, and bonuses</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Investor Capital</CardTitle>
            <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className={metricValueClass}>{formatMoney(summary.totalInvestorCapital)}</div>
            <p className="text-xs text-muted-foreground mt-1">Equity NAV + fixed savings liability</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>NAV / Unit</CardTitle>
            <Percent className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className={`${metricValueClass} text-emerald-400`}>{navPerUnit.toFixed(6)}</div>
            <p className="text-xs text-muted-foreground mt-1">{latestNav?.week_ending ?? "No locked NAV"}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Total Units</CardTitle>
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          </CardHeader>
          <CardContent>
            <div className={metricValueClass}>{formatUnits(summary.totalUnits)}</div>
            <p className="text-xs text-muted-foreground mt-1">{summary.investors.length} investors</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Available Cash by Pool</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              What each pool can still deploy, as opposed to what it owns.
            </p>
          </div>
          <div className="text-right">
            <div className={metricValueClass}>{formatMoney(cashAvailability.bankBalance)}</div>
            <p className="text-xs text-muted-foreground mt-1">Bank total</p>
          </div>
        </CardHeader>
        <CardContent>
          <AvailableCashPools
            pools={cashPools}
            bankBalance={cashAvailability.bankBalance}
            asOfDate={cashAvailability.asOfDate}
            fundCashRecorded={cashAvailability.fundCashSource !== "NEVER_RECORDED"}
          />
        </CardContent>
      </Card>

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
                  <TableCell className="text-right pr-6">
                    <div className="font-semibold">{formatMoney(investor.marketValue)}</div>
                    <div
                      className={`text-xs ${investor.equityPnlAmount >= 0 ? "text-emerald-400" : "text-red-400"}`}
                      title="Equity return equals current market value minus remaining equity cost basis."
                    >
                      {formatPercent(investor.equityReturnPercent, { signed: true })}
                    </div>
                  </TableCell>
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
