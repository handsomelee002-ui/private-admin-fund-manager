import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getInvestorStatementByPortalAccessId } from "@/lib/fundDb";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Banknote, Percent, TrendingUp, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const activitySorts = ["date", "ledger", "type", "units", "nav", "amount"] as const;

export default async function InvestorPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ portal_access_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { portal_access_id } = await params;
  const resolvedSearchParams = await searchParams;
  const headerStore = await headers();
  const forwardedFor = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || headerStore.get("x-real-ip") || "unknown";
  const userAgent = headerStore.get("user-agent") || "unknown";
  const clientKey = createHash("sha256").update(`${ip}|${userAgent}`).digest("base64url");
  const sortState = getSortState(resolvedSearchParams, activitySorts, { sort: "date", dir: "desc" });
  const statement = await getInvestorStatementByPortalAccessId(portal_access_id, { clientKey, userAgent }).catch(() => null);
  if (!statement) notFound();
  const activeActivityLedger = statement.activityLedger.filter((row: any) => row.auditStatus === "active");
  const sortedActivityLedger = sortRows(activeActivityLedger, sortState, {
    date: (row: any) => row.date,
    ledger: (row: any) => row.category,
    type: (row: any) => row.type,
    units: (row: any) => row.units,
    nav: (row: any) => row.navPerUnit,
    amount: (row: any) => row.amount,
  });

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{statement.investor.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Investor activity, units, cash movements, bonuses, and fixed savings.</p>
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
              <p className="mt-1 text-xs text-muted-foreground">{formatMoney(statement.savingsInterest)} accrued</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-base">Activity Ledger</CardTitle></CardHeader>
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
    </div>
  );
}
