import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPlatforms, deletePlatform, updatePlatformName } from "@/actions/trading";
import { AddPlatformForm } from "@/components/AddPlatformForm";
import { DeleteButton } from "@/components/DeleteButton";
import { EditNameDialog } from "@/components/EditNameDialog";
import { SortableTableHead } from "@/components/SortableTableHead";
import { formatMoney } from "@/lib/formatting";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { NoPrefetchLink } from "@/components/NoPrefetchLink";
import { ChevronRight, Building2, TrendingUp, Wallet, DollarSign, ArrowRightLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const platformSorts = ["platform", "created", "netInvested", "realized", "unrealized", "totalValue"] as const;

export default async function TradingLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, platformSorts, { sort: "created", dir: "desc" });
  const platforms = await timeAsync("route.trading.getPlatforms", () => getPlatforms(), { route: "/trading" });
  const sortedPlatforms = sortRows(platforms, sortState, {
    platform: (platform: any) => platform.name,
    created: (platform: any) => platform.createdAt,
    netInvested: (platform: any) => platform.netInvested,
    realized: (platform: any) => platform.realizedProfit,
    unrealized: (platform: any) => platform.unrealizedProfit,
    totalValue: (platform: any) => platform.totalValue,
  });

  const totalNetInvested = platforms.reduce((sum: number, p: any) => sum + p.netInvested, 0);
  const totalRealized = platforms.reduce((sum: number, p: any) => sum + p.realizedProfit, 0);
  const totalUnrealized = platforms.reduce((sum: number, p: any) => sum + p.unrealizedProfit, 0);
  const totalValue = platforms.reduce((sum: number, p: any) => sum + p.totalValue, 0);

  const fmt = formatMoney;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Platforms
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Platform directory with capital flows and weekly NAV snapshot history.
          </p>
        </div>
        <AddPlatformForm redirectToDetail />
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
        <Card className="relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 shadow-lg hover:shadow-primary/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Net Invested</CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
              <Wallet className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{fmt(totalNetInvested)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">Across all platforms</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-blue-500/15 to-blue-500/5 border-blue-500/25 shadow-lg hover:shadow-blue-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Unrealized</CardTitle>
            <div className="h-8 w-8 rounded-full bg-blue-500/15 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold tracking-tight ${totalUnrealized >= 0 ? "text-blue-400" : "text-red-400"}`}>
              {fmt(totalUnrealized)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Latest unrealized profit/loss</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-violet-500/15 to-violet-500/5 border-violet-500/25 shadow-lg hover:shadow-violet-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Realized</CardTitle>
            <div className="h-8 w-8 rounded-full bg-violet-500/15 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-violet-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold tracking-tight ${totalRealized >= 0 ? "text-violet-400" : "text-red-400"}`}>
              {fmt(totalRealized)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Closed profit from withdrawals</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 shadow-lg hover:shadow-emerald-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Portfolio Value</CardTitle>
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

      {/* ── Platforms Table ─────────────────────────────────────────────────── */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Directory</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <SortableTableHead className="pl-6" sortKey="platform" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Platform</SortableTableHead>
                <SortableTableHead sortKey="created" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Created</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="netInvested" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Net Invested</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="realized" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Realized Profit</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="unrealized" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Unrealized P&L</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="totalValue" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Total Value</SortableTableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPlatforms.map((platform: any) => {
                const pnlPct = platform.netInvested > 0
                  ? ((platform.unrealizedProfit / platform.netInvested) * 100)
                  : 0;
                return (
                  <TableRow key={platform.id} className="group hover:bg-muted/20 transition-colors border-border/30">
                    <TableCell className="pl-6">
                      <NoPrefetchLink
                        href={`/trading/${platform.id}`}
                        className="flex items-center gap-2 w-fit"
                      >
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm text-primary hover:underline flex items-center gap-1">
                            {platform.name}
                            <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </span>
                          <span className="text-[10px] text-muted-foreground">Click to view details</span>
                        </div>
                      </NoPrefetchLink>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{platform.createdAt}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium tabular-nums">
                        {fmt(platform.netInvested)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-semibold tabular-nums ${platform.realizedProfit >= 0 ? "text-violet-400" : "text-red-400"}`}>
                        {fmt(platform.realizedProfit)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`font-semibold tabular-nums ${platform.unrealizedProfit >= 0 ? "text-blue-400" : "text-red-400"}`}>
                          {platform.unrealizedProfit >= 0 ? "+" : ""}{fmt(platform.unrealizedProfit)}
                        </span>
                        <span className={`text-[10px] ${pnlPct >= 0 ? "text-blue-400/70" : "text-red-400/70"}`}>
                          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-bold tabular-nums text-emerald-400">
                        {fmt(platform.totalValue)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end gap-2">
                        <EditNameDialog id={platform.id} currentName={platform.name} title="Edit Platform Name" updateAction={updatePlatformName} />
                        <DeleteButton id={platform.id} deleteAction={deletePlatform} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sortedPlatforms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-16 text-sm">
                    No trading platforms found. Add your first platform to begin.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Totals footer */}
          {platforms.length > 0 && (
            <div className="border-t border-border/50 px-6 py-3 flex items-center justify-end gap-8 bg-muted/20">
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Invested</p>
                <p className="text-sm font-bold tabular-nums">{fmt(totalNetInvested)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Realized</p>
                <p className={`text-sm font-bold tabular-nums ${totalRealized >= 0 ? "text-violet-400" : "text-red-400"}`}>
                  {fmt(totalRealized)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total P&L</p>
                <p className={`text-sm font-bold tabular-nums ${totalUnrealized >= 0 ? "text-blue-400" : "text-red-400"}`}>
                  {totalUnrealized >= 0 ? "+" : ""}{fmt(totalUnrealized)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Portfolio Value</p>
                <p className="text-sm font-bold tabular-nums text-emerald-400">{fmt(totalValue)}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
