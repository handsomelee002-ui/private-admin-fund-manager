import { notFound } from "next/navigation";
import {
  getPlatform,
  getPlatformCapitalAllocation,
  getPlatformTransactions,
  getPlatformNavSnapshots,
} from "@/actions/trading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddPlatformTransactionForm } from "@/components/AddPlatformTransactionForm";
import { ClosePlatformControl } from "@/components/ClosePlatformControl";
import { PlatformTransactionsChart, PlatformNavSnapshotChart } from "@/components/PlatformCharts";
import { NotesTableCell } from "@/components/NotesTableCell";
import { PaginationControls } from "@/components/PaginationControls";
import { SortableTableHead } from "@/components/SortableTableHead";
import { Badge } from "@/components/ui/badge";
import { getFundCashAvailability } from "@/lib/fundDb";
import { formatMoney } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { calculatePlatformPerformance } from "@/lib/platformPerformance";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { NoPrefetchLink } from "@/components/NoPrefetchLink";
import { ArrowLeft, Wallet, TrendingUp, DollarSign, BarChart3, PieChart } from "lucide-react";

export const dynamic = "force-dynamic";

const transactionSorts = ["date", "source", "notes", "amount", "realized", "unrealized"] as const;
const snapshotSorts = ["week", "netInvested", "unrealized", "nav"] as const;
const metricHeaderClass = "flex min-h-12 flex-row items-start justify-between gap-3 pb-2";
const metricTitleClass = "text-sm leading-5 font-medium text-muted-foreground";
const metricIconWrapClass = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full";
const metricValueClass = "text-[1.625rem] leading-8 font-bold whitespace-nowrap tabular-nums tracking-normal";

export default async function PlatformDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ platformId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { platformId } = await params;
  const resolvedSearchParams = await searchParams;
  const transactionSortState = getSortState(resolvedSearchParams, transactionSorts, { sort: "date", dir: "desc" }, "tx");
  const snapshotSortState = getSortState(resolvedSearchParams, snapshotSorts, { sort: "week", dir: "desc" }, "snap");

  const platform = await getPlatform(platformId);
  if (!platform) return notFound();

  const [transactions, snapshots, capitalAllocation, cashAvailability] = await Promise.all([
    getPlatformTransactions(platformId),
    getPlatformNavSnapshots(platformId),
    getPlatformCapitalAllocation(platformId),
    getFundCashAvailability(),
  ]);
  const availableBySource = {
    equity: cashAvailability.equity.available,
    fixed_savings: cashAvailability.fixedSavings.available,
    brokerage: cashAvailability.brokerage.available,
  };
  const performance = calculatePlatformPerformance(transactions, snapshots);
  const netInvested = performance.netInvested;
  const realizedProfit = performance.realizedProfit;
  const latestUnrealized = performance.latestUnrealized;
  const totalValue = performance.currentValue;
  const pnlPct = performance.simpleRoi ?? 0;
  const sortedTransactions = sortRows(transactions, transactionSortState, {
    date: (transaction: any) => transaction.date,
    source: (transaction: any) => transaction.funding_source,
    notes: (transaction: any) => transaction.notes,
    amount: (transaction: any) => transaction.amount,
    realized: (transaction: any) => transaction.realized_profit,
    unrealized: (transaction: any) => {
      const transactionAmount = ["BROKER_WITHDRAWAL", "Withdraw"].includes(transaction.type)
        ? -parseFloat(transaction.base_amount || transaction.amount || "0")
        : ["BROKER_DEPOSIT", "Deposit"].includes(transaction.type)
          ? parseFloat(transaction.base_amount || transaction.amount || "0")
          : 0;
      return netInvested > 0 ? latestUnrealized * (transactionAmount / netInvested) : 0;
    },
  });
  const sortedSnapshots = sortRows(snapshots, snapshotSortState, {
    week: (snapshot: any) => snapshot.week_ending,
    netInvested: (snapshot: any) => snapshot.net_invested,
    unrealized: (snapshot: any) => snapshot.unrealized_profit,
    nav: (snapshot: any) => snapshot.nav_per_unit,
  });
  const transactionPagination = paginateRows(sortedTransactions, resolvedSearchParams, "tx");
  const snapshotPagination = paginateRows(sortedSnapshots, resolvedSearchParams, "snap");

  const fmt = formatMoney;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <NoPrefetchLink
            href="/trading"
            className="h-9 w-9 rounded-full border border-border/50 bg-card/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
          </NoPrefetchLink>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                {platform.name}
              </h1>
              {platform.closed_on && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground border-border/60">
                  Closed {platform.closed_on}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {platform.closed_on
                ? `Closed on ${platform.closed_on} and marked at zero. History since ${platform.created_at}.`
                : `Details and history since ${platform.created_at}`}
            </p>
          </div>
        </div>
        <ClosePlatformControl
          platformId={platformId}
          platformName={platform.name}
          closedOn={platform.closed_on ?? null}
        />
      </div>

      {/* ── Stat Cards ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
        <Card className="relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 shadow-lg hover:shadow-primary/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Net Invested</CardTitle>
            <div className={`${metricIconWrapClass} bg-primary/15`}>
              <Wallet className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={metricValueClass}>{fmt(netInvested)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">Total Deposits − Withdrawals</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-blue-500/15 to-blue-500/5 border-blue-500/25 shadow-lg hover:shadow-blue-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent pointer-events-none" />
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Latest Unrealized</CardTitle>
            <div className={`${metricIconWrapClass} bg-blue-500/15`}>
              <TrendingUp className="h-4 w-4 text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`${metricValueClass} ${latestUnrealized >= 0 ? "text-blue-400" : "text-red-400"}`}>
              {latestUnrealized >= 0 ? "+" : ""}{fmt(latestUnrealized)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <span className={`font-semibold ${pnlPct >= 0 ? "text-blue-400" : "text-red-400"}`}>
                {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
              </span>
              &nbsp;return on invested
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-violet-500/15 to-violet-500/5 border-violet-500/25 shadow-lg hover:shadow-violet-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Realized Profit</CardTitle>
            <div className={`${metricIconWrapClass} bg-violet-500/15`}>
              <DollarSign className="h-4 w-4 text-violet-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`${metricValueClass} ${realizedProfit >= 0 ? "text-violet-400" : "text-red-400"}`}>
              {fmt(realizedProfit)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Closed profit from withdrawals</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 shadow-lg hover:shadow-emerald-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Total Value</CardTitle>
            <div className={`${metricIconWrapClass} bg-emerald-500/15`}>
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`${metricValueClass} text-emerald-500`}>{fmt(totalValue)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">Net Invested + Unrealized</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <PieChart className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Capital Allocation</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Current platform source ownership used for P&L attribution.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {capitalAllocation.platformAllocations.map((allocation: any) => (
              <div key={allocation.source} className="rounded-md border border-border/50 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{allocation.label}</span>
                  <Badge variant="outline">{Number(allocation.ratioPercent).toFixed(2)}%</Badge>
                </div>
                <p className="mt-2 text-xl font-bold tabular-nums">{fmt(Number(allocation.baseAmount))}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="transactions" className="w-full flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <TabsList className="grid w-[250px] grid-cols-2 h-9 shrink-0">
            <TabsTrigger value="transactions" className="text-xs">Transactions</TabsTrigger>
            <TabsTrigger value="snapshots" className="text-xs">NAV Snapshots</TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            <TabsContent value="transactions" className="mt-0">
              <AddPlatformTransactionForm
                platformId={platformId}
                automaticAllocationBasis={capitalAllocation.automaticBasis}
                platformAllocationBalances={capitalAllocation.platformBalances}
                availableBySource={availableBySource}
                fundCashRecorded={cashAvailability.fundCashSource !== "NEVER_RECORDED"}
              />
            </TabsContent>
          </div>
        </div>

        {/* ── Transactions Tab ──────────────────────────────────────────────── */}
        <TabsContent value="transactions" className="mt-0">
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Chart */}
            <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Capital Flows</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-4">
                <PlatformTransactionsChart data={transactions} />
              </CardContent>
            </Card>

            {/* Table */}
            <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm overflow-hidden">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Transaction History</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table className="min-w-[760px] table-fixed text-xs">
                  <TableHeader>
                    <TableRow className="border-b border-border/50 hover:bg-transparent">
                      <SortableTableHead className="w-[98px] pl-6" sortKey="date" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Date</SortableTableHead>
                      <SortableTableHead className="w-[150px]" sortKey="source" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Allocation</SortableTableHead>
                      <SortableTableHead className="w-[150px]" sortKey="notes" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Notes</SortableTableHead>
                      <SortableTableHead className="w-[116px] text-right" sortKey="amount" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">RM Amount</SortableTableHead>
                      <SortableTableHead className="w-[100px] text-right" sortKey="realized" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Realized</SortableTableHead>
                      <SortableTableHead className="w-[110px] text-right" sortKey="unrealized" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Unrealized</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactionPagination.pageRows.map((t: any) => (
                      <TableRow key={t.id} className="hover:bg-muted/20 transition-colors border-border/30">
                        <TableCell className="pl-6 text-sm">{t.date}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(Array.isArray(t.allocations) && t.allocations.length > 0 ? t.allocations : [{ funding_source: t.funding_source, ratio_percent: 100, base_amount: t.base_amount }]).map((allocation: any) => (
                              <Badge key={allocation.funding_source} variant="outline" className="text-[10px] h-5 px-1.5">
                                {allocation.funding_source === "fixed_savings" ? "FS" : allocation.funding_source === "brokerage" ? "B" : "E"} {Number(allocation.ratio_percent || 0).toFixed(0)}%
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <NotesTableCell value={t.notes} className="" />
                        <TableCell className="text-right font-medium tabular-nums text-sm">
                          {fmt(parseFloat(t.base_amount || t.amount || "0"))}
                          {t.currency && t.currency !== "MYR" && (
                            <div className="text-[10px] text-muted-foreground">
                              {Number(t.amount || 0).toLocaleString()} {t.currency}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-medium tabular-nums text-sm ${parseFloat(t.realized_profit || "0") >= 0 ? "text-violet-400" : "text-red-400"}`}>
                          {t.realized_profit ? fmt(parseFloat(t.realized_profit)) : "-"}
                        </TableCell>
                        <TableCell className={`text-right font-medium tabular-nums text-sm ${(() => {
                          const transactionAmount = ["BROKER_WITHDRAWAL", "Withdraw"].includes(t.type)
                            ? -parseFloat(t.base_amount || t.amount || "0")
                            : ["BROKER_DEPOSIT", "Deposit"].includes(t.type)
                              ? parseFloat(t.base_amount || t.amount || "0")
                              : 0;
                          const value = netInvested > 0 ? latestUnrealized * (transactionAmount / netInvested) : 0;
                          return value >= 0 ? "text-blue-400" : "text-red-400";
                        })()}`}>
                          {(() => {
                            const transactionAmount = ["BROKER_WITHDRAWAL", "Withdraw"].includes(t.type)
                              ? -parseFloat(t.base_amount || t.amount || "0")
                              : ["BROKER_DEPOSIT", "Deposit"].includes(t.type)
                                ? parseFloat(t.base_amount || t.amount || "0")
                                : 0;
                            const value = netInvested > 0 ? latestUnrealized * (transactionAmount / netInvested) : 0;
                            return transactionAmount === 0 ? "-" : fmt(value);
                          })()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {sortedTransactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-12 text-sm">
                          No transactions recorded.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <PaginationControls {...transactionPagination} searchParams={resolvedSearchParams} prefix="tx" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── NAV Snapshots Tab ─────────────────────────────────────────────── */}
        <TabsContent value="snapshots" className="mt-0">
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Chart */}
            <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Weekly NAV Snapshots</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-4">
                <PlatformNavSnapshotChart data={snapshots} />
              </CardContent>
            </Card>

            {/* Table */}
            <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm overflow-hidden">
              <CardHeader className="pb-0">
                <CardTitle className="text-base">NAV Snapshot History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border/50 hover:bg-transparent">
                      <SortableTableHead className="pl-6" sortKey="week" activeSort={snapshotSortState.sort} activeDir={snapshotSortState.dir} searchParams={resolvedSearchParams} prefix="snap">Week Ending</SortableTableHead>
                      <SortableTableHead className="text-right" sortKey="netInvested" activeSort={snapshotSortState.sort} activeDir={snapshotSortState.dir} searchParams={resolvedSearchParams} prefix="snap">Equity Invested</SortableTableHead>
                      <SortableTableHead className="text-right" sortKey="unrealized" activeSort={snapshotSortState.sort} activeDir={snapshotSortState.dir} searchParams={resolvedSearchParams} prefix="snap">Equity P&L</SortableTableHead>
                      <SortableTableHead className="text-right pr-6" sortKey="nav" activeSort={snapshotSortState.sort} activeDir={snapshotSortState.dir} searchParams={resolvedSearchParams} prefix="snap">NAV / Unit</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshotPagination.pageRows.map((p: any) => {
                      const profit = parseFloat(p.unrealized_profit);
                      return (
                        <TableRow key={p.id} className="hover:bg-muted/20 transition-colors border-border/30">
                          <TableCell className="pl-6 font-medium text-sm">{p.week_ending}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums text-sm">{fmt(parseFloat(p.net_invested))}</TableCell>
                          <TableCell className="text-right">
                            <span className={`font-semibold tabular-nums ${profit >= 0 ? "text-blue-400" : "text-red-400"}`}>
                              {profit >= 0 ? "+" : ""}{fmt(profit)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right pr-6 font-semibold text-primary">{Number(p.nav_per_unit).toFixed(6)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {sortedSnapshots.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-12 text-sm">
                          No weekly NAV snapshots recorded. Enter platform final values when creating Weekly NAV.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <PaginationControls {...snapshotPagination} searchParams={resolvedSearchParams} prefix="snap" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
