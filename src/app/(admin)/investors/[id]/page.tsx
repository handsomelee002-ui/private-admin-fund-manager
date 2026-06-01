import { NoPrefetchLink } from "@/components/NoPrefetchLink";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddCashMovementForm } from "@/components/AddCashMovementForm";
import { AddFixedSavingsMovementForm } from "@/components/AddFixedSavingsMovementForm";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getInvestors } from "@/actions/investors";
import { getInvestorStatement } from "@/lib/fundDb";
import { requireAdmin } from "@/lib/auth";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { ArrowLeft, Banknote, Percent, TrendingUp, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const activitySorts = ["date", "ledger", "type", "units", "nav", "amount"] as const;

export default async function InvestorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, activitySorts, { sort: "date", dir: "desc" });
  const statusFilter = typeof resolvedSearchParams.status === "string" ? resolvedSearchParams.status : "active";
  const [statement, investors] = await Promise.all([
    getInvestorStatement(id),
    getInvestors(),
  ]);
  if (!statement) notFound();
  const visibleActivityLedger = statusFilter === "all"
    ? statement.activityLedger
    : statement.activityLedger.filter((row: any) => row.auditStatus === "active");
  const sortedActivityLedger = sortRows(visibleActivityLedger, sortState, {
    date: (row: any) => row.date,
    ledger: (row: any) => row.category,
    type: (row: any) => row.type,
    units: (row: any) => row.units,
    nav: (row: any) => row.navPerUnit,
    amount: (row: any) => row.amount,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <NoPrefetchLink href="/investors">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </NoPrefetchLink>
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
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Activity Ledger</CardTitle>
            <div className="flex items-center gap-2 text-sm">
              <NoPrefetchLink className={statusFilter === "active" ? "text-primary font-semibold" : "text-muted-foreground"} href={`/investors/${id}`}>Active</NoPrefetchLink>
              <NoPrefetchLink className={statusFilter === "all" ? "text-primary font-semibold" : "text-muted-foreground"} href={`/investors/${id}?status=all`}>All</NoPrefetchLink>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead className="pl-6" sortKey="date" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Date</SortableTableHead>
                <SortableTableHead sortKey="ledger" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Ledger</SortableTableHead>
                <SortableTableHead sortKey="type" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Type</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="units" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Units</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="nav" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>NAV / Unit</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="amount" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Amount</SortableTableHead>
                <TableHead className="pr-6">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedActivityLedger.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-6">{row.date}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.category}</TableCell>
                  <TableCell>
                    <Badge variant={["UnitIssue", "BonusIssue", "Deposit", "Bonus"].includes(row.type) ? "default" : "destructive"}>{row.type}</Badge>
                    {row.auditStatus !== "active" && <Badge variant="outline" className="ml-2">{row.auditStatus === "reversal" ? "Reversal" : "Reverted"}</Badge>}
                  </TableCell>
                  <TableCell className="text-right">{row.units ? formatUnits(row.units) : "-"}</TableCell>
                  <TableCell className="text-right">{row.navPerUnit ? Number(row.navPerUnit).toFixed(6) : "-"}</TableCell>
                  <TableCell className={`text-right font-semibold ${row.amount >= 0 ? "" : "text-red-400"}`}>{formatMoney(row.amount)}</TableCell>
                  <TableCell className="pr-6 text-muted-foreground">{row.notes || "-"}</TableCell>
                </TableRow>
              ))}
              {sortedActivityLedger.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">No investor activity.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
