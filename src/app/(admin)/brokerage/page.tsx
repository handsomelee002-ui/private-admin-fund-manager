import { sql } from "@vercel/postgres";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getBrokerageFeeRate,
  getAllBonusPayments,
  deleteBonusPayment,
} from "@/actions/settings";
import { calculateFixedSavingsLiability, getFixedSavingsRateInputs } from "@/lib/fundDb";
import { getInvestors } from "@/actions/investors";
import { BrokerageFeeConfig } from "@/components/BrokerageFeeConfig";
import { AddBonusForm } from "@/components/AddBonusForm";
import { DeleteButton } from "@/components/DeleteButton";
import { NotesTableCell } from "@/components/NotesTableCell";
import { PaginationControls } from "@/components/PaginationControls";
import { SortableTableHead } from "@/components/SortableTableHead";
import { formatMoney } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Percent, DollarSign, TrendingDown, TrendingUp, Gift, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const bonusSorts = ["investor", "ledger", "date", "amount"] as const;
const metricValueClass = "text-[1.625rem] leading-8 font-bold whitespace-nowrap tabular-nums tracking-normal";

export default async function BrokeragePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, bonusSorts, { sort: "date", dir: "desc" });

  const [
    brokerageFeeRate,
    brokeragePnlRes,
    withdrawalFeesRes,
    fsRows,
    fixedSavingsRates,
    bonusPayments,
    investors,
  ] = await Promise.all([
    timeAsync("route.brokerage.getBrokerageFeeRate", () => getBrokerageFeeRate(), { route: "/brokerage" }),
    timeAsync("route.brokerage.latestBrokeragePnlQuery", () => sql`
      WITH latest_nav AS (
        SELECT id
        FROM nav_weeks
        WHERE status = 'locked'
        ORDER BY week_ending DESC
        LIMIT 1
      )
      SELECT COALESCE(SUM(nwps.brokerage_profit_loss), 0) as brokerage_profit_loss
      FROM nav_week_platform_snapshots nwps
      WHERE nwps.nav_week_id = (SELECT id FROM latest_nav)
    `, { route: "/brokerage" }),
    timeAsync("route.brokerage.withdrawalFeesQuery", () => sql`
      SELECT COALESCE(SUM(fee_amount), 0) as total
      FROM performance_fees
      WHERE audit_status <> 'reverted'
    `, { route: "/brokerage" }).catch(() => null),
    timeAsync("route.brokerage.fixedSavingsRowsQuery", () => sql`
      SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `, { route: "/brokerage" }),
    timeAsync("route.brokerage.getFixedSavingsRateInputs", () => getFixedSavingsRateInputs(), { route: "/brokerage" }),
    timeAsync("route.brokerage.getAllBonusPayments", () => getAllBonusPayments(), { route: "/brokerage" }),
    timeAsync("route.brokerage.getInvestors", () => getInvestors(), { route: "/brokerage" }),
  ]);

  const brokerageProfitLoss = parseFloat(brokeragePnlRes.rows[0]?.brokerage_profit_loss || "0");
  const withdrawalBrokerageEarned = parseFloat(withdrawalFeesRes?.rows[0]?.total || "0");

  const brokerageFeeEarned = withdrawalBrokerageEarned;

  const fixedSavingsLiability = calculateFixedSavingsLiability(fsRows.rows as any[], undefined, fixedSavingsRates);
  const totalInterestOwed = fixedSavingsLiability.accruedInterest;

  const sortedBonusPayments = sortRows(bonusPayments, sortState, {
    investor: (bonus: any) => bonus.investor_name,
    ledger: (bonus: any) => bonus.ledger_type,
    date: (bonus: any) => bonus.date,
    amount: (bonus: any) => bonus.amount,
  });
  const bonusPagination = paginateRows(sortedBonusPayments, resolvedSearchParams);
  const totalBonusPaid = bonusPayments.reduce((sum: number, b: any) => sum + parseFloat(b.amount), 0);

  const netCommission = brokerageProfitLoss + brokerageFeeEarned - totalInterestOwed - totalBonusPaid;

  const fmt = formatMoney;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Brokerage</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure withdrawal fees and reconcile brokerage account liabilities.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="bg-card/50 border-border/50 lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Brokerage Fee Rate</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Charged only on NAV-based equity withdrawal/redemption profit. Click the edit icon to update.
            </p>
          </CardHeader>
          <CardContent>
            <BrokerageFeeConfig initialRate={brokerageFeeRate} />
            <p className="text-[10px] text-muted-foreground mt-3">
              Platform realized-profit fees and claim fees are disabled to prevent double charging.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50 lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Brokerage Account Balance</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Brokerage P&L + fees - accrued interest - investor bonuses.</p>
            </div>
            <div className="text-right">
              <div className={`${metricValueClass} ${netCommission >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {netCommission >= 0 ? "+" : ""}{fmt(netCommission)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Net available</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border/50 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <TrendingUp className="h-4 w-4 text-blue-400" />
                    Non-Equity Investment P&L
                  </div>
                  <span className={`font-semibold ${brokerageProfitLoss >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt(brokerageProfitLoss)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">Fixed-savings and brokerage-funded share from latest locked NAV.</p>
              </div>
              <div className="rounded-md border border-border/50 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                    Profit Performance Fees
                  </div>
                  <span className="font-semibold text-emerald-400">{fmt(brokerageFeeEarned)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">Equity redemption fee income.</p>
              </div>
              <div className="rounded-md border border-border/50 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <TrendingDown className="h-4 w-4 text-orange-400" />
                    Accrued Interest
                  </div>
                  <span className="font-semibold text-orange-400">-{fmt(totalInterestOwed)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">Contractual fixed-savings interest payable.</p>
              </div>
              <div className="rounded-md border border-border/50 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Gift className="h-4 w-4 text-violet-400" />
                    Investor Bonuses
                  </div>
                  <span className="font-semibold text-violet-400">-{fmt(totalBonusPaid)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">Equity and fixed-savings bonus adjustments.</p>
              </div>
            </div>

            <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Formula: {fmt(brokerageProfitLoss)} + {fmt(brokerageFeeEarned)} - {fmt(totalInterestOwed)} - {fmt(totalBonusPaid)}
            </div>
          </CardContent>
        </Card>
      </div>

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
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <SortableTableHead className="w-[180px] pl-6" sortKey="investor" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Investor</SortableTableHead>
                <SortableTableHead className="w-[116px]" sortKey="ledger" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Ledger</SortableTableHead>
                <SortableTableHead className="w-[116px]" sortKey="date" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Date</SortableTableHead>
                <SortableTableHead className="w-[128px] text-right" sortKey="amount" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Amount</SortableTableHead>
                <TableHead className="w-[180px]">Notes</TableHead>
                <TableHead className="w-[88px] pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bonusPagination.pageRows.map((b: any) => (
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
                  <NotesTableCell value={b.notes} className="" />
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
          <PaginationControls {...bonusPagination} searchParams={resolvedSearchParams} />
        </CardContent>
      </Card>
    </div>
  );
}
