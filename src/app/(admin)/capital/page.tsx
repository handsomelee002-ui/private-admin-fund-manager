import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddCashMovementForm } from "@/components/AddCashMovementForm";
import { NotesTableCell } from "@/components/NotesTableCell";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getInvestors } from "@/actions/investors";
import { getCashMovements } from "@/lib/fundDb";
import { formatMoney } from "@/lib/formatting";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { ArrowRightLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const capitalSorts = ["date", "investor", "type", "amount", "nav"] as const;

export default async function CapitalLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, capitalSorts, { sort: "date", dir: "desc" });
  const [records, investors] = await Promise.all([
    timeAsync("route.capital.getCashMovements", () => getCashMovements(), { route: "/capital" }),
    timeAsync("route.capital.getInvestors", () => getInvestors(), { route: "/capital" }),
  ]);
  const sortedRecords = sortRows(records, sortState, {
    date: (record: any) => record.date,
    investor: (record: any) => record.investor_name,
    type: (record: any) => record.type,
    amount: (record: any) => record.amount,
    nav: (record: any) => record.nav_per_unit,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Capital</h1>
          <p className="text-muted-foreground mt-1 text-sm">Deposits issue units and withdrawals redeem units at the latest locked weekly NAV.</p>
        </div>
        <div className="flex items-center gap-2">
          <AddCashMovementForm investors={investors} />
        </div>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Settled Cash Movements</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <SortableTableHead className="w-[15%] pl-6" sortKey="date" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Date</SortableTableHead>
                <SortableTableHead className="w-[18%]" sortKey="investor" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Investor</SortableTableHead>
                <SortableTableHead className="w-[12%]" sortKey="type" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Type</SortableTableHead>
                <SortableTableHead className="w-[18%] text-right" sortKey="amount" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Amount</SortableTableHead>
                <SortableTableHead className="w-[15%] text-right" sortKey="nav" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>NAV / Unit</SortableTableHead>
                <TableHead className="w-[22%] pr-6">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRecords.map((record: any) => (
                <TableRow key={record.id}>
                  <TableCell className="pl-6">{record.date}</TableCell>
                  <TableCell className="font-medium">{record.investor_name}</TableCell>
                  <TableCell>
                    <Badge variant={record.type === "Deposit" ? "default" : "destructive"}>{record.type}</Badge>
                    {record.audit_status !== "active" && <Badge variant="outline" className="ml-2">{record.audit_status === "reversal" ? "Reversal" : "Reverted"}</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(record.amount)}</TableCell>
                  <TableCell className="text-right">{record.nav_per_unit ? Number(record.nav_per_unit).toFixed(6) : "-"}</TableCell>
                  <NotesTableCell value={record.notes} previewLength={14} />
                </TableRow>
              ))}
              {sortedRecords.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    No cash movements recorded.
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
