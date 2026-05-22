import { getAllClaims, deleteClaim } from "@/actions/profitClaims";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettleClaimDialog } from "@/components/SettleClaimDialog";
import { DeleteButton } from "@/components/DeleteButton";
import { SortableTableHead } from "@/components/SortableTableHead";
import { formatMoney } from "@/lib/formatting";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Handshake, Clock, CheckCircle, AlertCircle, DollarSign } from "lucide-react";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  if (status === "settled") {
    return (
      <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 text-emerald-500 border-emerald-500/30 bg-emerald-500/5">
        <CheckCircle className="h-2.5 w-2.5" /> Settled
      </Badge>
    );
  }
  if (status === "partial") {
    return (
      <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 text-amber-400 border-amber-400/30 bg-amber-400/5">
        <AlertCircle className="h-2.5 w-2.5" /> Partial
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 text-orange-400 border-orange-400/30 bg-orange-400/5">
      <Clock className="h-2.5 w-2.5" /> Pending
    </Badge>
  );
}

const claimSorts = ["investor", "claimDate", "gross", "fee", "net", "settled", "outstanding", "status", "settledDate"] as const;

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, claimSorts, { sort: "claimDate", dir: "desc" });
  const claims = await getAllClaims();
  const sortedClaims = sortRows(claims, sortState, {
    investor: (claim: any) => claim.investor_name,
    claimDate: (claim: any) => claim.claim_date,
    gross: (claim: any) => claim.locked_amount,
    fee: (claim: any) => claim.brokerage_fee,
    net: (claim: any) => parseFloat(claim.locked_amount) - parseFloat(claim.brokerage_fee || "0"),
    settled: (claim: any) => claim.settled_amount,
    outstanding: (claim: any) => Math.max(0, parseFloat(claim.locked_amount) - parseFloat(claim.brokerage_fee || "0") - parseFloat(claim.settled_amount)),
    status: (claim: any) => claim.status,
    settledDate: (claim: any) => claim.settled_date,
  });

  const totalLocked   = claims.reduce((s: number, c: any) => s + parseFloat(c.locked_amount), 0);
  const totalSettled  = claims.reduce((s: number, c: any) => s + parseFloat(c.settled_amount), 0);
  const totalPending  = totalLocked - totalSettled;
  const pendingCount  = claims.filter((c: any) => c.status !== "settled").length;

  const fmt = formatMoney;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
          Profit Claims
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Track investor profit IOUs — locked unrealized profit pending settlement.
        </p>
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card className="relative overflow-hidden bg-gradient-to-br from-orange-500/15 to-orange-500/5 border-orange-500/25 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pending IOU</CardTitle>
            <div className="h-8 w-8 rounded-full bg-orange-500/15 flex items-center justify-center">
              <Clock className="h-4 w-4 text-orange-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight text-orange-400">{fmt(totalPending)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">{pendingCount} active claim{pendingCount !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Settled</CardTitle>
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight text-emerald-500">{fmt(totalSettled)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">Paid out to investors</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Locked</CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{fmt(totalLocked)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">All-time IOU created</p>
          </CardContent>
        </Card>
      </div>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <Handshake className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-amber-400">How Profit Claims Work</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              When an investor withdraws their capital while the fund has unrealized profits, their share of that profit is &quot;locked in&quot; as a pending IOU.
              The platform&apos;s unrealized profit remains untouched (it&apos;s a manual snapshot). When you eventually pay the investor their locked profit,
              click <strong>Settle</strong> to mark it as paid. Partial settlements are supported.
            </p>
          </div>
        </div>
      </div>

      {/* ── Claims Table ─────────────────────────────────────────────────────── */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">All Claims</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <SortableTableHead className="pl-6" sortKey="investor" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Investor</SortableTableHead>
                <SortableTableHead sortKey="claimDate" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Claim Date</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="gross" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Gross (IOU)</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="fee" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Perf. Fee</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="net" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Net Payable</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="settled" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Settled</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="outstanding" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Outstanding</SortableTableHead>
                <SortableTableHead sortKey="status" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Status</SortableTableHead>
                <SortableTableHead sortKey="settledDate" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Settled On</SortableTableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedClaims.map((c: any) => {
                const locked       = parseFloat(c.locked_amount);
                const brokerageFee = parseFloat(c.brokerage_fee || "0");
                const netPayable   = locked - brokerageFee;
                const settled      = parseFloat(c.settled_amount);
                const outstanding  = Math.max(0, netPayable - settled);
                return (
                  <TableRow key={c.id} className="hover:bg-muted/20 transition-colors border-border/30">
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                          {c.investor_name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-sm">{c.investor_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.claim_date}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-sm text-amber-400">
                      {fmt(locked)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-red-400">
                      {brokerageFee > 0 ? `− ${fmt(brokerageFee)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-sm text-primary">
                      {fmt(netPayable)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-sm text-emerald-400">
                      {settled > 0 ? fmt(settled) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-sm">
                      {outstanding > 0.005 ? (
                        <span className="text-orange-400">{fmt(outstanding)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.settled_date ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                      {c.notes || "—"}
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end items-center gap-2">
                        {c.status !== "settled" && (
                          <SettleClaimDialog claim={c} />
                        )}
                        <DeleteButton id={c.id} deleteAction={deleteClaim} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sortedClaims.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-16 text-sm">
                    No profit claims recorded yet. Lock a claim from an investor&apos;s profile when they withdraw capital.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
