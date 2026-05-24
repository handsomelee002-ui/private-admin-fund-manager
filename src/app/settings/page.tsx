import { sql } from "@vercel/postgres";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getBrokerageFeeRate,
  getAllBonusPayments,
  deleteBonusPayment,
} from "@/actions/settings";
import { calculateFixedSavingsLiability } from "@/lib/fundDb";
import { getInvestors } from "@/actions/investors";
import { BrokerageFeeConfig } from "@/components/BrokerageFeeConfig";
import { AddBonusForm } from "@/components/AddBonusForm";
import { DeleteButton } from "@/components/DeleteButton";
import { SortableTableHead } from "@/components/SortableTableHead";
import { formatMoney } from "@/lib/formatting";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Percent, DollarSign, TrendingDown, TrendingUp, Gift, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const bonusSorts = ["investor", "ledger", "date", "amount"] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, bonusSorts, { sort: "date", dir: "desc" });
  // ── Config ───────────────────────────────────────────────────────────────────
  const brokerageFeeRate = await getBrokerageFeeRate();

  // ── Realized Profit: NET across all platform Withdraw transactions ───────────
  // Performance fee model — losses reduce the fee base; no fee on net losses
  const realizedRes = await sql`
    SELECT COALESCE(SUM(realized_profit), 0) as net_realized
    FROM platform_transactions
    WHERE type = 'Withdraw' AND realized_profit IS NOT NULL
  `;
  const netRealized = parseFloat(realizedRes.rows[0]?.net_realized || 0);
  const platformBrokerageEarned = netRealized > 0 ? netRealized * (brokerageFeeRate / 100) : 0;

  // ── Brokerage earned from settled profit claims (pre-calculated at lock) ─────
  let claimsBrokerageEarned = 0;
  let withdrawalBrokerageEarned = 0;
  try {
    const claimsFeesRes = await sql`
      SELECT COALESCE(SUM(brokerage_fee), 0) as total
      FROM investor_profit_claims
      WHERE status = 'settled'
    `;
    claimsBrokerageEarned = parseFloat(claimsFeesRes.rows[0]?.total || "0");
  } catch { /* table may not exist yet */ }
  try {
    const withdrawalFeesRes = await sql`
      SELECT COALESCE(SUM(fee_amount), 0) as total
      FROM performance_fees
      WHERE audit_status <> 'reverted'
    `;
    withdrawalBrokerageEarned = parseFloat(withdrawalFeesRes.rows[0]?.total || "0");
  } catch { /* table may not exist yet */ }

  const brokerageFeeEarned = platformBrokerageEarned + claimsBrokerageEarned + withdrawalBrokerageEarned;
  const totalRealized = netRealized; // for display

  // ── Total Interest Owed to All Investors ─────────────────────────────────────
  const fsRows = await sql`
    SELECT id, account_id, investor_id, type, amount, annual_rate_percent, interest_rate, TO_CHAR(date, 'YYYY-MM-DD') as date
    FROM fixed_savings_ledger
    ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
  `;
  const fixedSavingsLiability = calculateFixedSavingsLiability(fsRows.rows as any[]);
  const totalInterestOwed = fixedSavingsLiability.payableInterest;

  // ── Total Bonuses Paid ───────────────────────────────────────────────────────
  const bonusPayments = await getAllBonusPayments();
  const sortedBonusPayments = sortRows(bonusPayments, sortState, {
    investor: (bonus: any) => bonus.investor_name,
    ledger: (bonus: any) => bonus.ledger_type,
    date: (bonus: any) => bonus.date,
    amount: (bonus: any) => bonus.amount,
  });
  const totalBonusPaid = bonusPayments.reduce(
    (sum: number, b: any) => sum + (b.ledger_type === "equity" ? parseFloat(b.amount) : 0),
    0,
  );

  // ── Net Commission ───────────────────────────────────────────────────────────
  const netCommission = brokerageFeeEarned - totalInterestOwed - totalBonusPaid;

  // ── Investors list for AddBonusForm ─────────────────────────────────────────
  const investors = await getInvestors();

  const fmt = formatMoney;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
          Brokerage
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure brokerage fees, track commission, and manage investor payable liabilities.
        </p>
      </div>

      {/* ── Brokerage Fee Config ─────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 shadow-lg lg:col-span-1">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardHeader>
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Brokerage Fee Rate</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Charged on each realized profit. Accumulates as fund commission. Click the edit icon to update.
            </p>
          </CardHeader>
          <CardContent>
            <BrokerageFeeConfig initialRate={brokerageFeeRate} />
            <p className="text-[10px] text-muted-foreground mt-3">
              {totalRealized >= 0 ? "Profit" : "Loss"} {fmt(Math.abs(totalRealized))} net realized → <strong className={totalRealized >= 0 ? "text-primary" : "text-red-400"}>{fmt(brokerageFeeEarned)}</strong> earned
            </p>
          </CardContent>
        </Card>

        {/* Commission Summary Cards */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3 lg:col-span-2">
          <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Brokerage Earned</CardTitle>
              <div className="h-7 w-7 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-emerald-400">{fmt(brokerageFeeEarned)}</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Platform: {fmt(platformBrokerageEarned)} + Claims: {fmt(claimsBrokerageEarned)} + Withdrawals: {fmt(withdrawalBrokerageEarned)}
              </p>
              <p className="text-[10px] text-muted-foreground">Net realized: {totalRealized >= 0 ? "+" : ""}{fmt(totalRealized)}</p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden bg-gradient-to-br from-orange-500/15 to-orange-500/5 border-orange-500/25 shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent pointer-events-none" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Interest Owed</CardTitle>
              <div className="h-7 w-7 rounded-full bg-orange-500/15 flex items-center justify-center">
                <TrendingDown className="h-3.5 w-3.5 text-orange-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-orange-400">{fmt(totalInterestOwed)}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Accrued interest plus fixed-savings bonus payable</p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden bg-gradient-to-br from-violet-500/15 to-violet-500/5 border-violet-500/25 shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Equity Bonus</CardTitle>
              <div className="h-7 w-7 rounded-full bg-violet-500/15 flex items-center justify-center">
                <Gift className="h-3.5 w-3.5 text-violet-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-violet-400">{fmt(totalBonusPaid)}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Fixed-savings bonus is included in interest owed</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Net Commission Card ──────────────────────────────────────────────── */}
      <Card className={`relative overflow-hidden shadow-lg ${netCommission >= 0 ? "bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/25" : "bg-gradient-to-br from-red-500/10 to-red-500/5 border-red-500/25"}`}>
        <div className="absolute inset-0 bg-gradient-to-br from-transparent to-transparent pointer-events-none" />
        <CardContent className="py-5 px-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Net Commission Balance</p>
              <p className="text-xs text-muted-foreground mt-0.5">Brokerage Earned - Payable Interest - Equity Bonus</p>
            </div>
            <div className="text-right">
              <div className={`text-3xl font-bold ${netCommission >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {netCommission >= 0 ? "+" : ""}{fmt(netCommission)}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {fmt(brokerageFeeEarned)} − {fmt(totalInterestOwed)} − {fmt(totalBonusPaid)}
              </p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Interest ({fmt(totalInterestOwed)})</span>
              <span>Equity bonus ({fmt(totalBonusPaid)})</span>
              <span>Net ({fmt(netCommission)})</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden flex">
              {brokerageFeeEarned > 0 && (
                <>
                  <div
                    className="h-full bg-orange-400/70 transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, (totalInterestOwed / brokerageFeeEarned) * 100)).toFixed(1)}%` }}
                  />
                  <div
                    className="h-full bg-violet-400/70 transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, (totalBonusPaid / brokerageFeeEarned) * 100)).toFixed(1)}%` }}
                  />
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Bonus Payments ───────────────────────────────────────────────────── */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Special Bonus Payments</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              One-time positive or negative bonuses to specific investors or all investors proportionally.
            </p>
          </div>
          <AddBonusForm investors={investors.map((i: any) => ({ id: i.id, name: i.name }))} />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <SortableTableHead className="pl-6" sortKey="investor" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Investor</SortableTableHead>
                <SortableTableHead sortKey="ledger" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Ledger</SortableTableHead>
                <SortableTableHead sortKey="date" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Date</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="amount" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Amount</SortableTableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedBonusPayments.map((b: any) => (
                <TableRow key={b.id} className="hover:bg-muted/20 transition-colors border-border/30">
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                        {b.investor_name === "All Investors" ? "A" : b.investor_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-sm">{b.investor_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-5 px-1.5 ${
                        b.ledger_type === "equity"
                          ? "text-violet-400 border-violet-400/30 bg-violet-400/5"
                          : "text-orange-400 border-orange-400/30 bg-orange-400/5"
                      }`}
                    >
                      {b.ledger_type === "equity" ? (
                        <><Wallet className="h-2.5 w-2.5 mr-0.5 inline" /> Equity</>
                      ) : (
                        <><TrendingUp className="h-2.5 w-2.5 mr-0.5 inline" /> Savings</>
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.date}</TableCell>
                  <TableCell className={`text-right font-bold tabular-nums text-sm ${parseFloat(b.amount) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {parseFloat(b.amount) >= 0 ? "+" : ""}{fmt(parseFloat(b.amount))}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                    {b.notes || "—"}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <DeleteButton id={b.id} deleteAction={deleteBonusPayment} />
                  </TableCell>
                </TableRow>
              ))}
              {sortedBonusPayments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-16 text-sm">
                    No bonus payments yet. Use &quot;Add Bonus&quot; to distribute a special payment.
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
