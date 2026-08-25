import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AvailableCashDetail } from "@/components/AvailableCashDetail";
import { HoverDetail } from "@/components/HoverDetail";
import { MetricCard } from "@/components/MetricCard";
import { PaginationControls } from "@/components/PaginationControls";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getDashboardSummary, getFundCashAvailability } from "@/lib/fundDb";
import { formatMoney, formatPercent, formatUnits } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Activity, Banknote, Coins, Landmark, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const dashboardInvestorSorts = ["investor", "units", "ownership", "marketValue"] as const;

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
  // Each pool's free cash, in the same order the funding forms show them. The
  // brokerage pot is not here: this answers what can be deployed into a
  // platform, and the pot stopped being a funding source. It lives on
  // /brokerage.
  const cashPools = [
    { key: "equity", label: "Equity", ...cashAvailability.equity, text: "text-blue-400" },
    { key: "fixed_savings", label: "Fixed Savings", ...cashAvailability.fixedSavings, text: "text-amber-400" },
  ];
  // The total is what these two pools can deploy, not what the bank holds: the
  // bank also holds the brokerage pot's money, which cannot fund a platform.
  // The card footnote quotes the bank anyway and the hover panel reconciles it,
  // subtracting the pot by name - which is what stops the bank total reading as
  // if the pot's earnings were deployable.
  const totalAvailable = cashPools.reduce((sum, pool) => sum + pool.available, 0);
  const cashAsOf = cashAvailability.fundCashSource === "NEVER_RECORDED"
    ? "Fund cash never recorded"
    : `As of ${cashAvailability.asOfDate}`;

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
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Equity NAV"
          icon={<Wallet className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          value={formatMoney(summary.aum)}
          delta={
            <p
              className={`text-xs mt-1 ${summary.equityPnlAmount >= 0 ? "text-emerald-400" : "text-red-400"}`}
              title="Equity NAV minus invested capital: what the deployed money has gained or lost."
            >
              ({formatMoney(summary.equityPnlAmount)} | {formatPercent(summary.equityReturnPercent, { signed: true })})
            </p>
          }
          rows={[
            {
              label: "Invested capital",
              value: formatMoney(summary.totalEquityInvestedCapital),
              hint: "Cash investors paid in, less the basis released by redemptions. Bonus units add none, so they widen the gap to NAV without anyone paying in.",
            },
            { label: "NAV / unit", value: navPerUnit.toFixed(6), valueClassName: "text-emerald-400" },
            { label: "Total units", value: formatUnits(summary.totalUnits) },
          ]}
          footnote={latestNav ? `Locked NAV ${latestNav.week_ending}` : "No locked NAV"}
        />
        <MetricCard
          title="Fixed Savings Net Principal"
          icon={<Banknote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          value={formatMoney(summary.fixedSavingsPrincipal)}
          rows={[
            { label: "Total liability", value: formatMoney(summary.fixedSavingsLiability) },
            { label: "Accrued interest", value: formatMoney(summary.fixedSavingsAccruedInterest) },
            { label: "Bonuses payable", value: formatMoney(summary.fixedSavingsBonus) },
          ]}
        />
        <MetricCard
          title="Investor Capital"
          icon={<Landmark className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          value={formatMoney(summary.totalInvestorCapital)}
          rows={[
            { label: "Equity NAV", value: formatMoney(summary.aum) },
            { label: "Fixed savings liability", value: formatMoney(summary.fixedSavingsLiability) },
            { label: "Investors", value: String(summary.investors.length) },
          ]}
          footnote="Equity NAV + fixed savings liability"
        />
        <HoverDetail
          detailClassName="w-[26rem]"
          detail={
            <AvailableCashDetail
              pools={cashPools}
              bankBalance={cashAvailability.bankBalance}
              brokerageAvailable={cashAvailability.brokerage.available}
              asOf={cashAsOf}
            />
          }
        >
          <MetricCard
            title="Available Cash"
            icon={<Coins className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
            value={formatMoney(totalAvailable)}
            valueClassName={totalAvailable < 0 ? "text-red-400" : undefined}
            rows={[
              ...cashPools.map((pool) => ({
                label: pool.label,
                value: formatMoney(pool.available),
                valueClassName: pool.available < 0 ? "text-red-400" : pool.text,
              })),
              { label: "Deployed in platforms", value: formatMoney(cashPools.reduce((sum, pool) => sum + pool.deployed, 0)) },
            ]}
            footnote="Hover for the full breakdown"
          />
        </HoverDetail>
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
