import { notFound } from "next/navigation";
import {
  getPlatform,
  getPlatformTransactions,
  getPlatformNavSnapshots,
} from "@/actions/trading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddPlatformTransactionForm } from "@/components/AddPlatformTransactionForm";
import { PlatformTransactionsChart, PlatformNavSnapshotChart } from "@/components/PlatformCharts";
import { NotesTableCell } from "@/components/NotesTableCell";
import { SortableTableHead } from "@/components/SortableTableHead";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/formatting";
import { calculatePlatformPerformance } from "@/lib/platformPerformance";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { NoPrefetchLink } from "@/components/NoPrefetchLink";
import { ArrowLeft, Wallet, TrendingUp, DollarSign, ArrowDownRight, ArrowUpRight, BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

const transactionSorts = ["date", "type", "notes", "amount", "realized"] as const;
const snapshotSorts = ["week", "netInvested", "unrealized", "nav"] as const;

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
  const statusFilter = typeof resolvedSearchParams.status === "string" ? resolvedSearchParams.status : "active";

  const platform = await getPlatform(platformId);
  if (!platform) return notFound();

  const [transactions, snapshots] = await Promise.all([
    getPlatformTransactions(platformId),
    getPlatformNavSnapshots(platformId),
  ]);
  const performance = calculatePlatformPerformance(transactions, snapshots);
  const visibleTransactions = statusFilter === "all" ? transactions : transactions.filter((transaction: any) => transaction.audit_status === "active");
  const sortedTransactions = sortRows(visibleTransactions, transactionSortState, {
    date: (transaction: any) => transaction.date,
    type: (transaction: any) => transaction.type,
    notes: (transaction: any) => transaction.notes,
    amount: (transaction: any) => transaction.amount,
    realized: (transaction: any) => transaction.realized_profit,
  });
  const sortedSnapshots = sortRows(snapshots, snapshotSortState, {
    week: (snapshot: any) => snapshot.week_ending,
    netInvested: (snapshot: any) => snapshot.net_invested,
    unrealized: (snapshot: any) => snapshot.unrealized_profit,
    nav: (snapshot: any) => snapshot.nav_per_unit,
  });

  const netInvested = performance.netInvested;
  const realizedProfit = performance.realizedProfit;
  const latestUnrealized = performance.latestUnrealized;
  const totalValue = performance.currentValue;
  const pnlPct = performance.simpleRoi ?? 0;

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
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              {platform.name}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">Details and history since {platform.created_at}</p>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
        <Card className="relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 shadow-lg hover:shadow-primary/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Invested</CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
              <Wallet className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{fmt(netInvested)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">Total Deposits − Withdrawals</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-blue-500/15 to-blue-500/5 border-blue-500/25 shadow-lg hover:shadow-blue-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Latest Unrealized</CardTitle>
            <div className="h-8 w-8 rounded-full bg-blue-500/15 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold tracking-tight ${latestUnrealized >= 0 ? "text-blue-400" : "text-red-400"}`}>
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
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Realized Profit</CardTitle>
            <div className="h-8 w-8 rounded-full bg-violet-500/15 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-violet-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold tracking-tight ${realizedProfit >= 0 ? "text-violet-400" : "text-red-400"}`}>
              {fmt(realizedProfit)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Closed profit from withdrawals</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 shadow-lg hover:shadow-emerald-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Value</CardTitle>
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight text-emerald-500">{fmt(totalValue)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">Net Invested + Unrealized</p>
          </CardContent>
        </Card>
      </div>

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
                defaultCurrency="MYR"
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
                  <div className="flex items-center gap-2 text-sm">
                    <NoPrefetchLink className={statusFilter === "active" ? "text-primary font-semibold" : "text-muted-foreground"} href={`/trading/${platformId}`}>Active</NoPrefetchLink>
                    <NoPrefetchLink className={statusFilter === "all" ? "text-primary font-semibold" : "text-muted-foreground"} href={`/trading/${platformId}?status=all`}>All</NoPrefetchLink>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table className="table-fixed text-xs">
                  <TableHeader>
                    <TableRow className="border-b border-border/50 hover:bg-transparent">
                      <SortableTableHead className="w-[98px] pl-6" sortKey="date" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Date</SortableTableHead>
                      <SortableTableHead className="w-[116px]" sortKey="type" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Type</SortableTableHead>
                      <SortableTableHead className="w-[150px]" sortKey="notes" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Notes</SortableTableHead>
                      <SortableTableHead className="w-[116px] text-right" sortKey="amount" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">RM Amount</SortableTableHead>
                      <SortableTableHead className="w-[100px] text-right" sortKey="realized" activeSort={transactionSortState.sort} activeDir={transactionSortState.dir} searchParams={resolvedSearchParams} prefix="tx">Realized</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTransactions.map((t: any) => (
                      <TableRow key={t.id} className="hover:bg-muted/20 transition-colors border-border/30">
                        <TableCell className="pl-6 text-sm">{t.date}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] h-5 px-1.5 ${
                              ["Deposit", "BROKER_DEPOSIT"].includes(t.type)
                                ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5"
                                : "text-orange-400 border-orange-400/30 bg-orange-400/5"
                            }`}
                          >
                            {["Deposit", "BROKER_DEPOSIT"].includes(t.type) ? (
                              <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />
                            ) : (
                              <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" />
                            )}
                            {String(t.type).replaceAll("_", " ")}
                          </Badge>
                          {t.audit_status !== "active" && (
                            <Badge variant="outline" className="ml-2 text-[10px] h-5 px-1.5">
                              {t.audit_status === "reversal" ? "Reversal" : "Reverted"}
                            </Badge>
                          )}
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
                      </TableRow>
                    ))}
                    {sortedTransactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-12 text-sm">
                          No transactions recorded.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
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
                      <SortableTableHead className="text-right" sortKey="netInvested" activeSort={snapshotSortState.sort} activeDir={snapshotSortState.dir} searchParams={resolvedSearchParams} prefix="snap">Net Invested</SortableTableHead>
                      <SortableTableHead className="text-right" sortKey="unrealized" activeSort={snapshotSortState.sort} activeDir={snapshotSortState.dir} searchParams={resolvedSearchParams} prefix="snap">Unrealized Profit</SortableTableHead>
                      <SortableTableHead className="text-right pr-6" sortKey="nav" activeSort={snapshotSortState.sort} activeDir={snapshotSortState.dir} searchParams={resolvedSearchParams} prefix="snap">NAV / Unit</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSnapshots.map((p: any) => {
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
                          No weekly NAV snapshots recorded. Update platform unrealized profit when creating Weekly NAV.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
