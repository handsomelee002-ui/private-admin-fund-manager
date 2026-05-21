import { notFound } from "next/navigation";
import {
  getPlatform,
  getPlatformTransactions,
  getPlatformNavSnapshots,
  deletePlatformTransaction,
} from "@/actions/trading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddPlatformTransactionForm } from "@/components/AddPlatformTransactionForm";
import { PlatformTransactionsChart, PlatformNavSnapshotChart } from "@/components/PlatformCharts";
import { DeleteButton } from "@/components/DeleteButton";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/formatting";
import Link from "next/link";
import { ArrowLeft, Wallet, TrendingUp, DollarSign, ArrowDownRight, ArrowUpRight, BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PlatformDetailsPage({ params }: { params: Promise<{ platformId: string }> }) {
  const { platformId } = await params;

  const platform = await getPlatform(platformId);
  if (!platform) return notFound();

  const transactions = await getPlatformTransactions(platformId);
  const snapshots = await getPlatformNavSnapshots(platformId);

  // Stats
  const netInvested = transactions.reduce((acc: number, t: any) => {
    return t.type === "Deposit" ? acc + parseFloat(t.amount) : acc - parseFloat(t.amount);
  }, 0);
  const realizedProfit = transactions.reduce((acc: number, t: any) => acc + parseFloat(t.realized_profit || "0"), 0);
  const latestUnrealized = snapshots.length > 0 ? parseFloat(snapshots[0].unrealized_profit) : 0;
  const totalValue = netInvested + latestUnrealized;
  const pnlPct = netInvested > 0 ? ((latestUnrealized / netInvested) * 100) : 0;

  const fmt = formatMoney;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/trading"
            className="h-9 w-9 rounded-full border border-border/50 bg-card/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
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

          <div>
            <TabsContent value="transactions" className="mt-0">
              <AddPlatformTransactionForm platformId={platformId} />
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
                <CardTitle className="text-base">Transaction History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border/50 hover:bg-transparent">
                      <TableHead className="pl-6">Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Realized</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((t: any) => (
                      <TableRow key={t.id} className="hover:bg-muted/20 transition-colors border-border/30">
                        <TableCell className="pl-6 text-sm">{t.date}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] h-5 px-1.5 ${
                              t.type === "Deposit"
                                ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5"
                                : "text-orange-400 border-orange-400/30 bg-orange-400/5"
                            }`}
                          >
                            {t.type === "Deposit" ? (
                              <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />
                            ) : (
                              <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" />
                            )}
                            {t.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{t.notes || "—"}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-sm">
                          {fmt(parseFloat(t.amount))}
                        </TableCell>
                        <TableCell className={`text-right font-medium tabular-nums text-sm ${parseFloat(t.realized_profit || "0") >= 0 ? "text-violet-400" : "text-red-400"}`}>
                          {t.realized_profit ? fmt(parseFloat(t.realized_profit)) : "-"}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <DeleteButton id={t.id} deleteAction={deletePlatformTransaction} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {transactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-12 text-sm">
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
                      <TableHead className="pl-6">Week Ending</TableHead>
                      <TableHead className="text-right">Net Invested</TableHead>
                      <TableHead className="text-right">Unrealized Profit</TableHead>
                      <TableHead className="text-right pr-6">NAV / Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshots.map((p: any) => {
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
                    {snapshots.length === 0 && (
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
