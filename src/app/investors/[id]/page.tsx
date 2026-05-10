import { sql } from "@vercel/postgres";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, ArrowDownRight, ArrowUpRight, TrendingUp, Percent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCapitalLedgerByInvestor, deleteCapitalRecord } from "@/actions/capital";
import { getFixedSavingsByInvestor, deleteFixedSavingsRecord } from "@/actions/fixedSavings";
import { calcDailyCompoundInterest } from "@/lib/savingsUtils";
import { AddCapitalForm } from "@/components/AddCapitalForm";
import { AddFixedSavingsForm } from "@/components/AddFixedSavingsForm";
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

  // Equity Records
  const records = await getCapitalLedgerByInvestor(id);
  const totalDeposits = records.filter(r => r.type === 'Deposit').reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const totalWithdrawals = records.filter(r => r.type === 'Withdrawal').reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const netCapital = totalDeposits - totalWithdrawals;

  // Fixed Savings Records — interest is computed dynamically (daily compounding)
  const savingsRecords = await getFixedSavingsByInvestor(id);

  const savingsDeposits = savingsRecords
    .filter(r => r.type === 'Deposit')
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

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-4 mb-2">
             <Link href="/investors">
               <Button variant="outline" size="sm">← Back</Button>
             </Link>
             <h1 className="text-3xl font-bold tracking-tight">{investor.name}</h1>
          </div>
          <p className="text-muted-foreground">
            Detailed ledger and capital overview.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Equity Capital</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              RM {netCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm border-orange-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Fixed Savings Balance</CardTitle>
            <TrendingUp className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">
              RM {savingsBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              +RM {totalAccruedInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} accrued interest (as of {today})
            </p>
          </CardContent>
        </Card>
        
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Lifetime Deposits</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              RM {(totalDeposits + savingsDeposits).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Lifetime Withdrawals</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              RM {(totalWithdrawals + savingsWithdrawals).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
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
                      <Badge variant={rec.type === "Deposit" ? "default" : "destructive"}>
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
    </div>
  );
}
