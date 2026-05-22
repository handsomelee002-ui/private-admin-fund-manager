import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getInvestorStatement } from "@/lib/fundDb";
import { requireInvestorAccess } from "@/lib/auth";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Banknote, Percent, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const portalUnitSorts = ["date", "type", "units", "amount"] as const;

export default async function InvestorPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ investor_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { investor_id } = await params;
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, portalUnitSorts, { sort: "date", dir: "desc" });
  await requireInvestorAccess(investor_id);
  const statement = await getInvestorStatement(investor_id);
  if (!statement) notFound();
  const sortedUnitLedger = sortRows(statement.unitLedger, sortState, {
    date: (row: any) => row.date,
    type: (row: any) => row.type,
    units: (row: any) => row.units,
    amount: (row: any) => row.gross_amount,
  });

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Investor Portal</h1>
          <p className="text-muted-foreground mt-1">Welcome, {statement.investor.name}.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Market Value</CardTitle>
              <Wallet className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{formatMoney(statement.marketValue)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Units</CardTitle>
              <Percent className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{formatUnits(statement.units)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Ownership</CardTitle>
              <Percent className="h-4 w-4 text-violet-400" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold text-violet-400">{statement.ownershipPercent.toFixed(4)}%</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Fixed Savings</CardTitle>
              <Banknote className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold text-amber-400">{formatMoney(statement.savingsBalance)}</div></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Unit Activity</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead className="pl-6" sortKey="date" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Date</SortableTableHead>
                  <SortableTableHead sortKey="type" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Type</SortableTableHead>
                  <SortableTableHead className="text-right" sortKey="units" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Units</SortableTableHead>
                  <SortableTableHead className="text-right pr-6" sortKey="amount" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Amount</SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedUnitLedger.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-6">{row.date}</TableCell>
                    <TableCell>{row.type}</TableCell>
                    <TableCell className="text-right">{formatUnits(row.units)}</TableCell>
                    <TableCell className="text-right pr-6">{formatMoney(row.gross_amount)}</TableCell>
                  </TableRow>
                ))}
                {sortedUnitLedger.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">No unit activity.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
