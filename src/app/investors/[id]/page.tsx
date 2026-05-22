import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddCashMovementForm } from "@/components/AddCashMovementForm";
import { AddFixedSavingsMovementForm } from "@/components/AddFixedSavingsMovementForm";
import { getInvestors } from "@/actions/investors";
import { getInvestorStatement } from "@/lib/fundDb";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { ArrowLeft, Banknote, Percent, TrendingUp, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InvestorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [statement, investors] = await Promise.all([
    getInvestorStatement(id),
    getInvestors(),
  ]);
  if (!statement) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/investors">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-3xl font-bold tracking-tight">{statement.investor.name}</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm ml-14">Investor activity, units, cash movements, bonuses, and fixed savings.</p>
        </div>
        <div className="flex gap-2">
          <AddCashMovementForm investors={investors} defaultInvestorId={id} />
          <AddFixedSavingsMovementForm investors={investors} defaultInvestorId={id} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Net Invested</CardTitle>
            <TrendingUp className="h-4 w-4 text-sky-400" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-sky-400">{formatMoney(statement.netInvestedCapital)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Market Value</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatMoney(statement.marketValue)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Units</CardTitle>
            <Percent className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatUnits(statement.units)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Ownership</CardTitle>
            <Percent className="h-4 w-4 text-violet-400" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-violet-400">{statement.ownershipPercent.toFixed(4)}%</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Fixed Savings</CardTitle>
            <Banknote className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">{formatMoney(statement.savingsBalance)}</div>
            <p className="text-xs text-muted-foreground mt-1">{formatMoney(statement.savingsInterest)} accrued</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader><CardTitle className="text-base">Activity Ledger</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Date</TableHead>
                <TableHead>Ledger</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">NAV / Unit</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="pr-6">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statement.activityLedger.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-6">{row.date}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.category}</TableCell>
                  <TableCell><Badge variant={["UnitIssue", "BonusIssue", "Deposit", "Bonus"].includes(row.type) ? "default" : "destructive"}>{row.type}</Badge></TableCell>
                  <TableCell className="text-right">{row.units ? formatUnits(row.units) : "-"}</TableCell>
                  <TableCell className="text-right">{row.navPerUnit ? Number(row.navPerUnit).toFixed(6) : "-"}</TableCell>
                  <TableCell className={`text-right font-semibold ${row.amount >= 0 ? "" : "text-red-400"}`}>{formatMoney(row.amount)}</TableCell>
                  <TableCell className="pr-6 text-muted-foreground">{row.notes || "-"}</TableCell>
                </TableRow>
              ))}
              {statement.activityLedger.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">No investor activity.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
