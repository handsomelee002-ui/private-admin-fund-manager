import { sql } from "@vercel/postgres";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, ArrowDownRight, ArrowUpRight, TrendingUp, Percent, PieChart, Award, Handshake, Clock, CheckCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCapitalLedgerByInvestor, deleteCapitalRecord } from "@/actions/capital";
import { getFixedSavingsByInvestor, deleteFixedSavingsRecord } from "@/actions/fixedSavings";
import { calcDailyCompoundInterest } from "@/lib/savingsUtils";
import { getClaimsByInvestor, deleteClaim } from "@/actions/profitClaims";
import { AddCapitalForm } from "@/components/AddCapitalForm";
import { AddFixedSavingsForm } from "@/components/AddFixedSavingsForm";
import { SettleClaimDialog } from "@/components/SettleClaimDialog";
import { DeleteButton } from "@/components/DeleteButton";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function InvestorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  // Fetch investor details
  const invRes = await sql`SELECT * FROM investors WHERE id = ${id}`;
  const investor = invRes.rows[0];

  if (!investor) {
    return <div>Investor not found</div>;
  }

  // Equity Records — include Bonus type as positive contribution
  const records = await getCapitalLedgerByInvestor(id);
  const totalDeposits = records
    .filter(r => r.type === 'Deposit' || r.type === 'Bonus')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const totalWithdrawals = records
    .filter(r => r.type === 'Withdrawal')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const netCapital = totalDeposits - totalWithdrawals;

  // Fixed Savings Records — Bonus type added to balance, no interest accrual on bonus
  const savingsRecords = await getFixedSavingsByInvestor(id);

  const savingsDeposits = savingsRecords
    .filter(r => r.type === 'Deposit' || r.type === 'Bonus')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const savingsWithdrawals = savingsRecords
    .filter(r => r.type === 'Withdrawal')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  // Calculate accrued interest up to today for every deposit that has a rate
  const totalAccruedInterest = savingsRecords
    .filter(r => r.type === 'Deposit' && r.interest_rate != null && parseFloat(r.interest_rate) > 0)
    .reduce((sum, r) => {
      return sum + calcDailyCompoundInterest(
        parseFloat(r.amount),
        parseFloat(r.interest_rate),
        r.date,
      );
    }, 0);

  // Principal balance (deposits – withdrawals) + all accrued interest
  const savingsBalance = savingsDeposits - savingsWithdrawals + totalAccruedInterest;

  // Fund-level totals — include Bonus type as positive equity contribution
  const totalEquityRes = await sql`
    SELECT COALESCE(SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount ELSE -amount END), 0) as total
    FROM capital_ledger
  `;
  const totalFundEquity = parseFloat(totalEquityRes.rows[0]?.total || 0);

  const perfRes = await sql`
    SELECT SUM(unrealized_profit) as total
    FROM (
      SELECT unrealized_profit,
             ROW_NUMBER() OVER(PARTITION BY platform_id ORDER BY month DESC) as rn
      FROM platform_performance
    ) sub WHERE rn = 1
  `;
  const totalUnrealized = parseFloat(perfRes.rows[0]?.total || 0);

  const equityPct = totalFundEquity > 0 ? (netCapital / totalFundEquity) * 100 : 0;
  const equityProfitShare = totalFundEquity > 0 ? (netCapital / totalFundEquity) * totalUnrealized : 0;
  const totalProfit = equityProfitShare + totalAccruedInterest;
  const totalDeposited = totalDeposits + savingsDeposits;
  const roi = totalDeposited > 0 ? (totalProfit / totalDeposited) * 100 : 0;

  // Profit claims for this investor
  const claims = await getClaimsByInvestor(id);
  const pendingClaimsTotal = claims
    .filter((c: any) => c.status !== "settled")
    .reduce((s: number, c: any) => s + (parseFloat(c.locked_amount) - parseFloat(c.settled_amount)), 0);

  const today = new Date().toISOString().split("T")[0];

  const fmt = (n: number) =>
    `RM ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-4 mb-1">
             <Link href="/investors">
               <Button variant="outline" size="sm">← Back</Button>
             </Link>
             <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
               {investor.name}
             </h1>
          </div>
          <p className="text-muted-foreground text-sm ml-[78px]">
            Detailed ledger and capital overview.
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Equity Capital */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Equity Capital</CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
              <Wallet className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(netCapital)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">Net equity (deposits − withdrawals)</p>
          </CardContent>
        </Card>

        {/* Fixed Savings */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-orange-500/15 to-orange-500/5 border-orange-500/25 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fixed Savings Balance</CardTitle>
            <div className="h-8 w-8 rounded-full bg-orange-500/15 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-orange-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-400">{fmt(savingsBalance)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">
              +{fmt(totalAccruedInterest)} accrued interest
            </p>
          </CardContent>
        </Card>

        {/* Equity % */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-violet-500/15 to-violet-500/5 border-violet-500/25 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Equity Ownership</CardTitle>
            <div className="h-8 w-8 rounded-full bg-violet-500/15 flex items-center justify-center">
              <PieChart className="h-4 w-4 text-violet-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-violet-400">{equityPct.toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground mt-1.5">Share of total fund equity</p>
          </CardContent>
        </Card>

        {/* ROI */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">ROI</CardTitle>
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <Award className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${roi >= 0 ? "text-emerald-500" : "text-red-400"}`}>
              {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {fmt(totalProfit)} total profit
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary: Lifetime Deposits & Withdrawals */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Lifetime Deposits</CardTitle>
            <ArrowDownRight className="h-3.5 w-3.5 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold">{fmt(totalDeposits + savingsDeposits)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Lifetime Withdrawals</CardTitle>
            <ArrowUpRight className="h-3.5 w-3.5 text-destructive" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold">{fmt(totalWithdrawals + savingsWithdrawals)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equity Ledger */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Equity Ledger</CardTitle>
            <AddCapitalForm investors={[investor]} defaultInvestorId={investor.id} />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((rec: any) => (
                  <TableRow key={rec.id}>
                    <TableCell className="text-xs">{rec.date}</TableCell>
                    <TableCell>
                      <Badge
                        variant={rec.type === "Deposit" ? "default" : rec.type === "Bonus" ? "outline" : "destructive"}
                        className={rec.type === "Bonus" ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/10" : ""}
                      >
                        {rec.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold text-primary text-sm">
                      RM {parseFloat(rec.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton id={rec.id} deleteAction={deleteCapitalRecord} />
                    </TableCell>
                  </TableRow>
                ))}
                {records.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                      No equity records found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Fixed Savings Ledger */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 border-orange-500/20">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Fixed Savings Ledger</CardTitle>
            <AddFixedSavingsForm investors={[investor]} defaultInvestorId={investor.id} />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">
                    <span className="flex items-center justify-end gap-1">
                      <Percent className="h-3 w-3" /> Rate
                    </span>
                  </TableHead>
                  <TableHead className="text-right">Accrued Interest</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {savingsRecords.map((rec: any) => {
                  const principal = parseFloat(rec.amount);
                  const rate = rec.interest_rate ? parseFloat(rec.interest_rate) : null;
                  const accrued =
                    rec.type === "Deposit" && rate && rate > 0
                      ? calcDailyCompoundInterest(principal, rate, rec.date)
                      : null;

                  return (
                    <TableRow key={rec.id}>
                      <TableCell className="text-xs">{rec.date}</TableCell>
                      <TableCell>
                        <Badge
                          variant={rec.type === "Deposit" ? "default" : "destructive"}
                        >
                          {rec.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-bold text-sm">
                        RM {principal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {rate != null ? `${rate}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium text-orange-500">
                        {accrued != null
                          ? `+RM ${accrued.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DeleteButton id={rec.id} deleteAction={deleteFixedSavingsRecord} />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {savingsRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">
                      No fixed savings records found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Accrued Interest Summary Footer */}
            {totalAccruedInterest > 0 && (
              <div className="mt-4 pt-3 border-t border-orange-500/20 flex justify-between items-center text-sm">
                <span className="text-muted-foreground">
                  Total accrued interest (daily compounding, as of {today}):
                </span>
                <span className="font-bold text-orange-500 text-base">
                  +RM {totalAccruedInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Profit Claims Section */}
      <Card className="bg-card/50 backdrop-blur-sm border-amber-500/20 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-base">Profit Claims (IOUs)</CardTitle>
            {pendingClaimsTotal > 0 && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-amber-400 border-amber-400/30 bg-amber-400/5">
                {fmt(pendingClaimsTotal)} pending
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <TableHead className="pl-6">Claim Date</TableHead>
                <TableHead className="text-right">Locked (IOU)</TableHead>
                <TableHead className="text-right">Settled</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Settled On</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((c: any) => {
                const locked    = parseFloat(c.locked_amount);
                const settled   = parseFloat(c.settled_amount);
                const remaining = locked - settled;
                return (
                  <TableRow key={c.id} className="hover:bg-muted/20 transition-colors border-border/30">
                    <TableCell className="pl-6 text-sm">{c.claim_date}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-sm text-amber-400">
                      {fmt(locked)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-sm text-emerald-400">
                      {settled > 0 ? fmt(settled) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {remaining > 0 ? <span className="text-orange-400 font-medium">{fmt(remaining)}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {c.status === "settled" ? (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 text-emerald-500 border-emerald-500/30 bg-emerald-500/5">
                          <CheckCircle className="h-2.5 w-2.5" /> Settled
                        </Badge>
                      ) : c.status === "partial" ? (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 text-amber-400 border-amber-400/30 bg-amber-400/5">
                          <AlertCircle className="h-2.5 w-2.5" /> Partial
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 text-orange-400 border-orange-400/30 bg-orange-400/5">
                          <Clock className="h-2.5 w-2.5" /> Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.settled_date ?? "—"}</TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end gap-2">
                        {c.status !== "settled" && (
                          <SettleClaimDialog claim={{ ...c, investor_name: investor.name }} />
                        )}
                        <DeleteButton id={c.id} deleteAction={deleteClaim} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {claims.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10 text-sm">
                    No profit claims yet. A claim is automatically created when a capital withdrawal is recorded while the fund has unrealized profits.
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
