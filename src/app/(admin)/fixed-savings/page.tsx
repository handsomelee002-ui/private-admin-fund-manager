import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddFixedSavingsMovementForm } from "@/components/AddFixedSavingsMovementForm";
import { NotesTableCell } from "@/components/NotesTableCell";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getInvestors } from "@/actions/investors";
import { getFixedSavingsLedger } from "@/lib/fundDb";
import { formatMoney } from "@/lib/formatting";
import { timeAsync } from "@/lib/serverTiming";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { Banknote } from "lucide-react";

export const dynamic = "force-dynamic";

const fixedSavingsSorts = ["date", "investor", "type", "amount"] as const;

export default async function FixedSavingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, fixedSavingsSorts, { sort: "date", dir: "desc" });
  const [records, investors] = await Promise.all([
    timeAsync("route.fixedSavings.getFixedSavingsLedger", () => getFixedSavingsLedger(), { route: "/fixed-savings" }),
    timeAsync("route.fixedSavings.getInvestors", () => getInvestors(), { route: "/fixed-savings" }),
  ]);
  const sortedRecords = sortRows(records, sortState, {
    date: (record: any) => record.date,
    investor: (record: any) => record.investor_name,
    type: (record: any) => record.type,
    amount: (record: any) => record.amount,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fixed Savings</h1>
          <p className="text-muted-foreground mt-1 text-sm">Liability book excluded from equity unit NAV.</p>
        </div>
        <div className="flex items-center gap-2">
          <AddFixedSavingsMovementForm investors={investors} />
        </div>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-base">Savings Ledger</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <SortableTableHead className="w-[116px] pl-6" sortKey="date" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Date</SortableTableHead>
                <SortableTableHead className="w-[180px]" sortKey="investor" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Investor</SortableTableHead>
                <SortableTableHead className="w-[116px]" sortKey="type" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Type</SortableTableHead>
                <SortableTableHead className="w-[160px] text-right" sortKey="amount" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Amount</SortableTableHead>
                <TableHead className="w-[180px] pr-6">Notes</TableHead>
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
                  <NotesTableCell value={record.notes} />
                </TableRow>
              ))}
              {sortedRecords.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                    No fixed savings records.
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
