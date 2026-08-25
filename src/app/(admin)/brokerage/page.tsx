import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getBrokerageFeeRate,
  getAllBonusPayments,
  deleteBonusPayment,
} from "@/actions/settings";
import { getBrokerageBalance, getBrokerageWithdrawals } from "@/lib/fundDb";
import { getInvestors } from "@/actions/investors";
import { BrokerageFeeConfig } from "@/components/BrokerageFeeConfig";
import { AddBonusForm } from "@/components/AddBonusForm";
import { BrokerageWithdrawalForm } from "@/components/BrokerageWithdrawalForm";
import { DeleteButton } from "@/components/DeleteButton";
import { NotesTableCell } from "@/components/NotesTableCell";
import { PaginationControls } from "@/components/PaginationControls";
import { SortableTableHead } from "@/components/SortableTableHead";
import { formatMoney } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Percent, Banknote, TrendingUp, Gift, Wallet } from "lucide-react";

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
    pot,
    brokerageWithdrawals,
    bonusPayments,
    investors,
  ] = await Promise.all([
    timeAsync("route.brokerage.getBrokerageFeeRate", () => getBrokerageFeeRate(), { route: "/brokerage" }),
    // One source for the pot's balance, shared with getCapitalAllocationBasis
    // and the dashboard availability card. Recomputing it here is what made this
    // page disagree with them.
    timeAsync("route.brokerage.getBrokerageBalance", () => getBrokerageBalance(), { route: "/brokerage" }),
    timeAsync("route.brokerage.getBrokerageWithdrawals", () => getBrokerageWithdrawals(), { route: "/brokerage" }),
    timeAsync("route.brokerage.getAllBonusPayments", () => getAllBonusPayments(), { route: "/brokerage" }),
    timeAsync("route.brokerage.getInvestors", () => getInvestors(), { route: "/brokerage" }),
  ]);

  const brokerageFeeEarned = pot.performanceFees;
  // Interest credited since inception. Not "unpaid": interest already paid out
  // in cash has still been borne by the pot, so netting that back would
  // overstate what is left.
  const totalInterestOwed = pot.savingsInterest;

  const sortedBonusPayments = sortRows(bonusPayments, sortState, {
    investor: (bonus: any) => bonus.investor_name,
    ledger: (bonus: any) => bonus.ledger_type,
    date: (bonus: any) => bonus.date,
    amount: (bonus: any) => bonus.amount,
  });
  const bonusPagination = paginateRows(sortedBonusPayments, resolvedSearchParams);
  const totalBonusPaid = pot.bonuses;

  const netCommission = pot.balance;
  const totalWithdrawn = pot.withdrawals;

  const fmt = formatMoney;

  // Every component lands in exactly one column. Fees, interest, bonuses and
  // cash out are all settled or accrued, so they are realised; only the mark is
  // unrealised. The two columns foot to the pot's balance, which is the figure
  // NAV prices the pot at - so splitting it here cannot move anyone's money.
  const statementRows = [
    {
      label: "Non-Equity Investment P&L",
      hint: "Realised is cash swept back from brokers above the capital they were given. Unrealised is the mark on money still deployed and still being traded.",
      realised: pot.platformProfitLossRealised,
      unrealised: pot.platformProfitLossUnrealised,
    },
    {
      label: "Profit Performance Fees",
      hint: "Equity redemption fee income.",
      realised: brokerageFeeEarned,
      unrealised: null,
    },
    {
      label: "Interest Credited",
      hint: "All fixed-savings interest ever credited, paid or still owed.",
      realised: -totalInterestOwed,
      unrealised: null,
    },
    {
      label: "Investor Bonuses",
      hint: "Equity and fixed-savings bonus adjustments.",
      realised: -totalBonusPaid,
      unrealised: null,
    },
    {
      label: "Cash Withdrawn",
      hint: "Already paid out of the fund's bank account.",
      realised: -totalWithdrawn,
      unrealised: null,
    },
  ];

  const amountClass = (value: number) =>
    value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-muted-foreground";

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
            <div className="flex items-start gap-4">
              <div className="text-right">
                <div className={`${metricValueClass} ${netCommission >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {netCommission >= 0 ? "+" : ""}{fmt(netCommission)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {pot.withdrawable > 0
                    ? `${fmt(pot.withdrawable)} available to withdraw`
                    : "Nothing to withdraw"}
                </p>
              </div>
              <BrokerageWithdrawalForm withdrawable={pot.withdrawable} unrealised={pot.unrealisedPot} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-md border border-border/50 bg-background/40">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Component</th>
                    <th className="px-3 py-2 text-right font-medium">Realised</th>
                    <th className="px-3 py-2 text-right font-medium">Unrealised</th>
                  </tr>
                </thead>
                <tbody>
                  {statementRows.map((row) => (
                    <tr key={row.label} className="border-b border-border/30 last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="text-sm text-muted-foreground">{row.label}</div>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5 max-w-md">{row.hint}</p>
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${amountClass(row.realised)}`}>
                        {fmt(row.realised)}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${row.unrealised === null ? "text-muted-foreground/40" : amountClass(row.unrealised)}`}>
                        {row.unrealised === null ? "—" : fmt(row.unrealised)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border/50 bg-muted/20">
                    <td className="px-3 py-2 text-sm font-medium">Pot</td>
                    <td className={`px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap ${amountClass(pot.realisedPot)}`}>
                      {fmt(pot.realisedPot)}
                    </td>
                    <td className={`px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap ${amountClass(pot.unrealisedPot)}`}>
                      {fmt(pot.unrealisedPot)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {pot.realisedPot < 0 && (
              <div className="rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] leading-relaxed text-red-400/90">
                The pot is in deficit by {fmt(Math.abs(pot.realisedPot))} against realised profit: more has been paid
                out or accrued than has actually been earned in cash. Equity is carrying it as residual owner, and it
                must be recovered before any further withdrawal.
              </div>
            )}

            {!pot.hasLockedNav && (
              <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                No NAV week has been locked yet, so there is no mark to split against. The balance is correct, but the
                realised and unrealised columns only become meaningful after the first lock.
              </div>
            )}

            {pot.hasLockedNav && pot.unrealisedPot < 0 && (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-400/90">
                Unrealised is negative: the money still deployed is marked {fmt(Math.abs(pot.unrealisedPot))} below what
                has already been realised out of it. Closing a broker account must be recorded as a zero valuation, or
                its loss stays here instead of being realised.
              </div>
            )}


            <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Balance: {fmt(pot.realisedPot)} realised + {fmt(pot.unrealisedPot)} unrealised = {fmt(netCommission)}.
              Withdrawals are capped at the lower of realised profit and the total balance, so no cash leaves against a
              mark that has since gone underwater.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Brokerage Withdrawals</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Cash taken out of the pot. Each row moved the fund&apos;s recorded bank balance by the same amount.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <TableHead className="w-[140px] pl-6">Date</TableHead>
                <TableHead className="w-[160px] text-right">Amount</TableHead>
                <TableHead className="pr-6">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brokerageWithdrawals.map((withdrawal: any) => (
                <TableRow key={withdrawal.id} className="hover:bg-muted/20 transition-colors border-border/30">
                  <TableCell className="pl-6 text-sm text-muted-foreground">{withdrawal.date}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-sm text-sky-400">
                    -{fmt(parseFloat(withdrawal.amount))}
                  </TableCell>
                  <NotesTableCell value={withdrawal.notes} className="pr-6" />
                </TableRow>
              ))}
              {brokerageWithdrawals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-12 text-sm">
                    Nothing yet. Realised profit stays in the pot until it is taken out.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
